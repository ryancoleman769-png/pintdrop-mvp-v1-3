import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type SendSenderConfirmationRequest = {
  sender_email?: string;
  sender_name?: string;
  recipient_name?: string;
  pub_name?: string;
  drink_name?: string;
  message?: string;
  voucher_code?: string;
  app_url?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function readRequestJson(req: Request) {
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return { ok: false as const, error: "Could not read request body." };
  }

  if (!raw.trim()) {
    return { ok: false as const, error: "Empty request body." };
  }

  try {
    return { ok: true as const, data: JSON.parse(raw) as SendSenderConfirmationRequest };
  } catch {
    return { ok: false as const, error: "Invalid JSON body." };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildRecipientVoucherUrl(appUrl: string, voucherCode: string) {
  return `${appUrl.replace(/\/$/, "")}/#redeem/${encodeURIComponent(voucherCode)}`;
}

function buildEmailHtml({
  appUrl,
  senderName,
  recipientName,
  pubName,
  drinkName,
  message,
  voucherCode,
  voucherUrl
}: {
  appUrl: string;
  senderName: string;
  recipientName: string;
  pubName: string;
  drinkName: string;
  message: string;
  voucherCode: string;
  voucherUrl: string;
}) {
  const logoUrl = `${appUrl.replace(/\/$/, "")}/images/pintdrop-logo.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your PintDrop has been sent</title>
</head>
<body style="margin:0;padding:0;background:#061009;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#e8efe9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#061009;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f1f17;border:1px solid rgba(106,203,69,0.28);border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:32px 28px 20px;text-align:center;background:linear-gradient(180deg,rgba(106,203,69,0.12),transparent);">
              <img src="${escapeHtml(logoUrl)}" alt="PintDrop" width="180" style="display:block;margin:0 auto 18px;max-width:180px;height:auto;" />
              <h1 style="margin:0;font-size:28px;line-height:1.15;color:#ffffff;letter-spacing:-0.03em;">Your PintDrop has been sent</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#dce7df;">
                Hi ${escapeHtml(senderName)}, thanks for sending a PintDrop! We’ve sent ${escapeHtml(recipientName)} a text with everything they need to enjoy their drink.
              </p>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#dce7df;">
                We’ve included your gift details below for your records.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:separate;border-spacing:0 10px;">
                <tr>
                  <td style="padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;">Recipient</div>
                    <div style="font-size:16px;font-weight:700;color:#ffffff;">${escapeHtml(recipientName)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;">Pub</div>
                    <div style="font-size:16px;font-weight:700;color:#ffffff;">${escapeHtml(pubName)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;">Gift / drink</div>
                    <div style="font-size:16px;font-weight:700;color:#ffffff;">${escapeHtml(drinkName)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;">Personal message</div>
                    <div style="font-size:15px;line-height:1.5;color:#dce7df;font-style:italic;">“${escapeHtml(message)}”</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border:1px solid rgba(106,203,69,0.22);border-radius:14px;background:rgba(106,203,69,0.08);">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;">PintDrop reference</div>
                    <div style="font-size:18px;font-weight:800;color:#6acb45;letter-spacing:0.06em;font-family:Consolas,Monaco,monospace;">${escapeHtml(voucherCode)}</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 18px;">
                <tr>
                  <td align="center" style="border-radius:14px;background:#6acb45;">
                    <a href="${escapeHtml(voucherUrl)}" style="display:inline-block;padding:16px 28px;font-size:16px;font-weight:800;color:#07120d;text-decoration:none;letter-spacing:0.04em;">View voucher</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#a8b5ad;text-align:center;">
                If your recipient doesn’t receive the text message, you can share this voucher link with them.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6d7a72;text-align:center;">PintDrop · Send a pint to their local</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText({
  senderName,
  recipientName,
  pubName,
  drinkName,
  message,
  voucherCode,
  voucherUrl
}: {
  senderName: string;
  recipientName: string;
  pubName: string;
  drinkName: string;
  message: string;
  voucherCode: string;
  voucherUrl: string;
}) {
  return [
    "Your PintDrop has been sent",
    "",
    `Hi ${senderName}, thanks for sending a PintDrop! We’ve sent ${recipientName} a text with everything they need to enjoy their drink.`,
    "",
    "We’ve included your gift details below for your records.",
    "Recipient: " + recipientName,
    "Pub: " + pubName,
    "Gift / drink: " + drinkName,
    "Personal message: \"" + message + "\"",
    "PintDrop reference: " + voucherCode,
    "",
    "View voucher: " + voucherUrl,
    "",
    "If your recipient doesn't receive the text message, you can share this voucher link with them.",
    "",
    "PintDrop"
  ].join("\n");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
    }

    const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")?.trim();

    if (!apiKey || !fromEmail) {
      return jsonResponse(
        {
          ok: false,
          error: "Email provider is not configured on the server."
        },
        500
      );
    }

    const parsedBody = await readRequestJson(req);
    if (!parsedBody.ok) {
      return jsonResponse({ ok: false, error: parsedBody.error }, 400);
    }

    const payload = parsedBody.data;
    const senderEmail = (payload.sender_email || "").trim().toLowerCase();
    const senderName = (payload.sender_name || "").trim();
    const recipientName = (payload.recipient_name || "").trim();
    const pubName = (payload.pub_name || "").trim();
    const drinkName = (payload.drink_name || "").trim();
    const message = (payload.message || "").trim();
    const voucherCode = (payload.voucher_code || "").trim().toUpperCase();
    const appUrl = (
      (payload.app_url || "").trim()
      || Deno.env.get("PINTDROP_APP_URL")
      || "https://pintdrop-mvp-v1-3.vercel.app"
    ).trim();

    if (!senderEmail || !isValidEmail(senderEmail)) {
      return jsonResponse(
        { ok: false, error: "sender_email is required and must be valid." },
        400
      );
    }

    if (!senderName || !recipientName || !pubName || !drinkName || !voucherCode) {
      return jsonResponse(
        {
          ok: false,
          error:
            "sender_name, recipient_name, pub_name, drink_name and voucher_code are required."
        },
        400
      );
    }

    const voucherUrl = buildRecipientVoucherUrl(appUrl, voucherCode);
    const html = buildEmailHtml({
      appUrl,
      senderName,
      recipientName,
      pubName,
      drinkName,
      message: message || `A PintDrop from ${senderName}`,
      voucherCode,
      voucherUrl
    });
    const text = buildEmailText({
      senderName,
      recipientName,
      pubName,
      drinkName,
      message: message || `A PintDrop from ${senderName}`,
      voucherCode,
      voucherUrl
    });

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [senderEmail],
        subject: "Your PintDrop has been sent",
        html,
        text
      })
    });

    let resendData: Record<string, unknown> = {};
    try {
      resendData = await resendResponse.json();
    } catch {
      resendData = {};
    }

    if (!resendResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Confirmation email could not be sent.",
          details: resendData.message || resendData
        },
        502
      );
    }

    return jsonResponse({
      ok: true,
      email_id: resendData.id,
      to: senderEmail,
      voucher_code: voucherCode,
      voucher_url: voucherUrl
    });
  } catch (error) {
    console.error("[send-sender-confirmation] Unhandled error:", error);
    return jsonResponse({ ok: false, error: "Internal server error." }, 500);
  }
});
