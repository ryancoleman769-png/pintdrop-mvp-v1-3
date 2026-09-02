function isPreviewOrDevelopment() {
  const vercelEnvironment = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercelEnvironment) {
    return vercelEnvironment === "preview" || vercelEnvironment === "development";
  }

  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

function requirePreviewOrDevelopment(res) {
  if (isPreviewOrDevelopment()) return true;

  res.status(404).json({
    ok: false,
    error: "This preview-only feature is not available in Production."
  });
  return false;
}

function requireStripeTestMode(res) {
  const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();

  if (!stripeSecretKey) {
    res.status(500).json({ ok: false, error: "Stripe test mode is not configured." });
    return false;
  }

  if (!stripeSecretKey.startsWith("sk_test_")) {
    res.status(500).json({
      ok: false,
      error: "Preview onboarding is locked to Stripe test mode."
    });
    return false;
  }

  return true;
}

module.exports = {
  isPreviewOrDevelopment,
  requirePreviewOrDevelopment,
  requireStripeTestMode
};
