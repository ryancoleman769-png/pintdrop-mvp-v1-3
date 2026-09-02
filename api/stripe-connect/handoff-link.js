const {
  createStripeClient,
  readJsonBody,
  getRequestOrigin
} = require("../_lib/connect-helpers");
const { verifyHandoffToken } = require("../_lib/handoff-token");
const {
  requirePreviewOrDevelopment,
  requireStripeTestMode
} = require("../_lib/preview-only");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requirePreviewOrDevelopment(res)) return;
  if (!requireStripeTestMode(res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const token = String(body?.token || "").trim();
    const handoff = verifyHandoffToken(token);
    if (!handoff) {
      res.status(401).json({ ok: false, error: "This secure setup link is invalid or has expired." });
      return;
    }

    const stripeResult = createStripeClient();
    if (stripeResult.error) {
      res.status(500).json({ ok: false, error: stripeResult.error });
      return;
    }
    const account = await stripeResult.stripe.accounts.retrieve(handoff.stripeAccountId);
    if (
      account.livemode
      || String(account.metadata?.pub_id || "") !== String(handoff.pubId)
      || account.metadata?.preview_only !== "true"
    ) {
      res.status(403).json({ ok: false, error: "This setup link does not match the selected pub." });
      return;
    }

    const origin = getRequestOrigin(req);
    const encodedToken = encodeURIComponent(token);
    const accountLink = await stripeResult.stripe.accountLinks.create({
      account: handoff.stripeAccountId,
      type: "account_onboarding",
      collection_options: {
        fields: "eventually_due",
        future_requirements: "include"
      },
      return_url: `${origin}/payout-handoff?state=return&token=${encodedToken}`,
      refresh_url: `${origin}/payout-handoff?state=refresh&token=${encodedToken}`
    });

    res.status(200).json({ ok: true, url: accountLink.url });
  } catch (error) {
    console.error("[stripe-connect/handoff-link]", error?.code || error?.type || "Unknown error");
    res.status(500).json({ ok: false, error: "Could not open Stripe's secure setup form." });
  }
};
