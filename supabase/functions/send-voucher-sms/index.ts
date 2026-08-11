import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type SendVoucherSmsRequest = {
  recipient_phone?: string;
  voucher_code?: string;
  sender_name?: string;
  recipient_name?: string;
  pub_name?: string;
  drink_name?: string;
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
    return {
      ok: false as const,
      error: "Could not read request body."
    };
  }

  if (!raw.trim()) {
    return {
      ok: false as const,
      error: "Empty request body."
    };
  }

  try {
    const data = JSON.parse(raw) as SendVoucherSmsRequest;
    return {
      ok: true as const,
      data
    };
  } catch {
    return {
      ok: false as const,
      error: "Invalid JSON body."
    };
  }
}

async function readResponseJson(response: Response) {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return {
      ok: false as const,
      error: "Could not read upstream response body.",
      raw: ""
    };
  }

  if (!raw.trim()) {
    return {
      ok: false as const,
      error: "Empty upstream response body.",
      raw: ""
    };
  }

  try {
    return {
      ok: true as const,
      data: JSON.parse(raw) as Record<string, unknown>,
      raw
    };
  } catch {
    return {
      ok: false as const,
      error: "Invalid JSON in upstream response.",
      raw: raw.slice(0, 500)
    };
  }
}

function normalizePhone(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("353")) return `+${digits}`;
  if (digits.startsWith("61")) return `+${digits}`;
  if (digits.startsWith("0")) return `+353${digits.slice(1)}`;
  if (digits.length >= 9) return `+${digits}`;

  return "";
}

function buildSmsBody({
  senderName,
  recipientName,
  pubName,
  drinkName,
  voucherCode,
  appUrl
}: {
  senderName: string;
  recipientName: string;
  pubName: string;
  drinkName: string;
  voucherCode: string;
  appUrl: string;
}) {
  const giftUrl =
    `${appUrl.replace(/\/$/, "")}/#redeem/${encodeURIComponent(voucherCode)}`;
  return `${senderName} sent you a ${drinkName} at ${pubName}! Open your PintDrop for ${recipientName}: ${giftUrl}`;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders
      });
    }

    if (req.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error: "Method not allowed"
        },
        405
      );
    }

    const accountSid =
      Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
    const authToken =
      Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
    const fromNumber =
      Deno.env.get("TWILIO_FROM_NUMBER")?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      return jsonResponse(
        {
          ok: false,
          error: "Twilio is not configured on the server."
        },
        500
      );
    }

    const parsedBody = await readRequestJson(req);
    if (!parsedBody.ok) {
      return jsonResponse(
        {
          ok: false,
          error: parsedBody.error
        },
        400
      );
    }

    const payload = parsedBody.data;
    const appUrl = (
      (payload.app_url || "").trim()
      || Deno.env.get("PINTDROP_APP_URL")
      || "https://pintdrop-mvp-v1-3.vercel.app"
    ).trim();
    const recipientPhone =
      normalizePhone(payload.recipient_phone || "");
    const voucherCode =
      (payload.voucher_code || "").trim().toUpperCase();
    const senderName =
      (payload.sender_name || "").trim();
    const recipientName =
      (payload.recipient_name || "").trim();
    const pubName =
      (payload.pub_name || "").trim();
    const drinkName =
      (payload.drink_name || "").trim();

    if (!recipientPhone) {
      return jsonResponse(
        {
          ok: false,
          error: "recipient_phone is required."
        },
        400
      );
    }

    if (!voucherCode) {
      return jsonResponse(
        {
          ok: false,
          error: "voucher_code is required."
        },
        400
      );
    }

    if (!senderName || !recipientName || !pubName || !drinkName) {
      return jsonResponse(
        {
          ok: false,
          error:
            "sender_name, recipient_name, pub_name and drink_name are required."
        },
        400
      );
    }

    const body = buildSmsBody({
      senderName,
      recipientName,
      pubName,
      drinkName,
      voucherCode,
      appUrl
    });

    const twilioUrl =
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authHeader =
      "Basic " + btoa(`${accountSid}:${authToken}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: recipientPhone,
        From: fromNumber,
        Body: body
      })
    });

    const twilioParsed =
      await readResponseJson(twilioResponse);

    if (!twilioParsed.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Twilio SMS failed.",
          details: twilioParsed.error,
          raw: twilioParsed.raw || undefined
        },
        502
      );
    }

    const twilioData = twilioParsed.data;

    if (!twilioResponse.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Twilio SMS failed.",
          details: twilioData.message || twilioData
        },
        502
      );
    }

    return jsonResponse({
      ok: true,
      message_sid: twilioData.sid,
      to: recipientPhone,
      voucher_code: voucherCode
    });
  } catch (error) {
    console.error(
      "[send-voucher-sms] Unhandled error:",
      error
    );
    return jsonResponse(
      {
        ok: false,
        error: "Internal server error."
      },
      500
    );
  }
});
