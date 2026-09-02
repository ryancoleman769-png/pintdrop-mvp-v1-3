const {
  createStripeClient,
  readJsonBody,
  loadPubStripeConnect
} = require("../_lib/connect-helpers");
const { verifyHandoffToken } = require("../_lib/handoff-token");
const {
  requirePreviewOrDevelopment,
  requireStripeTestMode
} = require("../_lib/preview-only");

function deriveStatus(account) {
  if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
    return "complete";
  }
  if (account.requirements?.disabled_reason) return "restricted";
  if (account.details_submitted) return "under_review";
  return "needs_details";
}

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
    const handoff = verifyHandoffToken(body?.token);
    if (!handoff) {
      res.status(401).json({ ok: false, error: "This secure setup link is invalid or has expired." });
      return;
    }

    const stripeResult = createStripeClient();
    if (stripeResult.error) {
      res.status(500).json({ ok: false, error: stripeResult.error });
      return;
    }
    const [account, pub] = await Promise.all([
      stripeResult.stripe.accounts.retrieve(handoff.stripeAccountId),
      loadPubStripeConnect(handoff.pubId)
    ]);

    if (
      account.livemode
      || String(account.metadata?.pub_id || "") !== String(handoff.pubId)
      || account.metadata?.preview_only !== "true"
    ) {
      res.status(403).json({ ok: false, error: "This setup link does not match the selected pub." });
      return;
    }

    const requirements = account.requirements || {};
    res.status(200).json({
      ok: true,
      previewOnly: true,
      stripeMode: "test",
      pub: {
        id: handoff.pubId,
        name: String(pub?.name || account.metadata?.pub_name || "PintDrop pub"),
        location: String(pub?.location || "")
      },
      status: deriveStatus(account),
      detailsSubmitted: account.details_submitted === true,
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      requirementsRemaining: Array.isArray(requirements.currently_due)
        ? requirements.currently_due.length
        : 0,
      expiresAt: new Date(handoff.expiresAt).toISOString()
    });
  } catch (error) {
    console.error("[stripe-connect/handoff-status]", error?.code || error?.type || "Unknown error");
    res.status(500).json({ ok: false, error: "Could not check the Stripe setup status." });
  }
};
