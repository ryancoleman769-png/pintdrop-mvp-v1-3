-- PintDrop Phase 2: Stripe Connect columns on pubs + RLS review
-- Run once in Supabase SQL Editor (project: ggvofckolukahshocxvd)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
-- Does NOT change vouchers, checkout, or existing pub rows beyond new NULL columns.

-- =============================================================================
-- 0. Inspect current RLS (read-only — note results before changing policies)
-- =============================================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'pubs';

-- =============================================================================
-- 1. Stripe Connect columns on public.pubs
-- =============================================================================

ALTER TABLE public.pubs
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS stripe_onboarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_connect_updated_at timestamptz;

-- Enforce allowed onboarding status values (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pubs_stripe_onboarding_status_check'
      AND conrelid = 'public.pubs'::regclass
  ) THEN
    ALTER TABLE public.pubs
      ADD CONSTRAINT pubs_stripe_onboarding_status_check
      CHECK (stripe_onboarding_status IN (
        'not_started',
        'pending',
        'complete',
        'restricted',
        'disabled'
      ));
  END IF;
END $$;

-- One Stripe account per pub; allow many NULLs
CREATE UNIQUE INDEX IF NOT EXISTS pubs_stripe_account_id_key
  ON public.pubs (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pubs_stripe_onboarding_status_idx
  ON public.pubs (stripe_onboarding_status);

COMMENT ON COLUMN public.pubs.stripe_account_id IS
  'Stripe Connect Express account id (acct_...). Set by PintDrop server only.';
COMMENT ON COLUMN public.pubs.stripe_onboarding_status IS
  'not_started | pending | complete | restricted | disabled';
COMMENT ON COLUMN public.pubs.active IS
  'Pub visible to customers. Future rule: require stripe onboarding complete before active=true.';

-- =============================================================================
-- 2. Helper: derive payouts-ready from stored Stripe flags
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pub_stripe_payouts_ready(
  p_stripe_account_id text,
  p_stripe_charges_enabled boolean,
  p_stripe_payouts_enabled boolean,
  p_stripe_onboarding_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_stripe_account_id IS NOT NULL
    AND coalesce(p_stripe_charges_enabled, false) = true
    AND coalesce(p_stripe_payouts_enabled, false) = true
    AND p_stripe_onboarding_status = 'complete';
$$;

-- =============================================================================
-- 3. Server-only RPC: update Stripe Connect fields on a pub
--    Callable from Vercel (service_role) and Stripe webhooks — NOT from browser.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_pub_stripe_connect(
  p_pub_id bigint,
  p_stripe_account_id text DEFAULT NULL,
  p_stripe_charges_enabled boolean DEFAULT NULL,
  p_stripe_payouts_enabled boolean DEFAULT NULL,
  p_stripe_details_submitted boolean DEFAULT NULL,
  p_stripe_onboarding_status text DEFAULT NULL,
  p_set_onboarded_at boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.pubs%ROWTYPE;
BEGIN
  IF p_pub_id IS NULL THEN
    RAISE EXCEPTION 'pub_id is required';
  END IF;

  IF p_stripe_onboarding_status IS NOT NULL
     AND p_stripe_onboarding_status NOT IN (
       'not_started', 'pending', 'complete', 'restricted', 'disabled'
     ) THEN
    RAISE EXCEPTION 'Invalid stripe_onboarding_status: %', p_stripe_onboarding_status;
  END IF;

  UPDATE public.pubs
  SET
    stripe_account_id = coalesce(p_stripe_account_id, stripe_account_id),
    stripe_charges_enabled = coalesce(p_stripe_charges_enabled, stripe_charges_enabled),
    stripe_payouts_enabled = coalesce(p_stripe_payouts_enabled, stripe_payouts_enabled),
    stripe_details_submitted = coalesce(p_stripe_details_submitted, stripe_details_submitted),
    stripe_onboarding_status = coalesce(p_stripe_onboarding_status, stripe_onboarding_status),
    stripe_onboarded_at = CASE
      WHEN p_set_onboarded_at THEN now()
      ELSE stripe_onboarded_at
    END,
    stripe_connect_updated_at = now()
  WHERE id = p_pub_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pub not found: %', p_pub_id;
  END IF;

  RETURN json_build_object(
    'id', updated_row.id,
    'name', updated_row.name,
    'active', updated_row.active,
    'stripe_account_id', updated_row.stripe_account_id,
    'stripe_charges_enabled', updated_row.stripe_charges_enabled,
    'stripe_payouts_enabled', updated_row.stripe_payouts_enabled,
    'stripe_details_submitted', updated_row.stripe_details_submitted,
    'stripe_onboarding_status', updated_row.stripe_onboarding_status,
    'stripe_onboarded_at', updated_row.stripe_onboarded_at,
    'stripe_payouts_ready', public.pub_stripe_payouts_ready(
      updated_row.stripe_account_id,
      updated_row.stripe_charges_enabled,
      updated_row.stripe_payouts_enabled,
      updated_row.stripe_onboarding_status
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_pub_stripe_connect(
  bigint, text, boolean, boolean, boolean, text, boolean
) TO service_role;

-- =============================================================================
-- 4. Server-only RPC: load pub Connect state for checkout / onboarding APIs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_pub_stripe_connect(p_pub_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.pubs%ROWTYPE;
BEGIN
  IF p_pub_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO row
  FROM public.pubs
  WHERE id = p_pub_id;

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

REVOKE ALL ON FUNCTION public.get_pub_stripe_connect(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_pub_stripe_connect(bigint) TO service_role;

-- =============================================================================
-- 5. RLS review on public.pubs
--    Goal: anon/authenticated may READ pubs (customer pub list unchanged).
--          anon/authenticated must NOT WRITE Stripe fields (server-only).
-- =============================================================================

ALTER TABLE public.pubs ENABLE ROW LEVEL SECURITY;

-- Public read (customer journey — keep working)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'Public can read pubs'
  ) THEN
    CREATE POLICY "Public can read pubs"
      ON public.pubs
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Block direct client writes (admin/server uses service_role which bypasses RLS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'No public insert on pubs'
  ) THEN
    CREATE POLICY "No public insert on pubs"
      ON public.pubs
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'No public update on pubs'
  ) THEN
    CREATE POLICY "No public update on pubs"
      ON public.pubs
      FOR UPDATE
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'No public delete on pubs'
  ) THEN
    CREATE POLICY "No public delete on pubs"
      ON public.pubs
      FOR DELETE
      TO anon, authenticated
      USING (false);
  END IF;
END $$;

-- =============================================================================
-- 6. Verify (run after migration — expect new columns, O'Flaherty's unchanged)
-- =============================================================================

SELECT
  id,
  name,
  location,
  active,
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted,
  stripe_onboarding_status,
  stripe_onboarded_at,
  public.pub_stripe_payouts_ready(
    stripe_account_id,
    stripe_charges_enabled,
    stripe_payouts_enabled,
    stripe_onboarding_status
  ) AS stripe_payouts_ready
FROM public.pubs
ORDER BY id;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'pubs'
ORDER BY policyname;
