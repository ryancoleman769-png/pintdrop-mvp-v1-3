const assert = require("assert");
const {
  buildCheckoutMetadata,
  parseCheckoutMetadata,
  validateCheckoutMetadata,
  buildFulfillmentResponse
} = require("../api/_lib/fulfillment");

const sampleOrder = {
  pubId: 1,
  drinkId: 2,
  pubName: "O'Flaherty's Bar",
  pubLocation: "Buncrana",
  drinkName: "Pint",
  drinkIcon: "🍺",
  giftPrice: 6.5,
  serviceFee: 0.98,
  total: 7.48,
  recipientName: "Dad",
  recipientPhone: "+353871234567",
  recipientEmail: "dad@example.com",
  senderName: "Ryan",
  senderEmail: "ryan@example.com",
  message: "Happy birthday Dad — have one on me 🍻",
  deliveryDate: "2026-08-10"
};

const metadata = buildCheckoutMetadata(sampleOrder);
assert.strictEqual(metadata.pub_id, "1");
assert.strictEqual(metadata.drink_id, "2");
assert.strictEqual(metadata.recipient_phone, "+353871234567");
assert.strictEqual(metadata.total, "7.48");
assert.ok(metadata.message.length <= 500);

const parsed = parseCheckoutMetadata(metadata);
assert.deepStrictEqual(validateCheckoutMetadata(parsed), []);
assert.strictEqual(parsed.recipientEmail, "dad@example.com");

const missing = validateCheckoutMetadata(parseCheckoutMetadata({ pub_id: "1" }));
assert.ok(missing.includes("drink_id"));
assert.ok(missing.includes("recipient_name"));

const response = buildFulfillmentResponse({
  id: "voucher-id",
  code: "PD-ABC123",
  pubId: 1,
  drinkId: 2,
  pubName: "O'Flaherty's Bar",
  pubLocation: "Buncrana",
  drinkName: "Pint",
  drinkIcon: "🍺",
  drinkPrice: 6.5,
  serviceFee: 0.98,
  total: 7.48,
  recipientName: "Dad",
  recipientPhone: "+353871234567",
  recipientEmail: "dad@example.com",
  senderName: "Ryan",
  senderEmail: "ryan@example.com",
  message: "Happy birthday",
  deliveryDate: "2026-08-10",
  status: "waiting",
  createdAt: "2026-08-10T12:00:00.000Z",
  expiresAt: "2026-09-09T12:00:00.000Z",
  drinkSlug: "pint",
  fulfillmentStatus: "completed",
  smsDeliveryStatus: "sent",
  senderEmailDeliveryStatus: "sent",
  recipientEmailDeliveryStatus: "sent"
});

assert.strictEqual(response.status, "completed");
assert.strictEqual(response.voucher.code, "PD-ABC123");
assert.strictEqual(response.delivery.sms, "sent");

console.log("fulfillment unit tests passed");
