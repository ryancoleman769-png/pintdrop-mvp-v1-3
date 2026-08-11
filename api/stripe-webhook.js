const { createStripeClient, readRawBody, syncStripeAccountToSupabase, getPintDropAppUrl } = require("./_lib/connect-helpers");
const { ensureCheckoutVoucher, processCheckoutDeliveries } = require("./_lib/fulfillment");
const Stripe = require("stripe");

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

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const webhookReceivedAt = Date.now();
      console.log("[stripe-webhook-timing]", {
        stage: "checkout.session.completed:received",
        sessionId: session.id,
        paymentStatus: session.payment_status,
        receivedAt: new Date(webhookReceivedAt).toISOString()
      });
      if (session.payment_status === "paid") {
        try {
          const result = await ensureCheckoutVoucher(session, { source: "stripe-webhook" });
          const appUrl = getPintDropAppUrl(req);
          void processCheckoutDeliveries(session.id, {
            source: "stripe-webhook",
            appUrl,
            skipSms: true
          }).catch((error) => {
            console.error("[stripe-webhook] Async delivery failed:", error);
          });
          console.log("[stripe-webhook-timing]", {
            stage: "checkout.session.completed:voucher_ready",
            sessionId: session.id,
            totalMs: Date.now() - webhookReceivedAt,
            voucherCode: result?.voucher?.code,
            fulfillmentStatus: result?.voucher?.fulfillmentStatus
          });
          console.log("[stripe-webhook] Checkout voucher ready:", {
            sessionId: session.id,
            voucherCode: result?.voucher?.code,
            fulfillmentStatus: result?.voucher?.fulfillmentStatus
          });
        } catch (error) {
          console.error("[stripe-webhook] Checkout fulfillment failed:", error);
          res.status(500).json({ ok: false, error: "Checkout fulfillment failed." });
          return;
        }
      }
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
