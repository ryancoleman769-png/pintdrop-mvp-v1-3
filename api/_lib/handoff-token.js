const crypto = require("crypto");

const HANDOFF_TOKEN_VERSION = 1;
const HANDOFF_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getHandoffSecret() {
  return String(
    process.env.PINTDROP_HANDOFF_SECRET
    || process.env.PINTDROP_ADMIN_KEY
    || ""
  ).trim();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signBody(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function createHandoffToken({ pubId, stripeAccountId }, now = Date.now()) {
  const secret = getHandoffSecret();
  if (!secret) {
    throw new Error("PINTDROP_HANDOFF_SECRET or PINTDROP_ADMIN_KEY is required.");
  }

  const parsedPubId = Number(pubId);
  const accountId = String(stripeAccountId || "").trim();
  if (!Number.isInteger(parsedPubId) || parsedPubId <= 0) {
    throw new Error("A valid pub ID is required for the handoff token.");
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new Error("A valid Stripe account ID is required for the handoff token.");
  }

  const payload = {
    v: HANDOFF_TOKEN_VERSION,
    pubId: parsedPubId,
    accountId,
    preview: true,
    jti: crypto.randomBytes(12).toString("base64url"),
    exp: now + HANDOFF_TOKEN_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body, secret)}`;
}

function verifyHandoffToken(token, now = Date.now()) {
  const secret = getHandoffSecret();
  const value = String(token || "").trim();
  if (!secret || !value) return null;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!safeEqual(signature, signBody(body, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload?.v !== HANDOFF_TOKEN_VERSION || payload?.preview !== true) return null;
    if (!Number.isInteger(Number(payload.pubId)) || Number(payload.pubId) <= 0) return null;
    if (!/^acct_[A-Za-z0-9]+$/.test(String(payload.accountId || ""))) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) return null;
    return {
      pubId: Number(payload.pubId),
      stripeAccountId: String(payload.accountId),
      expiresAt: Number(payload.exp),
      tokenId: String(payload.jti || "")
    };
  } catch {
    return null;
  }
}

module.exports = {
  HANDOFF_TOKEN_TTL_MS,
  createHandoffToken,
  verifyHandoffToken
};
