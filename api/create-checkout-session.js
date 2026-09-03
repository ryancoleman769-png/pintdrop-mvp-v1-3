const { createStripeClient, supabaseRpc } = require("./_lib/connect-helpers");
const { buildCheckoutMetadata } = require("./_lib/fulfillment");
const { loadVerifiedCheckoutQuote } = require("./_lib/checkout-drink");

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

async function resolveConnectAccountId(stripe, pub) {
  if (!pub?.stripe_account_id) {
    return { accountId: null, skipReason: "no_stripe_account" };
  }

  const accountId = String(pub.stripe_account_id).trim();
  if (!accountId) {
    return { accountId: null, skipReason: "no_stripe_account" };
  }

  if (pub.stripe_payouts_ready || pub.stripe_charges_enabled) {
    return { accountId, skipReason: "" };
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    if (account.charges_enabled) {
      return { accountId, skipReason: "" };
    }
    return { accountId: null, skipReason: "account_not_charge_ready" };
  } catch (error) {
    console.warn("[create-checkout-session] Stripe account lookup failed:", error);
    return { accountId: null, skipReason: "account_lookup_failed" };
  }
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
    const body = await readJsonBody(req);
    const pubId = Number(body.pubId);
    const drinkId = Number(body.drinkId);
    const giftName = String(body.giftName || "PintDrop gift").trim();
    const pubName = String(body.pubName || "").trim();
    const pubLocation = String(body.pubLocation || "").trim();
    const drinkIcon = String(body.drinkIcon || "🍺").trim();
    const senderEmail = String(body.senderEmail || "").trim().toLowerCase();
    const senderName = String(body.senderName || "").trim();
    const recipientName = String(body.recipientName || "").trim();
    const recipientPhone = String(body.recipientPhone || "").trim();
    const recipientEmail = String(body.recipientEmail || "").trim().toLowerCase();
    const message = String(body.message || "").trim();
    const deliveryDate = String(body.deliveryDate || new Date().toISOString().slice(0, 10)).trim();

    if (!Number.isFinite(pubId) || pubId <= 0) {
      res.status(400).json({ ok: false, error: "pubId is required." });
      return;
    }

    if (!Number.isFinite(drinkId) || drinkId <= 0) {
      res.status(400).json({ ok: false, error: "drinkId is required." });
      return;
    }

    if (!recipientName || !recipientPhone || !senderName || !senderEmail) {
      res.status(400).json({ ok: false, error: "Recipient and sender details are required." });
      return;
    }

    const verified = await loadVerifiedCheckoutQuote(pubId, drinkId);
    if (!verified.ok) {
      res.status(verified.statusCode || 400).json({ ok: false, error: verified.error });
      return;
    }

    const giftPrice = verified.giftPrice;
    const serviceFee = verified.serviceFee;
    const total = verified.total;
    const resolvedGiftName = verified.drinkName || giftName || "PintDrop gift";
    const resolvedDrinkIcon = verified.drinkIcon || drinkIcon || "🍺";

    const amountCents = Math.round(total * 100);
    const feeCents = Math.round(serviceFee * 100);
    const origin = getRequestOrigin(req);
    const stripe = stripeResult.stripe;

    const description = pubName
      ? "PintDrop at " + pubName
      : "PintDrop gift voucher";

    const pubConnect = Number.isFinite(pubId) && pubId > 0
      ? await loadPubConnectState(pubId)
      : null;
    let connectAccountId = null;
    let connectSkipReason = "missing_pub_id";

    if (!Number.isFinite(pubId) || pubId <= 0) {
      connectSkipReason = "missing_pub_id";
    } else if (!pubConnect) {
      connectSkipReason = "pub_lookup_failed";
    } else {
      const resolved = await resolveConnectAccountId(stripe, pubConnect);
      connectAccountId = resolved.accountId;
      connectSkipReason = resolved.skipReason || (connectAccountId ? "" : "account_not_charge_ready");
    }

    const sessionParams = {
      mode: "payment",
      currency: "eur",
      customer_email: senderEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: resolvedGiftName,
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
        ...buildCheckoutMetadata({
          pubId,
          drinkId,
          pubName,
          pubLocation,
          drinkName: resolvedGiftName,
          drinkIcon: resolvedDrinkIcon,
          giftPrice,
          serviceFee,
          total,
          recipientName,
          recipientPhone,
          recipientEmail,
          senderName,
          senderEmail,
          message: message || `A PintDrop from ${senderName}`,
          deliveryDate
        }),
        checkout_mode: connectAccountId ? "connect" : "platform",
        connect_skip_reason: connectAccountId ? "" : connectSkipReason
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
