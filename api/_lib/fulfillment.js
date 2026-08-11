const { getSupabaseUrl, getSupabaseServiceRoleKey, supabaseRpc } = require("./connect-helpers");

const METADATA_MAX_LENGTH = 500;

function createFulfillmentTimer(sessionId, source) {
  const startedAt = Date.now();
  const marks = [];
  return {
    mark(stage, extra = {}) {
      const elapsedMs = Date.now() - startedAt;
      marks.push({ stage, elapsedMs, ...extra });
      console.log("[fulfillment-timing]", {
        source,
        sessionId,
        stage,
        elapsedMs,
        ...extra
      });
    },
    summary() {
      const totalMs = Date.now() - startedAt;
      console.log("[fulfillment-timing-summary]", {
        source,
        sessionId,
        totalMs,
        stages: marks
      });
      return { totalMs, stages: marks };
    }
  };
}

function trimMetadata(value, maxLength = METADATA_MAX_LENGTH) {
  return String(value || "").trim().slice(0, maxLength);
}

function generateVoucherCode() {
  return "PD-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function buildCheckoutMetadata(order) {
  return {
    pub_id: String(order.pubId || ""),
    drink_id: String(order.drinkId || ""),
    pub_name: trimMetadata(order.pubName),
    pub_location: trimMetadata(order.pubLocation),
    drink_name: trimMetadata(order.drinkName),
    drink_icon: trimMetadata(order.drinkIcon, 50),
    gift_price: String(order.giftPrice),
    service_fee: String(order.serviceFee),
    total: String(order.total),
    recipient_name: trimMetadata(order.recipientName),
    recipient_phone: trimMetadata(order.recipientPhone, 50),
    recipient_email: trimMetadata(order.recipientEmail),
    sender_name: trimMetadata(order.senderName),
    sender_email: trimMetadata(order.senderEmail),
    message: trimMetadata(order.message),
    delivery_date: trimMetadata(order.deliveryDate, 10)
  };
}

function parseCheckoutMetadata(metadata = {}) {
  const pubId = Number(metadata.pub_id);
  const drinkId = Number(metadata.drink_id);
  const giftPrice = Number(metadata.gift_price);
  const serviceFee = Number(metadata.service_fee);
  const total = Number(metadata.total);

  return {
    pubId: Number.isFinite(pubId) ? pubId : 0,
    drinkId: Number.isFinite(drinkId) ? drinkId : 0,
    pubName: trimMetadata(metadata.pub_name),
    pubLocation: trimMetadata(metadata.pub_location),
    drinkName: trimMetadata(metadata.drink_name),
    drinkIcon: trimMetadata(metadata.drink_icon, 50) || "🍺",
    giftPrice: Number.isFinite(giftPrice) ? giftPrice : 0,
    serviceFee: Number.isFinite(serviceFee) ? serviceFee : 0,
    total: Number.isFinite(total) ? total : 0,
    recipientName: trimMetadata(metadata.recipient_name),
    recipientPhone: trimMetadata(metadata.recipient_phone, 50),
    recipientEmail: trimMetadata(metadata.recipient_email).toLowerCase(),
    senderName: trimMetadata(metadata.sender_name),
    senderEmail: trimMetadata(metadata.sender_email).toLowerCase(),
    message: trimMetadata(metadata.message) || "",
    deliveryDate: trimMetadata(metadata.delivery_date, 10)
      || new Date().toISOString().slice(0, 10)
  };
}

function validateCheckoutMetadata(order) {
  const missing = [];
  if (!order.pubId) missing.push("pub_id");
  if (!order.drinkId) missing.push("drink_id");
  if (!order.recipientName) missing.push("recipient_name");
  if (!order.recipientPhone) missing.push("recipient_phone");
  if (!order.senderName) missing.push("sender_name");
  if (!order.senderEmail) missing.push("sender_email");
  if (!order.drinkName) missing.push("drink_name");
  if (!order.giftPrice || !order.total) missing.push("pricing");
  return missing;
}

function mapVoucherRow(row) {
  if (!row) return null;
  if (typeof row === "string") {
    try {
      row = JSON.parse(row);
    } catch {
      return null;
    }
  }

  return {
    id: row.id,
    code: row.code,
    pubId: row.pub_id,
    drinkId: row.drink_id,
    pubName: row.pub_name,
    pubLocation: row.pub_location,
    drinkName: row.drink_name,
    drinkIcon: row.drink_icon,
    drinkPrice: Number(row.drink_price),
    serviceFee: Number(row.service_fee),
    total: Number(row.total),
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email || null,
    senderName: row.sender_name,
    senderEmail: row.sender_email || null,
    message: row.message,
    deliveryDate: row.delivery_date,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    drinkSlug: row.drink_slug,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    fulfillmentStatus: row.fulfillment_status || "pending",
    smsDeliveryStatus: row.sms_delivery_status || "pending",
    senderEmailDeliveryStatus: row.sender_email_delivery_status || "pending",
    recipientEmailDeliveryStatus: row.recipient_email_delivery_status || "skipped",
    smsMessageSid: row.sms_message_sid || null,
    senderEmailId: row.sender_email_id || null,
    recipientEmailId: row.recipient_email_id || null,
    deliveryError: row.delivery_error || null
  };
}

async function getVoucherByStripeSession(sessionId) {
  const row = await supabaseRpc("get_voucher_by_stripe_session", {
    p_stripe_session_id: sessionId
  });
  return mapVoucherRow(row);
}

async function invokeSupabaseFunction(functionName, body, timer = null) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const invokeStartedAt = Date.now();
  timer?.mark(`${functionName}:start`);

  const response = await fetch(`${getSupabaseUrl()}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text };
    }
  }

  const invokeMs = Date.now() - invokeStartedAt;
  timer?.mark(`${functionName}:complete`, { invokeMs, httpStatus: response.status, ok: Boolean(data?.ok) });

  if (!response.ok) {
    const message = data?.error || data?.details || text || `${functionName} failed.`;
    return { ok: false, error: message, details: data?.details || data, invokeMs };
  }

  if (!data?.ok) {
    return {
      ok: false,
      error: data?.error || data?.details || `${functionName} failed.`,
      details: data?.details || data,
      invokeMs
    };
  }

  return { ...data, invokeMs };
}

async function createOrGetCheckoutVoucher(sessionId, order) {
  let voucher = await getVoucherByStripeSession(sessionId);
  if (voucher) {
    return voucher;
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const code = generateVoucherCode();
  const row = await supabaseRpc("fulfill_checkout_voucher", {
    p_stripe_checkout_session_id: sessionId,
    p_code: code,
    p_pub_id: order.pubId,
    p_drink_id: order.drinkId,
    p_pub_name: order.pubName,
    p_pub_location: order.pubLocation,
    p_drink_name: order.drinkName,
    p_drink_icon: order.drinkIcon,
    p_drink_price: order.giftPrice,
    p_service_fee: order.serviceFee,
    p_total: order.total,
    p_recipient_name: order.recipientName,
    p_recipient_phone: order.recipientPhone,
    p_recipient_email: order.recipientEmail || null,
    p_sender_name: order.senderName,
    p_sender_email: order.senderEmail,
    p_message: order.message || `A PintDrop from ${order.senderName}`,
    p_delivery_date: order.deliveryDate,
    p_expires_at: expiresAt
  });

  return mapVoucherRow(row);
}

async function updateDeliveryStatus(sessionId, channel, status, externalId, errorMessage) {
  const row = await supabaseRpc("update_voucher_delivery_status", {
    p_stripe_checkout_session_id: sessionId,
    p_channel: channel,
    p_status: status,
    p_external_id: externalId || null,
    p_error: errorMessage || null
  });
  return mapVoucherRow(row);
}

function shouldSendChannel(voucher, channel) {
  if (!voucher) return false;
  if (channel === "sms") {
    if (voucher.smsMessageSid) return false;
    if (voucher.smsDeliveryStatus === "sent") return false;
    if (voucher.smsDeliveryStatus === "processing") return false;
    return ["pending", "failed"].includes(voucher.smsDeliveryStatus);
  }
  if (channel === "sender_email") {
    if (voucher.senderEmailId) return false;
    if (voucher.senderEmailDeliveryStatus === "sent") return false;
    if (voucher.senderEmailDeliveryStatus === "skipped") return false;
    if (voucher.senderEmailDeliveryStatus === "processing") return false;
    return ["pending", "failed"].includes(voucher.senderEmailDeliveryStatus);
  }
  if (channel === "recipient_email") {
    if (!voucher.recipientEmail) return false;
    if (voucher.recipientEmailId) return false;
    if (voucher.recipientEmailDeliveryStatus === "sent") return false;
    if (voucher.recipientEmailDeliveryStatus === "skipped") return false;
    if (voucher.recipientEmailDeliveryStatus === "processing") return false;
    return ["pending", "failed"].includes(voucher.recipientEmailDeliveryStatus);
  }
  return false;
}

function needsDeliveryProcessing(voucher) {
  if (!voucher) return false;
  return (
    shouldSendChannel(voucher, "sms")
    || shouldSendChannel(voucher, "sender_email")
    || shouldSendChannel(voucher, "recipient_email")
  );
}

async function deliverSms(voucher, timer = null) {
  return invokeSupabaseFunction("send-voucher-sms", {
    recipient_phone: voucher.recipientPhone,
    voucher_code: voucher.code,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName
  }, timer);
}

async function deliverSenderEmail(voucher, timer = null) {
  return invokeSupabaseFunction("send-sender-confirmation", {
    sender_email: voucher.senderEmail,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName,
    message: voucher.message,
    voucher_code: voucher.code
  }, timer);
}

async function deliverRecipientEmail(voucher, timer = null) {
  return invokeSupabaseFunction("send-recipient-gift", {
    recipient_email: voucher.recipientEmail,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName,
    message: voucher.message,
    voucher_code: voucher.code
  }, timer);
}

async function runDeliveryChannel(sessionId, voucher, channel, sendFn, timer = null) {
  const current = await getVoucherByStripeSession(sessionId);
  if (!shouldSendChannel(current, channel)) {
    return current || voucher;
  }

  timer?.mark(`${channel}:processing`);
  await updateDeliveryStatus(sessionId, channel, "processing");

  try {
    const channelStartedAt = Date.now();
    const result = await sendFn(voucher, timer);
    timer?.mark(`${channel}:finished`, {
      channelMs: Date.now() - channelStartedAt,
      ok: Boolean(result?.ok),
      invokeMs: result?.invokeMs || null
    });
    if (result.ok) {
      const externalId = result.message_sid || result.email_id || null;
      return updateDeliveryStatus(sessionId, channel, "sent", externalId);
    }
    return updateDeliveryStatus(
      sessionId,
      channel,
      "failed",
      null,
      result.error || `${channel} delivery failed`
    );
  } catch (error) {
    return updateDeliveryStatus(
      sessionId,
      channel,
      "failed",
      null,
      error?.message || `${channel} delivery failed`
    );
  }
}

async function finalizeFulfillmentStatus(sessionId, voucher) {
  if (!voucher) return null;

  const smsOk = voucher.smsDeliveryStatus === "sent";
  const senderOk = ["sent", "skipped"].includes(voucher.senderEmailDeliveryStatus);
  const recipientOk = ["sent", "skipped"].includes(voucher.recipientEmailDeliveryStatus);
  let fulfillmentStatus = "processing";

  if (smsOk && senderOk && recipientOk) {
    fulfillmentStatus = "completed";
  } else if (
    voucher.smsDeliveryStatus === "failed"
    || voucher.senderEmailDeliveryStatus === "failed"
    || voucher.recipientEmailDeliveryStatus === "failed"
  ) {
    fulfillmentStatus = "partial";
  }

  if (voucher.fulfillmentStatus !== fulfillmentStatus) {
    await supabaseRpc("update_voucher_delivery_status", {
      p_stripe_checkout_session_id: sessionId,
      p_channel: "fulfillment",
      p_status: fulfillmentStatus
    }).catch(() => null);
  }

  return getVoucherByStripeSession(sessionId);
}

async function ensureCheckoutVoucher(session, options = {}) {
  const timer = createFulfillmentTimer(session?.id, options.source || "ensure-voucher");
  timer.mark("session:received", {
    paymentStatus: session?.payment_status,
    mode: session?.mode
  });

  if (!session || session.payment_status !== "paid") {
    throw new Error("Checkout session is not paid.");
  }

  if (session.mode !== "payment") {
    throw new Error("Unsupported checkout session mode.");
  }

  const order = parseCheckoutMetadata(session.metadata || {});
  const missing = validateCheckoutMetadata(order);
  if (missing.length) {
    throw new Error(`Checkout metadata incomplete: ${missing.join(", ")}`);
  }

  const voucherStartedAt = Date.now();
  const voucher = await createOrGetCheckoutVoucher(session.id, order);
  timer.mark("voucher:create", {
    voucherMs: Date.now() - voucherStartedAt,
    voucherCode: voucher?.code || null,
    created: Boolean(voucher)
  });
  timer.summary();

  if (!voucher) {
    throw new Error("Voucher could not be created.");
  }

  return { voucher, order };
}

async function processCheckoutDeliveries(sessionId, options = {}) {
  const timer = createFulfillmentTimer(sessionId, options.source || "delivery");
  let voucher = await getVoucherByStripeSession(sessionId);
  if (!voucher) {
    timer.mark("delivery:skipped", { reason: "voucher_missing" });
    timer.summary();
    return null;
  }

  if (!needsDeliveryProcessing(voucher)) {
    timer.mark("delivery:skipped", {
      reason: "already_processed",
      fulfillmentStatus: voucher.fulfillmentStatus,
      sms: voucher.smsDeliveryStatus,
      senderEmail: voucher.senderEmailDeliveryStatus,
      recipientEmail: voucher.recipientEmailDeliveryStatus
    });
    timer.summary();
    return voucher;
  }

  voucher = await runDeliveryChannel(sessionId, voucher, "sms", deliverSms, timer);
  voucher = await runDeliveryChannel(sessionId, voucher, "sender_email", deliverSenderEmail, timer);
  voucher = await runDeliveryChannel(sessionId, voucher, "recipient_email", deliverRecipientEmail, timer);
  voucher = await finalizeFulfillmentStatus(sessionId, voucher);
  timer.mark("fulfillment:finalized", {
    fulfillmentStatus: voucher?.fulfillmentStatus || null,
    sms: voucher?.smsDeliveryStatus || null,
    senderEmail: voucher?.senderEmailDeliveryStatus || null,
    recipientEmail: voucher?.recipientEmailDeliveryStatus || null
  });
  timer.summary();
  return voucher;
}

async function fulfillCheckoutSession(session, options = {}) {
  const { voucher, order } = await ensureCheckoutVoucher(session, options);
  const delivered = await processCheckoutDeliveries(session.id, options);
  return {
    voucher: delivered || voucher,
    order
  };
}

function buildFulfillmentResponse(voucher) {
  if (!voucher) {
    return {
      ok: true,
      status: "processing",
      paid: true,
      voucher: null,
      delivery: null
    };
  }

  return {
    ok: true,
    status: voucher.fulfillmentStatus || "processing",
    voucherReady: true,
    paid: true,
    voucher: {
      id: voucher.id,
      code: voucher.code,
      recipient: voucher.recipientName,
      recipientEmail: voucher.recipientEmail,
      sender: voucher.senderName,
      senderEmail: voucher.senderEmail,
      message: voucher.message,
      pub: {
        id: voucher.drinkSlug || `pub-${voucher.pubId}`,
        supabaseId: voucher.pubId,
        name: voucher.pubName,
        town: voucher.pubLocation
      },
      gift: {
        id: voucher.drinkSlug || String(voucher.drinkId),
        supabaseId: voucher.drinkId,
        name: voucher.drinkName,
        price: voucher.drinkPrice,
        icon: voucher.drinkIcon
      },
      phone: voucher.recipientPhone,
      fee: voucher.serviceFee,
      total: voucher.total,
      deliveryDate: voucher.deliveryDate,
      createdAt: voucher.createdAt,
      expiresAt: voucher.expiresAt,
      status: voucher.status,
      source: "supabase"
    },
    delivery: {
      fulfillmentStatus: voucher.fulfillmentStatus,
      sms: voucher.smsDeliveryStatus,
      senderEmail: voucher.senderEmailDeliveryStatus,
      recipientEmail: voucher.recipientEmailDeliveryStatus,
      error: voucher.deliveryError
    }
  };
}

module.exports = {
  buildCheckoutMetadata,
  parseCheckoutMetadata,
  validateCheckoutMetadata,
  generateVoucherCode,
  mapVoucherRow,
  getVoucherByStripeSession,
  ensureCheckoutVoucher,
  processCheckoutDeliveries,
  needsDeliveryProcessing,
  fulfillCheckoutSession,
  buildFulfillmentResponse
};
