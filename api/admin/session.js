const { hasValidAdminSession } = require("../_lib/admin-session");
const { requirePreviewOrDevelopment } = require("../_lib/preview-only");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requirePreviewOrDevelopment(res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  res.status(200).json({ ok: true, authenticated: hasValidAdminSession(req) });
};
