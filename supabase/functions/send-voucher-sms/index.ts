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

type SmsSendResult = {
  ok: boolean;
  message_sid?: string;
  to?: string;
  voucher_code?: string;
  error?: string;
  details?: unknown;
  raw?: string;
  provider?: "sendmode" | "twilio";
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

function resolveAppUrl(payload: SendVoucherSmsRequest) {
  return (
    (payload.app_url || "").trim()
    || Deno.env.get("PINTDROP_APP_URL")
    || "https://pintdrop-mvp-v1-3.vercel.app"
  ).trim();
}

function resolveSmsProvider() {
  return (Deno.env.get("SMS_PROVIDER") || "twilio").trim().toLowerCase();
}

function shouldFallbackToTwilio() {
  return Deno.env.get("SMS_FALLBACK_TO_TWILIO") === "true";
}

async function sendViaTwilio({
  recipientPhone,
  body,
  voucherCode
}: {
  recipientPhone: string;
  body: string;
  voucherCode: string;
}): Promise<SmsSendResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER")?.trim();

  if (!accountSid || !authToken || !fromNumber) {
    return {
      ok: false,
      provider: "twilio",
      error: "Twilio is not configured on the server."
    };
  }

  const twilioUrl =
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);

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

  const twilioParsed = await readResponseJson(twilioResponse);

  if (!twilioParsed.ok) {
    return {
      ok: false,
      provider: "twilio",
      error: "Twilio SMS failed.",
      details: twilioParsed.error,
      raw: twilioParsed.raw || undefined
    };
  }

  const twilioData = twilioParsed.data;

  if (!twilioResponse.ok) {
    return {
      ok: false,
      provider: "twilio",
      error: "Twilio SMS failed.",
      details: twilioData.message || twilioData
    };
  }

  const messageSid = typeof twilioData.sid === "string"
    ? twilioData.sid
    : undefined;

  return {
    ok: true,
    provider: "twilio",
    message_sid: messageSid,
    to: recipientPhone,
    voucher_code: voucherCode
  };
}

async function sendViaSendmode({
  recipientPhone,
  body,
  voucherCode
}: {
  recipientPhone: string;
  body: string;
  voucherCode: string;
}): Promise<SmsSendResult> {
  const apiKey = Deno.env.get("SENDMODE_API_KEY")?.trim();
  const senderId = Deno.env.get("SENDMODE_SENDER_ID")?.trim();

  if (!apiKey || !senderId) {
    return {
      ok: false,
      provider: "sendmode",
      error: "Sendmode is not configured on the server."
    };
  }

  const sendmodeResponse = await fetch(
    "https://sms-rest.sendmode.dev/3.0/send",
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender_id: senderId,
        message: body,
        mobile_number: recipientPhone,
        customer_id: voucherCode
      })
    }
  );

  const sendmodeParsed = await readResponseJson(sendmodeResponse);

  if (!sendmodeParsed.ok) {
    return {
      ok: false,
      provider: "sendmode",
      error: "Sendmode SMS failed.",
      details: sendmodeParsed.error,
      raw: sendmodeParsed.raw || undefined
    };
  }

  const sendmodeData = sendmodeParsed.data;
  const isSuccessful = sendmodeData.is_successful === true;
  const errorMessage = typeof sendmodeData.error_message === "string"
    ? sendmodeData.error_message
    : undefined;

  if (!sendmodeResponse.ok || !isSuccessful) {
    return {
      ok: false,
      provider: "sendmode",
      error: "Sendmode SMS failed.",
      details: errorMessage || sendmodeData
    };
  }

  const requestId = typeof sendmodeData.request_id === "string"
    ? sendmodeData.request_id
    : undefined;
  const acceptDate = typeof sendmodeData.accept_date === "string"
    ? sendmodeData.accept_date
    : undefined;
  const messageSid = requestId || acceptDate;

  return {
    ok: true,
    provider: "sendmode",
    message_sid: messageSid,
    to: recipientPhone,
    voucher_code: voucherCode
  };
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
    const recipientPhone = normalizePhone(payload.recipient_phone || "");
    const voucherCode = (payload.voucher_code || "").trim().toUpperCase();
    const senderName = (payload.sender_name || "").trim();
    const recipientName = (payload.recipient_name || "").trim();
    const pubName = (payload.pub_name || "").trim();
    const drinkName = (payload.drink_name || "").trim();
    const appUrl = resolveAppUrl(payload);
    const smsProvider = resolveSmsProvider();

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

    let result: SmsSendResult;

    if (smsProvider === "sendmode") {
      result = await sendViaSendmode({
        recipientPhone,
        body,
        voucherCode
      });

      if (!result.ok && shouldFallbackToTwilio()) {
        result = await sendViaTwilio({
          recipientPhone,
          body,
          voucherCode
        });
      }
    } else {
      result = await sendViaTwilio({
        recipientPhone,
        body,
        voucherCode
      });
    }

    if (!result.ok) {
      return jsonResponse(
        {
          ok: false,
          error: result.error || "SMS could not be sent.",
          details: result.details,
          raw: result.raw
        },
        502
      );
    }

    return jsonResponse({
      ok: true,
      message_sid: result.message_sid,
      to: result.to,
      voucher_code: result.voucher_code
    });
  } catch (error) {
    console.error("[send-voucher-sms] Unhandled error:", error);
    return jsonResponse(
      {
        ok: false,
        error: "Internal server error."
      },
      500
    );
  }
});
