const {
  getVoucherByStripeSession,
  fulfillCheckoutSession,
  buildFulfillmentResponse
} = require("./_lib/fulfillment");
const { createStripeClient, readJsonBody } = require("./_lib/connect-helpers");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    res.status(500).json({ ok: false, error: stripeResult.error });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const expectedTotal = Number(body.expectedTotal);

    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const session = await stripeResult.stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(402).json({ ok: false, error: "Payment not completed.", status: "unpaid" });
      return;
    }

    if (session.currency !== "eur") {
      res.status(400).json({ ok: false, error: "Unexpected payment currency." });
      return;
    }

    if (Number.isFinite(expectedTotal) && expectedTotal > 0) {
      const expectedCents = Math.round(expectedTotal * 100);
      if (session.amount_total !== expectedCents) {
        res.status(400).json({ ok: false, error: "Payment amount mismatch." });
        return;
      }
    }

    let voucher = await getVoucherByStripeSession(sessionId);

    if (!voucher) {
      try {
        const result = await fulfillCheckoutSession(session);
        voucher = result.voucher;
      } catch (error) {
        console.warn("[checkout-fulfillment] Initial fulfillment attempt failed:", error);
      }
    } else if (voucher.fulfillmentStatus === "processing" || voucher.fulfillmentStatus === "pending") {
      try {
        const result = await fulfillCheckoutSession(session);
        voucher = result.voucher;
      } catch (error) {
        console.warn("[checkout-fulfillment] Recovery fulfillment failed:", error);
      }
    }

    if (!voucher) {
      res.status(200).json({
        ok: true,
        paid: true,
        status: "processing",
        sessionId,
        voucher: null,
        delivery: null
      });
      return;
    }

    res.status(200).json({
      ...buildFulfillmentResponse(voucher),
      sessionId
    });
  } catch (error) {
    console.error("[checkout-fulfillment]", error);
    res.status(500).json({ ok: false, error: "Could not load checkout fulfillment." });
  }
};
