const crypto = require("crypto");
const { sendJson } = require("./connect-helpers");

function isAdminReportingEnv(env = process.env) {
  const value = String(env.VERCEL_ENV || "").trim();
  return value === "preview" || value === "production";
}

function requireAdminReportingEnv(req, res, env = process.env) {
  if (!isAdminReportingEnv(env)) {
    sendJson(res, 403, { ok: false, error: "Admin reporting is not available in this environment." });
    return false;
  }
  return true;
}

function requireGet(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}

function passwordsMatch(provided, expected) {
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  isAdminReportingEnv,
  requireAdminReportingEnv,
  requireGet,
  passwordsMatch
};

