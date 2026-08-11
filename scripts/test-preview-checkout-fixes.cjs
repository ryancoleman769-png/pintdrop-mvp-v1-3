const { chromium, devices } = require("playwright");

const PREVIEW_URL =
  process.env.PINTDROP_PREVIEW_URL ||
  "https://pintdrop-mvp-v1-3-git-cursor-stripe-connect-apis-pintdrop.vercel.app";

function parseMoney(text) {
  const match = String(text || "").replace(/\u00a0/g, " ").match(/([\d.,]+)/);
  return match ? Number(match[1].replace(",", "")) : NaN;
}

async function assertRecipientNameStartsBlank(page) {
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });
  await page.locator('[data-customer-substep="pub"] .venue-card:not(.is-disabled)').first().click();
  await page.locator('[data-next-substep="drink"]').click();
  await page.locator('[data-next-substep="recipient"]').click();

  const recipientName = await page.locator("#recipientName").inputValue();
  if (recipientName.trim()) {
    throw new Error(`Recipient name should start blank, got: ${recipientName}`);
  }
  console.log("PASS: recipient name starts blank");
}

async function assertBarTabPricing(page) {
  await page.locator('[data-customer-substep="pub"] .venue-card:not(.is-disabled)').first().click();
  await page.locator('[data-next-substep="drink"]').click();

  const barTabCard = page.locator('[data-customer-substep="drink"] .gift-card[data-gift="tab"]');
  await barTabCard.waitFor({ state: "visible", timeout: 15000 });
  const cardPrice = parseMoney(await barTabCard.locator(".gift-card-price").textContent());
  if (Math.abs(cardPrice - 20) > 0.001) {
    throw new Error(`Bar Tab card should show €20.00 menu price, got ${cardPrice}`);
  }

  await barTabCard.click();
  const summaryPrice = parseMoney(await page.locator("#summaryPrice").textContent());
  if (Math.abs(summaryPrice - 23) > 0.001) {
    throw new Error(`Summary total should be €23.00, got ${summaryPrice}`);
  }

  await page.locator('[data-next-substep="recipient"]').click();
  await page.fill("#recipientName", "Preview Pricing Test");
  await page.fill("#recipientPhone", "0871234567");
  await page.fill("#senderName", "Preview Pricing Sender");
  await page.fill("#senderEmail", "preview.pricing@example.com");
  await page.locator("#orderForm").evaluate((form) => form.requestSubmit());
  await page.waitForSelector("#reviewStep.active");

  const giftPrice = parseMoney(await page.locator("#reviewGiftPrice").textContent());
  const fee = parseMoney(await page.locator("#reviewFee").textContent());
  const total = parseMoney(await page.locator("#reviewTotal").textContent());
  const payLabel = await page.locator("#goToPayment").textContent();

  if (Math.abs(giftPrice - 20) > 0.001) {
    throw new Error(`Review gift price should be €20.00, got ${giftPrice}`);
  }
  if (Math.abs(fee - 3) > 0.001) {
    throw new Error(`Review service fee should be €3.00, got ${fee}`);
  }
  if (Math.abs(total - 23) > 0.001) {
    throw new Error(`Review total should be €23.00, got ${total}`);
  }
  if (!/Pay €23\.00 securely/i.test(payLabel || "")) {
    throw new Error(`Pay button should show €23.00 total, got: ${payLabel}`);
  }

  let checkoutPayload = null;
  page.on("request", (request) => {
    if (request.url().includes("/api/create-checkout-session") && request.method() === "POST") {
      checkoutPayload = request.postDataJSON();
    }
  });

  await Promise.all([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }),
    page.locator("#goToPayment").click()
  ]);

  if (!checkoutPayload) {
    throw new Error("Missing create-checkout-session payload");
  }
  if (Math.abs(Number(checkoutPayload.giftPrice) - 20) > 0.001) {
    throw new Error(`Stripe giftPrice should be 20, got ${checkoutPayload.giftPrice}`);
  }
  if (Math.abs(Number(checkoutPayload.fee) - 3) > 0.001) {
    throw new Error(`Stripe fee should be 3, got ${checkoutPayload.fee}`);
  }
  if (Math.abs(Number(checkoutPayload.total) - 23) > 0.001) {
    throw new Error(`Stripe total should be 23, got ${checkoutPayload.total}`);
  }

  console.log("PASS: Bar Tab pricing is €20.00 + €3.00 fee = €23.00 through review and Stripe");
}

(async () => {
  console.log("Preview URL:", PREVIEW_URL);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "en-IE"
  });
  const page = await context.newPage();
  await page.addInitScript(() => sessionStorage.setItem("pintdrop_splash_seen", "1"));

  await assertRecipientNameStartsBlank(page);
  await assertBarTabPricing(page);
  await browser.close();
  console.log("All Preview checkout fixes passed.");
})().catch((error) => {
  console.error("FAIL:", error.message || error);
  process.exit(1);
});
