const {
  handleOptions,
  requirePost,
  sendJson,
  hasValidAdminAuth
} = require("../_lib/connect-helpers");
const { clearAdminSessionCookie } = require("../_lib/admin-session");
const { requireAdminReportingEnv } = require("../_lib/admin-guard");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requireAdminReportingEnv(req, res)) return;
  if (!requirePost(req, res)) return;

  if (!hasValidAdminAuth(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized." });
    return;
  }

  clearAdminSessionCookie(res, req);
  sendJson(res, 200, { ok: true, authenticated: false });
};
