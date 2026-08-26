/**
 * Static + unit checks for one-shot tab-20 / tab-30 partner redemption.
 * Run: node scripts/verify-fixed-bar-tab-redemption.cjs
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sql = fs.readFileSync(
  path.join(root, "supabase", "fixed-bar-tab-oneshot-redemption-migration.sql"),
  "utf8"
);
const rollback = fs.readFileSync(
  path.join(root, "supabase", "fixed-bar-tab-oneshot-redemption-rollback.sql"),
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

eval(extractFunction(appJs, "barTabPresetFromSlug"));
eval(extractFunction(appJs, "isBarTabSlug"));
eval(extractFunction(appJs, "isBarTabGift"));
eval(extractFunction(appJs, "isBarTabVoucher"));
eval(extractFunction(appJs, "isFixedBarTabPresetVoucher"));
eval(extractFunction(appJs, "isLegacyPartialBarTabVoucher"));
eval(extractFunction(appJs, "normalizePartnerRedemptionError"));

const processBarRedemption = appJs.slice(
  appJs.indexOf("async function processBarRedemption"),
  appJs.indexOf("function stopPartnerQrDecodeLoop")
);

const pint = { gift: { id: "pint", name: "Pint", price: 6 } };
const tab30 = { gift: { id: "tab-30", name: "€30 Bar Tab", price: 30 } };
const tab20 = { gift: { id: "tab-20", slug: "tab-20", name: "€20 Bar Tab", price: 20 } };
const legacyTab = { gift: { id: "tab", name: "Bar Tab", price: 20 } };
const namedOnly = { gift: { id: "39", name: "€30 Bar Tab", price: 30 } };

assert.strictEqual(isBarTabVoucher(pint), false);
assert.strictEqual(isFixedBarTabPresetVoucher(pint), false);
assert.strictEqual(isLegacyPartialBarTabVoucher(pint), false);

assert.strictEqual(isBarTabVoucher(tab30), true);
assert.strictEqual(isFixedBarTabPresetVoucher(tab30), true);
assert.strictEqual(isLegacyPartialBarTabVoucher(tab30), false);

assert.strictEqual(isBarTabVoucher(tab20), true);
assert.strictEqual(isFixedBarTabPresetVoucher(tab20), true);
assert.strictEqual(isLegacyPartialBarTabVoucher(tab20), false);

assert.strictEqual(isBarTabVoucher(legacyTab), true);
assert.strictEqual(isFixedBarTabPresetVoucher(legacyTab), false);
assert.strictEqual(isLegacyPartialBarTabVoucher(legacyTab), true);

assert.strictEqual(isBarTabVoucher(namedOnly), true);
assert.strictEqual(isFixedBarTabPresetVoucher(namedOnly), false);
assert.strictEqual(isLegacyPartialBarTabVoucher(namedOnly), true);

const amountSql =
  "Bar Tab vouchers must be redeemed with an amount via redeem_bar_tab_for_partner";
assert.strictEqual(
  normalizePartnerRedemptionError(amountSql, tab30),
  amountSql
);
assert.strictEqual(
  normalizePartnerRedemptionError(amountSql, tab20),
  amountSql
);
assert.strictEqual(
  normalizePartnerRedemptionError(amountSql, legacyTab),
  "Bar Tab vouchers must be redeemed with an amount from the partner dashboard."
);
assert.ok(!normalizePartnerRedemptionError("expired voucher", tab30).includes("amount"));
assert.strictEqual(
  normalizePartnerRedemptionError("This voucher has expired and cannot be redeemed", tab30),
  "This voucher is not redeemable."
);

assert.ok(
  processBarRedemption.includes("isLegacyPartialBarTabVoucher(voucher)"),
  "processBarRedemption isolates legacy partial Bar Tabs only"
);
assert.ok(
  processBarRedemption.includes("const result = await redeemVoucherById(voucher.id)"),
  "processBarRedemption still auto-redeems waiting vouchers"
);
assert.ok(
  !/if \(isBarTabVoucher\(voucher\)\)/.test(processBarRedemption),
  "processBarRedemption no longer hard-blocks every Bar Tab"
);
assert.ok(
  processBarRedemption.includes('voucher.status === "redeemed"'),
  "already-redeemed path remains before redeem"
);

assert.ok(indexHtml.includes("app.js?v=20260826-fixed-tab-redeem"));
assert.ok(appJs.includes("isBarTabSlug"));
assert.ok(appJs.includes("isBarTabGift"));

assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.redeem_voucher_for_partner"));
assert.ok(sql.includes("v_pub_id := public.current_partner_pub_id()"));
assert.ok(sql.includes("AND vo.status = 'waiting'"));
assert.ok(sql.includes("AND vo.pub_id = v_pub_id"));
assert.ok(sql.includes("IN ('tab-20', 'tab-30')"));
assert.ok(sql.includes("bar_tab_remaining_balance"));
assert.ok(sql.includes("public._voucher_is_expired"));
assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.redeem_voucher_for_partner(uuid, text) FROM PUBLIC"));
assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public.redeem_voucher_for_partner(uuid, text) TO authenticated"));
assert.ok(!/GRANT EXECUTE ON FUNCTION public\.redeem_voucher_for_partner\(uuid, text\) TO anon/i.test(sql));
assert.ok(!/GRANT EXECUTE[^;]*TO anon/i.test(sql));
assert.ok(sql.includes("IF public._voucher_is_bar_tab(v_voucher_id)"));
assert.ok(rollback.includes("DROP FUNCTION IF EXISTS public._voucher_is_fixed_bar_tab_preset"));
assert.ok(sql.includes("Safe to re-run: CREATE OR REPLACE only. No voucher DML."));
assert.ok(sql.includes("UPDATE public.vouchers vo"), "one-shot redeem UPDATE is inside the RPC");

console.log("verify-fixed-bar-tab-redemption: PASS");
