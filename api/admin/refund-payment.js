const {
  createStripeClient,
  handleOptions,
  readJsonBody,
  requireAdminAuth,
  requirePost,
  sendJson
} = require("../_lib/connect-helpers");

function cleanId(value) {
  return String(value || "").trim();
}

async function resolvePaymentIntent(stripe, checkoutSessionId, paymentIntentId) {
  if (checkoutSessionId) {
    if (!checkoutSessionId.startsWith("cs_")) {
      const error = new Error("Invalid Stripe Checkout Session ID.");
      error.statusCode = 400;
      throw error;
    }

    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["payment_intent"]
    });
    const intent = session.payment_intent;
    const resolved = typeof intent === "string" ? intent : intent?.id;
    if (!resolved) {
      const error = new Error("This checkout session has no payment to refund.");
      error.statusCode = 409;
      throw error;
    }
    return { paymentIntentId: resolved, checkoutSessionId: session.id };
  }

  if (!paymentIntentId.startsWith("pi_")) {
    const error = new Error("A valid Checkout Session ID or Payment Intent ID is required.");
    error.statusCode = 400;
    throw error;
  }

  return { paymentIntentId, checkoutSessionId: "" };
}

async function findExistingFullRefund(stripe, paymentIntentId, amountReceived) {
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const succeededAmount = refunds.data
    .filter((refund) => refund.status === "succeeded")
    .reduce((total, refund) => total + Number(refund.amount || 0), 0);

  return succeededAmount >= amountReceived
    ? refunds.data.find((refund) => refund.status === "succeeded") || null
    : null;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requirePost(req, res)) return;
  if (!requireAdminAuth(req, res)) return;

  const stripeResult = createStripeClient();
  if (stripeResult.error) {
    sendJson(res, 500, { ok: false, error: stripeResult.error });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const checkoutSessionId = cleanId(body.checkoutSessionId);
    const suppliedPaymentIntentId = cleanId(body.paymentIntentId);
    const confirmation = cleanId(body.confirmation).toUpperCase();

    if (confirmation !== "REFUND") {
      sendJson(res, 400, {
        ok: false,
        error: "Refund confirmation is required."
      });
      return;
    }

    if (
      String(process.env.VERCEL_ENV || "").trim() === "preview"
      && (!checkoutSessionId || !checkoutSessionId.startsWith("cs_test_"))
    ) {
      sendJson(res, 403, {
        ok: false,
        error: "Preview can only refund Stripe test-mode payments."
      });
      return;
    }

    const stripe = stripeResult.stripe;
    const resolved = await resolvePaymentIntent(
      stripe,
      checkoutSessionId,
      suppliedPaymentIntentId
    );
    const paymentIntent = await stripe.paymentIntents.retrieve(resolved.paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      sendJson(res, 409, { ok: false, error: "Only a successful payment can be refunded." });
      return;
    }

    const amountReceived = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
    if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
      sendJson(res, 409, { ok: false, error: "The refundable payment amount is unavailable." });
      return;
    }

    const existingRefund = await findExistingFullRefund(
      stripe,
      paymentIntent.id,
      amountReceived
    );
    if (existingRefund) {
      sendJson(res, 200, {
        ok: true,
        alreadyRefunded: true,
        refundId: existingRefund.id,
        paymentIntentId: paymentIntent.id,
        checkoutSessionId: resolved.checkoutSessionId || null
      });
      return;
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: {
        source: "pintdrop_admin",
        checkout_session_id: resolved.checkoutSessionId || ""
      }
    }, {
      idempotencyKey: `pintdrop-full-refund-${paymentIntent.id}`
    });

    sendJson(res, 200, {
      ok: true,
      alreadyRefunded: false,
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      paymentIntentId: paymentIntent.id,
      checkoutSessionId: resolved.checkoutSessionId || null,
      transferReversed: true,
      applicationFeeRefunded: true
    });
  } catch (error) {
    console.error("[admin/refund-payment]", error);
    const statusCode = Number(error?.statusCode) || 500;
    sendJson(res, statusCode, {
      ok: false,
      error: statusCode >= 500 ? "Could not refund this payment." : error.message
    });
  }
};
