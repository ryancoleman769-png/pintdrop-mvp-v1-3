const Stripe = require("stripe");

function getRequestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) {
    return proto + "://" + host;
  }
  return "https://pintdrop-mvp-v1-3.vercel.app";
}

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
    const parsedTotal = Number(body.total);
    const parsedGiftPrice = Number(body.giftPrice);
    const parsedFee = Number(body.fee);
    const giftName = String(body.giftName || "PintDrop gift").trim();
    const pubName = String(body.pubName || "").trim();
    const senderEmail = String(body.senderEmail || "").trim().toLowerCase();

    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
      res.status(400).json({ ok: false, error: "Invalid order total." });
      return;
    }

    if (!Number.isFinite(parsedGiftPrice) || !Number.isFinite(parsedFee)) {
      res.status(400).json({ ok: false, error: "Invalid order pricing." });
      return;
    }

    const expectedTotal = Math.round((parsedGiftPrice + parsedFee) * 100) / 100;
    if (Math.abs(parsedTotal - expectedTotal) > 0.001) {
      res.status(400).json({ ok: false, error: "Order total mismatch." });
      return;
    }

    const amountCents = Math.round(parsedTotal * 100);
    const origin = getRequestOrigin(req);
    const stripe = new Stripe(secretKey);

    const description = pubName
      ? "PintDrop at " + pubName
      : "PintDrop gift voucher";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "eur",
      customer_email: senderEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: giftName,
              description
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      success_url: origin + "/?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/?stripe=cancelled",
      metadata: {
        gift_name: giftName,
        pub_name: pubName
      }
    });

    res.status(200).json({
      ok: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error("[create-checkout-session]", error);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
};
