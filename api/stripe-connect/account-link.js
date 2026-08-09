const {
  getRequestOrigin,
  handleOptions,
  requirePost,
  sendJson,
  readJsonBody,
  createStripeClient,
  requireAdminKey,
  requireSupabaseServiceRole,
  supabaseRpc
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
      sendJson(res, 400, {
        ok: false,
        error: "Pub does not have a Stripe connected account yet. Create one first."
      });
      return;
    }

    const origin = getRequestOrigin(req);
    const accountLink = await stripeResult.stripe.accountLinks.create({
      account: pub.stripe_account_id,
      type: "account_onboarding",
      return_url: origin + "/?view=partner&connect=return&pubId=" + pubId,
      refresh_url: origin + "/?view=partner&connect=refresh&pubId=" + pubId
    });

    sendJson(res, 200, {
      ok: true,
      pubId,
      stripeAccountId: pub.stripe_account_id,
      url: accountLink.url
    });
  } catch (error) {
    console.error("[stripe-connect/account-link]", error);
    sendJson(res, 500, { ok: false, error: "Could not create Stripe onboarding link." });
  }
};
