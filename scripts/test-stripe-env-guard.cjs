const assert = require("assert");
const { getStripeSecretKeyError } = require("../api/_lib/connect-helpers");

const TEST_KEY = "sk_test_placeholder";
const LIVE_KEY = "sk_live_placeholder";

assert.strictEqual(
  getStripeSecretKeyError("", "production"),
  "Stripe is not configured on the server."
);
assert.strictEqual(
  getStripeSecretKeyError("", "preview"),
  "Stripe is not configured on the server."
);

assert.strictEqual(getStripeSecretKeyError(LIVE_KEY, "production"), null);
assert.strictEqual(
  getStripeSecretKeyError(TEST_KEY, "production"),
  "Stripe live mode required in Production. Use a sk_live_ key."
);
assert.strictEqual(
  getStripeSecretKeyError("rk_live_placeholder", "production"),
  "Stripe live mode required in Production. Use a sk_live_ key."
);

assert.strictEqual(getStripeSecretKeyError(TEST_KEY, "preview"), null);
assert.strictEqual(getStripeSecretKeyError(TEST_KEY, "development"), null);
assert.strictEqual(getStripeSecretKeyError(TEST_KEY, ""), null);
assert.strictEqual(
  getStripeSecretKeyError(LIVE_KEY, "preview"),
  "Stripe test mode only outside Production. Use a sk_test_ key."
);
assert.strictEqual(
  getStripeSecretKeyError(LIVE_KEY, "development"),
  "Stripe test mode only outside Production. Use a sk_test_ key."
);
assert.strictEqual(
  getStripeSecretKeyError(LIVE_KEY, ""),
  "Stripe test mode only outside Production. Use a sk_test_ key."
);

console.log("stripe env guard unit tests passed");
