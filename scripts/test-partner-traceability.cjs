/**
 * Partner accountant traceability — static safety and wiring checks.
 * Run: node scripts/test-partner-traceability.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const rpc = fs.readFileSync(path.join(root, "supabase", "get-my-pub-vouchers-rpc.sql"), "utf8");
const reportApi = fs.readFileSync(path.join(root, "api", "partner", "accounting-report.js"), "utf8");

function includes(source, value, message) {
  assert.ok(source.includes(value), message);
}

includes(html, 'id="partnerTraceabilityTitle"', "Accountant panel is present");
includes(html, 'id="partnerExportCsv"', "CSV export control is present");
includes(html, 'id="partnerTraceabilityRows"', "Traceability table is present");
includes(app, "function computeTraceabilitySummary", "Summary calculation is present");
includes(app, "function exportPartnerTraceabilityCsv", "CSV export is wired");
includes(app, "voucherSoldInPeriod", "Sale period uses sale date");
includes(app, "voucher.redeemedAt", "Redemption date is reported separately");
includes(app, "safeCsvCell", "Spreadsheet formula injection is guarded");
includes(app, "partnerAccountingReports.clear()", "Settlement cache clears when partner sessions change");
includes(html, "Print / PDF", "Printable accountant statement is available");
includes(css, ".partner-traceability-table-wrap", "Mobile table overflow styling is present");
includes(reportApi, "resolveAuthenticatedPartnerPub(req)", "Settlement endpoint authenticates the partner");
includes(reportApi, "pub_id: `eq.${pubId}`", "Settlement query is restricted to the authenticated venue");
includes(reportApi, "stripe.payouts.list", "Stripe payout records are reconciled");
includes(reportApi, "amount_refunded", "Refund amounts are reported");
includes(reportApi, "amount_reversed", "Transfer reversals are reported");

assert.ok(
  /partner_pub_id := public\.current_partner_pub_id\(\)/.test(rpc),
  "Reporting data must derive venue scope from the authenticated partner"
);
assert.ok(
  /WHERE vo\.pub_id = partner_pub_id/.test(rpc),
  "Reporting data must only include the signed-in venue"
);
assert.ok(
  !app.includes("stripeFee: voucher.fee"),
  "PintDrop service fee must not be mislabelled as a Stripe fee"
);
assert.ok(
  !/Recipient|Sender/.test(app.match(/const headings = \[[^;]+;/)?.[0] || ""),
  "The standard accountant CSV must not export customer names"
);

console.log("partner traceability checks passed");
