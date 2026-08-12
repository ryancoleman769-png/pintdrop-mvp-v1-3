-- PintDrop Phase 0 + 1 + 2 ROLLBACK
-- Run manually in Supabase SQL Editor only if reverting onboarding schema + gates.
-- WARNING: Restores broad public pub read (draft pubs visible again if active=true).

BEGIN;

-- =============================================================================
-- Phase 2 rollback: restore original public read policy
-- =============================================================================

DROP POLICY IF EXISTS "Customers can read live pubs" ON public.pubs;
DROP POLICY IF EXISTS "Authenticated can read live or own pub" ON public.pubs;

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

-- =============================================================================
-- Phase 2 rollback: drop checkout eligibility helpers
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_pub_checkout_eligibility(bigint);
DROP FUNCTION IF EXISTS public.is_pub_customer_ready(boolean, text);

-- =============================================================================
-- Phase 1 rollback: drop onboarding columns + constraints
-- =============================================================================

DROP INDEX IF EXISTS public.pubs_slug_key;

ALTER TABLE public.pubs
  DROP CONSTRAINT IF EXISTS pubs_onboarding_status_check;

ALTER TABLE public.pubs
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS offers_bar_tab,
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_name,
  DROP COLUMN IF EXISTS onboarding_status;

-- =============================================================================
-- Phase 0 rollback note: Ryan's Pub was active=true before Phase 0.
-- Uncomment only if you intentionally want to restore pre-Phase-0 visibility.
-- =============================================================================
-- UPDATE public.pubs SET active = true WHERE id = 3;

COMMIT;
