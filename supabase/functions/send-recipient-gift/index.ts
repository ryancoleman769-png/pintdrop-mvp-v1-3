import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type SendRecipientGiftRequest = {
  recipient_email?: string;
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
    return { ok: true as const, data: JSON.parse(raw) as SendRecipientGiftRequest };
  } catch {
    return { ok: false as const, error: "Invalid JSON body." };
  }
}

function escapeHtml(value: string) {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charAt(i);
    if (ch === "&") {
      result += "&amp;";
    } else if (ch === "<") {
      result += "&lt;";
    } else if (ch === ">") {
      result += "&gt;";
    } else if (ch === '"') {
      result += "&quot;";
    } else if (ch === "'") {
      result += "&#39;";
    } else {
      result += ch;
    }
  }
  return result;
}

function trimTrailingSlash(url: string) {
  if (url.endsWith("/")) {
    return url.slice(0, -1);
  }
  return url;
}

function buildRecipientVoucherUrl(appUrl: string, voucherCode: string) {
  return trimTrailingSlash(appUrl) + "/#redeem/" + encodeURIComponent(voucherCode);
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
  const logoUrl = trimTrailingSlash(appUrl) + "/images/pintdrop-logo.png";
  const safeLogoUrl = escapeHtml(logoUrl);
  const safeSenderName = escapeHtml(senderName);
  const safeRecipientName = escapeHtml(recipientName);
  const safePubName = escapeHtml(pubName);
  const safeDrinkName = escapeHtml(drinkName);
  const safeMessage = escapeHtml(message);
  const safeVoucherCode = escapeHtml(voucherCode);
  const safeVoucherUrl = escapeHtml(voucherUrl);

  return "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "  <meta charset=\"utf-8\" />\n" +
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n" +
    "  <title>You've received a PintDrop</title>\n" +
    "</head>\n" +
    "<body style=\"margin:0;padding:0;background:#061009;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#e8efe9;\">\n" +
    "  <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#061009;padding:32px 16px;\">\n" +
    "    <tr>\n" +
    "      <td align=\"center\">\n" +
    "        <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:560px;background:#0f1f17;border:1px solid rgba(106,203,69,0.28);border-radius:24px;overflow:hidden;\">\n" +
    "          <tr>\n" +
    "            <td style=\"padding:32px 28px 20px;text-align:center;background:linear-gradient(180deg,rgba(106,203,69,0.12),transparent);\">\n" +
    "              <img src=\"" + safeLogoUrl + "\" alt=\"PintDrop\" width=\"180\" style=\"display:block;margin:0 auto 18px;max-width:180px;height:auto;\" />\n" +
    "              <h1 style=\"margin:0;font-size:28px;line-height:1.15;color:#ffffff;letter-spacing:-0.03em;\">You've received a PintDrop!</h1>\n" +
    "            </td>\n" +
    "          </tr>\n" +
    "          <tr>\n" +
    "            <td style=\"padding:8px 28px 28px;\">\n" +
    "              <p style=\"margin:0 0 20px;font-size:16px;line-height:1.55;color:#dce7df;\">\n" +
    "                Hi " + safeRecipientName + ", " + safeSenderName + " sent you a PintDrop to enjoy at the bar.\n" +
    "              </p>\n" +
    "              <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin:0 0 24px;border-collapse:separate;border-spacing:0 10px;\">\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">From</div>\n" +
    "                    <div style=\"font-size:16px;font-weight:700;color:#ffffff;\">" + safeSenderName + "</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">Recipient</div>\n" +
    "                    <div style=\"font-size:16px;font-weight:700;color:#ffffff;\">" + safeRecipientName + "</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">Pub</div>\n" +
    "                    <div style=\"font-size:16px;font-weight:700;color:#ffffff;\">" + safePubName + "</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">Gift / drink</div>\n" +
    "                    <div style=\"font-size:16px;font-weight:700;color:#ffffff;\">" + safeDrinkName + "</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.03);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">Personal message</div>\n" +
    "                    <div style=\"font-size:15px;line-height:1.5;color:#dce7df;font-style:italic;\">\u201C" + safeMessage + "\u201D</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "                <tr>\n" +
    "                  <td style=\"padding:14px 16px;border:1px solid rgba(106,203,69,0.22);border-radius:14px;background:rgba(106,203,69,0.08);\">\n" +
    "                    <div style=\"font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8fa593;margin-bottom:4px;\">PintDrop reference</div>\n" +
    "                    <div style=\"font-size:18px;font-weight:800;color:#6acb45;letter-spacing:0.06em;font-family:Consolas,Monaco,monospace;\">" + safeVoucherCode + "</div>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "              </table>\n" +
    "              <table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" style=\"margin:0 auto 18px;\">\n" +
    "                <tr>\n" +
    "                  <td align=\"center\" style=\"border-radius:14px;background:#6acb45;\">\n" +
    "                    <a href=\"" + safeVoucherUrl + "\" style=\"display:inline-block;padding:18px 32px;font-size:17px;font-weight:800;color:#07120d;text-decoration:none;letter-spacing:0.04em;\">Open your PintDrop</a>\n" +
    "                  </td>\n" +
    "                </tr>\n" +
    "              </table>\n" +
    "              <p style=\"margin:0;font-size:14px;line-height:1.55;color:#a8b5ad;text-align:center;\">\n" +
    "                Show your voucher at the bar to redeem your drink.\n" +
    "              </p>\n" +
    "            </td>\n" +
    "          </tr>\n" +
    "        </table>\n" +
    "        <p style=\"margin:18px 0 0;font-size:12px;line-height:1.5;color:#6d7a72;text-align:center;\">PintDrop · Send a pint to their local</p>\n" +
    "      </td>\n" +
    "    </tr>\n" +
    "  </table>\n" +
    "</body>\n" +
    "</html>";
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
    "You've received a PintDrop!",
    "",
    "Hi " + recipientName + ", " + senderName + " sent you a PintDrop to enjoy at the bar.",
    "",
    "From: " + senderName,
    "Recipient: " + recipientName,
    "Pub: " + pubName,
    "Gift / drink: " + drinkName,
    "Personal message: \"" + message + "\"",
    "PintDrop reference: " + voucherCode,
    "",
    "Open your PintDrop: " + voucherUrl,
    "",
    "Show your voucher at the bar to redeem your drink.",
    "",
    "PintDrop"
  ].join("\n");
}

function isValidEmail(value: string) {
  const trimmed = value.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) {
    return false;
  }
  const domain = trimmed.slice(atIndex + 1);
  if (domain.indexOf("@") !== -1) {
    return false;
  }
  const dotIndex = domain.indexOf(".");
  if (dotIndex <= 0 || dotIndex === domain.length - 1) {
    return false;
  }
  return true;
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

    console.log("[send-recipient-gift] RESEND_API_KEY exists:", Boolean(apiKey));
    console.log("[send-recipient-gift] RESEND_FROM_EMAIL exists:", Boolean(fromEmail));

    if (!apiKey || !fromEmail) {
      console.error("[send-recipient-gift] Email provider not configured.", {
        hasApiKey: Boolean(apiKey),
        hasFromEmail: Boolean(fromEmail)
      });
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
    const recipientEmail = (payload.recipient_email || "").trim().toLowerCase();
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

    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return jsonResponse(
        { ok: false, error: "recipient_email is required and must be valid." },
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
    const resolvedMessage = message || ("A PintDrop from " + senderName);
    const html = buildEmailHtml({
      appUrl,
      senderName,
      recipientName,
      pubName,
      drinkName,
      message: resolvedMessage,
      voucherCode,
      voucherUrl
    });
    const text = buildEmailText({
      senderName,
      recipientName,
      pubName,
      drinkName,
      message: resolvedMessage,
      voucherCode,
      voucherUrl
    });

    console.log("[send-recipient-gift] Sending recipient gift email to:", recipientEmail);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipientEmail],
        subject: senderName + " sent you a PintDrop!",
        html,
        text
      })
    });

    console.log("[send-recipient-gift] Resend HTTP status:", resendResponse.status);

    let resendData: Record<string, unknown> = {};
    let resendRawBody = "";
    try {
      resendRawBody = await resendResponse.text();
      resendData = resendRawBody ? JSON.parse(resendRawBody) as Record<string, unknown> : {};
    } catch (parseError) {
      console.error("[send-recipient-gift] Resend response parse error:", parseError instanceof Error ? parseError.message : parseError);
      console.error("[send-recipient-gift] Resend raw response body:", resendRawBody);
      resendData = {};
    }

    if (!resendResponse.ok) {
      console.error("[send-recipient-gift] Resend request failed.", {
        status: resendResponse.status,
        body: resendData.message || resendData || resendRawBody
      });
      return jsonResponse(
        {
          ok: false,
          error: "Recipient gift email could not be sent.",
          details: resendData.message || resendData
        },
        502
      );
    }

    console.log("[send-recipient-gift] Recipient gift email sent successfully.", {
      to: recipientEmail,
      email_id: resendData.id
    });

    return jsonResponse({
      ok: true,
      email_id: resendData.id,
      to: recipientEmail,
      voucher_code: voucherCode,
      voucher_url: voucherUrl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[send-recipient-gift] Unhandled error message:", message);
    if (stack) {
      console.error("[send-recipient-gift] Unhandled error stack:", stack);
    }
    return jsonResponse({ ok: false, error: "Internal server error." }, 500);
  }
});
