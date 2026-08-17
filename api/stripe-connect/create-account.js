const {
  handleOptions,
  requirePost,
  sendJson,
  readJsonBody,
  createStripeClient,
  requireSupabaseServiceRole,
  authorizeConnectRequest,
  ensureStripeConnectAccount
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

    const ensured = await ensureStripeConnectAccount(stripeResult.stripe, auth.pubId);
    if (ensured.error) {
      sendJson(res, ensured.status || 500, { ok: false, error: ensured.error });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      pubId: auth.pubId,
      stripeAccountId: ensured.stripeAccountId,
      stripeOnboardingStatus: ensured.pub?.stripe_onboarding_status || "pending",
      stripePayoutsReady: ensured.pub?.stripe_payouts_ready || false,
      reused: ensured.reused === true
    });
  } catch (error) {
    console.error("[stripe-connect/create-account]", error);
    sendJson(res, 500, { ok: false, error: "Could not create Stripe connected account." });
  }
};
