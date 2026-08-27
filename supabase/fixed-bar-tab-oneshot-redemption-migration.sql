-- PintDrop: one-shot redemption for fixed Bar Tab presets (tab-20 / tab-30)
-- Run manually in Supabase SQL Editor after review.
-- Do NOT apply automatically. Do NOT run against Production unless Preview testing needs it.
--
-- DEPENDS ON (already live):
--   • public.current_partner_pub_id()
--   • public._voucher_is_expired(timestamptz)          -- Step 11D
--   • public._voucher_is_bar_tab(uuid)                 -- Step 10A
--   • public._voucher_line_items_json(uuid)
--   • public._bar_tab_redemptions_json(uuid)
--   • vouchers.bar_tab_original_balance / remaining / total_redeemed
--
-- THIS MIGRATION:
--   • tab-20 and tab-30 redeem once via redeem_voucher_for_partner, like a pint
--   • On success: status waiting -> redeemed, redeemed_at set, remaining -> 0
--   • Legacy slug 'tab' (variable/partial) still rejected here; use redeem_bar_tab_for_partner
--   • Pint / wine / cocktail / spirit path unchanged except NULL balance columns stay NULL
--   • Isolation still via current_partner_pub_id(); no anon EXECUTE
--
-- Safe to re-run: CREATE OR REPLACE only. No voucher DML.

BEGIN;

CREATE OR REPLACE FUNCTION public._voucher_is_fixed_bar_tab_preset(p_voucher_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vouchers vo
    JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = p_voucher_id
      AND lower(coalesce(d.slug, '')) IN ('tab-20', 'tab-30')
  );
$$;

REVOKE ALL ON FUNCTION public._voucher_is_fixed_bar_tab_preset(uuid) FROM PUBLIC;

-- Legacy partial Bar Tab only (slug 'tab' or name match). Fixed presets are not partial.
CREATE OR REPLACE FUNCTION public._voucher_is_bar_tab(p_voucher_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vouchers vo
    LEFT JOIN public.drinks d ON d.id = vo.drink_id
    WHERE vo.id = p_voucher_id
      AND NOT public._voucher_is_fixed_bar_tab_preset(vo.id)
      AND (
        lower(coalesce(d.slug, '')) = 'tab'
        OR EXISTS (
          SELECT 1
          FROM public.voucher_line_items vli
          JOIN public.drinks d2 ON d2.id = vli.drink_id
          WHERE vli.voucher_id = vo.id
            AND lower(d2.slug) = 'tab'
        )
        OR lower(coalesce(vo.drink_name, '')) LIKE '%bar tab%'
      )
  );
$$;

REVOKE ALL ON FUNCTION public._voucher_is_bar_tab(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.redeem_voucher_for_partner(
  p_id uuid DEFAULT NULL,
  p_code text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  v_voucher_pub_id bigint;
  v_voucher_id uuid;
  v_expires_at timestamptz;
  v_status text;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL AND (p_code IS NULL OR trim(p_code) = '') THEN
    RAISE EXCEPTION 'Voucher id or code is required';
  END IF;

  SELECT vo.id, vo.pub_id, vo.expires_at, vo.status
  INTO v_voucher_id, v_voucher_pub_id, v_expires_at, v_status
  FROM public.vouchers vo
  WHERE (
      (p_id IS NOT NULL AND vo.id = p_id)
      OR (p_code IS NOT NULL AND upper(vo.code) = upper(trim(p_code)))
    )
  LIMIT 1;

  -- Wrong pub or unknown voucher: same as today (no leak)
  IF v_voucher_id IS NULL OR v_voucher_pub_id IS DISTINCT FROM v_pub_id THEN
    RETURN NULL;
  END IF;

  IF public._voucher_is_expired(v_expires_at) THEN
    RAISE EXCEPTION 'This voucher has expired and cannot be redeemed';
  END IF;

  -- Legacy variable Bar Tab only. tab-20 / tab-30 fall through as one-shot.
  IF public._voucher_is_bar_tab(v_voucher_id) THEN
    RAISE EXCEPTION 'Bar Tab vouchers must be redeemed with an amount via redeem_bar_tab_for_partner';
  END IF;

  -- One-time redeem. Duplicate scans match 0 rows (status is no longer waiting).
  -- Pint balances stay NULL. Fixed Bar Tab remaining is closed out to 0.
  UPDATE public.vouchers vo
  SET
    status = 'redeemed',
    redeemed_at = now(),
    bar_tab_remaining_balance = CASE
      WHEN vo.bar_tab_remaining_balance IS NULL THEN NULL
      ELSE 0
    END,
    bar_tab_total_redeemed = CASE
      WHEN vo.bar_tab_original_balance IS NOT NULL THEN vo.bar_tab_original_balance
      WHEN vo.bar_tab_remaining_balance IS NOT NULL THEN round(vo.drink_price, 2)
      ELSE vo.bar_tab_total_redeemed
    END
  WHERE vo.id = v_voucher_id
    AND vo.status = 'waiting'
    AND vo.pub_id = v_pub_id
  RETURNING vo.id INTO v_voucher_id;

  IF v_voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT row_to_json(v)
    FROM (
      SELECT
        vo.*,
        d.slug AS drink_slug,
        public._voucher_line_items_json(vo.id) AS line_items,
        public._bar_tab_redemptions_json(vo.id) AS bar_tab_redemptions
      FROM public.vouchers vo
      LEFT JOIN public.drinks d ON d.id = vo.drink_id
      WHERE vo.id = v_voucher_id
    ) v
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_voucher_for_partner(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_partner(uuid, text) TO authenticated;

COMMIT;
