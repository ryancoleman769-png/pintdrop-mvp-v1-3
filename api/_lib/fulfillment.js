const { getSupabaseUrl, getSupabaseServiceRoleKey, supabaseRpc } = require("./connect-helpers");

const METADATA_MAX_LENGTH = 500;

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

async function invokeSupabaseFunction(functionName, body) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

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

  if (!response.ok) {
    const message = data?.error || data?.details || text || `${functionName} failed.`;
    return { ok: false, error: message, details: data?.details || data };
  }

  if (!data?.ok) {
    return {
      ok: false,
      error: data?.error || data?.details || `${functionName} failed.`,
      details: data?.details || data
    };
  }

  return data;
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
    return ["pending", "processing", "failed"].includes(voucher.smsDeliveryStatus);
  }
  if (channel === "sender_email") {
    if (voucher.senderEmailId) return false;
    return ["pending", "processing", "failed"].includes(voucher.senderEmailDeliveryStatus);
  }
  if (channel === "recipient_email") {
    if (!voucher.recipientEmail) return false;
    if (voucher.recipientEmailId) return false;
    return ["pending", "processing", "failed"].includes(voucher.recipientEmailDeliveryStatus);
  }
  return false;
}

async function deliverSms(voucher) {
  return invokeSupabaseFunction("send-voucher-sms", {
    recipient_phone: voucher.recipientPhone,
    voucher_code: voucher.code,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName
  });
}

async function deliverSenderEmail(voucher) {
  return invokeSupabaseFunction("send-sender-confirmation", {
    sender_email: voucher.senderEmail,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName,
    message: voucher.message,
    voucher_code: voucher.code
  });
}

async function deliverRecipientEmail(voucher) {
  return invokeSupabaseFunction("send-recipient-gift", {
    recipient_email: voucher.recipientEmail,
    sender_name: voucher.senderName,
    recipient_name: voucher.recipientName,
    pub_name: voucher.pubName,
    drink_name: voucher.drinkName,
    message: voucher.message,
    voucher_code: voucher.code
  });
}

async function runDeliveryChannel(sessionId, voucher, channel, sendFn) {
  const current = await getVoucherByStripeSession(sessionId);
  if (!shouldSendChannel(current, channel)) {
    return current || voucher;
  }

  await updateDeliveryStatus(sessionId, channel, "processing");

  try {
    const result = await sendFn(voucher);
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

async function fulfillCheckoutSession(session) {
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

  let voucher = await createOrGetCheckoutVoucher(session.id, order);
  if (!voucher) {
    throw new Error("Voucher could not be created.");
  }

  voucher = await runDeliveryChannel(session.id, voucher, "sms", deliverSms);
  voucher = await runDeliveryChannel(session.id, voucher, "sender_email", deliverSenderEmail);
  voucher = await runDeliveryChannel(session.id, voucher, "recipient_email", deliverRecipientEmail);
  voucher = await finalizeFulfillmentStatus(session.id, voucher);

  return {
    voucher,
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
  fulfillCheckoutSession,
  buildFulfillmentResponse
};
