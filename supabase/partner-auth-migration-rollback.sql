-- PintDrop Phase 1+2 rollback: Partner Auth foundation
-- Run manually in Supabase SQL Editor if partner-auth-migration.sql must be reversed.
--
-- WARNING: This removes partner auth infrastructure. The live app will continue using
-- legacy anon RPCs (list_vouchers_by_pub, redeem_voucher, etc.) unchanged.
--
-- Does NOT delete auth.users rows or any voucher/order data.

BEGIN;

-- =============================================================================
-- 1. Restore Stripe Connect RPC grants (match pre-partner-auth live drift state)
--    If you had already corrected grants before rollback, re-apply stripe-connect-pubs.sql
--    for service_role-only access instead of this block.
-- =============================================================================

REVOKE ALL ON FUNCTION public.get_pub_stripe_connect(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_pub_stripe_connect(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) TO service_role;

-- Restore anon grants if they existed before partner-auth migration (live drift state).
-- Comment out these two lines if your pre-migration state was service_role-only.
GRANT EXECUTE ON FUNCTION public.get_pub_stripe_connect(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) TO anon, authenticated;

-- =============================================================================
-- 2. Drop new partner RPCs
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_my_pub_stripe_connect();
DROP FUNCTION IF EXISTS public.redeem_voucher_for_partner(uuid, text);
DROP FUNCTION IF EXISTS public.get_voucher_for_partner_redemption(text);
DROP FUNCTION IF EXISTS public.list_my_pub_vouchers();
DROP FUNCTION IF EXISTS public.get_my_partner_profile();

-- =============================================================================
-- 3. Drop helper functions
-- =============================================================================

DROP FUNCTION IF EXISTS public.assert_partner_pub_access(bigint);
DROP FUNCTION IF EXISTS public.current_partner_role();
DROP FUNCTION IF EXISTS public.current_partner_pub_id();
DROP FUNCTION IF EXISTS public.is_partner_user();

-- =============================================================================
-- 4. Drop RLS policies added on vouchers / voucher_line_items
-- =============================================================================

DROP POLICY IF EXISTS "Partners can read own pub vouchers" ON public.vouchers;
DROP POLICY IF EXISTS "Partners can read own pub voucher line items" ON public.voucher_line_items;

-- =============================================================================
-- 5. Drop pub_partner_users table (policies drop with table)
-- =============================================================================

DROP TABLE IF EXISTS public.pub_partner_users;

COMMIT;
