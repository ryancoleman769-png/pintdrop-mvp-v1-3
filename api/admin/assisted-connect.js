const {
  requireAdminAuth,
  createStripeClient,
  readJsonBody,
  getRequestOrigin,
  loadPubStripeConnect
} = require("../_lib/connect-helpers");
const {
  AssistedOnboardingValidationError,
  validateAssistedOnboardingInput,
  buildStripeAccountCreateParams,
  buildStripeRepresentativeParams,
  buildAssistedIdempotencyKey
} = require("../_lib/assisted-onboarding");
const { createHandoffToken } = require("../_lib/handoff-token");
const {
  requirePreviewOrDevelopment,
  requireStripeTestMode
} = require("../_lib/preview-only");

function stripePublicError(error) {
  if (error?.type === "StripeInvalidRequestError" || error?.type === "StripeCardError") {
    return "Stripe could not accept one of the supplied details. Check the form and try again.";
  }
  return "Could not prepare the Stripe test account. Please try again.";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requirePreviewOrDevelopment(res)) return;
  if (!requireStripeTestMode(res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!requireAdminAuth(req, res)) return;

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    res.status(500).json({ ok: false, error: stripeResult.error });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const details = validateAssistedOnboardingInput(body);
    const pub = await loadPubStripeConnect(details.pubId);
    if (!pub) {
      res.status(404).json({ ok: false, error: "The selected pub could not be found." });
      return;
    }

    const idempotencyKey = buildAssistedIdempotencyKey(details);
    const account = await stripeResult.stripe.accounts.create(
      buildStripeAccountCreateParams(pub, details),
      { idempotencyKey }
    );

    if (account.livemode) {
      throw new Error("Preview created a live Stripe account unexpectedly.");
    }

    let representativePrefilled = details.businessType !== "company";
    let representativeWarning = "";
    const representative = buildStripeRepresentativeParams(details);
    if (representative) {
      try {
        await stripeResult.stripe.accounts.createPerson(
          account.id,
          representative,
          { idempotencyKey: `${idempotencyKey}-representative` }
        );
        representativePrefilled = true;
      } catch (error) {
        representativeWarning = "Stripe will ask the pub representative to confirm their personal details.";
        console.warn(
          "[admin/assisted-connect] representative prefill skipped",
          error?.code || error?.type || "stripe_error"
        );
      }
    }

    const token = createHandoffToken({
      pubId: details.pubId,
      stripeAccountId: account.id
    });
    const origin = getRequestOrigin(req);
    const handoffUrl = `${origin}/payout-handoff?token=${encodeURIComponent(token)}`;

    res.status(200).json({
      ok: true,
      previewOnly: true,
      pub: {
        id: Number(pub.id),
        name: String(pub.name || ""),
        location: String(pub.location || "")
      },
      stripeAccountId: account.id,
      stripeMode: "test",
      ibanLast4: details.iban.slice(-4),
      representativePrefilled,
      warning: representativeWarning,
      handoffUrl
    });
  } catch (error) {
    if (error instanceof AssistedOnboardingValidationError) {
      res.status(error.statusCode || 400).json({ ok: false, error: error.message });
      return;
    }

    console.error(
      "[admin/assisted-connect]",
      error?.code || error?.type || error?.message || "Unknown error"
    );
    res.status(500).json({ ok: false, error: stripePublicError(error) });
  }
};
