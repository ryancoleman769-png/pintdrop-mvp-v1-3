const crypto = require("crypto");

const ADMIN_SESSION_COOKIE = "pintdrop_admin_session";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function getAdminSessionSecret() {
  return String(process.env.PINTDROP_ADMIN_KEY || "").trim();
}

function parseCookies(req) {
  const raw = String(
    req.headers?.cookie
    || req.headers?.get?.("cookie")
    || ""
  ).trim();
  const cookies = {};
  if (!raw) return cookies;

  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function signAdminSessionPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyAdminSessionToken(token, secret) {
  const value = String(token || "").trim();
  if (!value || !secret) return null;

  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");

  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
    if (payload.role !== "pintdrop_admin") return null;
    return payload;
  } catch {
    return null;
  }
}

function createAdminSessionToken(secret) {
  return signAdminSessionPayload({
    role: "pintdrop_admin",
    exp: Date.now() + ADMIN_SESSION_TTL_MS
  }, secret);
}

function getAdminSessionFromRequest(req) {
  const secret = getAdminSessionSecret();
  if (!secret) return null;
  const cookies = parseCookies(req);
  return verifyAdminSessionToken(cookies[ADMIN_SESSION_COOKIE], secret);
}

function hasValidAdminSession(req) {
  return Boolean(getAdminSessionFromRequest(req));
}

function buildAdminSessionCookie(token, req) {
  const secure = String(process.env.VERCEL_ENV || "").trim() !== "development";
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function setAdminSessionCookie(res, token, req) {
  res.setHeader("Set-Cookie", buildAdminSessionCookie(token, req));
}

function clearAdminSessionCookie(res, req) {
  const secure = String(process.env.VERCEL_ENV || "").trim() !== "development";
  const parts = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  getAdminSessionSecret,
  hasValidAdminSession,
  getAdminSessionFromRequest,
  createAdminSessionToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  verifyAdminSessionToken
};
