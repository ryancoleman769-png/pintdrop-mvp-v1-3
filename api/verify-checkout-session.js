const Stripe = require("stripe");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ ok: false, error: "Stripe is not configured on the server." });
    return;
  }

  if (!secretKey.startsWith("sk_test_")) {
    res.status(500).json({ ok: false, error: "Stripe test mode only. Use a sk_test_ key." });
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

    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(402).json({ ok: false, error: "Payment not completed." });
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

    res.status(200).json({
      ok: true,
      paid: true,
      sessionId: session.id,
      amountTotal: session.amount_total,
      currency: session.currency
    });
  } catch (error) {
    console.error("[verify-checkout-session]", error);
    res.status(500).json({ ok: false, error: "Could not verify checkout session." });
  }
};
