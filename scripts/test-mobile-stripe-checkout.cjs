const { chromium, devices } = require("playwright");

const BASE_URL =
  process.env.PINTDROP_TEST_URL ||
  "https://pintdrop-mvp-v1-3-git-cursor-stripe-connect-apis-pintdrop.vercel.app/";

async function runMobileStripeCheckoutTest() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "en-IE",
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    sessionStorage.setItem("pintdrop_splash_seen", "1");
  });

  const cardCollectors = ["#paymentStep", "#paymentForm", "#cardNumber", "#cardName", "#cardExpiry", "#cardCvc", "#payButton"];
  const checkoutRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/create-checkout-session")) {
      checkoutRequests.push(request);
    }
  });

  console.log("Opening", BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  for (const selector of cardCollectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      throw new Error(`Legacy payment UI still present: ${selector}`);
    }
  }

  const messageValue = await page.locator("#message").inputValue();
  if (messageValue.trim()) {
    throw new Error(`Personal message should be empty by default, got: ${messageValue}`);
  }

  const placeholder = await page.locator("#message").getAttribute("placeholder");
  if (!placeholder || !/optional/i.test(placeholder)) {
    throw new Error(`Expected optional message placeholder, got: ${placeholder}`);
  }

  await page.locator('[data-customer-substep="pub"] .venue-card:not(.is-disabled)').first().click();
  await page.locator('[data-next-substep="drink"]').click();
  await page.locator('[data-customer-substep="drink"] .gift-card').first().click();
  await page.locator('[data-next-substep="recipient"]').click();

  await page.fill("#recipientName", "Mobile Test Recipient");
  await page.fill("#recipientPhone", "0871234567");
  await page.fill("#senderName", "Mobile Test Sender");
  await page.fill("#senderEmail", "mobile.test@example.com");
  await page.locator("#orderForm").evaluate((form) => form.requestSubmit());

  await page.waitForSelector("#reviewStep.active");
  await page.waitForSelector("#goToPayment");

  const payLabel = await page.locator("#goToPayment").textContent();
  if (!/Pay €[\d.]+\s+securely/i.test(payLabel || "")) {
    throw new Error(`Unexpected pay button label: ${payLabel}`);
  }

  await Promise.all([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }),
    page.locator("#goToPayment").click(),
  ]);

  if (checkoutRequests.length !== 1) {
    throw new Error(`Expected one create-checkout-session request, got ${checkoutRequests.length}`);
  }

  const stripeUrl = page.url();
  console.log("PASS: iPhone viewport redirected to Stripe Checkout:", stripeUrl);
  await browser.close();
}

runMobileStripeCheckoutTest().catch((error) => {
  console.error("FAIL:", error.message || error);
  process.exit(1);
});
