const crypto = require("crypto");
const Stripe = require("stripe");
const {
  hasValidAdminSession,
  getAdminSessionFromRequest,
  getAdminSessionSecret
} = require("./admin-session");

const DEFAULT_SUPABASE_URL = "https://ggvofckolukahshocxvd.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_4NAQehcdmGoOOUbDMHniHg_8ExxQv3m";

function getRequestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) {
    return proto + "://" + host;
  }
  return "https://pintdrop.ie";
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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

function requirePost(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}

function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

const STRIPE_SECRET_KEY_PATTERN = /^sk_(test|live)_[A-Za-z0-9]+$/;

function validateStripeSecretKey(raw) {
  const secretKey = String(raw || "").trim();
  if (!secretKey) {
    return { error: "Stripe is not configured on the server." };
  }
  if (!STRIPE_SECRET_KEY_PATTERN.test(secretKey)) {
    return { error: "Invalid Stripe secret key format." };
  }
  return { secretKey };
}

function createStripeClient() {
  const validated = validateStripeSecretKey(getStripeSecretKey());
  if (validated.error) {
    return { error: validated.error };
  }
  return { stripe: new Stripe(validated.secretKey) };
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, "");
}

function getSupabaseServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function getSupabaseAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
}

function getPartnerAccessTokenFromRequest(req) {
  const headers = req.headers;
  if (!headers) return "";

  let authHeader = "";
  if (typeof headers.get === "function") {
    authHeader = String(headers.get("authorization") || "").trim();
  }
  if (!authHeader) {
    authHeader = String(headers.authorization || "").trim();
  }

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  // Some preview hosting layers reserve or rewrite the Authorization header.
  // Accept the same Supabase token from a dedicated header as a safe fallback.
  let partnerToken = "";
  if (typeof headers.get === "function") {
    partnerToken = String(headers.get("x-pintdrop-partner-token") || "").trim();
  }
  if (!partnerToken) {
    partnerToken = String(headers["x-pintdrop-partner-token"] || "").trim();
  }

  if (partnerToken.toLowerCase().startsWith("bearer ")) {
    return partnerToken.slice(7).trim();
  }
  if (partnerToken) return partnerToken;

  return "";
}

function hasValidAdminKey(req) {
  const configuredKey = String(process.env.PINTDROP_ADMIN_KEY || "").trim();
  if (!configuredKey) return false;

  const providedKey = getAdminKeyFromRequest(req);
  return Boolean(providedKey && timingSafeEqualStrings(providedKey, configuredKey));
}

function hasValidAdminAuth(req) {
  return hasValidAdminKey(req) || hasValidAdminSession(req);
}

function requireAdminAuth(req, res) {
  const configuredKey = String(process.env.PINTDROP_ADMIN_KEY || "").trim();
  if (!configuredKey) {
    sendJson(res, 500, { ok: false, error: "PINTDROP_ADMIN_KEY is not configured on the server." });
    return false;
  }

  if (!hasValidAdminAuth(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return false;
  }

  return true;
}

function getAdminKeyFromRequest(req) {
  const headers = req.headers;
  if (!headers) return "";

  let headerKey = "";
  if (typeof headers.get === "function") {
    headerKey = String(headers.get("x-pintdrop-admin-key") || "").trim();
  }
  if (!headerKey) {
    headerKey = String(headers["x-pintdrop-admin-key"] || "").trim();
  }
  if (headerKey) return headerKey;

  let authHeader = "";
  if (typeof headers.get === "function") {
    authHeader = String(headers.get("authorization") || "").trim();
  }
  if (!authHeader) {
    authHeader = String(headers.authorization || "").trim();
  }
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

function timingSafeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdminKey(req, res) {
  const configuredKey = String(process.env.PINTDROP_ADMIN_KEY || "").trim();
  if (!configuredKey) {
    sendJson(res, 500, { ok: false, error: "PINTDROP_ADMIN_KEY is not configured on the server." });
    return false;
  }

  const providedKey = getAdminKeyFromRequest(req);
  if (!providedKey || !timingSafeEqualStrings(providedKey, configuredKey)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return false;
  }

  return true;
}

function requireSupabaseServiceRole(res) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." });
    return null;
  }
  return serviceRoleKey;
}

async function supabaseRpcAsUser(functionName, payload, accessToken) {
  const anonKey = getSupabaseAnonKey();
  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY is not configured.");
  }

  if (!accessToken) {
    throw new Error("Partner access token is required.");
  }

  const response = await fetch(getSupabaseUrl() + "/rest/v1/rpc/" + functionName, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: "Bearer " + accessToken
    },
    body: JSON.stringify(payload || {})
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || "Supabase RPC failed.";
    throw new Error(message);
  }

  return data;
}

async function resolveAuthenticatedPartnerPub(req) {
  const accessToken = getPartnerAccessTokenFromRequest(req);
  if (!accessToken) return null;

  const configuredAdminKey = String(process.env.PINTDROP_ADMIN_KEY || "").trim();
  if (configuredAdminKey && timingSafeEqualStrings(accessToken, configuredAdminKey)) {
    return null;
  }

  const anonKey = getSupabaseAnonKey();
  if (!anonKey) return null;

  const userResponse = await fetch(getSupabaseUrl() + "/auth/v1/user", {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + accessToken
    }
  });

  if (!userResponse.ok) {
    return null;
  }

  let profile = null;
  try {
    profile = await supabaseRpcAsUser("get_my_partner_profile", {}, accessToken);
  } catch (error) {
    console.warn("[stripe-connect] Partner profile lookup failed:", error.message);
    return null;
  }

  if (typeof profile === "string") {
    try {
      profile = JSON.parse(profile);
    } catch {
      return null;
    }
  }

  const pubId = Number(profile?.pub_id);
  if (!Number.isFinite(pubId) || pubId <= 0) {
    return null;
  }

  return {
    pubId,
    profile,
    accessToken
  };
}

async function authorizeConnectRequest(req, res, body = {}) {
  if (hasValidAdminKey(req)) {
    const pubId = Number(body.pubId);
    if (!Number.isFinite(pubId) || pubId <= 0) {
      sendJson(res, 400, { ok: false, error: "pubId is required." });
      return null;
    }

    return {
      mode: "admin",
      pubId
    };
  }

  const partner = await resolveAuthenticatedPartnerPub(req);
  if (!partner) {
    sendJson(res, 401, { ok: false, error: "Partner authentication required." });
    return null;
  }

  const bodyPubId = Number(body.pubId);
  if (Number.isFinite(bodyPubId) && bodyPubId > 0 && bodyPubId !== partner.pubId) {
    sendJson(res, 403, { ok: false, error: "Access denied for pub." });
    return null;
  }

  return {
    mode: "partner",
    pubId: partner.pubId,
    profile: partner.profile
  };
}

async function loadPubStripeConnect(pubId) {
  return supabaseRpc("get_pub_stripe_connect", { p_pub_id: pubId });
}

async function ensureStripeConnectAccount(stripe, pubId, existingPub) {
  let pub = existingPub || null;

  if (!pub) {
    pub = await loadPubStripeConnect(pubId);
  }

  if (!pub) {
    return { error: "Pub not found.", status: 404 };
  }

  if (pub.stripe_account_id) {
    return {
      pub,
      stripeAccountId: String(pub.stripe_account_id),
      created: false,
      reused: true
    };
  }

  const account = await stripe.accounts.create({
    type: "express",
    country: "IE",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      pub_id: String(pubId),
      pintdrop_pub_id: String(pubId),
      pub_name: String(pub.name || "")
    }
  });

  await syncStripeAccountToSupabase(account);

  const refreshed = await loadPubStripeConnect(pubId);
  return {
    pub: refreshed || pub,
    stripeAccountId: account.id,
    created: true,
    reused: false
  };
}

async function supabaseRpc(functionName, payload) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const response = await fetch(getSupabaseUrl() + "/rest/v1/rpc/" + functionName, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || "Supabase RPC failed.";
    throw new Error(message);
  }

  return data;
}

async function supabaseSelectPubs(filters = {}) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, value);
  });
  params.set("select", "id,name,location,active,stripe_account_id,stripe_onboarding_status");

  const response = await fetch(getSupabaseUrl() + "/rest/v1/pubs?" + params.toString(), {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    }
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || data?.error || "Supabase pubs query failed.";
    throw new Error(message);
  }

  return data;
}

function deriveOnboardingStatus(account) {
  if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
    return "complete";
  }

  if (account.requirements?.disabled_reason) {
    return "restricted";
  }

  if (account.id) {
    return "pending";
  }

  return "not_started";
}

async function syncStripeAccountToSupabase(account) {
  let pubId = Number(account.metadata?.pub_id || account.metadata?.pintdrop_pub_id);

  if (!Number.isFinite(pubId)) {
    const pubs = await supabaseSelectPubs({
      stripe_account_id: "eq." + account.id
    });
    pubId = Number(pubs[0]?.id);
  }

  if (!Number.isFinite(pubId)) {
    console.warn("[stripe-connect] No pub matched Stripe account:", account.id);
    return null;
  }

  const onboardingStatus = deriveOnboardingStatus(account);
  const payload = {
    p_pub_id: pubId,
    p_stripe_account_id: account.id,
    p_stripe_charges_enabled: Boolean(account.charges_enabled),
    p_stripe_payouts_enabled: Boolean(account.payouts_enabled),
    p_stripe_details_submitted: Boolean(account.details_submitted),
    p_stripe_onboarding_status: onboardingStatus,
    p_set_onboarded_at: onboardingStatus === "complete"
  };

  return supabaseRpc("update_pub_stripe_connect", payload);
}

module.exports = {
  DEFAULT_SUPABASE_URL,
  getRequestOrigin,
  readJsonBody,
  readRawBody,
  sendJson,
  handleOptions,
  requirePost,
  createStripeClient,
  validateStripeSecretKey,
  getSupabaseUrl,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getPartnerAccessTokenFromRequest,
  getAdminSessionSecret,
  hasValidAdminKey,
  hasValidAdminAuth,
  requireAdminAuth,
  requireAdminKey,
  getAdminSessionFromRequest,
  requireSupabaseServiceRole,
  supabaseRpc,
  supabaseRpcAsUser,
  resolveAuthenticatedPartnerPub,
  authorizeConnectRequest,
  loadPubStripeConnect,
  ensureStripeConnectAccount,
  supabaseSelectPubs,
  deriveOnboardingStatus,
  syncStripeAccountToSupabase
};
