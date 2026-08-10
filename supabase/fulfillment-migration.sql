-- PintDrop: server-side checkout fulfillment (run once in Supabase SQL Editor)
-- Adds recipient email, Stripe session idempotency, and delivery status tracking.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS sender_email text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sms_delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sender_email_delivery_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS recipient_email_delivery_status text NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS sms_message_sid text,
  ADD COLUMN IF NOT EXISTS sender_email_id text,
  ADD COLUMN IF NOT EXISTS recipient_email_id text,
  ADD COLUMN IF NOT EXISTS delivery_error text;

CREATE UNIQUE INDEX IF NOT EXISTS vouchers_stripe_checkout_session_id_uidx
  ON public.vouchers (stripe_checkout_session_id);

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
  p_expires_at timestamptz
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
    recipient_email_delivery_status
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
    recipient_delivery_status
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

CREATE OR REPLACE FUNCTION public.update_voucher_delivery_status(
  p_stripe_checkout_session_id text,
  p_channel text,
  p_status text,
  p_external_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  normalized_status text;
BEGIN
  normalized_status := lower(trim(coalesce(p_status, '')));

  IF p_stripe_checkout_session_id IS NULL OR trim(p_stripe_checkout_session_id) = '' THEN
    RAISE EXCEPTION 'stripe_checkout_session_id is required';
  END IF;

  UPDATE public.vouchers vo
  SET
    fulfillment_status = CASE
      WHEN p_channel = 'fulfillment' THEN normalized_status
      ELSE vo.fulfillment_status
    END,
    sms_delivery_status = CASE
      WHEN p_channel = 'sms' AND vo.sms_delivery_status IN ('pending', 'processing', 'failed')
        THEN normalized_status
      ELSE vo.sms_delivery_status
    END,
    sms_message_sid = CASE
      WHEN p_channel = 'sms' AND vo.sms_delivery_status IN ('pending', 'processing', 'failed')
        THEN nullif(trim(coalesce(p_external_id, '')), '')
      ELSE vo.sms_message_sid
    END,
    sender_email_delivery_status = CASE
      WHEN p_channel = 'sender_email' AND vo.sender_email_delivery_status IN ('pending', 'processing', 'failed')
        THEN normalized_status
      ELSE vo.sender_email_delivery_status
    END,
    sender_email_id = CASE
      WHEN p_channel = 'sender_email' AND vo.sender_email_delivery_status IN ('pending', 'processing', 'failed')
        THEN nullif(trim(coalesce(p_external_id, '')), '')
      ELSE vo.sender_email_id
    END,
    recipient_email_delivery_status = CASE
      WHEN p_channel = 'recipient_email' AND vo.recipient_email_delivery_status IN ('pending', 'processing', 'failed')
        THEN normalized_status
      ELSE vo.recipient_email_delivery_status
    END,
    recipient_email_id = CASE
      WHEN p_channel = 'recipient_email' AND vo.recipient_email_delivery_status IN ('pending', 'processing', 'failed')
        THEN nullif(trim(coalesce(p_external_id, '')), '')
      ELSE vo.recipient_email_id
    END,
    delivery_error = CASE
      WHEN normalized_status = 'failed' THEN nullif(trim(coalesce(p_error, '')), '')
      ELSE vo.delivery_error
    END
  WHERE vo.stripe_checkout_session_id = trim(p_stripe_checkout_session_id);

  UPDATE public.vouchers vo
  SET fulfillment_status = CASE
    WHEN vo.sms_delivery_status = 'sent'
      AND vo.sender_email_delivery_status IN ('sent', 'skipped')
      AND vo.recipient_email_delivery_status IN ('sent', 'skipped')
      THEN 'completed'
    WHEN vo.sms_delivery_status = 'failed'
      OR vo.sender_email_delivery_status = 'failed'
      OR vo.recipient_email_delivery_status = 'failed'
      THEN 'partial'
    ELSE vo.fulfillment_status
  END
  WHERE vo.stripe_checkout_session_id = trim(p_stripe_checkout_session_id);

  SELECT public.get_voucher_by_stripe_session(p_stripe_checkout_session_id) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_voucher_by_stripe_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_voucher_delivery_status(
  text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_voucher_by_stripe_session(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_checkout_voucher(
  text, text, bigint, bigint, text, text, text, text, numeric, numeric, numeric,
  text, text, text, text, text, text, date, timestamptz
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_voucher_delivery_status(
  text, text, text, text, text
) TO anon, authenticated;
