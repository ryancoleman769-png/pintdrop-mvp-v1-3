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
eval(extractFunction(appJs, "isBarTabRedeemAmountValid"));
eval(extractFunction(appJs, "getBarTabRedeemButtonLabel"));
eval(extractFunction(appJs, "applyBarTabDebit"));
eval(extractFunction(appJs, "formatBarTabNoticeAmount"));
eval(extractFunction(appJs, "isFiniteBarTabAmount"));
eval(extractFunction(appJs, "getBarTabStaffScreenState"));
eval(extractFunction(appJs, "getLatestBarTabRedemption"));
eval(extractFunction(appJs, "buildSenderNotificationText"));

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

const senderNotifyVoucher = {
  recipient: "Ryan Coleman",
  pub: { name: "O'Flaherty's Bar" },
  gift: { id: "tab-30", name: "€30 Bar Tab", price: 30 },
  status: "waiting",
  barTab: { original: 30, remaining: 22, totalRedeemed: 8, redemptions: [] }
};
assert.strictEqual(
  buildSenderNotificationText(senderNotifyVoucher, {
    amount_redeemed: 8,
    remaining_balance: 22
  }),
  "Ryan Coleman has just redeemed €8 from the €30 Bar Tab you sent at O'Flaherty's Bar. €22 remaining."
);
assert.strictEqual(
  buildSenderNotificationText({
    ...senderNotifyVoucher,
    barTab: { original: 30, remaining: 10, totalRedeemed: 20, redemptions: [] }
  }, {
    amount_redeemed: 12,
    remaining_balance: 10
  }),
  "Ryan Coleman has just redeemed €12 from the €30 Bar Tab you sent at O'Flaherty's Bar. €10 remaining."
);
assert.strictEqual(
  buildSenderNotificationText({
    ...senderNotifyVoucher,
    status: "redeemed",
    barTab: { original: 30, remaining: 0, totalRedeemed: 30, redemptions: [] }
  }, {
    amount_redeemed: 5,
    remaining_balance: 0
  }),
  "Ryan Coleman has just redeemed €5 from the €30 Bar Tab you sent at O'Flaherty's Bar. Remaining balance: €0."
);
assert.strictEqual(
  buildSenderNotificationText({
    ...senderNotifyVoucher,
    barTab: { original: 30, remaining: 99, totalRedeemed: 8, redemptions: [] }
  }, {
    amount_redeemed: 8,
    remaining_balance: 22
  }),
  "Ryan Coleman has just redeemed €8 from the €30 Bar Tab you sent at O'Flaherty's Bar. €22 remaining.",
  "uses returned remaining_balance instead of a client-side calculation"
);
assert.strictEqual(
  buildSenderNotificationText({
    recipient: "Ryan Coleman",
    pub: { name: "O'Flaherty's Bar" },
    gift: { id: "pint", name: "Pint", price: 6 },
    status: "redeemed"
  }),
  "Ryan Coleman has just redeemed the Pint you sent at O'Flaherty's Bar."
);

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
assert.ok(
  !processBarRedemption.slice(barTabReturn, autoRedeem).includes("redeemBarTabById"),
  "scan alone does not debit a Bar Tab"
);

const scannedTab = getBarTabStaffScreenState(tab30);
assert.strictEqual(scannedTab.hero, "Voucher scanned — NOT YET REDEEMED");
assert.strictEqual(scannedTab.tone, "waiting");
assert.strictEqual(scannedTab.instruction, "Enter the amount being spent now");
assert.strictEqual(scannedTab.allowDebit, true);
assert.strictEqual(scannedTab.remaining, 30);
assert.strictEqual(isBarTabRedeemAmountValid(tab30, ""), false);
assert.strictEqual(isBarTabRedeemAmountValid(tab30, "0"), false);
assert.strictEqual(isBarTabRedeemAmountValid(tab30, "-1"), false);
assert.strictEqual(isBarTabRedeemAmountValid(tab30, "30.01"), false);
assert.strictEqual(isBarTabRedeemAmountValid(tab30, "18"), true);
assert.strictEqual(getBarTabRedeemButtonLabel(tab30, ""), "Redeem");
assert.strictEqual(getBarTabRedeemButtonLabel(tab30, "18"), "Redeem €18.00");

const confirmedPartial = getBarTabStaffScreenState(first.voucher, {
  lastBarTabRedemption: { amount_redeemed: 8, remaining_balance: 22 }
});
assert.strictEqual(confirmedPartial.hero, "REDEMPTION CONFIRMED");
assert.strictEqual(confirmedPartial.tone, "confirmed");
assert.strictEqual(confirmedPartial.allowDebit, false);
assert.strictEqual(confirmedPartial.fullyRedeemed, false);
assert.strictEqual(confirmedPartial.showConfirmed, true);
assert.strictEqual(confirmedPartial.redeemedNow, 8);
assert.strictEqual(confirmedPartial.remaining, 22);

const laterScan = getBarTabStaffScreenState(first.voucher);
assert.strictEqual(laterScan.hero, "Voucher scanned — NOT YET REDEEMED");
assert.strictEqual(laterScan.tone, "waiting");
assert.strictEqual(laterScan.allowDebit, true);
assert.strictEqual(laterScan.remaining, 22);
assert.strictEqual(isBarTabRedeemAmountValid(first.voucher, "22"), true);
assert.strictEqual(isBarTabRedeemAmountValid(first.voucher, "22.01"), false);

const confirmedFinal = getBarTabStaffScreenState(third.voucher, {
  lastBarTabRedemption: { amount_redeemed: 10, remaining_balance: 0 }
});
assert.strictEqual(confirmedFinal.hero, "❌ BAR TAB USED — DO NOT ACCEPT");
assert.strictEqual(confirmedFinal.tone, "used");
assert.strictEqual(confirmedFinal.remaining, 0);
assert.strictEqual(confirmedFinal.fullyRedeemed, true);
assert.strictEqual(confirmedFinal.allowDebit, false);
assert.strictEqual(confirmedFinal.showConfirmed, false);

const rescanEmpty = getBarTabStaffScreenState(third.voucher);
assert.strictEqual(rescanEmpty.hero, "❌ BAR TAB USED — DO NOT ACCEPT");
assert.strictEqual(rescanEmpty.tone, "used");
assert.strictEqual(rescanEmpty.allowDebit, false);
assert.strictEqual(rescanEmpty.fullyRedeemed, true);
assert.strictEqual(isBarTabRedeemAmountValid(third.voucher, "1"), false);

const usedByRemaining = getBarTabStaffScreenState({
  gift: { id: "tab-30", name: "€30 Bar Tab", price: 30 },
  status: "waiting",
  barTab: { original: 30, remaining: 0, totalRedeemed: 30, redemptions: [] }
});
assert.strictEqual(usedByRemaining.tone, "used");
assert.strictEqual(usedByRemaining.allowDebit, false);

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
assert.ok(indexHtml.includes("Enter the amount being spent now"));
assert.ok(indexHtml.includes("Do not hand over drinks until redemption is confirmed."));
assert.ok(indexHtml.includes('id="redemptionBarTabHoldWarning"'));
assert.ok(indexHtml.includes('id="redemptionBarTabConfirmed"'));
assert.ok(indexHtml.includes('id="redemptionBarTabRedeemedNow"'));
assert.ok(indexHtml.includes('id="redemptionBarTabConfirmedRemaining"'));
assert.ok(indexHtml.includes('id="redemptionBarTabRedeemBtn" type="button" class="primary redemption-redeem-btn" disabled'));
assert.ok(appJs.includes("Voucher scanned — NOT YET REDEEMED"));
assert.ok(appJs.includes("REDEMPTION CONFIRMED"));
assert.ok(appJs.includes("❌ BAR TAB USED — DO NOT ACCEPT"));
assert.ok(!indexHtml.includes('id="redemptionBarTabUsedBanner"'));
assert.ok(!indexHtml.includes("redemption-bar-tab-used-banner"));
assert.ok(indexHtml.includes("app.js?v=20260902-accounting-live-merge"));
assert.ok(appJs.includes("showSenderNotification(result.voucher, result.redemption)"));

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
