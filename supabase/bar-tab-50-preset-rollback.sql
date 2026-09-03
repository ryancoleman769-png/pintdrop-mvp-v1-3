-- PintDrop: rollback €50 Bar Tab preset support
-- Re-applies the previous €20/€30 menu functions.
-- Existing tab-50 rows are deliberately left untouched and become unavailable.

-- PintDrop: multiple fixed Bar Tab presets per pub
-- Run manually in Supabase SQL Editor after review.
-- Do NOT apply automatically. Do NOT run against Production unless Preview testing needs it.
--
-- CURRENT STORAGE (before this migration):
--   • public.drinks has UNIQUE (pub_id, slug)
--   • Bar Tab is a single drink row with slug = 'tab' and one price
--   • pubs.offers_bar_tab is the on/off flag
--   • save_my_pub_menu / get_my_pub_menu / _partner_menu_catalog only allow slug 'tab'
--
-- THIS MIGRATION:
--   • Adds catalog slugs tab-20 / tab-30 (one drinks row per amount)
--   • Keeps legacy slug 'tab' so existing rows are not rewritten
--   • Does not UPDATE or DELETE existing drink prices
--   • Does not change Stripe, vouchers, redemption, signup, or pub isolation
--
-- Safe to re-run: CREATE OR REPLACE only. No data backfill.

BEGIN;

CREATE OR REPLACE FUNCTION public._partner_drink_is_bar_tab(p_slug text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_slug, '') IN ('tab', 'tab-20', 'tab-30')
      OR coalesce(p_slug, '') LIKE 'tab-%';
$$;

REVOKE ALL ON FUNCTION public._partner_drink_is_bar_tab(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._partner_menu_catalog()
RETURNS TABLE (
  slug text,
  name text,
  icon text,
  sort_order integer,
  is_bar_tab boolean
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('pint',     'Pint',           '🍺', 1, false),
    ('wine',     'Glass of Wine',  '🍷', 2, false),
    ('cocktail', 'Cocktail',       '🍸', 3, false),
    ('spirit',   'Spirit & Mixer', '🥃', 4, false),
    ('tab',      'Bar Tab',        '💶', 5, true),
    ('tab-20',   '€20 Bar Tab',    '💶', 6, true),
    ('tab-30',   '€30 Bar Tab',    '💶', 7, true)
  ) AS catalog(slug, name, icon, sort_order, is_bar_tab);
$$;

CREATE OR REPLACE FUNCTION public.pub_menu_is_configured(p_pub_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.drinks d
    WHERE d.pub_id = p_pub_id
      AND d.slug IN ('pint', 'wine', 'cocktail', 'spirit')
      AND d.active = true
      AND public._partner_menu_price_valid(d.price)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.drinks d
    WHERE d.pub_id = p_pub_id
      AND d.active = true
      AND (
        d.slug IN ('pint', 'wine', 'cocktail', 'spirit')
        OR public._partner_drink_is_bar_tab(d.slug)
      )
      AND NOT public._partner_menu_price_valid(d.price)
  );
$$;

REVOKE ALL ON FUNCTION public.pub_menu_is_configured(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pub_menu_is_configured(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_pub_menu()
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

  SELECT json_build_object(
    'pub_id', v_pub_id,
    'menu_configured', public.pub_menu_is_configured(v_pub_id),
    'offers_bar_tab', coalesce(p.offers_bar_tab, false),
    'items', coalesce(json_agg(row_to_json(item) ORDER BY item.sort_order), '[]'::json)
  )
  INTO result
  FROM public.pubs p
  CROSS JOIN LATERAL (
    SELECT
      c.slug,
      c.name,
      c.icon,
      c.sort_order,
      c.is_bar_tab,
      d.id AS drink_id,
      CASE WHEN d.id IS NULL THEN NULL ELSE d.price END AS price,
      coalesce(d.active, false) AS active,
      (d.id IS NOT NULL) AS saved
    FROM public._partner_menu_catalog() c
    LEFT JOIN public.drinks d
      ON d.pub_id = v_pub_id
     AND d.slug = c.slug
  ) item
  WHERE p.id = v_pub_id
  GROUP BY p.id, p.offers_bar_tab;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_my_pub_menu(p_menu jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_id bigint;
  v_offers_bar_tab boolean := false;
  v_items jsonb;
  v_item jsonb;
  v_slug text;
  v_price numeric;
  v_active boolean;
  v_catalog record;
  v_seen_slugs text[] := ARRAY[]::text[];
  v_standard_active_count integer := 0;
  v_preset_active_count integer := 0;
BEGIN
  v_pub_id := public.current_partner_pub_id();

  IF v_pub_id IS NULL THEN
    RAISE EXCEPTION 'Partner authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_menu IS NULL OR jsonb_typeof(p_menu) <> 'object' THEN
    RAISE EXCEPTION 'Invalid menu payload';
  END IF;

  v_items := coalesce(p_menu -> 'items', '[]'::jsonb);
  v_offers_bar_tab := coalesce((p_menu ->> 'offers_bar_tab')::boolean, false);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'At least one drink is required';
  END IF;

  IF jsonb_array_length(v_items) > 8 THEN
    RAISE EXCEPTION 'Too many menu items';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_slug := lower(trim(coalesce(v_item ->> 'slug', '')));

    IF v_slug = '' THEN
      RAISE EXCEPTION 'Each menu item must include a slug';
    END IF;

    IF v_slug = ANY (v_seen_slugs) THEN
      RAISE EXCEPTION 'Duplicate menu item: %', v_slug;
    END IF;

    v_seen_slugs := array_append(v_seen_slugs, v_slug);

    SELECT * INTO v_catalog
    FROM public._partner_menu_catalog() c
    WHERE c.slug = v_slug;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid drink type: %', v_slug;
    END IF;

    IF v_catalog.is_bar_tab AND NOT v_offers_bar_tab THEN
      RAISE EXCEPTION 'Enable Bar Tab before configuring it';
    END IF;

    v_active := coalesce((v_item ->> 'active')::boolean, false);

    IF v_slug IN ('tab-20', 'tab-30') THEN
      IF v_active THEN
        v_price := split_part(v_slug, '-', 2)::numeric;
        v_preset_active_count := v_preset_active_count + 1;
      ELSE
        v_price := NULL;
      END IF;
    ELSIF NOT (v_item ? 'price') OR v_item ->> 'price' IS NULL OR trim(v_item ->> 'price') = '' THEN
      IF v_active THEN
        RAISE EXCEPTION 'Price is required for %', v_catalog.name;
      END IF;
      v_price := NULL;
    ELSE
      BEGIN
        v_price := round((v_item ->> 'price')::numeric, 2);
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Invalid price for %', v_catalog.name;
      END;

      IF v_active AND NOT public._partner_menu_price_valid(v_price) THEN
        RAISE EXCEPTION 'Invalid price for %', v_catalog.name;
      END IF;
    END IF;

    IF v_active AND v_price IS NULL THEN
      RAISE EXCEPTION 'Price is required for %', v_catalog.name;
    END IF;

    IF v_active AND NOT v_catalog.is_bar_tab THEN
      v_standard_active_count := v_standard_active_count + 1;
    END IF;

    IF v_active THEN
      INSERT INTO public.drinks (
        pub_id,
        slug,
        name,
        price,
        icon,
        active,
        sort_order
      )
      VALUES (
        v_pub_id,
        v_catalog.slug,
        v_catalog.name,
        v_price,
        v_catalog.icon,
        true,
        v_catalog.sort_order
      )
      ON CONFLICT (pub_id, slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        icon = EXCLUDED.icon,
        active = true,
        sort_order = EXCLUDED.sort_order;
    ELSE
      UPDATE public.drinks d
      SET active = false
      WHERE d.pub_id = v_pub_id
        AND d.slug = v_catalog.slug;

      IF v_price IS NOT NULL AND public._partner_menu_price_valid(v_price) THEN
        INSERT INTO public.drinks (
          pub_id,
          slug,
          name,
          price,
          icon,
          active,
          sort_order
        )
        VALUES (
          v_pub_id,
          v_catalog.slug,
          v_catalog.name,
          v_price,
          v_catalog.icon,
          false,
          v_catalog.sort_order
        )
        ON CONFLICT (pub_id, slug)
        DO UPDATE SET
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          icon = EXCLUDED.icon,
          active = false,
          sort_order = EXCLUDED.sort_order;
      END IF;
    END IF;
  END LOOP;

  IF v_standard_active_count < 1 THEN
    RAISE EXCEPTION 'At least one standard drink must be available with a price';
  END IF;

  IF v_offers_bar_tab AND v_preset_active_count < 1 THEN
    RAISE EXCEPTION 'Choose at least one Bar Tab amount (€20 or €30).';
  END IF;

  UPDATE public.pubs
  SET offers_bar_tab = v_offers_bar_tab
  WHERE id = v_pub_id;

  IF NOT v_offers_bar_tab THEN
    UPDATE public.drinks
    SET active = false
    WHERE pub_id = v_pub_id
      AND public._partner_drink_is_bar_tab(slug);
  ELSIF v_preset_active_count > 0 THEN
    -- Keep the legacy tab row and its price, but hide it once presets are saved.
    UPDATE public.drinks
    SET active = false
    WHERE pub_id = v_pub_id
      AND slug = 'tab';
  END IF;

  RETURN public.get_my_pub_menu();
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_pub_menu() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_my_pub_menu(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_pub_menu() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_pub_menu(jsonb) TO authenticated;

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

  SELECT count(*)::integer
  INTO v_active_standard_count
  FROM public.drinks d
  WHERE d.pub_id = v_pub_id
    AND d.active = true
    AND NOT public._partner_drink_is_bar_tab(d.slug)
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

COMMIT;

-- Verify after apply:
-- SELECT * FROM public._partner_menu_catalog() ORDER BY sort_order;
-- SELECT slug, price, active FROM public.drinks WHERE slug LIKE 'tab%' ORDER BY pub_id, slug;
