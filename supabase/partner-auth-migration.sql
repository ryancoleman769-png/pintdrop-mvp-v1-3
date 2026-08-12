-- PintDrop Phase 1+2: Partner Auth foundation + secure pub-scoped RPCs
-- Run manually in Supabase SQL Editor (project: ggvofckolukahshocxvd)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
--
-- PRODUCTION SAFETY:
--   • Does NOT modify existing voucher/order rows.
--   • Does NOT revoke anon grants on checkout / recipient / legacy partner RPCs.
--   • Adds new authenticated-only RPCs alongside legacy insecure ones (overlap period).
--   • Only revokes anon from Stripe Connect RPCs (server-only; not used by browser checkout).
--
-- After this migration, manually create the O'Flaherty's Auth user and pub_partner_users row
-- (see commented section at the bottom — do NOT run that block until Auth user exists).

BEGIN;

-- =============================================================================
-- 1. pub_partner_users — maps auth.users.id → pubs.id
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pub_partner_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pub_id bigint NOT NULL REFERENCES public.pubs(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'admin'
    CHECK (role IN ('owner', 'manager', 'staff', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  last_login_at timestamptz NULL,
  CONSTRAINT pub_partner_users_user_pub_key UNIQUE (user_id, pub_id)
);

COMMENT ON TABLE public.pub_partner_users IS
  'Links a Supabase Auth user to exactly one pub partner account (pilot).';

-- Pilot: at most one active pub mapping per user.
CREATE UNIQUE INDEX IF NOT EXISTS pub_partner_users_active_user_uidx
  ON public.pub_partner_users (user_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS pub_partner_users_pub_id_idx
  ON public.pub_partner_users (pub_id)
  WHERE active = true;

ALTER TABLE public.pub_partner_users ENABLE ROW LEVEL SECURITY;

-- Partners may read their own mapping row only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pub_partner_users'
      AND policyname = 'Partners can read own mapping'
  ) THEN
    CREATE POLICY "Partners can read own mapping"
      ON public.pub_partner_users
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Block all client writes; onboarding is manual via service_role / SQL editor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pub_partner_users'
      AND policyname = 'No public insert on pub_partner_users'
  ) THEN
    CREATE POLICY "No public insert on pub_partner_users"
      ON public.pub_partner_users
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pub_partner_users'
      AND policyname = 'No public update on pub_partner_users'
  ) THEN
    CREATE POLICY "No public update on pub_partner_users"
      ON public.pub_partner_users
      FOR UPDATE
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pub_partner_users'
      AND policyname = 'No public delete on pub_partner_users'
  ) THEN
    CREATE POLICY "No public delete on pub_partner_users"
      ON public.pub_partner_users
      FOR DELETE
      TO anon, authenticated
      USING (false);
  END IF;
END $$;

-- =============================================================================
-- 2. Helper functions — derive pub from auth.uid(), never trust caller pub_id
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_partner_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pub_partner_users ppu
    WHERE ppu.user_id = auth.uid()
      AND ppu.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_partner_pub_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ppu.pub_id
  FROM public.pub_partner_users ppu
  WHERE ppu.user_id = auth.uid()
    AND ppu.active = true
  ORDER BY ppu.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_partner_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ppu.role
  FROM public.pub_partner_users ppu
  WHERE ppu.user_id = auth.uid()
    AND ppu.active = true
  ORDER BY ppu.created_at ASC
  LIMIT 1;
$$;

-- Raises if the caller is not an active partner or pub_id does not match session pub.
CREATE OR REPLACE FUNCTION public.assert_partner_pub_access(p_pub_id bigint)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_pub_id IS NULL OR p_pub_id <> v_pub_id THEN
    RAISE EXCEPTION 'Access denied for pub %', coalesce(p_pub_id::text, 'NULL')
      USING ERRCODE = '42501';
  END IF;

  RETURN v_pub_id;
END;
$$;

REVOKE ALL ON FUNCTION public.is_partner_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_partner_pub_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_partner_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_partner_pub_access(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_partner_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_partner_pub_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_partner_role() TO authenticated;
-- assert_partner_pub_access: internal only (called from partner RPCs)

-- =============================================================================
-- 3. RLS foundations on vouchers + voucher_line_items (direct table access)
--    Legacy SECURITY DEFINER RPCs are unchanged; these policies support Phase 3+.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vouchers'
      AND policyname = 'Partners can read own pub vouchers'
  ) THEN
    CREATE POLICY "Partners can read own pub vouchers"
      ON public.vouchers
      FOR SELECT
      TO authenticated
      USING (pub_id = public.current_partner_pub_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'voucher_line_items'
      AND policyname = 'Partners can read own pub voucher line items'
  ) THEN
    CREATE POLICY "Partners can read own pub voucher line items"
      ON public.voucher_line_items
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.vouchers vo
          WHERE vo.id = voucher_line_items.voucher_id
            AND vo.pub_id = public.current_partner_pub_id()
        )
      );
  END IF;
END $$;

-- =============================================================================
-- 4. Authenticated partner-scoped RPCs (no caller-supplied pub_id)
-- =============================================================================

-- 4a. Partner profile (pub name, role) for future login UI
CREATE OR REPLACE FUNCTION public.get_my_partner_profile()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  v_role text;
  result json;
BEGIN
  v_pub_id := public.current_partner_pub_id();
  v_role := public.current_partner_role();

  IF v_pub_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'pub_id', p.id,
    'pub_name', p.name,
    'pub_location', p.location,
    'role', v_role,
    'active', p.active
  )
  INTO result
  FROM public.pubs p
  WHERE p.id = v_pub_id;

  RETURN result;
END;
$$;

-- 4b. Dashboard voucher list — pub derived from auth.uid()
CREATE OR REPLACE FUNCTION public.list_my_pub_vouchers()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  result json;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
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
    WHERE vo.pub_id = v_pub_id
    ORDER BY vo.created_at DESC
  ) v;

  RETURN result;
END;
$$;

-- 4c. Partner redemption lookup — omits phone/emails; pub must match session
CREATE OR REPLACE FUNCTION public.get_voucher_for_partner_redemption(p_code text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  result json;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(v) INTO result
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
    WHERE upper(vo.code) = upper(trim(p_code))
      AND vo.pub_id = v_pub_id
    LIMIT 1
  ) v;

  RETURN result;
END;
$$;

-- 4d. Partner redemption — pub ownership enforced server-side
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
  result json;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL AND (p_code IS NULL OR trim(p_code) = '') THEN
    RAISE EXCEPTION 'Voucher id or code is required';
  END IF;

  SELECT vo.id, vo.pub_id
  INTO v_voucher_id, v_voucher_pub_id
  FROM public.vouchers vo
  WHERE (
      (p_id IS NOT NULL AND vo.id = p_id)
      OR (p_code IS NOT NULL AND upper(vo.code) = upper(trim(p_code)))
    )
  LIMIT 1;

  IF v_voucher_id IS NULL OR v_voucher_pub_id IS DISTINCT FROM v_pub_id THEN
    RETURN NULL;
  END IF;

  UPDATE public.vouchers vo
  SET
    status = 'redeemed',
    redeemed_at = now()
  WHERE vo.id = v_voucher_id
    AND vo.status = 'waiting'
    AND vo.pub_id = v_pub_id
  RETURNING vo.id INTO v_voucher_id;

  IF v_voucher_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT row_to_json(v) INTO result
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
    WHERE vo.id = v_voucher_id
  ) v;

  RETURN result;
END;
$$;

-- 4e. Stripe Connect state for logged-in partner (no caller pub_id)
CREATE OR REPLACE FUNCTION public.get_my_pub_stripe_connect()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  row public.pubs%ROWTYPE;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO row
  FROM public.pubs
  WHERE id = v_pub_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', row.id,
    'name', row.name,
    'location', row.location,
    'active', row.active,
    'stripe_account_id', row.stripe_account_id,
    'stripe_charges_enabled', row.stripe_charges_enabled,
    'stripe_payouts_enabled', row.stripe_payouts_enabled,
    'stripe_details_submitted', row.stripe_details_submitted,
    'stripe_onboarding_status', row.stripe_onboarding_status,
    'stripe_onboarded_at', row.stripe_onboarded_at,
    'stripe_payouts_ready', public.pub_stripe_payouts_ready(
      row.stripe_account_id,
      row.stripe_charges_enabled,
      row.stripe_payouts_enabled,
      row.stripe_onboarding_status
    )
  );
END;
$$;

-- =============================================================================
-- 5. Grants — new RPCs authenticated-only; legacy anon RPCs UNTOUCHED
-- =============================================================================

REVOKE ALL ON FUNCTION public.get_my_partner_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_pub_vouchers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_voucher_for_partner_redemption(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_voucher_for_partner(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_pub_stripe_connect() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_partner_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_pub_vouchers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_for_partner_redemption(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_partner(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pub_stripe_connect() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5b. Safe grant correction: Stripe Connect RPCs are server-only.
--     Revoking anon/authenticated here does NOT affect checkout, SMS, QR,
--     recipient voucher view, or legacy partner redemption (list/redeem by pub).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_pub_stripe_connect(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_pub_stripe_connect(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) TO service_role;

-- =============================================================================
-- 6. PHASE 3+ — DO NOT RUN YET (overlap period documentation)
-- =============================================================================
-- After O'Flaherty's login is tested and app.js switches to authenticated RPCs,
-- manually revoke anon/authenticated execute on these legacy RPCs:
--
--   REVOKE EXECUTE ON FUNCTION public.list_vouchers_by_pub(bigint) FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.get_voucher_by_code(text) FROM anon, authenticated;
--     → replace recipient view with a limited public RPC if needed
--   REVOKE EXECUTE ON FUNCTION public.redeem_voucher(uuid, text) FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.create_voucher(...) FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.fulfill_checkout_voucher(...) FROM anon, authenticated;
--     → keep service_role only (Vercel checkout-fulfillment already uses service_role)
--   REVOKE EXECUTE ON FUNCTION public.get_voucher_by_stripe_session(text) FROM anon, authenticated;
--     → only after success-page lookup is moved server-side if required
--
-- Until those revokes, the pilot dashboard continues using list_vouchers_by_pub(1).

COMMIT;

-- =============================================================================
-- MANUAL ONBOARDING (run separately after creating Auth user — NOT part of migration)
-- =============================================================================
--
-- Step A — Supabase Dashboard → Authentication → Users → Add user
--   • Email: partner@oflahertys.ie (example)
--   • Password: (strong, share securely with pub)
--   • Auto Confirm User: ON
--
-- Step B — Copy the new user's UUID from Authentication → Users
--
-- Step C — Run in SQL editor (replace USER_UUID):
--
--   INSERT INTO public.pub_partner_users (user_id, pub_id, role, active)
--   VALUES ('USER_UUID_HERE'::uuid, 1, 'admin', true);
--
-- Step D — Verify (as that user via supabase.auth.signInWithPassword in browser console):
--
--   SELECT public.get_my_partner_profile();
--   SELECT json_array_length(public.list_my_pub_vouchers()) AS voucher_count;
