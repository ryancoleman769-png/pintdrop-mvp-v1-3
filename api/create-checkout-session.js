const Stripe = require("stripe");
const {
  parseLineItemsFromBody,
  validateLineItems,
  calculateBasketTotals,
  buildVoucherSummaryFields,
  compactOrderItemsForMetadata,
  buildStripeLineItems,
  METADATA_MAX_LENGTH
} = require("./_lib/order-items");
const { supabaseRpc } = require("./_lib/connect-helpers");
const { buildCheckoutMetadata } = require("./_lib/fulfillment");

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

async function loadPubCheckoutEligibility(pubId) {
  if (!Number.isFinite(pubId) || pubId <= 0) {
    return null;
  }

  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) {
    return null;
  }

  try {
    return await supabaseRpc("get_pub_checkout_eligibility", { p_pub_id: pubId });
  } catch (error) {
    console.warn("[create-checkout-session] Pub eligibility lookup failed:", error);
    return null;
  }
}

function isPubAvailableForCheckout(pub) {
  if (!pub) return false;
  if (pub.customer_ready === true) return true;
  const active = pub.active === true;
  const approved = String(pub.onboarding_status || "").trim().toLowerCase() === "approved";
  return active && approved;
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
    const lineItems = parseLineItemsFromBody(body);
    const lineValidation = validateLineItems(lineItems);
    if (!lineValidation.ok) {
      res.status(400).json({ ok: false, error: lineValidation.error });
      return;
    }

    const { pubValue, fee, total } = calculateBasketTotals(lineItems);
    const parsedFee = Number(body.fee);
    const parsedTotal = Number(body.total);
    const parsedGiftPrice = Number(body.giftPrice ?? body.pubValue ?? pubValue);
    const pubId = Number(body.pubId);
    const pubName = String(body.pubName || "").trim();
    const pubLocation = String(body.pubLocation || "").trim();
    const senderEmail = String(body.senderEmail || "").trim().toLowerCase();
    const senderName = String(body.senderName || "").trim();
    const recipientName = String(body.recipientName || "").trim();
    const recipientPhone = String(body.recipientPhone || "").trim();
    const recipientEmail = String(body.recipientEmail || "").trim().toLowerCase();
    const message = String(body.message || "").trim();
    const deliveryDate = String(body.deliveryDate || new Date().toISOString().slice(0, 10)).trim();
    const summary = buildVoucherSummaryFields(lineItems);
    const orderItemsMetadata = compactOrderItemsForMetadata(lineItems);

    if (orderItemsMetadata.length > METADATA_MAX_LENGTH) {
      res.status(400).json({ ok: false, error: "Order is too large for checkout metadata." });
      return;
    }

    if (!Number.isFinite(parsedGiftPrice) || Math.abs(parsedGiftPrice - pubValue) > 0.001) {
      res.status(400).json({ ok: false, error: "Invalid gift price." });
      return;
    }

    if (!Number.isFinite(parsedFee) || Math.abs(parsedFee - fee) > 0.001) {
      res.status(400).json({ ok: false, error: "Invalid order pricing." });
      return;
    }

    if (!Number.isFinite(parsedTotal) || Math.abs(parsedTotal - total) > 0.001) {
      res.status(400).json({ ok: false, error: "Order total mismatch." });
      return;
    }

    if (!Number.isFinite(pubId) || pubId <= 0) {
      res.status(400).json({ ok: false, error: "pubId is required." });
      return;
    }

    const pubEligibility = await loadPubCheckoutEligibility(pubId);
    if (!pubEligibility) {
      res.status(404).json({ ok: false, error: "Pub not found." });
      return;
    }

    if (!isPubAvailableForCheckout(pubEligibility)) {
      res.status(403).json({ ok: false, error: "This pub is not available for checkout." });
      return;
    }

    if (!recipientName || !recipientPhone || !senderName || !senderEmail) {
      res.status(400).json({ ok: false, error: "Recipient and sender details are required." });
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
      line_items: buildStripeLineItems(lineItems, parsedFee, description),
      success_url: origin + "/?stripe=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/?stripe=cancelled",
      metadata: {
        ...buildCheckoutMetadata({
          pubId,
          drinkId: summary.drinkId,
          pubName,
          pubLocation,
          drinkName: summary.drinkName,
          drinkIcon: summary.drinkIcon,
          giftPrice: pubValue,
          serviceFee: parsedFee,
          total: parsedTotal,
          recipientName,
          recipientPhone,
          recipientEmail,
          senderName,
          senderEmail,
          message: message || `A PintDrop from ${senderName}`,
          deliveryDate,
          orderItems: orderItemsMetadata
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
      connect: Boolean(connectAccountId),
      amountCents
    });
  } catch (error) {
    console.error("[create-checkout-session]", error);
    res.status(500).json({ ok: false, error: "Could not create checkout session." });
  }
};
