-- PintDrop: multi-item orders (additive, backward-compatible)
-- Run once in Supabase SQL Editor. Safe on shared Preview/Production DB:
--   - Adds new table only (no drops/alters to existing voucher rows)
--   - Extends RPCs with optional p_line_items; legacy single-drink calls unchanged
--
-- IMPORTANT: Execute this entire script as one transaction (BEGIN … COMMIT below).
--
-- RPCs REPLACED/UPDATED by this migration:
--   1. public.fulfill_checkout_voucher  — DROP old signature, CREATE with p_line_items
--   2. public.create_voucher            — DROP old signature, CREATE with p_line_items
--   3. public.get_voucher_by_code       — CREATE OR REPLACE (adds line_items to JSON)
--   4. public.get_voucher_by_stripe_session — CREATE OR REPLACE (adds line_items)
--   5. public.redeem_voucher            — CREATE OR REPLACE (return shape adds line_items)
--   6. public.list_vouchers_by_pub      — CREATE OR REPLACE (adds line_items)
-- NEW:
--   7. public.voucher_line_items        — table
--   8. public._insert_voucher_line_items  — internal helper (not granted to clients)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Child table for order line items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voucher_line_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id    uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  drink_id      bigint REFERENCES public.drinks(id),
  drink_name    text NOT NULL,
  drink_icon    text,
  unit_price    numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  quantity      integer NOT NULL CHECK (quantity > 0),
  line_subtotal numeric(10, 2) NOT NULL CHECK (line_subtotal >= 0),
  sort_order    smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voucher_line_items_voucher_id_idx
  ON public.voucher_line_items (voucher_id, sort_order);

ALTER TABLE public.voucher_line_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Internal helper — line items JSON for a voucher (empty array if none)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._voucher_line_items_json(p_voucher_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    json_agg(
      json_build_object(
        'drink_id', vli.drink_id,
        'drink_name', vli.drink_name,
        'drink_icon', vli.drink_icon,
        'unit_price', vli.unit_price,
        'quantity', vli.quantity,
        'line_subtotal', vli.line_subtotal,
        'sort_order', vli.sort_order
      )
      ORDER BY vli.sort_order, vli.created_at
    ),
    '[]'::json
  )
  FROM public.voucher_line_items vli
  WHERE vli.voucher_id = p_voucher_id;
$$;

REVOKE ALL ON FUNCTION public._voucher_line_items_json(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._voucher_line_items_json(uuid) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Insert line items from checkout JSON (called inside fulfill/create only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._insert_voucher_line_items(
  p_voucher_id uuid,
  p_line_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  idx integer := 0;
  v_drink_id bigint;
  v_name text;
  v_icon text;
  v_unit_price numeric;
  v_quantity integer;
  v_subtotal numeric;
BEGIN
  IF p_voucher_id IS NULL THEN
    RAISE EXCEPTION 'voucher_id is required';
  END IF;

  IF p_line_items IS NULL
    OR jsonb_typeof(p_line_items) <> 'array'
    OR jsonb_array_length(p_line_items) = 0 THEN
    RETURN;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_line_items) AS t(value) LOOP
    idx := idx + 1;
    v_drink_id := nullif(trim(coalesce(item->>'drink_id', '')), '')::bigint;
    v_name := trim(coalesce(item->>'drink_name', ''));
    v_icon := nullif(trim(coalesce(item->>'drink_icon', '')), '');
    v_unit_price := (item->>'unit_price')::numeric;
    v_quantity := (item->>'quantity')::integer;
    v_subtotal := round(v_unit_price * v_quantity, 2);

    IF v_name = '' OR v_quantity IS NULL OR v_quantity <= 0 OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid line item at index %', idx;
    END IF;

    IF abs(v_subtotal - coalesce((item->>'line_subtotal')::numeric, v_subtotal)) > 0.01 THEN
      RAISE EXCEPTION 'Line subtotal mismatch at index %', idx;
    END IF;

    INSERT INTO public.voucher_line_items (
      voucher_id,
      drink_id,
      drink_name,
      drink_icon,
      unit_price,
      quantity,
      line_subtotal,
      sort_order
    )
    VALUES (
      p_voucher_id,
      v_drink_id,
      v_name,
      v_icon,
      v_unit_price,
      v_quantity,
      v_subtotal,
      coalesce((item->>'sort_order')::smallint, idx::smallint)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._insert_voucher_line_items(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._insert_voucher_line_items(uuid, jsonb) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_voucher_by_code — adds line_items; LEFT JOIN drinks for multi-item safety
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_voucher_by_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  voucher_id uuid;
BEGIN
  SELECT vo.id INTO voucher_id
  FROM public.vouchers vo
  WHERE upper(vo.code) = upper(trim(p_code))
  LIMIT 1;

  IF voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug,
      public._voucher_line_items_json(vo.id) AS line_items
    FROM public.vouchers vo
    LEFT JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = voucher_id
  ) v;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_voucher_by_stripe_session — adds line_items
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_voucher_by_stripe_session(p_stripe_session_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  voucher_id uuid;
BEGIN
  SELECT vo.id INTO voucher_id
  FROM public.vouchers vo
  WHERE vo.stripe_checkout_session_id = trim(p_stripe_session_id)
  LIMIT 1;

  IF voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug,
      public._voucher_line_items_json(vo.id) AS line_items
    FROM public.vouchers vo
    LEFT JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = voucher_id
  ) v;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. create_voucher — optional p_line_items (legacy path when NULL/[])
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz
);

CREATE OR REPLACE FUNCTION public.create_voucher(
  p_code text,
  p_pub_id bigint,
  p_drink_id bigint,
  p_pub_name text,
  p_pub_location text,
  p_drink_name text,
  p_drink_icon text,
  p_drink_price numeric,
  p_service_fee numeric,
  p_total numeric,
  p_recipient_name text,
  p_recipient_phone text,
  p_sender_name text,
  p_message text,
  p_delivery_date date,
  p_expires_at timestamptz,
  p_line_items jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  result json;
  computed_pub_value numeric := 0;
  expected_fee numeric := 0;
BEGIN
  expected_fee := round(p_drink_price * 0.15, 2);

  IF abs(p_service_fee - expected_fee) > 0.01 THEN
    RAISE EXCEPTION 'service_fee must be 15%% of drink_price';
  END IF;

  IF abs(p_total - (p_drink_price + p_service_fee)) > 0.01 THEN
    RAISE EXCEPTION 'total must equal drink_price + service_fee';
  END IF;

  IF p_line_items IS NOT NULL
    AND jsonb_typeof(p_line_items) = 'array'
    AND jsonb_array_length(p_line_items) > 0 THEN
    SELECT coalesce(sum((elem->>'line_subtotal')::numeric), 0)
    INTO computed_pub_value
    FROM jsonb_array_elements(p_line_items) AS t(elem);

    IF abs(computed_pub_value - p_drink_price) > 0.01 THEN
      RAISE EXCEPTION 'drink_price must equal sum of line item subtotals';
    END IF;
  END IF;

  INSERT INTO public.vouchers (
    code,
    pub_id,
    drink_id,
    pub_name,
    pub_location,
    drink_name,
    drink_icon,
    drink_price,
    service_fee,
    total,
    recipient_name,
    recipient_phone,
    sender_name,
    message,
    delivery_date,
    status,
    expires_at,
    redeemed_at
  )
  VALUES (
    upper(trim(p_code)),
    p_pub_id,
    p_drink_id,
    p_pub_name,
    p_pub_location,
    p_drink_name,
    p_drink_icon,
    p_drink_price,
    p_service_fee,
    p_total,
    p_recipient_name,
    p_recipient_phone,
    p_sender_name,
    p_message,
    p_delivery_date,
    'waiting',
    p_expires_at,
    NULL
  )
  RETURNING id INTO new_id;

  PERFORM public._insert_voucher_line_items(new_id, p_line_items);

  SELECT public.get_voucher_by_code(
    (SELECT code FROM public.vouchers WHERE id = new_id)
  ) INTO result;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. fulfill_checkout_voucher — optional p_line_items (Stripe fulfillment path)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz
);

DROP FUNCTION IF EXISTS public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean
);

CREATE OR REPLACE FUNCTION public.fulfill_checkout_voucher(
  p_stripe_checkout_session_id text,
  p_code text,
  p_pub_id bigint,
  p_drink_id bigint,
  p_pub_name text,
  p_pub_location text,
  p_drink_name text,
  p_drink_icon text,
  p_drink_price numeric,
  p_service_fee numeric,
  p_total numeric,
  p_recipient_name text,
  p_recipient_phone text,
  p_recipient_email text,
  p_sender_name text,
  p_sender_email text,
  p_message text,
  p_delivery_date date,
  p_expires_at timestamptz,
  p_whatsapp_opt_in boolean DEFAULT false,
  p_line_items jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing json;
  new_id uuid;
  result json;
  normalized_email text;
  recipient_delivery_status text;
  whatsapp_status text;
  computed_pub_value numeric := 0;
  expected_fee numeric := 0;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR trim(p_stripe_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'stripe_checkout_session_id is required';
  END IF;

  SELECT public.get_voucher_by_stripe_session(p_stripe_checkout_session_id) INTO existing;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  expected_fee := round(p_drink_price * 0.15, 2);

  IF abs(p_service_fee - expected_fee) > 0.01 THEN
    RAISE EXCEPTION 'service_fee must be 15%% of drink_price';
  END IF;

  IF abs(p_total - (p_drink_price + p_service_fee)) > 0.01 THEN
    RAISE EXCEPTION 'total must equal drink_price + service_fee';
  END IF;

  IF p_line_items IS NOT NULL
    AND jsonb_typeof(p_line_items) = 'array'
    AND jsonb_array_length(p_line_items) > 0 THEN
    SELECT coalesce(sum((elem->>'line_subtotal')::numeric), 0)
    INTO computed_pub_value
    FROM jsonb_array_elements(p_line_items) AS t(elem);

    IF abs(computed_pub_value - p_drink_price) > 0.01 THEN
      RAISE EXCEPTION 'drink_price must equal sum of line item subtotals';
    END IF;
  END IF;

  normalized_email := nullif(lower(trim(coalesce(p_recipient_email, ''))), '');
  recipient_delivery_status := CASE
    WHEN normalized_email IS NULL THEN 'skipped'
    ELSE 'pending'
  END;
  whatsapp_status := CASE
    WHEN coalesce(p_whatsapp_opt_in, false) THEN 'pending'
    ELSE 'skipped'
  END;

  INSERT INTO public.vouchers (
    code,
    pub_id,
    drink_id,
    pub_name,
    pub_location,
    drink_name,
    drink_icon,
    drink_price,
    service_fee,
    total,
    recipient_name,
    recipient_phone,
    recipient_email,
    sender_name,
    sender_email,
    message,
    delivery_date,
    status,
    expires_at,
    redeemed_at,
    stripe_checkout_session_id,
    fulfillment_status,
    sms_delivery_status,
    sender_email_delivery_status,
    recipient_email_delivery_status,
    whatsapp_opt_in,
    whatsapp_delivery_status
  )
  VALUES (
    upper(trim(p_code)),
    p_pub_id,
    p_drink_id,
    p_pub_name,
    p_pub_location,
    p_drink_name,
    p_drink_icon,
    p_drink_price,
    p_service_fee,
    p_total,
    p_recipient_name,
    p_recipient_phone,
    normalized_email,
    p_sender_name,
    nullif(lower(trim(coalesce(p_sender_email, ''))), ''),
    p_message,
    p_delivery_date,
    'waiting',
    p_expires_at,
    NULL,
    trim(p_stripe_checkout_session_id),
    'processing',
    'pending',
    'pending',
    recipient_delivery_status,
    coalesce(p_whatsapp_opt_in, false),
    whatsapp_status
  )
  ON CONFLICT (stripe_checkout_session_id) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    SELECT public.get_voucher_by_stripe_session(p_stripe_checkout_session_id) INTO existing;
    RETURN existing;
  END IF;

  PERFORM public._insert_voucher_line_items(new_id, p_line_items);

  SELECT public.get_voucher_by_stripe_session(p_stripe_checkout_session_id) INTO result;
  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. redeem_voucher — return shape adds line_items (logic unchanged)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_voucher(
  p_id uuid DEFAULT NULL,
  p_code text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  voucher_id uuid;
BEGIN
  IF p_id IS NULL AND (p_code IS NULL OR trim(p_code) = '') THEN
    RAISE EXCEPTION 'Voucher id or code is required';
  END IF;

  UPDATE public.vouchers vo
  SET
    status = 'redeemed',
    redeemed_at = now()
  WHERE vo.status = 'waiting'
    AND (
      (p_id IS NOT NULL AND vo.id = p_id)
      OR (p_code IS NOT NULL AND upper(vo.code) = upper(trim(p_code)))
    )
  RETURNING vo.id INTO voucher_id;

  IF voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_code IS NOT NULL THEN
    SELECT public.get_voucher_by_code(trim(p_code)) INTO result;
  ELSE
    SELECT public.get_voucher_by_code(
      (SELECT code FROM public.vouchers WHERE id = voucher_id)
    ) INTO result;
  END IF;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. list_vouchers_by_pub — adds line_items per voucher
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_vouchers_by_pub(p_pub_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF p_pub_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(row_to_json(v)), '[]'::json)
  INTO result
  FROM (
    SELECT
      vo.id,
      vo.code,
      vo.pub_id,
      vo.drink_id,
      vo.pub_name,
      vo.pub_location,
      vo.drink_name,
      vo.drink_icon,
      vo.drink_price,
      vo.service_fee,
      vo.total,
      vo.recipient_name,
      vo.sender_name,
      vo.message,
      vo.delivery_date,
      vo.status,
      vo.created_at,
      vo.expires_at,
      vo.redeemed_at,
      d.slug AS drink_slug,
      public._voucher_line_items_json(vo.id) AS line_items
    FROM public.vouchers vo
    LEFT JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.pub_id = p_pub_id
    ORDER BY vo.created_at DESC
  ) v;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (match existing RPC access)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_voucher_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_voucher_by_stripe_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_voucher(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_vouchers_by_pub(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_voucher_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_by_stripe_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz, jsonb
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean, jsonb
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_vouchers_by_pub(bigint) TO anon, authenticated;

COMMIT;

-- Admin verify (optional — run manually after migration):
-- SELECT json_array_length(public.list_vouchers_by_pub(1)) AS voucher_count;
-- SELECT public.get_voucher_by_code('PD-DEMO1') -> 'line_items' AS line_items;
