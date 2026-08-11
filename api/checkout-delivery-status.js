const { getVoucherByStripeSession, buildFulfillmentResponse } = require("./_lib/fulfillment");
const { readJsonBody } = require("./_lib/connect-helpers");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "").trim();

    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const voucher = await getVoucherByStripeSession(sessionId);
    if (!voucher) {
      res.status(200).json({
        ok: true,
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
    console.error("[checkout-delivery-status]", error);
    res.status(500).json({ ok: false, error: "Could not load delivery status." });
  }
};
