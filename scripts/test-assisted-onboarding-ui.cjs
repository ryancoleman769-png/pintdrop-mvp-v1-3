const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.PINTDROP_TEST_BASE_URL || "http://127.0.0.1:4173";
const outputDirectory = path.join(process.cwd(), "test-results", "assisted-onboarding");

async function jsonRoute(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

async function testAdminPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  await page.route("**/api/admin/session", (route) => jsonRoute(route, { ok: true, authenticated: true }));
  await page.route("**/api/admin/pubs", (route) => jsonRoute(route, {
    ok: true,
    pubs: [
      {
        id: 6,
        name: "PintDrop Test Pub",
        location: "Buncrana",
        contactName: "Ava Murphy",
        contactPhone: "+353871234567",
        contactEmail: "owner@example.com",
        active: false,
        onboardingStatus: "draft",
        stripeOnboardingStatus: "not_started"
      },
      {
        id: 1,
        name: "O'Flaherty's Bar",
        location: "Buncrana",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        active: true,
        onboardingStatus: "approved",
        stripeOnboardingStatus: "complete"
      }
    ]
  }));
  await page.route("**/api/admin/assisted-connect", (route) => jsonRoute(route, {
    ok: true,
    previewOnly: true,
    pub: { id: 6, name: "PintDrop Test Pub", location: "Buncrana" },
    stripeAccountId: "acct_preview123",
    stripeMode: "test",
    ibanLast4: "5678",
    representativePrefilled: true,
    warning: "",
    handoffUrl: `${baseUrl}/payout-handoff.html?token=preview-token`
  }));

  await page.goto(`${baseUrl}/admin-assisted.html`, { waitUntil: "networkidle" });
  await page.selectOption("#pubId", "6");
  await page.click("#fillTestDetails");
  assert.equal(await page.inputValue("#businessCity"), "Buncrana");
  assert.equal(await page.inputValue("#iban"), "IE29 AIBK 9311 5212 3456 78");
  await page.click("#assistedSetupButton");
  await page.waitForSelector("#handoffResult:not(.hidden)");
  assert.equal(await page.inputValue("#iban"), "", "IBAN should be cleared after success");
  assert.match(await page.textContent("#handoffPubName"), /PintDrop Test Pub is ready/);
  await page.screenshot({ path: path.join(outputDirectory, "admin-desktop.png"), fullPage: true });
  await context.close();
}

async function testHandoffPage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  await page.route("**/api/stripe-connect/handoff-status", (route) => jsonRoute(route, {
    ok: true,
    previewOnly: true,
    stripeMode: "test",
    pub: { id: 6, name: "PintDrop Test Pub", location: "Buncrana" },
    status: "needs_details",
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    requirementsRemaining: 5,
    expiresAt: "2026-09-08T12:00:00.000Z"
  }));

  await page.goto(`${baseUrl}/payout-handoff.html?token=preview-token`, { waitUntil: "networkidle" });
  await page.waitForSelector("#handoffReady:not(.hidden)");
  assert.equal(await page.textContent("#handoffPubName"), "PintDrop Test Pub");
  await page.screenshot({ path: path.join(outputDirectory, "handoff-mobile.png"), fullPage: true });
  await context.close();
}

(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await testAdminPage(browser);
    await testHandoffPage(browser);
    console.log("Assisted onboarding UI checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
