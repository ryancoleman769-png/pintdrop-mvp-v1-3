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
  if (process.env.VERCEL_ENV !== "preview" && !requireAdminKey(req, res)) return;
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

    const existing = await supabaseRpc("get_pub_stripe_connect", { p_pub_id: pubId });
    if (!existing) {
      sendJson(res, 404, { ok: false, error: "Pub not found." });
      return;
    }

    if (existing.stripe_account_id) {
      sendJson(res, 200, {
        ok: true,
        pubId,
        stripeAccountId: existing.stripe_account_id,
        stripeOnboardingStatus: existing.stripe_onboarding_status,
        stripePayoutsReady: existing.stripe_payouts_ready,
        reused: true
      });
      return;
    }

    const account = await stripeResult.stripe.accounts.create({
      type: "express",
      country: "IE",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: {
        pub_id: String(pubId),
        pintdrop_pub_id: String(pubId),
        pub_name: String(existing.name || "")
      }
    });

    const synced = await syncStripeAccountToSupabase(account);

    sendJson(res, 200, {
      ok: true,
      pubId,
      stripeAccountId: account.id,
      stripeOnboardingStatus: synced?.stripe_onboarding_status || "pending",
      stripePayoutsReady: synced?.stripe_payouts_ready || false,
      reused: false
    });
  } catch (error) {
    console.error("[stripe-connect/create-account]", error);
    sendJson(res, 500, { ok: false, error: "Could not create Stripe connected account." });
  }
};
