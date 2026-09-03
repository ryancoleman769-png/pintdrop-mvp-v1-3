const {
  handleOptions,
  requirePost,
  sendJson,
  readJsonBody
} = require("../_lib/connect-helpers");
const {
  getAdminSessionSecret,
  createAdminSessionToken,
  setAdminSessionCookie
} = require("../_lib/admin-session");
const { requireAdminReportingEnv, passwordsMatch } = require("../_lib/admin-guard");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requireAdminReportingEnv(req, res)) return;
  if (!requirePost(req, res)) return;

  const secret = getAdminSessionSecret();
  if (!secret) {
    sendJson(res, 500, { ok: false, error: "Admin login is not configured on the server." });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body." });
    return;
  }

  const password = String(body.password || "").trim();
  if (!password || !passwordsMatch(password, secret)) {
    sendJson(res, 401, { ok: false, error: "Invalid admin credentials." });
    return;
  }

  setAdminSessionCookie(res, createAdminSessionToken(secret), req);
  sendJson(res, 200, { ok: true, authenticated: true });
};
