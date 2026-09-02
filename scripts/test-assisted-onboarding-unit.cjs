const assert = require("node:assert/strict");
const {
  AssistedOnboardingValidationError,
  normaliseIrishPhone,
  normaliseIrishIban,
  normaliseEircode,
  parseDateOfBirth,
  validateAssistedOnboardingInput,
  buildStripeAccountCreateParams,
  buildStripeRepresentativeParams,
  buildAssistedIdempotencyKey
} = require("../api/_lib/assisted-onboarding");
const {
  HANDOFF_TOKEN_TTL_MS,
  createHandoffToken,
  verifyHandoffToken
} = require("../api/_lib/handoff-token");
const {
  isPreviewOrDevelopment,
  requirePreviewOrDevelopment,
  requireStripeTestMode
} = require("../api/_lib/preview-only");

function expectValidationError(callback) {
  assert.throws(callback, (error) => error instanceof AssistedOnboardingValidationError);
}

function fakeResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

const originalEnvironment = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  PINTDROP_HANDOFF_SECRET: process.env.PINTDROP_HANDOFF_SECRET,
  PINTDROP_ADMIN_KEY: process.env.PINTDROP_ADMIN_KEY
};

try {
  assert.equal(normaliseIrishPhone("087 123 4567"), "+353871234567");
  assert.equal(normaliseIrishPhone("00353 87 123 4567"), "+353871234567");
  expectValidationError(() => normaliseIrishPhone("123"));

  assert.equal(normaliseIrishIban("IE29 AIBK 9311 5212 3456 78"), "IE29AIBK93115212345678");
  expectValidationError(() => normaliseIrishIban("IE00 AIBK 9311 5212 3456 78"));
  expectValidationError(() => normaliseIrishIban("GB29NWBK60161331926819"));

  assert.equal(normaliseEircode("f93 x123"), "F93 X123");
  expectValidationError(() => normaliseEircode("not-an-eircode"));
  assert.deepEqual(parseDateOfBirth("1985-01-15"), { day: 15, month: 1, year: 1985 });

  const details = validateAssistedOnboardingInput({
    pubId: 6,
    businessType: "company",
    legalName: "PintDrop Preview Pub Limited",
    representativeFirstName: "Ava",
    representativeLastName: "Murphy",
    representativeDob: "1985-01-15",
    email: "OWNER@EXAMPLE.COM",
    phone: "087 123 4567",
    addressLine1: "1 Main Street",
    addressLine2: "Suite 2",
    city: "Buncrana",
    postalCode: "F93 X123",
    accountHolderName: "PintDrop Preview Pub Limited",
    iban: "IE29 AIBK 9311 5212 3456 78"
  });
  assert.equal(details.email, "owner@example.com");
  assert.equal(details.phone, "+353871234567");
  assert.equal(details.iban, "IE29AIBK93115212345678");

  const accountParams = buildStripeAccountCreateParams(
    { id: 6, name: "PintDrop Test Pub", location: "Buncrana" },
    details
  );
  assert.equal(accountParams.type, "express");
  assert.equal(accountParams.country, "IE");
  assert.equal(accountParams.business_type, "company");
  assert.equal(accountParams.company.name, "PintDrop Preview Pub Limited");
  assert.equal(accountParams.external_account.account_number, "IE29AIBK93115212345678");
  assert.equal(accountParams.metadata.preview_only, "true");
  assert.equal(accountParams.tos_acceptance, undefined, "PintDrop must never accept Stripe terms for a pub");

  const representative = buildStripeRepresentativeParams(details);
  assert.equal(representative.relationship.representative, true);
  assert.equal(representative.first_name, "Ava");

  const idempotencyKey = buildAssistedIdempotencyKey(details);
  assert.match(idempotencyKey, /^pintdrop-preview-assisted-6-[a-f0-9]{28}$/);
  assert.equal(idempotencyKey.includes(details.iban), false, "The IBAN must not appear in idempotency keys");

  process.env.PINTDROP_HANDOFF_SECRET = "unit-test-handoff-secret";
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  const token = createHandoffToken({ pubId: 6, stripeAccountId: "acct_test123" }, now);
  const verified = verifyHandoffToken(token, now + 1_000);
  assert.equal(verified.pubId, 6);
  assert.equal(verified.stripeAccountId, "acct_test123");
  assert.equal(verified.expiresAt, now + HANDOFF_TOKEN_TTL_MS);
  assert.equal(verifyHandoffToken(`${token}tampered`, now + 1_000), null);
  assert.equal(verifyHandoffToken(token, now + HANDOFF_TOKEN_TTL_MS + 1), null);

  process.env.VERCEL_ENV = "preview";
  assert.equal(isPreviewOrDevelopment(), true);
  process.env.VERCEL_ENV = "production";
  assert.equal(isPreviewOrDevelopment(), false);
  const productionResponse = fakeResponse();
  assert.equal(requirePreviewOrDevelopment(productionResponse), false);
  assert.equal(productionResponse.statusCode, 404);
  process.env.VERCEL_ENV = "development";
  assert.equal(isPreviewOrDevelopment(), true);

  process.env.STRIPE_SECRET_KEY = "sk_live_preview_should_never_use_this";
  const liveKeyResponse = fakeResponse();
  assert.equal(requireStripeTestMode(liveKeyResponse), false);
  assert.equal(liveKeyResponse.statusCode, 500);
  process.env.STRIPE_SECRET_KEY = "sk_test_preview_only";
  assert.equal(requireStripeTestMode(fakeResponse()), true);

  console.log("Assisted onboarding unit checks passed.");
} finally {
  Object.entries(originalEnvironment).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
