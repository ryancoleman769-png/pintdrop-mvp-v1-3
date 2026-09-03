/**
 * Customer pub picker town groupings — source + grouping checks.
 * Run: node scripts/test-customer-pub-town-groups.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.ok(
  !appJs.includes("CUSTOMER_VISIBLE_PUB_IDS"),
  "Customer visibility is not restricted by a hard-coded pub allowlist"
);
assert.match(appJs, /function isCustomerVisiblePub\(/);
assert.match(appJs, /if \(pub\.source === "supabase"\) return pub\.participating !== false;/);
assert.match(
  indexHtml,
  /placeholder="Search pubs or towns"/,
  "Search placeholder is Search pubs or towns"
);
assert.ok(
  !indexHtml.includes("Search pubs in Buncrana"),
  "Old Buncrana-only placeholder is gone"
);
assert.match(indexHtml, /id="pubList" class="venue-town-list"/);
assert.match(appJs, /function groupPubsByTown\(/);
assert.match(appJs, /function partitionPickerPubs\(/);
assert.match(appJs, /const OTHER_TOWN_HEADING = "Other"/);
assert.match(appJs, /data-town-group=/);
assert.match(appJs, /data-coming-soon="true"/);
assert.match(stylesCss, /#customer \.venue-town-heading/);
assert.match(indexHtml, /How PintDrop works/);
assert.match(indexHtml, /Buy them a pint from anywhere in the world/);
assert.match(stylesCss, /#customer \.how-pintdrop-works-steps/);

const start = appJs.indexOf("function isPintDropTestPub");
const end = appJs.indexOf("async function loadPubs");
assert.ok(start > 0 && end > start, "Town grouping helpers are present");
const sandbox = {};
vm.runInNewContext(`
function sortPubs(list) { return [...list]; }
${appJs.slice(start, end)}
this.pubTownHeading = pubTownHeading;
this.groupPubsByTown = groupPubsByTown;
this.partitionPickerPubs = partitionPickerPubs;
this.isComingSoonPickerPub = isComingSoonPickerPub;
this.isCustomerVisiblePub = isCustomerVisiblePub;
this.applyCustomerPubFilter = applyCustomerPubFilter;
this.OTHER_TOWN_HEADING = OTHER_TOWN_HEADING;
`, sandbox);

const customerVisible = sandbox.applyCustomerPubFilter([
  { id: "oflahertys", name: "O'Flaherty's Bar", source: "supabase", participating: true },
  { id: "thecottagebar", name: "The Cottage Bar", town: "Letterkenny", source: "supabase", participating: true },
  { id: "pintdroptestpub", name: "PintDrop Test Pub", source: "supabase", participating: true },
  { id: "inactivepub", name: "Inactive Pub", source: "supabase", participating: false },
  { id: "drift", name: "The Drift Inn", source: "demo", participating: true },
  { id: "local", name: "Your Local", source: "demo", participating: false }
]);
assert.ok(customerVisible.some(pub => pub.id === "thecottagebar"), "Approved Supabase pubs such as The Cottage remain visible");
assert.ok(!customerVisible.some(pub => pub.id === "pintdroptestpub"), "PintDrop test pubs remain hidden");
assert.ok(!customerVisible.some(pub => pub.id === "inactivepub"), "Inactive Supabase pubs remain hidden");
assert.ok(!customerVisible.some(pub => pub.id === "drift"), "Participating demo pubs are not exposed as live venues");

assert.strictEqual(sandbox.pubTownHeading({ town: "Buncrana" }), "Buncrana");
assert.strictEqual(sandbox.pubTownHeading({ town: "  " }), "Other");
assert.strictEqual(sandbox.pubTownHeading({}), "Other");

const grouped = sandbox.groupPubsByTown([
  { id: "oflahertys", name: "O'Flaherty's Bar", town: "Buncrana" },
  { id: "harbour", name: "Harbour Inn", town: "Buncrana" },
  { id: "carn", name: "A Pub", town: "Carndonagh" },
  { id: "mystery", name: "No Town Pub", town: "" }
]);

assert.strictEqual(
  grouped.map(group => String(group.town)).join("|"),
  "Buncrana|Carndonagh|Other",
  "Towns sort A-Z with Other last"
);
assert.strictEqual(
  grouped.find(group => group.town === "Buncrana").pubs.map(pub => pub.id).join("|"),
  "oflahertys|harbour"
);
assert.strictEqual(String(grouped.find(group => group.town === "Other").pubs[0].id), "mystery");
assert.ok(grouped.every(group => group.pubs.length > 0), "No empty town groups");

const visibleOnly = sandbox.groupPubsByTown([
  { id: "oflahertys", name: "O'Flaherty's Bar", town: "Buncrana" },
  { id: "local", name: "Your Local", town: "Coming soon" }
]);
assert.ok(!visibleOnly.some(group => group.pubs.some(pub => pub.id === "drift")));
assert.ok(visibleOnly.some(group => group.town === "Buncrana"));
assert.ok(
  !visibleOnly.some(group => /coming soon/i.test(group.town)),
  "Coming soon is not a town heading"
);

const partitioned = sandbox.partitionPickerPubs([
  { id: "oflahertys", name: "O'Flaherty's Bar", town: "Buncrana" },
  { id: "local", name: "Your Local", town: "Coming soon" }
]);
assert.strictEqual(partitioned.townPubs.map(pub => pub.id).join("|"), "oflahertys");
assert.strictEqual(partitioned.comingSoonPubs.map(pub => pub.id).join("|"), "local");
assert.ok(sandbox.isComingSoonPickerPub({ id: "local", town: "Coming soon" }));
assert.ok(!sandbox.isComingSoonPickerPub({ id: "oflahertys", town: "Buncrana" }));

console.log("customer pub town grouping tests passed");
