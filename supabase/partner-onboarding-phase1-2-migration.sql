-- PintDrop Phase 0 + 1 + 2: Onboarding schema + customer visibility gates
-- Run manually in Supabase SQL Editor (project: ggvofckolukahshocxvd)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.
--
-- PRODUCTION SAFETY:
--   • Phase 0: Ryan's Pub (id=3) → active=false
--   • Phase 1: Additive columns on pubs; O'Flaherty's backfilled approved
--   • Phase 2: Narrow anon pub read; partner RPCs unchanged (SECURITY DEFINER)
--   • Does NOT touch Stripe fields, drinks, vouchers, partner auth, or fulfillment

BEGIN;

-- =============================================================================
-- Phase 1: Onboarding columns on public.pubs
-- =============================================================================

ALTER TABLE public.pubs
  ADD COLUMN IF NOT EXISTS onboarding_status text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS offers_bar_tab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Backfill existing rows as approved before enforcing NOT NULL
UPDATE public.pubs
SET onboarding_status = 'approved'
WHERE onboarding_status IS NULL;

-- Phase 0 + Phase 1 backfill: pilot pubs
UPDATE public.pubs
SET
  onboarding_status = 'approved',
  active = true,
  slug = coalesce(slug, 'oflahertys'),
  approved_at = coalesce(approved_at, now())
WHERE id = 1;

UPDATE public.pubs
SET
  onboarding_status = 'draft',
  active = false,
  slug = coalesce(slug, 'ryanspub')
WHERE id = 3;

ALTER TABLE public.pubs
  ALTER COLUMN onboarding_status SET DEFAULT 'draft';

ALTER TABLE public.pubs
  ALTER COLUMN onboarding_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pubs_onboarding_status_check'
      AND conrelid = 'public.pubs'::regclass
  ) THEN
    ALTER TABLE public.pubs
      ADD CONSTRAINT pubs_onboarding_status_check
      CHECK (onboarding_status IN (
        'draft',
        'pending_approval',
        'approved',
        'rejected',
        'suspended'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pubs_slug_key
  ON public.pubs (slug)
  WHERE slug IS NOT NULL;

COMMENT ON COLUMN public.pubs.onboarding_status IS
  'Partner onboarding lifecycle: draft | pending_approval | approved | rejected | suspended';
COMMENT ON COLUMN public.pubs.active IS
  'Customer-visible when true AND onboarding_status = approved (see RLS + checkout gate).';

-- =============================================================================
-- Phase 2: Customer-visible pub helper (server-side checkout gate)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_pub_customer_ready(
  p_active boolean,
  p_onboarding_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_active, false) = true
    AND p_onboarding_status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.get_pub_checkout_eligibility(p_pub_id bigint)
RETURNS json
LANGUAGE plpgsql
STABLE
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
    'active', row.active,
    'onboarding_status', row.onboarding_status,
    'customer_ready', public.is_pub_customer_ready(row.active, row.onboarding_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_pub_customer_ready(boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pub_checkout_eligibility(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_pub_customer_ready(boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pub_checkout_eligibility(bigint) TO service_role;

-- =============================================================================
-- Phase 2: RLS — narrow customer pub visibility; preserve partner draft access
-- =============================================================================

-- Replace broad public read with customer-visible + partner-own rules
DROP POLICY IF EXISTS "Public can read pubs" ON public.pubs;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'Customers can read live pubs'
  ) THEN
    CREATE POLICY "Customers can read live pubs"
      ON public.pubs
      FOR SELECT
      TO anon
      USING (
        active = true
        AND onboarding_status = 'approved'
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pubs'
      AND policyname = 'Authenticated can read live or own pub'
  ) THEN
    CREATE POLICY "Authenticated can read live or own pub"
      ON public.pubs
      FOR SELECT
      TO authenticated
      USING (
        (active = true AND onboarding_status = 'approved')
        OR id = public.current_partner_pub_id()
      );
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify (run after migration)
-- =============================================================================
-- SELECT id, name, active, onboarding_status, slug FROM public.pubs ORDER BY id;
-- SELECT policyname, roles, qual FROM pg_policies WHERE tablename = 'pubs';
-- SELECT public.get_pub_checkout_eligibility(1);
-- SELECT public.get_pub_checkout_eligibility(3);
