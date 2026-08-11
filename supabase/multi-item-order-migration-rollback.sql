-- PintDrop: ROLLBACK for multi-item-order-migration.sql
-- Run ONLY if you need to revert after a successful multi-item migration.
-- WARNING: Deletes voucher_line_items rows. Multi-item voucher detail will be lost
-- (voucher summary columns on public.vouchers are retained).

BEGIN;

-- Remove child rows and table introduced by multi-item migration
DROP TABLE IF EXISTS public.voucher_line_items CASCADE;

DROP FUNCTION IF EXISTS public._insert_voucher_line_items(uuid, jsonb);
DROP FUNCTION IF EXISTS public._voucher_line_items_json(uuid);

-- Drop multi-item function signatures before restoring prior versions
DROP FUNCTION IF EXISTS public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean, jsonb
);

DROP FUNCTION IF EXISTS public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz, jsonb
);

-- Restore get_voucher_by_code (vouchers-rpc.sql)
CREATE OR REPLACE FUNCTION public.get_voucher_by_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE upper(vo.code) = upper(trim(p_code))
    LIMIT 1
  ) v;

  RETURN result;
END;
$$;

-- Restore get_voucher_by_stripe_session (fulfillment-migration.sql)
CREATE OR REPLACE FUNCTION public.get_voucher_by_stripe_session(p_stripe_session_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.stripe_checkout_session_id = trim(p_stripe_session_id)
    LIMIT 1
  ) v;

  RETURN result;
END;
$$;

-- Restore create_voucher (vouchers-rpc.sql)
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
  p_expires_at timestamptz
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  result json;
BEGIN
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

  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = new_id
  ) v;

  RETURN result;
END;
$$;

-- Restore fulfill_checkout_voucher (whatsapp-delivery-migration.sql)
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
  p_whatsapp_opt_in boolean DEFAULT false
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
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR trim(p_stripe_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'stripe_checkout_session_id is required';
  END IF;

  SELECT public.get_voucher_by_stripe_session(p_stripe_checkout_session_id) INTO existing;
  IF existing IS NOT NULL THEN
    RETURN existing;
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

  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = new_id
  ) v;

  RETURN result;
END;
$$;

-- Restore redeem_voucher (vouchers-rpc.sql)
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
  RETURNING vo.id INTO p_id;

  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(v) INTO result
  FROM (
    SELECT
      vo.*,
      d.slug AS drink_slug
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = p_id
  ) v;

  RETURN result;
END;
$$;

-- Restore list_vouchers_by_pub (partner-vouchers-rpc.sql)
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
      d.slug AS drink_slug
    FROM public.vouchers vo
    INNER JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.pub_id = p_pub_id
    ORDER BY vo.created_at DESC
  ) v;

  RETURN result;
END;
$$;

-- Restore grants (match pre-migration repo definitions)
REVOKE ALL ON FUNCTION public.get_voucher_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_voucher_by_stripe_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_voucher(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_vouchers_by_pub(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_voucher_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_by_stripe_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_voucher(
  text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, date, timestamptz
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz, boolean
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_vouchers_by_pub(bigint) TO anon, authenticated;

COMMIT;

-- Verify after rollback:
-- SELECT public.get_voucher_by_code('PD-DEMO1');
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'fulfill_checkout_voucher';
