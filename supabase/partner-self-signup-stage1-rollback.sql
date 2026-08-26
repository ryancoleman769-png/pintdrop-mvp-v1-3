-- PintDrop Stage 1 ROLLBACK: Partner self-signup / onboarding RPCs
-- Project: ggvofckolukahshocxvd
--
-- DO NOT auto-apply. Review first, then run manually if Stage 1 must be undone.
--
-- Behaviour:
--   • Drops Stage 1 RPCs / helpers introduced by partner-self-signup-stage1-migration.sql
--   • Restores get_my_partner_profile() to the pre-Stage-1 return shape
--   • Removes registration_user_id column + unique index
--   • Does NOT delete pubs, drinks, or pub_partner_users rows created while Stage 1 was live
--     (those remain as draft/inactive data — safe for customer listings)
--   • Does NOT drop is_pub_customer_ready (may pre-exist from onboarding migration)
--   • Does NOT touch get_my_pub_menu / save_my_pub_menu

BEGIN;

-- Partner-callable Stage 1 RPCs
DROP FUNCTION IF EXISTS public.register_my_draft_pub(text, text, text, text);
DROP FUNCTION IF EXISTS public.get_my_onboarding_status();
DROP FUNCTION IF EXISTS public.submit_my_pub_for_approval();

-- Helpers introduced by Stage 1
DROP FUNCTION IF EXISTS public.generate_unique_pub_slug(text);
DROP FUNCTION IF EXISTS public.seed_standard_pub_drinks(bigint);

-- Admin RPCs (service_role)
DROP FUNCTION IF EXISTS public.admin_approve_pub(bigint, text);
DROP FUNCTION IF EXISTS public.admin_reject_pub(bigint, text, text);

-- Restore pre-Stage-1 partner profile shape (pub from current_partner_pub_id only).
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

REVOKE ALL ON FUNCTION public.get_my_partner_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_profile() TO authenticated;

DROP INDEX IF EXISTS public.pubs_registration_user_id_uidx;

ALTER TABLE public.pubs
  DROP COLUMN IF EXISTS registration_user_id;

COMMIT;

-- Optional manual cleanup after rollback (NOT included — run only if desired):
--   SELECT id, name, active, onboarding_status, slug
--   FROM public.pubs
--   WHERE onboarding_status = 'draft' AND active = false
--   ORDER BY id DESC;
