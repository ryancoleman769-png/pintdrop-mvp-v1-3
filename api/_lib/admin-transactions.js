const {
  handleOptions,
  sendJson,
  requireAdminAuth,
  requireSupabaseServiceRole,
  getSupabaseUrl
} = require("./connect-helpers");
const { requireAdminReportingEnv, requireGet } = require("./admin-guard");

const DUBLIN_TZ = "Europe/Dublin";
const MAX_ROWS = 2000;
const VOUCHER_SELECT = [
  "created_at",
  "pub_id",
  "pub_name",
  "code",
  "drink_name",
  "drink_price",
  "service_fee",
  "total",
  "status",
  "redeemed_at",
  "stripe_checkout_session_id"
].join(",");

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function moneyNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function addMoney(left, right) {
  return moneyNumber(moneyNumber(left) + moneyNumber(right));
}

function formatMoney(value) {
  return moneyNumber(value).toFixed(2);
}

function emptyTotals() {
  return { count: 0, drinkValue: 0, serviceFee: 0, total: 0 };
}

function addToBucket(bucket, row) {
  bucket.count += 1;
  bucket.drinkValue = addMoney(bucket.drinkValue, row.drinkValue);
  bucket.serviceFee = addMoney(bucket.serviceFee, row.serviceFee);
  bucket.total = addMoney(bucket.total, row.total);
}

function mapVoucherStatus(status) {
  return String(status || "").trim().toLowerCase() === "redeemed" ? "REDEEMED" : "VALID";
}

function stripeModeFromSessionId(sessionId) {
  const value = String(sessionId || "").trim();
  if (value.startsWith("cs_live_")) return "live";
  if (value.startsWith("cs_test_")) return "test";
  return "unknown";
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - date.getTime();
}

function dublinLocalToUtc(ymd, hour = 0, minute = 0, second = 0, ms = 0) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), DUBLIN_TZ);
  return new Date(utcGuess - offset);
}

function nextYmd(ymd) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function dublinYmd(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DUBLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}

function formatDublinDateTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DUBLIN_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(iso));
}

function isoWeekFromYmd(ymd) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const utcDay = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - utcDay);
  const isoYear = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - 3);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (date) => date.toISOString().slice(0, 10);
  const key = `${isoYear}-W${String(week).padStart(2, "0")}`;
  return {
    key,
    label: `${key} (${fmt(monday)} – ${fmt(sunday)})`
  };
}

function mapTransactionRow(row) {
  return {
    createdAt: row.created_at || null,
    createdAtLabel: formatDublinDateTime(row.created_at),
    pubId: Number(row.pub_id) || 0,
    pubName: String(row.pub_name || "").trim() || "Unknown pub",
    code: String(row.code || "").trim(),
    drinkName: String(row.drink_name || "").trim() || "PintDrop gift",
    drinkValue: moneyNumber(row.drink_price),
    serviceFee: moneyNumber(row.service_fee),
    total: moneyNumber(row.total),
    status: mapVoucherStatus(row.status),
    redeemedAt: row.redeemed_at || null,
    redeemedAtLabel: formatDublinDateTime(row.redeemed_at),
    stripeCheckoutSessionId: String(row.stripe_checkout_session_id || "").trim(),
    stripeMode: stripeModeFromSessionId(row.stripe_checkout_session_id)
  };
}

function parseAdminTransactionFilters(input = {}) {
  const pubId = Number(input.pubId);
  const from = YMD_PATTERN.test(String(input.from || "").trim()) ? String(input.from).trim() : "";
  const to = YMD_PATTERN.test(String(input.to || "").trim()) ? String(input.to).trim() : "";
  const statusRaw = String(input.status || "all").trim().toUpperCase();
  const stripeRaw = String(input.stripeMode || "all").trim().toLowerCase();

  return {
    pubId: Number.isFinite(pubId) && pubId > 0 ? pubId : null,
    from,
    to,
    status: statusRaw === "VALID" || statusRaw === "REDEEMED" ? statusRaw : "all",
    stripeMode: stripeRaw === "test" || stripeRaw === "live" ? stripeRaw : "all"
  };
}

function buildVouchersQuery(filters) {
  const params = new URLSearchParams();
  params.set("select", VOUCHER_SELECT);
  params.set("order", "created_at.desc");
  params.set("limit", String(MAX_ROWS));

  if (filters.pubId) {
    params.set("pub_id", `eq.${filters.pubId}`);
  }
  if (filters.status === "VALID") {
    params.set("status", "eq.waiting");
  } else if (filters.status === "REDEEMED") {
    params.set("status", "eq.redeemed");
  }

  const fromIso = filters.from ? dublinLocalToUtc(filters.from).toISOString() : "";
  const toIso = filters.to ? dublinLocalToUtc(nextYmd(filters.to)).toISOString() : "";
  if (fromIso && toIso) {
    params.set("and", `(created_at.gte.${fromIso},created_at.lt.${toIso})`);
  } else if (fromIso) {
    params.set("created_at", `gte.${fromIso}`);
  } else if (toIso) {
    params.set("created_at", `lt.${toIso}`);
  }

  if (filters.stripeMode === "test") {
    params.set("stripe_checkout_session_id", "like.cs_test_%");
  } else if (filters.stripeMode === "live") {
    params.set("stripe_checkout_session_id", "like.cs_live_%");
  }

  return params;
}

function summarizeTransactions(rows) {
  const dailyMap = new Map();
  const weeklyMap = new Map();
  const pubMap = new Map();
  const overall = emptyTotals();

  for (const row of rows) {
    addToBucket(overall, row);

    const day = dublinYmd(row.createdAt) || "unknown";
    if (!dailyMap.has(day)) dailyMap.set(day, { date: day, ...emptyTotals() });
    addToBucket(dailyMap.get(day), row);

    const week = isoWeekFromYmd(day === "unknown" ? "1970-01-01" : day);
    if (!weeklyMap.has(week.key)) {
      weeklyMap.set(week.key, { week: week.key, label: week.label, ...emptyTotals() });
    }
    addToBucket(weeklyMap.get(week.key), row);

    const pubKey = String(row.pubId || row.pubName);
    if (!pubMap.has(pubKey)) {
      pubMap.set(pubKey, { pubId: row.pubId, pubName: row.pubName, ...emptyTotals() });
    }
    addToBucket(pubMap.get(pubKey), row);
  }

  return {
    overall,
    daily: [...dailyMap.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    weekly: [...weeklyMap.values()].sort((a, b) => String(b.week).localeCompare(String(a.week))),
    pubs: [...pubMap.values()].sort((a, b) => String(a.pubName).localeCompare(String(b.pubName)))
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function transactionsToCsv(rows) {
  const header = [
    "Date/time (Europe/Dublin)",
    "Pub",
    "Pub ID",
    "Voucher code",
    "Gift/drink",
    "Drink value",
    "Service fee",
    "Customer total",
    "Status",
    "Redeemed date/time (Europe/Dublin)",
    "Stripe Checkout Session ID",
    "Stripe mode"
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.createdAtLabel,
      row.pubName,
      row.pubId,
      row.code,
      row.drinkName,
      formatMoney(row.drinkValue),
      formatMoney(row.serviceFee),
      formatMoney(row.total),
      row.status,
      row.redeemedAtLabel,
      row.stripeCheckoutSessionId,
      row.stripeMode
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function queryFromRequest(req) {
  const url = new URL(req.url || "/", "https://pintdrop.invalid");
  return {
    ...Object.fromEntries(url.searchParams.entries()),
    ...(req.query || {})
  };
}

async function serviceRestGet(pathname, params, serviceRoleKey) {
  const response = await fetch(`${getSupabaseUrl()}${pathname}?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
      Prefer: "count=exact",
      Range: `0-${MAX_ROWS - 1}`
    }
  });
  let data = [];
  try {
    data = await response.json();
  } catch {
    data = [];
  }
  if (!response.ok) {
    return { ok: false, error: "Could not load transactions." };
  }
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

async function loadAdminPubOptions(serviceRoleKey) {
  const params = new URLSearchParams();
  params.set("select", "id,name");
  params.set("order", "name.asc");
  const loaded = await serviceRestGet("/rest/v1/pubs", params, serviceRoleKey);
  if (!loaded.ok) return [];
  return loaded.rows
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name || "").trim()
    }))
    .filter((row) => Number.isFinite(row.id) && row.id > 0 && row.name);
}

async function loadAdminTransactions(filters, serviceRoleKey) {
  const voucherQuery = buildVouchersQuery(filters);
  const loaded = await serviceRestGet("/rest/v1/vouchers", voucherQuery, serviceRoleKey);
  if (!loaded.ok) return loaded;

  const rows = loaded.rows.map(mapTransactionRow);
  const pubs = await loadAdminPubOptions(serviceRoleKey);
  const knownIds = new Set(pubs.map((pub) => pub.id));
  for (const row of rows) {
    if (row.pubId && !knownIds.has(row.pubId)) {
      pubs.push({ id: row.pubId, name: row.pubName });
      knownIds.add(row.pubId);
    }
  }
  pubs.sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    filters,
    rows,
    pubs,
    totals: summarizeTransactions(rows),
    truncated: loaded.rows.length >= MAX_ROWS
  };
}

function csvFilename(filters) {
  const day = dublinYmd(new Date().toISOString()) || "export";
  const parts = ["pintdrop-transactions", day];
  if (filters.pubId) parts.push(`pub-${filters.pubId}`);
  if (filters.status !== "all") parts.push(filters.status.toLowerCase());
  if (filters.stripeMode !== "all") parts.push(filters.stripeMode);
  return `${parts.join("-")}.csv`;
}

async function handleAdminTransactionsRequest(req, res, { asCsv = false } = {}) {
  if (handleOptions(req, res)) return;
  if (!requireAdminReportingEnv(req, res)) return;
  if (!requireGet(req, res)) return;
  if (!requireAdminAuth(req, res)) return;
  const serviceRoleKey = requireSupabaseServiceRole(res);
  if (!serviceRoleKey) return;

  try {
    const filters = parseAdminTransactionFilters(queryFromRequest(req));
    const result = await loadAdminTransactions(filters, serviceRoleKey);
    if (!result.ok) {
      sendJson(res, 500, { ok: false, error: result.error || "Could not load transactions." });
      return;
    }

    if (asCsv) {
      const csv = transactionsToCsv(result.rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${csvFilename(filters)}"`);
      res.status(200).send(csv);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      filters: result.filters,
      rows: result.rows,
      pubs: result.pubs,
      totals: result.totals,
      truncated: result.truncated
    });
  } catch (error) {
    console.error("[admin/transactions]", error);
    sendJson(res, 500, { ok: false, error: "Could not load transactions." });
  }
}

module.exports = {
  DUBLIN_TZ,
  MAX_ROWS,
  VOUCHER_SELECT,
  moneyNumber,
  mapVoucherStatus,
  stripeModeFromSessionId,
  mapTransactionRow,
  parseAdminTransactionFilters,
  buildVouchersQuery,
  summarizeTransactions,
  transactionsToCsv,
  dublinLocalToUtc,
  dublinYmd,
  isoWeekFromYmd,
  loadAdminTransactions,
  handleAdminTransactionsRequest
};

