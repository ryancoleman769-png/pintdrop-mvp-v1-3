const Stripe = require("stripe");
const {
  createStripeClient,
  readRawBody,
  syncStripeAccountToSupabase
} = require("./_lib/connect-helpers");

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) {
    res.status(500).json({ ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured on the server." });
    return;
  }

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    res.status(500).json({ ok: false, error: stripeResult.error });
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    res.status(400).json({ ok: false, error: "Missing Stripe signature." });
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("[stripe-webhook] Signature verification failed:", error);
    res.status(400).json({ ok: false, error: "Invalid webhook signature." });
    return;
  }

  try {
    if (event.type === "account.updated") {
      const account = event.data.object;
      await syncStripeAccountToSupabase(account);
    }

    res.status(200).json({ ok: true, received: true, type: event.type });
  } catch (error) {
    console.error("[stripe-webhook] Handler failed:", error);
    res.status(500).json({ ok: false, error: "Webhook handler failed." });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
