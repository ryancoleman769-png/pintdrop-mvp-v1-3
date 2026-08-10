const Stripe = require("stripe");
const { calculateServiceFee, calculateOrderTotal } = require("./_lib/pricing");
const { supabaseRpc } = require("./_lib/connect-helpers");

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

async function loadPubConnectState(pubId) {
  if (!Number.isFinite(pubId) || pubId <= 0) {
    return null;
  }

  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) {
    return null;
  }

  try {
    return await supabaseRpc("get_pub_stripe_connect", { p_pub_id: pubId });
  } catch (error) {
    console.warn("[create-checkout-session] Connect pub lookup failed:", error);
    return null;
  }
}

function canUseConnectCheckout(pub) {
  if (!pub?.stripe_account_id) {
    return null;
  }
  if (!pub.stripe_charges_enabled) {
    return null;
  }
  return String(pub.stripe_account_id).trim();
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
    const parsedGiftPrice = Number(body.giftPrice);
    const parsedFee = Number(body.fee);
    const parsedTotal = Number(body.total);
    const pubId = Number(body.pubId);
    const giftName = String(body.giftName || "PintDrop gift").trim();
    const pubName = String(body.pubName || "").trim();
    const senderEmail = String(body.senderEmail || "").trim().toLowerCase();

    if (!Number.isFinite(parsedGiftPrice) || parsedGiftPrice <= 0) {
      res.status(400).json({ ok: false, error: "Invalid gift price." });
      return;
    }

    const expectedFee = calculateServiceFee(parsedGiftPrice);
    const expectedTotal = calculateOrderTotal(parsedGiftPrice);

    if (!Number.isFinite(parsedFee) || Math.abs(parsedFee - expectedFee) > 0.001) {
      res.status(400).json({ ok: false, error: "Invalid order pricing." });
      return;
    }

    if (!Number.isFinite(parsedTotal) || Math.abs(parsedTotal - expectedTotal) > 0.001) {
      res.status(400).json({ ok: false, error: "Order total mismatch." });
      return;
    }

    const amountCents = Math.round(parsedTotal * 100);
    const feeCents = Math.round(parsedFee * 100);
    const origin = getRequestOrigin(req);
    const stripe = new Stripe(secretKey);

    const description = pubName
      ? "PintDrop at " + pubName
      : "PintDrop gift voucher";

    const pubConnect = Number.isFinite(pubId) && pubId > 0
      ? await loadPubConnectState(pubId)
      : null;
    const connectAccountId = canUseConnectCheckout(pubConnect);

    const sessionParams = {
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
        pub_name: pubName,
        pub_id: Number.isFinite(pubId) && pubId > 0 ? String(pubId) : "",
        gift_price: String(parsedGiftPrice),
        service_fee: String(parsedFee),
        checkout_mode: connectAccountId ? "connect" : "platform"
      }
    };

    if (connectAccountId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: feeCents,
        transfer_data: {
          destination: connectAccountId
        }
      };
      sessionParams.metadata.stripe_account_id = connectAccountId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.status(200).json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      connect: Boolean(connectAccountId)
    });
  } catch (error) {
    console.error("[create-checkout-session]", error);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
};
