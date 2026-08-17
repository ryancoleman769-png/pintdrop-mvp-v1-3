/**
 * PintDrop — Supabase configuration (frontend / public keys only)
 *
 * Minimal client bootstrap for existing site flows plus PartnerAuth
 * required for partner login and Stripe Connect payout sync.
 */
const SUPABASE_CONFIG = {
  url: "https://ggvofckolukahshocxvd.supabase.co",
  anonKey: "sb_publishable_4NAQehcdmGoOOUbDMHniHg_8ExxQv3m"
};

function isSupabaseConfigured() {
  const url = SUPABASE_CONFIG.url.trim();
  const anonKey = SUPABASE_CONFIG.anonKey.trim();
  return url.length > 0 && anonKey.length > 0;
}

let supabaseClient = null;

function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.warn("[PintDrop] Supabase JS client is not loaded.");
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(
      SUPABASE_CONFIG.url.trim(),
      SUPABASE_CONFIG.anonKey.trim()
    );
  }

  return supabaseClient;
}

window.PintDropSupabase = {
  config: SUPABASE_CONFIG,
  isConfigured: isSupabaseConfigured,
  getClient: getSupabaseClient
};

const PUB_LOCAL_ASSETS = {
  oflahertys: { icon: "🍺", image: "images/oflahertys-bar.jpg" },
  drift: { icon: "🍻" },
  local: { icon: "📍" }
};

const PUB_SLUG_BY_SUPABASE_ID = {
  1: "oflahertys",
  8: "oflahertys"
};

function resolvePubSlug(row) {
  if (row.slug) return String(row.slug).trim();
  if (PUB_SLUG_BY_SUPABASE_ID[row.id]) return PUB_SLUG_BY_SUPABASE_ID[row.id];
  return String(row.name || row.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32) || `pub-${row.id}`;
}

function isCustomerReadyPubRow(row) {
  const active = row.active !== false && row.active !== 0;
  const status = String(row.onboarding_status || "approved").trim().toLowerCase();
  return active && status === "approved";
}

function mapSupabasePubRow(row) {
  const id = resolvePubSlug(row);
  const assets = PUB_LOCAL_ASSETS[id] || {};
  const customerReady = isCustomerReadyPubRow(row);

  return {
    id,
    supabaseId: row.id,
    name: row.name,
    town: row.town || row.city || row.location || "",
    icon: row.icon || assets.icon || "🍺",
    image: row.image_url || row.image || assets.image || null,
    participating: customerReady,
    source: "supabase"
  };
}

async function fetchPubsFromSupabase() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pubs")
    .select("*")
    .eq("active", true)
    .eq("onboarding_status", "approved")
    .order("name", { ascending: true });

  if (error) {
    console.warn("[PintDrop] Supabase pubs fetch failed:", error.message);
    return null;
  }

  return (data || [])
    .filter(isCustomerReadyPubRow)
    .map(mapSupabasePubRow);
}

window.PintDropSupabase.fetchPubs = fetchPubsFromSupabase;
window.PintDropSupabase.mapPubRow = mapSupabasePubRow;

function mapSupabaseDrinkRow(row) {
  const menuPrice = row.slug === "tab" ? 20.5 : Number(row.price);
  return {
    id: row.slug,
    supabaseId: row.id,
    name: row.name,
    price: menuPrice,
    icon: row.icon || "🍺",
    source: "supabase"
  };
}

async function fetchDrinksFromSupabase(pubId) {
  const client = getSupabaseClient();
  if (!client || !pubId) return null;

  const { data, error } = await client
    .from("drinks")
    .select("*")
    .eq("pub_id", pubId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.warn("[PintDrop] Supabase drinks fetch failed:", error.message);
    return null;
  }

  return (data || []).map(mapSupabaseDrinkRow);
}

window.PintDropSupabase.fetchDrinks = fetchDrinksFromSupabase;
window.PintDropSupabase.mapDrinkRow = mapSupabaseDrinkRow;

function mapSupabaseVoucherRow(row) {
  if (!row) return null;

  if (typeof row === "string") {
    try {
      row = JSON.parse(row);
    } catch {
      console.warn("[PintDrop] Could not parse Supabase voucher row JSON.");
      return null;
    }
  }

  const pubSlug = PUB_SLUG_BY_SUPABASE_ID[row.pub_id] || `pub-${row.pub_id}`;
  const assets = PUB_LOCAL_ASSETS[pubSlug] || {};

  return {
    id: row.id,
    code: row.code,
    pub: {
      id: pubSlug,
      supabaseId: row.pub_id,
      name: row.pub_name,
      town: row.pub_location,
      icon: assets.icon || "🍺",
      image: assets.image || null,
      participating: true,
      source: "supabase"
    },
    gift: {
      id: row.drink_slug || String(row.drink_id),
      supabaseId: row.drink_id,
      name: row.drink_name,
      price: Number(row.drink_price),
      icon: row.drink_icon || "🍺",
      source: "supabase"
    },
    recipient: row.recipient_name,
    phone: row.recipient_phone || "",
    recipientEmail: row.recipient_email || null,
    sender: row.sender_name,
    message: row.message,
    deliveryDate: typeof row.delivery_date === "string"
      ? row.delivery_date.slice(0, 10)
      : row.delivery_date,
    fee: Number(row.service_fee),
    total: Number(row.total),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    redeemedAt: row.redeemed_at,
    source: "supabase"
  };
}

async function fetchVoucherByCodeFromSupabase(code) {
  const client = getSupabaseClient();
  if (!client || !code?.trim()) return null;

  const { data, error } = await client.rpc("get_voucher_by_code", {
    p_code: code.trim()
  });

  if (error) {
    console.warn("[PintDrop] Supabase voucher lookup failed:", error.message);
    return null;
  }

  return mapSupabaseVoucherRow(data);
}

async function createVoucherInSupabase(voucher) {
  const client = getSupabaseClient();
  const pub = voucher.pub;
  const gift = voucher.gift;

  if (!client || !pub?.supabaseId || !gift?.supabaseId) return null;

  const { data, error } = await client.rpc("create_voucher", {
    p_code: voucher.code,
    p_pub_id: pub.supabaseId,
    p_drink_id: gift.supabaseId,
    p_pub_name: pub.name,
    p_pub_location: pub.town,
    p_drink_name: gift.name,
    p_drink_icon: gift.icon,
    p_drink_price: gift.price,
    p_service_fee: voucher.fee,
    p_total: voucher.total,
    p_recipient_name: voucher.recipient,
    p_recipient_phone: voucher.phone,
    p_sender_name: voucher.sender,
    p_message: voucher.message,
    p_delivery_date: voucher.deliveryDate,
    p_expires_at: voucher.expiresAt
  });

  if (error) {
    console.warn("[PintDrop] Supabase voucher create failed:", error.message);
    return null;
  }

  return mapSupabaseVoucherRow(data);
}

async function redeemVoucherInSupabase({ id, code } = {}) {
  const client = getSupabaseClient();
  if (!client || (!id && !code)) return null;

  const { data, error } = await client.rpc("redeem_voucher", {
    p_id: id || null,
    p_code: code || null
  });

  if (error) {
    console.warn("[PintDrop] Supabase voucher redeem failed:", error.message);
    return null;
  }

  return mapSupabaseVoucherRow(data);
}

async function fetchPartnerVouchersFromSupabase(pubId) {
  const client = getSupabaseClient();
  if (!client || !pubId) return null;

  const { data, error } = await client.rpc("list_vouchers_by_pub", {
    p_pub_id: pubId
  });

  if (error) {
    console.warn("[PintDrop] Supabase partner vouchers fetch failed:", error.message);
    return null;
  }

  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return rows.map(mapSupabaseVoucherRow).filter(Boolean);
}

window.PintDropSupabase.fetchVoucherByCode = fetchVoucherByCodeFromSupabase;
window.PintDropSupabase.createVoucher = createVoucherInSupabase;
window.PintDropSupabase.redeemVoucher = redeemVoucherInSupabase;
window.PintDropSupabase.mapVoucherRow = mapSupabaseVoucherRow;
window.PintDropSupabase.fetchPartnerVouchers = fetchPartnerVouchersFromSupabase;

function normalizeInvokeData(data) {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
}

async function readInvokeErrorBody(error) {
  if (!error?.context || typeof error.context.text !== "function") {
    return null;
  }

  try {
    const raw = await error.context.text();
    if (!raw?.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function sendVoucherSmsFromEdge(voucher) {
  const client = getSupabaseClient();
  if (!client || !voucher) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const payload = {
    recipient_phone: String(voucher.phone || voucher.recipient_phone || "").trim(),
    voucher_code: String(voucher.code || voucher.voucher_code || "").trim(),
    sender_name: String(voucher.sender || voucher.sender_name || "").trim(),
    recipient_name: String(voucher.recipient || voucher.recipient_name || "").trim(),
    pub_name: String(voucher.pub?.name || voucher.pub_name || "").trim(),
    drink_name: String(voucher.gift?.name || voucher.drink_name || "").trim()
  };

  if (!payload.recipient_phone || !payload.voucher_code) {
    return { ok: false, error: "Missing recipient phone or voucher code." };
  }

  try {
    const { data, error } = await client.functions.invoke("send-voucher-sms", { body: payload });
    const parsedData = normalizeInvokeData(data);
    const errorBody = error ? await readInvokeErrorBody(error) : null;

    if (error) {
      const message = errorBody?.error || errorBody?.details || error.message || "SMS could not be sent.";
      return { ok: false, error: message };
    }

    if (!parsedData?.ok) {
      return { ok: false, error: parsedData?.error || parsedData?.details || "SMS could not be sent." };
    }

    return { ok: true, message_sid: parsedData.message_sid };
  } catch (error) {
    return { ok: false, error: "SMS could not be sent." };
  }
}

async function sendSenderConfirmationFromEdge(voucher, senderEmail) {
  const client = getSupabaseClient();
  if (!client || !voucher) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const payload = {
    sender_email: String(senderEmail || "").trim().toLowerCase(),
    sender_name: String(voucher.sender || voucher.sender_name || "").trim(),
    recipient_name: String(voucher.recipient || voucher.recipient_name || "").trim(),
    pub_name: String(voucher.pub?.name || voucher.pub_name || "").trim(),
    drink_name: String(voucher.gift?.name || voucher.drink_name || "").trim(),
    message: String(voucher.message || "").trim(),
    voucher_code: String(voucher.code || voucher.voucher_code || "").trim()
  };

  if (!payload.sender_email || !payload.voucher_code) {
    return { ok: false, error: "Missing sender email or voucher code." };
  }

  try {
    const { data, error } = await client.functions.invoke("send-sender-confirmation", { body: payload });
    const parsedData = normalizeInvokeData(data);
    const errorBody = error ? await readInvokeErrorBody(error) : null;

    if (error) {
      const message = errorBody?.error || errorBody?.details || error.message || "Confirmation email could not be sent.";
      return { ok: false, error: message };
    }

    if (!parsedData?.ok) {
      return { ok: false, error: parsedData?.error || parsedData?.details || "Confirmation email could not be sent." };
    }

    return { ok: true, email_id: parsedData.email_id, voucher_url: parsedData.voucher_url };
  } catch (error) {
    return { ok: false, error: "Confirmation email could not be sent." };
  }
}

async function sendRecipientGiftFromEdge(voucher, recipientEmail) {
  const client = getSupabaseClient();
  if (!client || !voucher) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const payload = {
    recipient_email: String(recipientEmail || "").trim().toLowerCase(),
    sender_name: String(voucher.sender || voucher.sender_name || "").trim(),
    recipient_name: String(voucher.recipient || voucher.recipient_name || "").trim(),
    pub_name: String(voucher.pub?.name || voucher.pub_name || "").trim(),
    drink_name: String(voucher.gift?.name || voucher.drink_name || "").trim(),
    message: String(voucher.message || "").trim(),
    voucher_code: String(voucher.code || voucher.voucher_code || "").trim()
  };

  if (!payload.recipient_email || !payload.voucher_code) {
    return { ok: false, error: "Missing recipient email or voucher code." };
  }

  try {
    const { data, error } = await client.functions.invoke("send-recipient-gift", { body: payload });
    const parsedData = normalizeInvokeData(data);
    const errorBody = error ? await readInvokeErrorBody(error) : null;

    if (error) {
      const message = errorBody?.error || errorBody?.details || error.message || "Recipient gift email could not be sent.";
      return { ok: false, error: message };
    }

    if (!parsedData?.ok) {
      return { ok: false, error: parsedData?.error || parsedData?.details || "Recipient gift email could not be sent." };
    }

    return { ok: true, email_id: parsedData.email_id, voucher_url: parsedData.voucher_url };
  } catch (error) {
    return { ok: false, error: "Recipient gift email could not be sent." };
  }
}

window.PintDropSupabase.sendVoucherSms = sendVoucherSmsFromEdge;
window.PintDropSupabase.sendSenderConfirmation = sendSenderConfirmationFromEdge;
window.PintDropSupabase.sendRecipientGiftEmail = sendRecipientGiftFromEdge;

async function signInPartner(email, password) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    return { ok: false, error: "Email and password are required." };
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });

  if (error) {
    console.warn("[PintDrop Partner Auth] sign in failed:", error.message);
    return { ok: false, error: error.message || "Sign in failed." };
  }

  return { ok: true, session: data.session, user: data.user };
}

async function signOutPartner() {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { error } = await client.auth.signOut();
  if (error) {
    console.warn("[PintDrop Partner Auth] sign out failed:", error.message);
    return { ok: false, error: error.message || "Sign out failed." };
  }

  return { ok: true };
}

async function getPartnerSession() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.auth.getSession();
  if (error) {
    console.warn("[PintDrop Partner Auth] getSession failed:", error.message);
    return null;
  }

  return data.session || null;
}

function onPartnerAuthStateChange(callback) {
  const client = getSupabaseClient();
  if (!client || typeof callback !== "function") {
    return () => {};
  }

  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    data?.subscription?.unsubscribe?.();
  };
}

async function fetchMyPartnerProfileFromSupabase() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.rpc("get_my_partner_profile");
  if (error) {
    console.warn("[PintDrop Partner Auth] profile fetch failed:", error.message);
    return null;
  }

  return data || null;
}

async function fetchMyPubStripeConnectFromSupabase() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.rpc("get_my_pub_stripe_connect");
  if (error) {
    console.warn("[PintDrop Partner Auth] stripe connect fetch failed:", error.message);
    return null;
  }

  return data || null;
}

async function fetchMyPubMenuFromSupabase() {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.rpc("get_my_pub_menu");
  if (error) {
    console.warn("[PintDrop Partner Menu] fetch failed:", error.message);
    throw error;
  }

  return data || null;
}

async function saveMyPubMenuToSupabase(p_menu) {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const { data, error } = await client.rpc("save_my_pub_menu", { p_menu });
  if (error) {
    console.warn("[PintDrop Partner Menu] save failed:", error.message);
    return { ok: false, error: error.message || "Could not save your menu." };
  }

  return { ok: true, menu: data || null };
}

window.PintDropSupabase.PartnerAuth = {
  signIn: signInPartner,
  signOut: signOutPartner,
  getSession: getPartnerSession,
  onAuthStateChange: onPartnerAuthStateChange,
  fetchProfile: fetchMyPartnerProfileFromSupabase,
  fetchStripeConnect: fetchMyPubStripeConnectFromSupabase,
  fetchMenu: fetchMyPubMenuFromSupabase,
  saveMenu: saveMyPubMenuToSupabase
};
