const {
  getVoucherByStripeSession,
  ensureCheckoutVoucher,
  processCheckoutDeliveries,
  needsDeliveryProcessing,
  buildFulfillmentResponse
} = require("./_lib/fulfillment");
const { createStripeClient, readJsonBody, getPintDropAppUrl } = require("./_lib/connect-helpers");

function scheduleDelivery(sessionId, source, appUrl) {
  void processCheckoutDeliveries(sessionId, { source, appUrl }).catch((error) => {
    console.error("[checkout-fulfillment] Async delivery failed:", {
      sessionId,
      source,
      error: error?.message || error
    });
  });
}

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
    const requestStartedAt = Date.now();
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const expectedTotal = Number(body.expectedTotal);
    const triggerDelivery = body.triggerDelivery === true;
    const appUrl = getPintDropAppUrl(req);

    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const stripeRetrieveStartedAt = Date.now();
    const session = await stripeResult.stripe.checkout.sessions.retrieve(sessionId);
    const stripeRetrieveMs = Date.now() - stripeRetrieveStartedAt;

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
    const initialLookupMs = Date.now() - requestStartedAt;
    let fulfillmentPath = "existing_voucher";

    if (!voucher) {
      fulfillmentPath = "create_voucher";
      try {
        const result = await ensureCheckoutVoucher(session, { source: "checkout-fulfillment" });
        voucher = result.voucher;
        if (triggerDelivery && voucher) {
          scheduleDelivery(sessionId, "checkout-fulfillment:create", appUrl);
        }
      } catch (error) {
        console.warn("[checkout-fulfillment] Voucher creation failed:", error);
      }
    } else if (triggerDelivery && needsDeliveryProcessing(voucher)) {
      fulfillmentPath = "resume_delivery";
      scheduleDelivery(sessionId, "checkout-fulfillment:resume", appUrl);
    }

    const totalMs = Date.now() - requestStartedAt;
    console.log("[checkout-fulfillment-timing]", {
      sessionId,
      fulfillmentPath,
      triggerDelivery,
      appUrl,
      stripeRetrieveMs,
      initialLookupMs,
      totalMs,
      hasVoucher: Boolean(voucher),
      fulfillmentStatus: voucher?.fulfillmentStatus || null,
      sms: voucher?.smsDeliveryStatus || null,
      senderEmail: voucher?.senderEmailDeliveryStatus || null,
      whatsapp: voucher?.whatsappDeliveryStatus || null
    });

    if (!voucher) {
      res.status(200).json({
        ok: true,
        paid: true,
        status: "processing",
        voucherReady: false,
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
