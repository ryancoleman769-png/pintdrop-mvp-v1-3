const {
  handleOptions,
  requirePost,
  sendJson,
  readJsonBody,
  createStripeClient,
  requireAdminKey,
  requireSupabaseServiceRole,
  supabaseRpc,
  syncStripeAccountToSupabase
} = require("../_lib/connect-helpers");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requirePost(req, res)) return;
  if (!requireAdminKey(req, res)) return;
  if (!requireSupabaseServiceRole(res)) return;

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    sendJson(res, 500, { ok: false, error: stripeResult.error });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const pubId = Number(body.pubId);

    if (!Number.isFinite(pubId) || pubId <= 0) {
      sendJson(res, 400, { ok: false, error: "pubId is required." });
      return;
    }

    const pub = await supabaseRpc("get_pub_stripe_connect", { p_pub_id: pubId });
    if (!pub) {
      sendJson(res, 404, { ok: false, error: "Pub not found." });
      return;
    }

    if (!pub.stripe_account_id) {
      sendJson(res, 200, {
        ok: true,
        pubId,
        stripeAccountId: null,
        stripeOnboardingStatus: pub.stripe_onboarding_status || "not_started",
        stripePayoutsReady: false
      });
      return;
    }

    const account = await stripeResult.stripe.accounts.retrieve(pub.stripe_account_id);
    const synced = await syncStripeAccountToSupabase(account);

    sendJson(res, 200, {
      ok: true,
      pubId,
      stripeAccountId: account.id,
      stripeOnboardingStatus: synced?.stripe_onboarding_status || pub.stripe_onboarding_status,
      stripePayoutsReady: synced?.stripe_payouts_ready || false,
      stripeChargesEnabled: synced?.stripe_charges_enabled ?? account.charges_enabled,
      stripePayoutsEnabled: synced?.stripe_payouts_enabled ?? account.payouts_enabled,
      stripeDetailsSubmitted: synced?.stripe_details_submitted ?? account.details_submitted
    });
  } catch (error) {
    console.error("[stripe-connect/account-status]", error);
    sendJson(res, 500, { ok: false, error: "Could not refresh Stripe account status." });
  }
};
