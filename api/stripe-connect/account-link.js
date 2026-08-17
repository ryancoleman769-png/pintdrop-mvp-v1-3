const {
  getRequestOrigin,
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

    const origin = getRequestOrigin(req);
    const accountLink = await stripeResult.stripe.accountLinks.create({
      account: ensured.stripeAccountId,
      type: "account_onboarding",
      return_url: origin + "/?view=partner&connect=return",
      refresh_url: origin + "/?view=partner&connect=refresh"
    });

    sendJson(res, 200, {
      ok: true,
      pubId: auth.pubId,
      stripeAccountId: ensured.stripeAccountId,
      url: accountLink.url,
      accountCreated: ensured.created === true,
      accountReused: ensured.reused === true
    });
  } catch (error) {
    console.error("[stripe-connect/account-link]", error);
    sendJson(res, 500, { ok: false, error: "Could not create Stripe onboarding link." });
  }
};
