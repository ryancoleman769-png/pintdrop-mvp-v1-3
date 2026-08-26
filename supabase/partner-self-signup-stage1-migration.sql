-- PintDrop Stage 1: Partner self-signup / onboarding RPCs (Preview)
-- Project: ggvofckolukahshocxvd
--
-- DO NOT auto-apply. Review first, then run manually in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP IF EXISTS where needed.
--
-- PREREQUISITES (must already exist in Production):
--   • public.pubs with onboarding_status, slug, contact_*, offers_bar_tab, approved_*
--   • public.pub_partner_users + current_partner_pub_id() / current_partner_role()
--   • public.pub_stripe_payouts_ready(...)
--   • public.drinks (per-pub rows: slug, name, icon, price, active, sort_order)
--   • Live menu RPCs get_my_pub_menu / save_my_pub_menu / _partner_menu_catalog
--     (NOT redefined here). New pubs need NO seeded drinks.rows — the live menu
--     RPC LEFT JOINs catalog→drinks and returns price=NULL, active=false, saved=false
--     until the partner saves via save_my_pub_menu.
--
-- PRODUCTION SAFETY:
--   • Additive columns + new/replaced RPCs only
--   • Does NOT set any existing pub active/approved
--   • Partners cannot self-activate (admin_* is service_role only)
--   • register_my_draft_pub never accepts client pub_id
--   • Cross-pub isolation still via current_partner_pub_id()

BEGIN;

-- =============================================================================
-- 0. Ensure customer-ready helper exists (idempotent; used by admin_approve_pub)
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

REVOKE ALL ON FUNCTION public.is_pub_customer_ready(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pub_customer_ready(boolean, text) TO service_role;

-- =============================================================================
-- 1. Additive columns for registration audit / resume
-- =============================================================================

ALTER TABLE public.pubs
  ADD COLUMN IF NOT EXISTS registration_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pubs.registration_user_id IS
  'Auth user that created this pub via register_my_draft_pub (audit / resume).';

-- At most one pub created via self-signup per auth user (NULLs allowed for legacy pubs).
CREATE UNIQUE INDEX IF NOT EXISTS pubs_registration_user_id_uidx
  ON public.pubs (registration_user_id)
  WHERE registration_user_id IS NOT NULL;

-- =============================================================================
-- 2. Unique slug helper
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_unique_pub_slug(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix integer := 1;
BEGIN
  base_slug := lower(trim(coalesce(p_name, '')));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '', 'g');
  base_slug := left(base_slug, 28);

  IF base_slug IS NULL OR base_slug = '' THEN
    base_slug := 'pub';
  END IF;

  candidate := base_slug;

  WHILE EXISTS (
    SELECT 1 FROM public.pubs p WHERE p.slug = candidate
  ) LOOP
    suffix := suffix + 1;
    candidate := left(base_slug, 28 - length(suffix::text) - 1) || '-' || suffix::text;
  END LOOP;

  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_pub_slug(text) FROM PUBLIC;
-- Called only from SECURITY DEFINER register_my_draft_pub; no direct client use.
GRANT EXECUTE ON FUNCTION public.generate_unique_pub_slug(text) TO service_role;

-- =============================================================================
-- 3. register_my_draft_pub — authenticated, one pub per user, no client pub_id
--    Creates draft pub + owner mapping only. Does NOT seed drinks rows and does
--    NOT alter drinks.price nullability (Production: price NOT NULL). Blank menu
--    UI comes from live get_my_pub_menu() catalog LEFT JOIN until save_my_pub_menu.
--    Bar Tab stays off via offers_bar_tab=false.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_my_draft_pub(
  p_pub_name text,
  p_location text,
  p_contact_name text,
  p_contact_phone text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email_confirmed timestamptz;
  v_name text := trim(coalesce(p_pub_name, ''));
  v_location text := trim(coalesce(p_location, ''));
  v_contact_name text := trim(coalesce(p_contact_name, ''));
  v_contact_phone text := trim(coalesce(p_contact_phone, ''));
  v_slug text;
  v_pub_id bigint;
  v_role text;
  result json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.email_confirmed_at
  INTO v_email_confirmed
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'Email confirmation required';
  END IF;

  IF v_name = '' OR char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Pub name is required (2–120 characters)';
  END IF;

  IF v_location = '' OR char_length(v_location) < 2 OR char_length(v_location) > 160 THEN
    RAISE EXCEPTION 'Town/location is required (2–160 characters)';
  END IF;

  IF v_contact_name = '' OR char_length(v_contact_name) < 2 OR char_length(v_contact_name) > 120 THEN
    RAISE EXCEPTION 'Contact name is required (2–120 characters)';
  END IF;

  IF v_contact_phone = '' OR char_length(v_contact_phone) < 7 OR char_length(v_contact_phone) > 40 THEN
    RAISE EXCEPTION 'Contact phone is required (7–40 characters)';
  END IF;

  -- One active partner mapping per user (also enforced by unique index).
  IF EXISTS (
    SELECT 1
    FROM public.pub_partner_users ppu
    WHERE ppu.user_id = v_uid
      AND ppu.active = true
  ) THEN
    RAISE EXCEPTION 'This account is already linked to a pub';
  END IF;

  -- One self-registered pub per auth user.
  IF EXISTS (
    SELECT 1
    FROM public.pubs p
    WHERE p.registration_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'This account already created a draft pub';
  END IF;

  v_slug := public.generate_unique_pub_slug(v_name);

  INSERT INTO public.pubs (
    name,
    location,
    active,
    onboarding_status,
    slug,
    contact_name,
    contact_phone,
    contact_email,
    offers_bar_tab,
    registration_user_id,
    stripe_onboarding_status
  )
  VALUES (
    v_name,
    v_location,
    false,
    'draft',
    v_slug,
    v_contact_name,
    v_contact_phone,
    nullif(lower(trim(coalesce((SELECT email FROM auth.users WHERE id = v_uid), ''))), ''),
    false,
    v_uid,
    'not_started'
  )
  RETURNING id INTO v_pub_id;

  INSERT INTO public.pub_partner_users (
    user_id,
    pub_id,
    role,
    active,
    created_by
  )
  VALUES (
    v_uid,
    v_pub_id,
    'owner',
    true,
    v_uid
  );

  v_role := 'owner';

  SELECT json_build_object(
    'pub_id', p.id,
    'pub_name', p.name,
    'pub_location', p.location,
    'slug', p.slug,
    'role', v_role,
    'active', p.active,
    'onboarding_status', p.onboarding_status,
    'contact_name', p.contact_name,
    'contact_phone', p.contact_phone,
    'contact_email', p.contact_email,
    'offers_bar_tab', p.offers_bar_tab,
    'submitted_at', p.submitted_at,
    'approved_at', p.approved_at
  )
  INTO result
  FROM public.pubs p
  WHERE p.id = v_pub_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.register_my_draft_pub(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_my_draft_pub(text, text, text, text) TO authenticated;

-- =============================================================================
-- 4. Extend get_my_partner_profile (additive fields; same isolation model)
-- =============================================================================

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
    'slug', p.slug,
    'role', v_role,
    'active', p.active,
    'onboarding_status', p.onboarding_status,
    'contact_name', p.contact_name,
    'contact_phone', p.contact_phone,
    'contact_email', p.contact_email,
    'offers_bar_tab', coalesce(p.offers_bar_tab, false),
    'submitted_at', p.submitted_at,
    'approved_at', p.approved_at,
    'rejection_reason', p.rejection_reason,
    'stripe_account_id', p.stripe_account_id,
    'stripe_onboarding_status', p.stripe_onboarding_status,
    'stripe_payouts_ready', public.pub_stripe_payouts_ready(
      p.stripe_account_id,
      p.stripe_charges_enabled,
      p.stripe_payouts_enabled,
      p.stripe_onboarding_status
    )
  )
  INTO result
  FROM public.pubs p
  WHERE p.id = v_pub_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_partner_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_profile() TO authenticated;

-- =============================================================================
-- 5. get_my_onboarding_status — checklist for Stage 2 UI
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_onboarding_status()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  v_pub public.pubs%ROWTYPE;
  v_email_confirmed boolean := false;
  v_has_contact boolean := false;
  v_menu_ready boolean := false;
  v_payouts_ready boolean := false;
  v_active_standard_count integer := 0;
  v_can_submit boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT (u.email_confirmed_at IS NOT NULL)
  INTO v_email_confirmed
  FROM auth.users u
  WHERE u.id = auth.uid();

  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RETURN json_build_object(
      'has_pub', false,
      'email_confirmed', coalesce(v_email_confirmed, false),
      'onboarding_status', null,
      'active', false,
      'checklist', json_build_object(
        'account_verified', coalesce(v_email_confirmed, false),
        'pub_details', false,
        'menu_ready', false,
        'payouts_ready', false,
        'submitted', false,
        'approved', false
      ),
      'can_submit_for_approval', false
    );
  END IF;

  SELECT * INTO v_pub FROM public.pubs WHERE id = v_pub_id;

  v_has_contact :=
    nullif(trim(coalesce(v_pub.name, '')), '') IS NOT NULL
    AND nullif(trim(coalesce(v_pub.location, '')), '') IS NOT NULL
    AND nullif(trim(coalesce(v_pub.contact_name, '')), '') IS NOT NULL
    AND nullif(trim(coalesce(v_pub.contact_phone, '')), '') IS NOT NULL;

  -- Menu is "ready" only after save_my_pub_menu creates real drinks rows:
  -- at least one active standard (non-tab) drink with a valid price.
  -- Unsaved catalog items from get_my_pub_menu (no drinks row) do not count.
  SELECT count(*)::integer
  INTO v_active_standard_count
  FROM public.drinks d
  WHERE d.pub_id = v_pub_id
    AND d.active = true
    AND d.slug IS DISTINCT FROM 'tab'
    AND d.price IS NOT NULL
    AND d.price > 0;

  v_menu_ready := v_active_standard_count >= 1;

  v_payouts_ready := public.pub_stripe_payouts_ready(
    v_pub.stripe_account_id,
    v_pub.stripe_charges_enabled,
    v_pub.stripe_payouts_enabled,
    v_pub.stripe_onboarding_status
  );

  v_can_submit :=
    coalesce(v_email_confirmed, false)
    AND v_has_contact
    AND v_menu_ready
    AND v_payouts_ready
    AND v_pub.onboarding_status IN ('draft', 'rejected')
    AND coalesce(v_pub.active, false) = false;

  RETURN json_build_object(
    'has_pub', true,
    'pub_id', v_pub.id,
    'pub_name', v_pub.name,
    'email_confirmed', coalesce(v_email_confirmed, false),
    'onboarding_status', v_pub.onboarding_status,
    'active', coalesce(v_pub.active, false),
    'submitted_at', v_pub.submitted_at,
    'approved_at', v_pub.approved_at,
    'rejection_reason', v_pub.rejection_reason,
    'checklist', json_build_object(
      'account_verified', coalesce(v_email_confirmed, false),
      'pub_details', v_has_contact,
      'menu_ready', v_menu_ready,
      'payouts_ready', v_payouts_ready,
      'submitted', v_pub.onboarding_status IN ('pending_approval', 'approved'),
      'approved', v_pub.onboarding_status = 'approved' AND coalesce(v_pub.active, false) = true
    ),
    'active_standard_drink_count', v_active_standard_count,
    'can_submit_for_approval', v_can_submit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_onboarding_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_onboarding_status() TO authenticated;

-- =============================================================================
-- 6. submit_my_pub_for_approval — partner cannot set active/approved
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_my_pub_for_approval()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  v_status json;
  v_can_submit boolean;
  result json;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  v_status := public.get_my_onboarding_status();
  v_can_submit := coalesce((v_status->>'can_submit_for_approval')::boolean, false);

  IF NOT v_can_submit THEN
    RAISE EXCEPTION 'Onboarding is not complete enough to submit for approval';
  END IF;

  UPDATE public.pubs p
  SET
    onboarding_status = 'pending_approval',
    submitted_at = now(),
    rejection_reason = NULL,
    -- Hard guarantee: partners never self-activate via this RPC.
    active = false
  WHERE p.id = v_pub_id
    AND p.onboarding_status IN ('draft', 'rejected')
    AND coalesce(p.active, false) = false
  RETURNING json_build_object(
    'pub_id', p.id,
    'pub_name', p.name,
    'onboarding_status', p.onboarding_status,
    'active', p.active,
    'submitted_at', p.submitted_at
  ) INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Pub could not be submitted for approval';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_my_pub_for_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_my_pub_for_approval() TO authenticated;

-- =============================================================================
-- 7. Admin approve / reject — service_role ONLY
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_pub(
  p_pub_id bigint,
  p_approved_by text DEFAULT 'pintdrop-admin'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF p_pub_id IS NULL OR p_pub_id <= 0 THEN
    RAISE EXCEPTION 'pub_id is required';
  END IF;

  UPDATE public.pubs p
  SET
    onboarding_status = 'approved',
    active = true,
    approved_at = now(),
    approved_by = nullif(trim(coalesce(p_approved_by, '')), ''),
    rejection_reason = NULL
  WHERE p.id = p_pub_id
    AND p.onboarding_status = 'pending_approval'
  RETURNING json_build_object(
    'pub_id', p.id,
    'pub_name', p.name,
    'slug', p.slug,
    'onboarding_status', p.onboarding_status,
    'active', p.active,
    'approved_at', p.approved_at,
    'approved_by', p.approved_by,
    'customer_ready', public.is_pub_customer_ready(p.active, p.onboarding_status)
  ) INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Pub % cannot be approved (must be pending_approval)', p_pub_id;
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_pub(
  p_pub_id bigint,
  p_rejection_reason text DEFAULT NULL,
  p_rejected_by text DEFAULT 'pintdrop-admin'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  v_reason text := nullif(trim(coalesce(p_rejection_reason, '')), '');
BEGIN
  IF p_pub_id IS NULL OR p_pub_id <= 0 THEN
    RAISE EXCEPTION 'pub_id is required';
  END IF;

  UPDATE public.pubs p
  SET
    onboarding_status = 'rejected',
    active = false,
    rejection_reason = v_reason,
    approved_at = NULL,
    approved_by = nullif(trim(coalesce(p_rejected_by, '')), '')
  WHERE p.id = p_pub_id
    AND p.onboarding_status IN ('pending_approval', 'draft', 'approved')
  RETURNING json_build_object(
    'pub_id', p.id,
    'pub_name', p.name,
    'slug', p.slug,
    'onboarding_status', p.onboarding_status,
    'active', p.active,
    'rejection_reason', p.rejection_reason,
    'customer_ready', public.is_pub_customer_ready(p.active, p.onboarding_status)
  ) INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Pub % cannot be rejected', p_pub_id;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_pub(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_approve_pub(bigint, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_pub(bigint, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_reject_pub(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reject_pub(bigint, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_pub(bigint, text, text) TO service_role;

COMMIT;

-- =============================================================================
-- Verify (run manually after apply — read-only)
-- =============================================================================
-- SELECT proname, prosecdef
-- FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
--   AND proname IN (
--     'generate_unique_pub_slug',
--     'register_my_draft_pub',
--     'get_my_partner_profile',
--     'get_my_onboarding_status',
--     'submit_my_pub_for_approval',
--     'admin_approve_pub',
--     'admin_reject_pub'
--   );
--
-- SELECT grantee, privilege_type, routine_name
-- FROM information_schema.routine_privileges
-- WHERE routine_schema = 'public'
--   AND routine_name LIKE '%draft_pub%'
--    OR routine_name LIKE 'admin_%_pub'
--    OR routine_name = 'submit_my_pub_for_approval';
