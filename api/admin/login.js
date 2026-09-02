const crypto = require("crypto");
const {
  getAdminSessionSecret,
  createAdminSessionToken,
  setAdminSessionCookie
} = require("../_lib/admin-session");
const { readJsonBody } = require("../_lib/connect-helpers");
const { requirePreviewOrDevelopment } = require("../_lib/preview-only");

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requirePreviewOrDevelopment(res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const secret = getAdminSessionSecret();
  if (!secret) {
    res.status(500).json({ ok: false, error: "Preview admin access is not configured." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (!safeEqual(body?.key, secret)) {
      res.setHeader("Retry-After", "2");
      res.status(401).json({ ok: false, error: "Incorrect admin password." });
      return;
    }

    const token = createAdminSessionToken(secret);
    setAdminSessionCookie(res, token, req);
    res.status(200).json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: "Invalid request." });
  }
};
