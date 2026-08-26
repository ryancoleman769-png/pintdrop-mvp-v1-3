/**
 * Static + unit checks for partial tab / tab-20 / tab-30 redemption.
 * Run: node scripts/verify-fixed-bar-tab-redemption.cjs
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const configJs = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sql = fs.readFileSync(
  path.join(root, "supabase", "bar-tab-partial-preset-redemption-migration.sql"),
  "utf8"
);
const rollback = fs.readFileSync(
  path.join(root, "supabase", "bar-tab-partial-preset-redemption-rollback.sql"),
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

const BAR_TAB_PRESETS = [20, 30];
eval(extractFunction(appJs, "barTabPresetFromSlug"));
eval(extractFunction(appJs, "isExactBarTabPreset"));
eval(extractFunction(appJs, "isBarTabSlug"));
eval(extractFunction(appJs, "isBarTabGift"));
eval(extractFunction(appJs, "hasSavedDrinkSupabaseId"));
eval(extractFunction(appJs, "formatBarTabGiftName"));
eval(extractFunction(appJs, "normalizeCustomerGifts"));
eval(extractFunction(appJs, "isBarTabVoucher"));
eval(extractFunction(appJs, "formatBarTabAmount"));
eval(extractFunction(appJs, "getBarTabOriginal"));
eval(extractFunction(appJs, "getBarTabRemaining"));
eval(extractFunction(appJs, "getBarTabTotalRedeemed"));
eval(extractFunction(appJs, "getBarTabBalanceDisplay"));
eval(extractFunction(appJs, "isBarTabFullyRedeemed"));
eval(extractFunction(appJs, "parseRedemptionAmount"));
eval(extractFunction(appJs, "validateBarTabRedeemAmount"));
eval(extractFunction(appJs, "applyBarTabDebit"));

const processBarRedemption = appJs.slice(
  appJs.indexOf("async function processBarRedemption"),
  appJs.indexOf("function stopPartnerQrDecodeLoop")
);

const pint = {
  gift: { id: "pint", name: "Pint", price: 6 },
  status: "waiting"
};
const tab30 = {
  gift: { id: "tab-30", name: "€30 Bar Tab", price: 30 },
  status: "waiting",
  barTab: { original: 30, remaining: 30, totalRedeemed: 0, redemptions: [] }
};
const tab20 = {
  gift: { id: "tab-20", slug: "tab-20", name: "€20 Bar Tab", price: 20 },
  status: "waiting",
  barTab: { original: 20, remaining: 20, totalRedeemed: 0, redemptions: [] }
};
const legacyTab = {
  gift: { id: "tab", name: "Bar Tab", price: 20 },
  status: "waiting",
  barTab: { original: 20, remaining: 20, totalRedeemed: 0, redemptions: [] }
};

assert.strictEqual(isBarTabVoucher(pint), false);
assert.strictEqual(isBarTabVoucher(tab30), true);
assert.strictEqual(isBarTabVoucher(tab20), true);
assert.strictEqual(isBarTabVoucher(legacyTab), true);

assert.deepStrictEqual(getBarTabBalanceDisplay(tab30), {
  original: 30,
  redeemed: 0,
  remaining: 30
});
assert.strictEqual(formatBarTabAmount(30), "€30.00");
assert.strictEqual(formatBarTabAmount(0), "€0.00");

const liveAfterEight = {
  gift: { id: "tab-30", name: "€30 Bar Tab", price: 30 },
  status: "waiting",
  barTab: { original: 30, remaining: 22, totalRedeemed: 8, redemptions: [] }
};
assert.deepStrictEqual(getBarTabBalanceDisplay(liveAfterEight), {
  original: 30,
  redeemed: 8,
  remaining: 22
});
assert.strictEqual(formatBarTabAmount(8), "€8.00");
assert.strictEqual(formatBarTabAmount(22), "€22.00");

let current = tab30;
const first = applyBarTabDebit(current, 8);
assert.strictEqual(first.ok, true);
assert.strictEqual(first.voucher.barTab.remaining, 22);
assert.strictEqual(first.voucher.barTab.totalRedeemed, 8);
assert.strictEqual(first.voucher.status, "waiting");
assert.deepStrictEqual(getBarTabBalanceDisplay(first.voucher), {
  original: 30,
  redeemed: 8,
  remaining: 22
});
current = first.voucher;

const second = applyBarTabDebit(current, 12);
assert.strictEqual(second.ok, true);
assert.strictEqual(second.voucher.barTab.remaining, 10);
assert.strictEqual(second.voucher.status, "waiting");
current = second.voucher;

const third = applyBarTabDebit(current, 10);
assert.strictEqual(third.ok, true);
assert.strictEqual(third.voucher.barTab.remaining, 0);
assert.strictEqual(third.voucher.status, "redeemed");
assert.strictEqual(isBarTabFullyRedeemed(third.voucher), true);

assert.strictEqual(applyBarTabDebit(current, 12).ok, false);
assert.match(applyBarTabDebit(tab30, 30.01).error, /more than the remaining/);
assert.match(applyBarTabDebit(tab30, 0).error, /greater than €0/);
assert.match(applyBarTabDebit(tab30, -1).error, /greater than €0/);
assert.match(applyBarTabDebit(third.voucher, 1).error, /fully redeemed/);
assert.strictEqual(applyBarTabDebit(pint, 1).ok, false);

assert.ok(
  processBarRedemption.includes("if (isBarTabVoucher(voucher))"),
  "scan detects Bar Tabs before one-shot redeem"
);
assert.ok(
  processBarRedemption.includes("renderRedemptionScreen(voucher, { barMode: true });"),
  "Bar Tab scan renders without auto-redeem"
);
const barTabReturn = processBarRedemption.indexOf("if (isBarTabVoucher(voucher))");
const autoRedeem = processBarRedemption.indexOf("redeemVoucherById(voucher.id)");
assert.ok(barTabReturn >= 0 && autoRedeem > barTabReturn, "pint one-shot stays after Bar Tab return");
assert.ok(processBarRedemption.includes("return;"), "Bar Tab scan returns before redeemVoucherById");

assert.ok(appJs.includes("auth.redeemBarTab"));
assert.ok(configJs.includes('client.rpc("redeem_bar_tab_for_partner"'));
assert.ok(configJs.includes("bar_tab_original_balance"));
assert.ok(configJs.includes("bar_tab_remaining_balance"));
assert.ok(configJs.includes("bar_tab_total_redeemed"));
assert.ok(configJs.includes("bar_tab_redemptions"));
assert.ok(configJs.includes("redeemBarTab: redeemBarTabForPartnerFromSupabase"));
const redeemBarTabFn = configJs.slice(
  configJs.indexOf("async function redeemBarTabForPartnerFromSupabase"),
  configJs.indexOf("async function fetchPartnerVouchersFromSupabase")
);
assert.ok(redeemBarTabFn.includes('client.rpc("redeem_bar_tab_for_partner"'));
assert.ok(!redeemBarTabFn.includes("p_pub_id"), "Bar Tab redeem does not take a client pub id");

assert.ok(indexHtml.includes('id="redemptionBarTabPanel"'));
assert.ok(indexHtml.includes('id="redemptionBarTabOriginal"'));
assert.ok(indexHtml.includes('id="redemptionBarTabRedeemed"'));
assert.ok(indexHtml.includes('id="redemptionBarTabRemaining"'));
assert.ok(indexHtml.includes('id="redemptionBarTabAmount"'));
assert.ok(indexHtml.includes('id="redemptionBarTabRedeemBtn"'));
assert.ok(indexHtml.includes("Redeemed so far"));
assert.ok(indexHtml.includes('id="voucherBarTabPanel"'));
assert.ok(indexHtml.includes('id="voucherBarTabOriginal"'));
assert.ok(indexHtml.includes('id="voucherBarTabRedeemed"'));
assert.ok(indexHtml.includes('id="voucherBarTabRemaining"'));
assert.ok(indexHtml.includes('id="voucherBarTabPanel" class="bar-tab-balance-panel hidden"'));
assert.ok(appJs.includes("fillBarTabBalanceFields"));
assert.ok(appJs.includes("panelId: `${prefix}BarTabPanel`"));
assert.ok(indexHtml.includes("app.js?v=20260826-bar-tab-balances"));

assert.ok(appJs.includes("const show = isBarTabVoucher(voucher);"));
assert.ok(appJs.includes('panel.classList.toggle("hidden", !show)'));
assert.ok(appJs.includes("getBarTabBalanceDisplay(voucher)"));

const populateFn = extractFunction(appJs, "populateVoucherFields");
assert.ok(populateFn.includes("fillBarTabBalanceFields"));
assert.ok(populateFn.includes("panelId: `${prefix}BarTabPanel`"));

assert.ok(appJs.includes("await findVoucherByCode(code)"));
assert.ok(appJs.includes('populateVoucherFields(voucher, "voucher")'));
assert.ok(appJs.includes('panelId: "redemptionBarTabPanel"'));
assert.ok(appJs.includes('redeemedId: "redemptionBarTabRedeemed"'));

assert.ok(sql.includes("IN ('tab', 'tab-20', 'tab-30')"));
assert.ok(sql.includes("IF public._voucher_is_bar_tab(v_voucher_id)"));
assert.ok(sql.includes("v_pub_id := public.current_partner_pub_id()"));
assert.ok(sql.includes("AND vo.status = 'waiting'"));
assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.redeem_voucher_for_partner(uuid, text) FROM PUBLIC"));
assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_partner(uuid, text) TO authenticated"));
assert.ok(!/GRANT EXECUTE[^;]*TO anon/i.test(sql));
assert.ok(!sql.includes("CREATE OR REPLACE FUNCTION public.redeem_bar_tab_for_partner"));
assert.ok(rollback.includes("_voucher_is_fixed_bar_tab_preset"));

const unsavedTab = normalizeCustomerGifts([
  { id: "pint", name: "Pint", price: 6, icon: "x" },
  { id: "tab-30", name: "€30 Bar Tab", price: 30, icon: "e" }
]);
assert.deepStrictEqual(unsavedTab.map((gift) => gift.id), ["pint"]);

const savedTab = normalizeCustomerGifts([
  { id: "tab-30", name: "€30 Bar Tab", price: 30, icon: "e", supabaseId: 118 }
]);
assert.strictEqual(savedTab.length, 1);
assert.strictEqual(savedTab[0].id, "tab-30");
assert.ok(appJs.includes("if (!hasSavedDrinkSupabaseId(gift)) return;"));
assert.ok(!appJs.includes('{ id: "tab-20", name: "€20 Bar Tab"'));

console.log("verify-fixed-bar-tab-redemption: PASS");
