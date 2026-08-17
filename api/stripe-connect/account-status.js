const {
  handleOptions,
  requirePost,
  sendJson,
  readJsonBody,
  createStripeClient,
  requireSupabaseServiceRole,
  authorizeConnectRequest,
  loadPubStripeConnect,
  syncStripeAccountToSupabase
} = require("../_lib/connect-helpers");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requirePost(req, res)) return;
  if (!requireSupabaseServiceRole(res)) return;

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    sendJson(res, 500, { ok: false, error: stripeResult.error });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const auth = await authorizeConnectRequest(req, res, body);
    if (!auth) return;

    const pub = await loadPubStripeConnect(auth.pubId);
    if (!pub) {
      sendJson(res, 404, { ok: false, error: "Pub not found." });
      return;
    }

    if (!pub.stripe_account_id) {
      sendJson(res, 200, {
        ok: true,
        pubId: auth.pubId,
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
      pubId: auth.pubId,
      stripeAccountId: account.id,
      stripeOnboardingStatus: synced?.stripe_onboarding_status || pub.stripe_onboarding_status,
      stripePayoutsReady: synced?.stripe_payouts_ready || false,
      stripeChargesEnabled: synced?.stripe_charges_enabled ?? account.charges_enabled,
      stripePayoutsEnabled: synced?.stripe_payouts_enabled ?? account.payouts_enabled,
      stripeDetailsSubmitted: synced?.stripe_details_submitted ?? account.details_submitted,
      active: pub.active,
      onboardingStatus: pub.onboarding_status
    });
  } catch (error) {
    console.error("[stripe-connect/account-status]", error);
    sendJson(res, 500, { ok: false, error: "Could not refresh Stripe account status." });
  }
};
