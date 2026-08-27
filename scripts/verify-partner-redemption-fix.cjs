/**
 * Static verification for partner redemption + Recent redemptions fix.
 * Run: node scripts/verify-partner-redemption-fix.cjs
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const revokeSql = fs.readFileSync(
  path.join(root, "supabase", "revoke-anon-redeem-voucher-for-partner.sql"),
  "utf8"
);
const vouchersSql = fs.readFileSync(
  path.join(root, "supabase", "get-my-pub-vouchers-rpc.sql"),
  "utf8"
);

const checks = [];

function pass(name) {
  checks.push({ name, ok: true });
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
}

if (configJs.includes('client.rpc("redeem_voucher_for_partner"')) {
  pass("PartnerAuth uses redeem_voucher_for_partner RPC");
} else {
  fail("PartnerAuth uses redeem_voucher_for_partner RPC");
}

if (configJs.includes('client.rpc("get_voucher_for_partner_redemption"')) {
  pass("PartnerAuth uses get_voucher_for_partner_redemption RPC");
} else {
  fail("PartnerAuth uses get_voucher_for_partner_redemption RPC");
}

if (!configJs.includes('client.rpc("redeem_voucher"')) {
  pass("supabase-config no longer calls legacy redeem_voucher");
} else {
  fail("supabase-config no longer calls legacy redeem_voucher");
}

if (configJs.includes("redeemVoucher: redeemVoucherForPartnerFromSupabase")) {
  pass("PartnerAuth.redeemVoucher exported");
} else {
  fail("PartnerAuth.redeemVoucher exported");
}

if (configJs.includes("fetchVoucherForRedemption: fetchVoucherForPartnerRedemptionFromSupabase")) {
  pass("PartnerAuth.fetchVoucherForRedemption exported");
} else {
  fail("PartnerAuth.fetchVoucherForRedemption exported");
}

if (configJs.includes('mapped.status !== "redeemed"')) {
  pass("Partner redeem requires server status redeemed");
} else {
  fail("Partner redeem requires server status redeemed");
}

if (appJs.includes("findPartnerVoucherByCode")) pass("Partner-scoped voucher lookup in app.js");
else fail("Partner-scoped voucher lookup in app.js");

if (appJs.includes("auth.fetchVoucherForRedemption") || appJs.includes("fetchVoucherForRedemption")) {
  pass("app.js uses partner voucher lookup API");
} else {
  fail("app.js uses partner voucher lookup API");
}

if (appJs.includes("auth.redeemVoucher") || appJs.includes("redeemVoucher({")) {
  pass("app.js uses PartnerAuth.redeemVoucher");
} else {
  fail("app.js uses PartnerAuth.redeemVoucher");
}

if (!appJs.includes("PintDropSupabase.redeemVoucher")) {
  pass("app.js no longer calls PintDropSupabase.redeemVoucher");
} else {
  fail("app.js no longer calls PintDropSupabase.redeemVoucher");
}

if (
  appJs.includes("if (window.PintDropSupabase?.isConfigured?.())") &&
  appJs.includes("!hasActivePartnerProfile()") &&
  appJs.includes("storePendingPartnerRedemption")
) {
  pass("Unauthenticated staff redemption redirects to partner login");
} else {
  fail("Unauthenticated staff redemption redirects to partner login");
}

if (
  appJs.includes("local.status = \"redeemed\"") &&
  !appJs.match(/isConfigured[\s\S]{0,400}local\.status = "redeemed"/)
) {
  pass("No localStorage redeem fallback when Supabase configured");
} else if (
  appJs.includes("async function redeemVoucherById") &&
  appJs.split("async function redeemVoucherById")[1].includes("local.status = \"redeemed\"") &&
  appJs.split("async function redeemVoucherById")[1].indexOf("local.status = \"redeemed\"") >
    appJs.split("async function redeemVoucherById")[1].indexOf("if (window.PintDropSupabase?.isConfigured?.())")
) {
  pass("No localStorage redeem fallback when Supabase configured");
} else {
  fail("No localStorage redeem fallback when Supabase configured", "local redeem may run after Supabase branch");
}

if (appJs.includes("isBarTabVoucher")) pass("Bar Tab detection present");
else fail("Bar Tab detection present");

if (appJs.includes("redeemBarTabById") && appJs.includes("auth.redeemBarTab")) {
  pass("Bar Tabs use redeemBarTab partial path");
} else {
  fail("Bar Tabs use redeemBarTab partial path");
}

if (appJs.includes("Amount is more than the remaining balance.")) {
  pass("Over-balance copy present");
} else {
  fail("Over-balance copy present");
}

if (appJs.includes("auth.fetchVouchers")) pass("Recent redemptions uses authenticated fetchVouchers");
else fail("Recent redemptions uses authenticated fetchVouchers");

if (appJs.includes("partnerVouchersLoadError")) pass("Recent redemptions RPC error state tracked");
else fail("Recent redemptions RPC error state tracked");

if (indexHtml.includes('id="partnerHistoryError"')) pass("partnerHistoryError UI present");
else fail("partnerHistoryError UI present");

if (revokeSql.includes("REVOKE EXECUTE ON FUNCTION public.redeem_voucher_for_partner")) {
  pass("Optional anon revoke SQL prepared");
} else {
  fail("Optional anon revoke SQL prepared");
}

if (vouchersSql.includes("get_my_pub_vouchers")) pass("get_my_pub_vouchers SQL present");
else fail("get_my_pub_vouchers SQL present");

const failures = checks.filter(c => !c.ok);
console.log("Partner redemption fix verification");
console.log("=================================");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
}
console.log("");
console.log(`Total: ${checks.length - failures.length}/${checks.length} passed`);
process.exit(failures.length ? 1 : 0);
