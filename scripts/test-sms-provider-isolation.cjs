/**
 * Preview-only SMS provider isolation.
 * Run: node scripts/test-sms-provider-isolation.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  shouldSendChannel,
  resolveServerSmsProvider,
  buildSmsDeliveryPayload
} = require("../api/_lib/fulfillment");

const root = path.join(__dirname, "..");
const smsSource = fs.readFileSync(
  path.join(root, "supabase", "functions", "send-voucher-sms", "index.ts"),
  "utf8"
);
const fulfillmentSource = fs.readFileSync(
  path.join(root, "api", "_lib", "fulfillment.js"),
  "utf8"
);

function extractFunction(src, name) {
  const needle = `function ${name}(`;
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`missing function ${name}`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function toEvalable(src) {
  return src
    .replace(/: unknown/g, "")
    .replace(/: SendVoucherSmsRequest/g, "")
    .replace(/ as const/g, "");
}

const envState = {};
globalThis.Deno = {
  env: {
    get(key) {
      return Object.prototype.hasOwnProperty.call(envState, key) ? envState[key] : undefined;
    }
  }
};

eval(toEvalable(extractFunction(smsSource, "resolveSmsProvider")));
eval(toEvalable(extractFunction(smsSource, "parseRequestedSmsProvider")));
eval(toEvalable(extractFunction(smsSource, "resolveEffectiveSmsProvider")));
eval(toEvalable(extractFunction(smsSource, "resolveAppUrl")));

function withDenoEnv(values, fn) {
  const keys = Object.keys(envState);
  keys.forEach((key) => {
    delete envState[key];
  });
  Object.assign(envState, values);
  try {
    return fn();
  } finally {
    Object.keys(envState).forEach((key) => {
      delete envState[key];
    });
  }
}

const sampleVoucher = {
  recipientPhone: "+353871234567",
  code: "PD-ABC123",
  senderName: "Ryan",
  recipientName: "Dad",
  pubName: "O'Flaherty's Bar",
  drinkName: "Pint"
};

// Request absent => existing env/default Twilio path.
withDenoEnv({}, () => {
  const result = resolveEffectiveSmsProvider({});
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, "twilio");
});

withDenoEnv({ SMS_PROVIDER: "twilio" }, () => {
  const result = resolveEffectiveSmsProvider({});
  assert.strictEqual(result.provider, "twilio");
});

withDenoEnv({ SMS_PROVIDER: "sendmode" }, () => {
  const absent = resolveEffectiveSmsProvider({});
  assert.strictEqual(absent.provider, "sendmode");
});

// Explicit request overrides env.
withDenoEnv({ SMS_PROVIDER: "sendmode" }, () => {
  const result = resolveEffectiveSmsProvider({ sms_provider: "twilio" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, "twilio");
});

withDenoEnv({ SMS_PROVIDER: "twilio" }, () => {
  const result = resolveEffectiveSmsProvider({ sms_provider: "sendmode" });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.provider, "sendmode");
});

withDenoEnv({}, () => {
  assert.strictEqual(resolveEffectiveSmsProvider({ sms_provider: "TWILIO" }).provider, "twilio");
  assert.strictEqual(resolveEffectiveSmsProvider({ sms_provider: " SendMode " }).provider, "sendmode");
  assert.strictEqual(resolveEffectiveSmsProvider({ sms_provider: "" }).provider, "twilio");
  assert.strictEqual(resolveEffectiveSmsProvider({ sms_provider: "   " }).provider, "twilio");
});

// Invalid provider cannot select Sendmode or any other provider.
withDenoEnv({ SMS_PROVIDER: "sendmode" }, () => {
  const invalid = resolveEffectiveSmsProvider({ sms_provider: "nexmo" });
  assert.strictEqual(invalid.ok, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(invalid, "provider"));
  assert.match(invalid.error, /twilio or sendmode/);
});

["mailgun", "sns", "true", 1, { provider: "sendmode" }].forEach((value) => {
  const invalid = parseRequestedSmsProvider(value);
  assert.strictEqual(invalid.ok, false);
});

assert.ok(smsSource.includes("https://rest.sendmode.com/v2/send"));
assert.ok(!smsSource.includes("sms-rest.sendmode.dev"));
assert.ok(smsSource.includes("api.twilio.com/2010-04-01/Accounts"));
assert.ok(smsSource.includes("if (!providerResult.ok)"));
assert.ok(smsSource.includes("const smsProvider = providerResult.provider"));
assert.ok(!smsSource.includes("verify_jwt"));
assert.ok(!smsSource.includes("Bearer "));

// app_url: payload wins, then env, then existing default.
withDenoEnv({}, () => {
  assert.strictEqual(
    resolveAppUrl({ app_url: "https://preview.example/" }),
    "https://preview.example/"
  );
});
withDenoEnv({ PINTDROP_APP_URL: "https://from-env.example" }, () => {
  assert.strictEqual(resolveAppUrl({}), "https://from-env.example");
  assert.strictEqual(
    resolveAppUrl({ app_url: "https://from-payload.example" }),
    "https://from-payload.example"
  );
});
withDenoEnv({}, () => {
  assert.strictEqual(resolveAppUrl({}), "https://pintdrop-mvp-v1-3.vercel.app");
});

assert.ok(smsSource.includes("/#redeem/${encodeURIComponent(voucherCode)}"));

eval(extractFunction(smsSource, "buildSendmodeV2MessagePayload"));
eval(extractFunction(smsSource, "buildSendmodeV2Request"));
eval(extractFunction(smsSource, "isSendmodeV2Success"));
eval(extractFunction(smsSource, "getSendmodeV2ErrorDetails"));
eval(extractFunction(smsSource, "getSendmodeV2MessageSid"));

const sendmodeRequest = buildSendmodeV2Request(
  "live_test_key",
  "SM Testing",
  "+353871234567",
  "Ryan sent you a Pint at O'Flaherty's Bar! Open your PintDrop for Dad: https://preview.example/#redeem/PD-ABC123",
  "PD-ABC123"
);
assert.strictEqual(sendmodeRequest.url, "https://rest.sendmode.com/v2/send");
assert.strictEqual(sendmodeRequest.headers.Authorization, "live_test_key");
assert.ok(!String(sendmodeRequest.headers.Authorization).toLowerCase().startsWith("bearer "));
assert.strictEqual(sendmodeRequest.headers["Content-Type"], "application/x-www-form-urlencoded");
assert.strictEqual(typeof sendmodeRequest.body.get, "function");
assert.strictEqual(
  [...sendmodeRequest.body.keys()].join(","),
  "message"
);
const sendmodeMessage = JSON.parse(sendmodeRequest.body.get("message"));
assert.deepStrictEqual(Object.keys(sendmodeMessage).sort(), [
  "customerid",
  "messagetext",
  "recipients",
  "senderid"
]);
assert.strictEqual(
  sendmodeMessage.messagetext,
  "Ryan sent you a Pint at O'Flaherty's Bar! Open your PintDrop for Dad: https://preview.example/#redeem/PD-ABC123"
);
assert.deepStrictEqual(sendmodeMessage.recipients, ["+353871234567"]);
assert.strictEqual(sendmodeMessage.senderid, "SM Testing");
assert.strictEqual(sendmodeMessage.customerid, "PD-ABC123");
assert.ok(!JSON.stringify(sendmodeMessage).includes("live_test_key"));

assert.strictEqual(
  isSendmodeV2Success(true, { status: "OK", statusCode: 0 }),
  true
);
assert.strictEqual(
  isSendmodeV2Success(false, { status: "OK", statusCode: 0 }),
  false
);
assert.strictEqual(
  isSendmodeV2Success(true, { status: "OK", statusCode: 195 }),
  false
);
assert.strictEqual(
  isSendmodeV2Success(true, { is_successful: true }),
  false
);

const sendmodeError = getSendmodeV2ErrorDetails({
  status: "EXPECTED_PARAMETER_MISSING",
  statusCode: 195,
  error: "You do not have all the required variables in your [message] data"
});
assert.strictEqual(sendmodeError.status, "EXPECTED_PARAMETER_MISSING");
assert.strictEqual(sendmodeError.statusCode, 195);
assert.match(sendmodeError.error, /required variables/);
assert.ok(!JSON.stringify(sendmodeError).includes("live_test_key"));
assert.strictEqual(
  getSendmodeV2MessageSid({ status: "OK", statusCode: 0, acceptedDateTime: "2017-08-25T12:51:01" }),
  undefined
);

// Fulfillment omits sms_provider when env is absent or invalid.
assert.strictEqual(resolveServerSmsProvider({}), null);
assert.strictEqual(resolveServerSmsProvider({ SMS_PROVIDER: "" }), null);
assert.strictEqual(resolveServerSmsProvider({ SMS_PROVIDER: "nexmo" }), null);

const omitted = buildSmsDeliveryPayload(sampleVoucher, {});
assert.strictEqual(Object.prototype.hasOwnProperty.call(omitted, "sms_provider"), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(omitted, "app_url"), false);
assert.strictEqual(omitted.voucher_code, "PD-ABC123");

const sendmodePayload = buildSmsDeliveryPayload(sampleVoucher, {
  SMS_PROVIDER: "sendmode",
  PINTDROP_APP_URL: "https://pintdrop-mvp-v1-3-preview.vercel.app/"
});
assert.strictEqual(sendmodePayload.sms_provider, "sendmode");
assert.strictEqual(sendmodePayload.app_url, "https://pintdrop-mvp-v1-3-preview.vercel.app/");

const twilioPayload = buildSmsDeliveryPayload(sampleVoucher, {
  SMS_PROVIDER: "TWILIO"
});
assert.strictEqual(twilioPayload.sms_provider, "twilio");
assert.strictEqual(Object.prototype.hasOwnProperty.call(twilioPayload, "app_url"), false);

assert.ok(fulfillmentSource.includes("buildSmsDeliveryPayload(voucher)"));
assert.ok(fulfillmentSource.includes("if (smsProvider) payload.sms_provider = smsProvider"));
assert.ok(fulfillmentSource.includes("if (appUrl) payload.app_url = appUrl"));

// Channel independence: SMS, sender email, recipient email run in order.
const smsCall = fulfillmentSource.indexOf(
  'runDeliveryChannel(session.id, voucher, "sms", deliverSms)'
);
const senderCall = fulfillmentSource.indexOf(
  'runDeliveryChannel(session.id, voucher, "sender_email", deliverSenderEmail)'
);
const recipientCall = fulfillmentSource.indexOf(
  'runDeliveryChannel(session.id, voucher, "recipient_email", deliverRecipientEmail)'
);
assert.ok(smsCall > 0 && senderCall > smsCall && recipientCall > senderCall);
assert.ok(
  fulfillmentSource.includes("voucher = await runDeliveryChannel(session.id, voucher, \"sender_email\", deliverSenderEmail);")
);
assert.ok(
  fulfillmentSource.includes("voucher = await runDeliveryChannel(session.id, voucher, \"recipient_email\", deliverRecipientEmail);")
);

// SMS failure marks failed and does not throw past later channels.
assert.ok(fulfillmentSource.includes("p_channel: channel"));
assert.ok(/updateDeliveryStatus\(\s*sessionId,\s*channel,\s*"failed"/.test(fulfillmentSource));
assert.ok(fulfillmentSource.includes("result.error || `${channel} delivery failed`"));

const failedSms = {
  smsDeliveryStatus: "failed",
  smsMessageSid: null,
  senderEmailDeliveryStatus: "pending",
  senderEmailId: null,
  recipientEmail: "dad@example.com",
  recipientEmailDeliveryStatus: "pending",
  recipientEmailId: null
};
assert.strictEqual(shouldSendChannel(failedSms, "sms"), true);
assert.strictEqual(shouldSendChannel(failedSms, "sender_email"), true);
assert.strictEqual(shouldSendChannel(failedSms, "recipient_email"), true);

const sentSms = {
  ...failedSms,
  smsDeliveryStatus: "sent",
  smsMessageSid: "SM123"
};
assert.strictEqual(shouldSendChannel(sentSms, "sms"), false);
assert.strictEqual(shouldSendChannel(sentSms, "sender_email"), true);

const processingSms = {
  ...failedSms,
  smsDeliveryStatus: "processing"
};
assert.strictEqual(shouldSendChannel(processingSms, "sms"), true);

const skippedRecipient = {
  ...failedSms,
  recipientEmail: ""
};
assert.strictEqual(shouldSendChannel(skippedRecipient, "recipient_email"), false);

console.log("sms provider isolation tests passed");
