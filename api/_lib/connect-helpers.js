const crypto = require("crypto");
const Stripe = require("stripe");

const DEFAULT_SUPABASE_URL = "https://ggvofckolukahshocxvd.supabase.co";

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

function createStripeClient() {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    return { error: "Stripe is not configured on the server." };
  }
  if (!secretKey.startsWith("sk_test_")) {
    return { error: "Stripe test mode only. Use a sk_test_ key." };
  }
  return { stripe: new Stripe(secretKey) };
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, "");
}

function getSupabaseServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
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

function getPintDropAppUrl(req) {
  const explicit = String(process.env.PINTDROP_APP_URL || "").trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (req) {
    const origin = getRequestOrigin(req);
    if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) {
      return origin.replace(/\/+$/, "");
    }
  }

  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, "")}`.replace(/\/+$/, "");
  }

  return "https://pintdrop-mvp-v1-3.vercel.app";
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
  getPintDropAppUrl,
  readJsonBody,
  readRawBody,
  sendJson,
  handleOptions,
  requirePost,
  createStripeClient,
  getSupabaseUrl,
  getSupabaseServiceRoleKey,
  requireAdminKey,
  requireSupabaseServiceRole,
  supabaseRpc,
  supabaseSelectPubs,
  deriveOnboardingStatus,
  syncStripeAccountToSupabase
};
