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

assert.match(
  appJs,
  /const CUSTOMER_VISIBLE_PUB_IDS = new Set\(\["oflahertys", "local"\]\);/,
  "Customer visibility allowlist is unchanged"
);
assert.ok(
  !/CUSTOMER_VISIBLE_PUB_IDS = new Set\([^)]*drift/.test(appJs),
  "Drift Inn is not in the customer visibility allowlist"
);
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

const start = appJs.indexOf("const OTHER_TOWN_HEADING");
const end = appJs.indexOf("async function loadPubs");
assert.ok(start > 0 && end > start, "Town grouping helpers are present");
const sandbox = {};
vm.runInNewContext(`${appJs.slice(start, end)}\nthis.pubTownHeading = pubTownHeading;\nthis.groupPubsByTown = groupPubsByTown;\nthis.partitionPickerPubs = partitionPickerPubs;\nthis.isComingSoonPickerPub = isComingSoonPickerPub;\nthis.OTHER_TOWN_HEADING = OTHER_TOWN_HEADING;`, sandbox);

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
