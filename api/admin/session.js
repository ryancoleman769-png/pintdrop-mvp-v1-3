const {
  handleOptions,
  sendJson,
  hasValidAdminAuth
} = require("../_lib/connect-helpers");
const { requireAdminReportingEnv, requireGet } = require("../_lib/admin-guard");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (!requireAdminReportingEnv(req, res)) return;
  if (!requireGet(req, res)) return;

  sendJson(res, 200, {
    ok: true,
    authenticated: hasValidAdminAuth(req)
  });
};
