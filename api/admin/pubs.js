const {
  requireAdminAuth,
  getSupabaseUrl,
  getSupabaseServiceRoleKey
} = require("../_lib/connect-helpers");
const { requirePreviewOrDevelopment } = require("../_lib/preview-only");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requirePreviewOrDevelopment(res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  if (!requireAdminAuth(req, res)) return;

  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    res.status(500).json({ ok: false, error: "Supabase admin access is not configured." });
    return;
  }

  try {
    const params = new URLSearchParams({
      select: [
        "id",
        "name",
        "location",
        "contact_name",
        "contact_phone",
        "contact_email",
        "active",
        "onboarding_status",
        "stripe_onboarding_status"
      ].join(","),
      order: "id.desc",
      limit: "200"
    });
    const response = await fetch(`${getSupabaseUrl()}/rest/v1/pubs?${params.toString()}`, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || "Supabase pubs query failed.");
    }

    res.status(200).json({
      ok: true,
      pubs: (Array.isArray(data) ? data : []).map((pub) => ({
        id: Number(pub.id),
        name: String(pub.name || ""),
        location: String(pub.location || ""),
        contactName: String(pub.contact_name || ""),
        contactPhone: String(pub.contact_phone || ""),
        contactEmail: String(pub.contact_email || ""),
        active: pub.active === true,
        onboardingStatus: String(pub.onboarding_status || "draft"),
        stripeOnboardingStatus: String(pub.stripe_onboarding_status || "not_started")
      }))
    });
  } catch (error) {
    console.error("[admin/pubs]", error?.message || "Unknown error");
    res.status(500).json({ ok: false, error: "Could not load the pub list." });
  }
};
