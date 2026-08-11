const { chromium } = require("playwright");

const PREVIEW_URL =
  process.env.PINTDROP_PREVIEW_URL ||
  "https://pintdrop-mvp-v1-3-git-cursor-stripe-connect-apis-pintdrop.vercel.app";

const TEST_CODE = process.env.PINTDROP_TEST_VOUCHER_CODE || "PD-DEMO1";

async function assertConfigLoads() {
  const response = await fetch(`${PREVIEW_URL}/supabase-config.js`);
  if (!response.ok) {
    throw new Error(`supabase-config.js returned ${response.status}`);
  }
  const text = await response.text();
  if (!text.includes("ggvofckolukahshocxvd.supabase.co")) {
    throw new Error("supabase-config.js missing Supabase URL");
  }
  if (!text.includes("fetchVoucherByCode")) {
    throw new Error("supabase-config.js missing fetchVoucherByCode export");
  }
  console.log("PASS: supabase-config.js loads on Preview");
}

async function assertRedeemPageFindsVoucher() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => sessionStorage.setItem("pintdrop_splash_seen", "1"));

  await page.goto(`${PREVIEW_URL}/#redeem/${encodeURIComponent(TEST_CODE)}`, {
    waitUntil: "networkidle"
  });

  const configured = await page.evaluate(() => Boolean(window.PintDropSupabase?.isConfigured?.()));
  if (!configured) {
    throw new Error("PintDropSupabase is not configured on redeem page");
  }

  const title = await page.locator("#voucherTitle").textContent();
  if (/not found/i.test(title || "")) {
    throw new Error(`Redeem page shows not found for ${TEST_CODE}`);
  }

  const emptyHidden = await page.locator("#voucherEmpty").isHidden();
  if (!emptyHidden) {
    throw new Error(`Voucher body not shown for ${TEST_CODE}`);
  }

  const shownCode = await page.locator("#voucherCode, #successCode, [id*='Code']").first().textContent().catch(() => "");
  console.log("PASS: redeem page opened voucher", { code: TEST_CODE, title: title?.trim(), shownCode: shownCode?.trim() });
  await browser.close();
}

async function assertRpcLookupWorks() {
  const response = await fetch("https://ggvofckolukahshocxvd.supabase.co/rest/v1/rpc/get_voucher_by_code", {
    method: "POST",
    headers: {
      apikey: "sb_publishable_4NAQehcdmGoOOUbDMHniHg_8ExxQv3m",
      Authorization: "Bearer sb_publishable_4NAQehcdmGoOOUbDMHniHg_8ExxQv3m",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_code: TEST_CODE })
  });
  const data = await response.json();
  if (!data?.code) {
    throw new Error(`get_voucher_by_code failed for ${TEST_CODE}`);
  }
  console.log("PASS: get_voucher_by_code RPC returns", data.code);
}

async function assertFulfillmentHelpers() {
  const {
    waitForVoucherReadableByCode,
    getVoucherByCode
  } = require("../api/_lib/fulfillment");

  if (typeof getVoucherByCode !== "function" || typeof waitForVoucherReadableByCode !== "function") {
    throw new Error("Fulfillment read-back helpers missing");
  }
  console.log("PASS: fulfillment read-back helpers exported");
}

(async () => {
  console.log("Preview URL:", PREVIEW_URL);
  await assertConfigLoads();
  await assertRpcLookupWorks();
  await assertFulfillmentHelpers();
  await assertRedeemPageFindsVoucher();
  console.log("All Preview redeem checks passed.");
})().catch((error) => {
  console.error("FAIL:", error.message || error);
  process.exit(1);
});
