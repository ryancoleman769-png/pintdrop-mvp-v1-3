-- PintDrop: Authenticated partner voucher list for Recent redemptions
-- Run manually in Supabase SQL Editor (project: ggvofckolukahshocxvd)
-- Requires: public.current_partner_pub_id() from partner-auth-migration.sql
--
-- PRODUCTION SAFETY:
--   • No client-supplied pub_id — pub derived from auth.uid() → pub_partner_users
--   • authenticated EXECUTE only (anon cannot list vouchers)
--   • Does NOT modify voucher rows, checkout RPCs, or legacy redeem_voucher grants

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_pub_vouchers()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  partner_pub_id bigint;
  result json;
BEGIN
  partner_pub_id := public.current_partner_pub_id();
  IF partner_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required';
  END IF;

  SELECT coalesce(
    json_agg(row_to_json(v) ORDER BY v.created_at DESC),
    '[]'::json
  )
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
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.pub_id = partner_pub_id
  ) v;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_pub_vouchers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_pub_vouchers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_pub_vouchers() TO authenticated;

COMMIT;
