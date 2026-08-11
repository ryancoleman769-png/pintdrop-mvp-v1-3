const {
  getVoucherByStripeSession,
  processCheckoutDeliveries
} = require("./_lib/fulfillment");
const { readJsonBody, getPintDropAppUrl } = require("./_lib/connect-helpers");

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
    const appUrl = getPintDropAppUrl(req);

    if (!sessionId) {
      res.status(400).json({ ok: false, error: "sessionId is required." });
      return;
    }

    const voucher = await getVoucherByStripeSession(sessionId);
    if (!voucher) {
      res.status(409).json({ ok: false, error: "Voucher not ready for delivery yet." });
      return;
    }

    void processCheckoutDeliveries(sessionId, {
      source: "trigger-checkout-delivery",
      appUrl
    }).catch((error) => {
      console.error("[trigger-checkout-delivery] Background delivery failed:", {
        sessionId,
        error: error?.message || error
      });
    });

    res.status(202).json({
      ok: true,
      accepted: true,
      sessionId,
      voucherCode: voucher.code
    });
  } catch (error) {
    console.error("[trigger-checkout-delivery]", error);
    res.status(500).json({ ok: false, error: "Could not trigger checkout delivery." });
  }
};
