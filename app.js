const DEMO_PUBS = [
  { id: "oflahertys", supabaseId: 8, name: "O'Flaherty's Bar", town: "Buncrana", icon: "🍺", image: "images/oflahertys-bar.jpg", participating: true },
  { id: "drift", name: "The Drift Inn", town: "Buncrana", icon: "🍻", participating: true },
  { id: "local", name: "Your Local", town: "Coming soon", icon: "📍", participating: false }
];

let pubs = DEMO_PUBS.map(pub => ({ ...pub }));

function sortPubs(list) {
  return [...list].sort((a, b) => {
    if (a.id === PARTNER_PUB_ID) return -1;
    if (b.id === PARTNER_PUB_ID) return 1;
    if (Boolean(a.participating) !== Boolean(b.participating)) {
      return a.participating ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "en");
  });
}

function isPintDropTestPub(pub) {
  const name = String(pub?.name || "").toLowerCase();
  const id = String(pub?.id || "").toLowerCase();
  const slug = String(pub?.slug || "").toLowerCase();
  return /pintdrop\s*test/.test(name)
    || id.includes("pintdroptest")
    || slug.includes("pintdroptest");
}

function isCustomerVisiblePub(pub) {
  if (!pub?.id || isPintDropTestPub(pub)) return false;
  if (pub.source === "supabase") return pub.participating !== false;
  return pub.id === "local" || pub.id === "oflahertys";
}

function applyCustomerPubFilter(list) {
  const visible = (list || []).filter(isCustomerVisiblePub);
  const byId = new Map();

  for (const pub of visible) {
    const existing = byId.get(pub.id);
    if (!existing || (pub.source === "supabase" && existing.source !== "supabase")) {
      byId.set(pub.id, pub);
    }
  }

  return sortPubs([...byId.values()]);
}

const OTHER_TOWN_HEADING = "Other";

function isComingSoonPickerPub(pub) {
  return pub?.id === "local" || /^coming soon$/i.test(String(pub?.town || "").trim());
}

function pubTownHeading(pub) {
  const town = String(pub?.town || "").trim();
  if (!town || /^coming soon$/i.test(town)) return OTHER_TOWN_HEADING;
  return town;
}

function partitionPickerPubs(list) {
  const townPubs = [];
  const comingSoonPubs = [];
  for (const pub of list) {
    if (isComingSoonPickerPub(pub)) comingSoonPubs.push(pub);
    else townPubs.push(pub);
  }
  return { townPubs, comingSoonPubs };
}

function groupPubsByTown(list) {
  const groups = new Map();
  for (const pub of list) {
    if (isComingSoonPickerPub(pub)) continue;
    const town = pubTownHeading(pub);
    if (!groups.has(town)) groups.set(town, []);
    groups.get(town).push(pub);
  }

  return [...groups.keys()]
    .sort((a, b) => {
      if (a === OTHER_TOWN_HEADING) return 1;
      if (b === OTHER_TOWN_HEADING) return -1;
      return a.localeCompare(b, "en");
    })
    .map(town => ({ town, pubs: groups.get(town) }))
    .filter(group => group.pubs.length > 0);
}

async function loadPubs() {
  pubs = DEMO_PUBS.map(pub => ({ ...pub }));

  if (!window.PintDropSupabase?.isConfigured?.()) {
    pubs = applyCustomerPubFilter(pubs);
    return;
  }

  try {
    const remotePubs = await window.PintDropSupabase.fetchPubs();
    if (remotePubs?.length) {
      const remoteById = new Map(remotePubs.map(pub => [pub.id, pub]));
      const demoOnly = DEMO_PUBS.filter(pub => !remoteById.has(pub.id));
      pubs = applyCustomerPubFilter([
        ...remotePubs,
        ...demoOnly.map(pub => ({ ...pub, source: "demo" }))
      ]);
      return;
    }
  } catch (error) {
    console.warn("[PintDrop] Using demo pubs after Supabase error:", error);
  }

  pubs = applyCustomerPubFilter(pubs);
}

const DEMO_GIFTS = [
  { id: "pint", name: "Pint", price: 6.00, icon: "🍺" },
  { id: "wine", name: "Glass of Wine", price: 7.00, icon: "🍷" },
  { id: "cocktail", name: "Cocktail", price: 10.00, icon: "🍸" },
  { id: "spirit", name: "Spirit & Mixer", price: 9.00, icon: "🥃" }
];

const BAR_TAB_PRESETS = window.PintDropSupabase?.BAR_TAB_PRESET_PRICES || [20, 30, 50];

function barTabPresetFromSlug(slug) {
  const match = /^tab-(20|30|50)$/.exec(String(slug || "").trim().toLowerCase());
  return match ? Number(match[1]) : null;
}

function isExactBarTabPreset(price) {
  return BAR_TAB_PRESETS.includes(Number(price));
}

function isBarTabSlug(slug) {
  const value = String(slug || "").trim().toLowerCase();
  return value === "tab" || value.startsWith("tab-");
}

function isBarTabGift(gift) {
  if (!gift) return false;
  if (gift.is_bar_tab || isBarTabSlug(gift.id) || isBarTabSlug(gift.slug)) return true;
  return String(gift.name || "").toLowerCase().includes("bar tab");
}

function hasSavedDrinkSupabaseId(gift) {
  const supabaseId = Number(gift?.supabaseId);
  return Number.isFinite(supabaseId) && supabaseId > 0;
}

function formatBarTabGiftName(price) {
  return `€${price} Bar Tab`;
}

function normalizeCustomerGifts(list) {
  const standard = [];
  const tabs = new Map();

  (list || []).forEach((gift) => {
    if (!isBarTabGift(gift)) {
      standard.push(gift);
      return;
    }
    if (gift.active === false || gift.active === 0) return;
    // Only offer Bar Tab amounts that exist as saved drinks rows for this pub.
    if (!hasSavedDrinkSupabaseId(gift)) return;

    const slugPreset = barTabPresetFromSlug(gift.id || gift.slug);
    const price = Number(gift.price);

    if (slugPreset) {
      if (price !== slugPreset) return;
      tabs.set(slugPreset, {
        ...gift,
        id: `tab-${slugPreset}`,
        price: slugPreset,
        name: formatBarTabGiftName(slugPreset),
        icon: gift.icon || "💶"
      });
      return;
    }

    if (!isExactBarTabPreset(price) || tabs.has(price)) return;
    tabs.set(price, {
      ...gift,
      id: `tab-${price}`,
      price,
      name: formatBarTabGiftName(price),
      icon: gift.icon || "💶"
    });
  });

  return [
    ...standard,
    ...BAR_TAB_PRESETS.filter((price) => tabs.has(price)).map((price) => tabs.get(price))
  ];
}

let gifts = normalizeCustomerGifts(DEMO_GIFTS.map(gift => ({ ...gift })));

async function loadGiftsForPub(pub) {
  gifts = normalizeCustomerGifts(DEMO_GIFTS.map(gift => ({ ...gift, source: "demo" })));

  if (!pub?.supabaseId || !window.PintDropSupabase?.isConfigured?.()) {
    ensureSelectedGiftValid();
    return;
  }

  try {
    const remoteGifts = await window.PintDropSupabase.fetchDrinks(pub.supabaseId);
    if (remoteGifts?.length) {
      gifts = normalizeCustomerGifts(remoteGifts);
      if (pub.offersBarTab === false) {
        gifts = gifts.filter((gift) => !isBarTabGift(gift));
      }
    }
  } catch (error) {
    console.warn("[PintDrop] Using demo drinks after Supabase error:", error);
  }

  ensureSelectedGiftValid();
}

function ensureSelectedGiftValid() {
  if (!gifts.length) {
    selectedGift = null;
    return;
  }
  const previousId = selectedGift?.id;
  selectedGift = (previousId && gifts.find(gift => gift.id === previousId)) || gifts[0];
}

const SERVICE_FEE_RATE = 0.15;

function calculateServiceFee(menuPrice) {
  const price = Number(menuPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  return Math.round(price * SERVICE_FEE_RATE * 100) / 100;
}

function calculateOrderTotal(menuPrice) {
  const price = Number(menuPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }
  return Math.round((price + calculateServiceFee(price)) * 100) / 100;
}

const PENDING_ORDER_STORAGE_KEY = "pintdrop_pending_order";
const LOGO = {
  mark: "images/pintdrop-mark.png",
  full: "images/pintdrop-logo.png"
};
const DEMO = {
  sender: "",
  senderEmail: "",
  recipient: "",
  phone: "",
  phoneCountry: "IE",
  message: ""
};
let selectedPub = pubs[0];
let selectedGift = gifts[0];
let pendingOrder = null;
let paymentProcessing = false;
let customerSubStep = "pub";
let activeRedemptionVoucherId = null;
let activeRedemptionVoucher = null;
let pendingBarTabRedeemAmount = null;
let redemptionJustConfirmed = false;
let partnerActivityFilter = "today";
let partnerHistoryFilter = "today";
let partnerTraceabilityFilter = "today";

const PARTNER_PUB_ID = "oflahertys";
const PARTNER_SUPABASE_PUB_ID = 8;
const PARTNER_DRINK_SUPABASE_IDS = {
  pint: 35,
  wine: 36,
  cocktail: 37,
  spirit: 38,
  tab: 39
};
const PARTNER_DEMO_SEED_KEY = "pintdrop_partner_demo_seeded";
const PARTNER_SHIFT_STORAGE_KEY = "pintdrop_partner_shift";
const PARTNER_PENDING_REDEEM_KEY = "pintdrop_partner_pending_redeem";
const PARTNER_SHIFT_DURATION_MS = 12 * 60 * 60 * 1000;
const PARTNER_AUTH_TIMEOUT_MS = 15000;
const PARTNER_AUTH_STALL_MESSAGE = "Sign-in stalled. Check your connection and try again.";

let partnerVouchers = null;
let partnerVouchersLoadError = null;
const partnerAccountingReports = new Map();
let partnerAccountingLoadError = null;
let publicVoucherDisplay = null;
let partnerQrScanActive = false;
let partnerQrScanHandling = false;
let partnerQrScanFrameId = null;
let partnerQrDecodeCanvas = null;
let partnerQrDecodeContext = null;
let partnerQrDecodeInFlight = false;
let partnerZxingReader = null;
let partnerStripeConnectData = null;
let partnerMenuData = null;
let partnerMenuLoading = false;
let partnerSession = null;
let partnerProfile = null;
let partnerProfileOwnerUserId = null;
let partnerProfileLoadError = false;
let partnerOnboardingStatus = null;
let partnerPendingConfirmEmail = "";
let partnerUnconfirmedLogin = false;
let partnerForcedScreen = null;
let partnerAuthAttemptDepth = 0;
let partnerShiftExpireInFlight = false;
let partnerAuthReady = false;
let partnerAuthUnsubscribe = null;

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR"
}).format(value);

function readVouchers() {
  try {
    return JSON.parse(localStorage.getItem("pintdrop_vouchers") || "[]");
  } catch {
    return [];
  }
}

function writeVouchers(vouchers) {
  localStorage.setItem("pintdrop_vouchers", JSON.stringify(vouchers));
}

function createCode() {
  return "PD-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function formatDateTime(iso) {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })} at ${date.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}`;
}

function isToday(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();
}

function startOfWeek(date = new Date()) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function isThisWeek(iso) {
  if (!iso) return false;
  return new Date(iso) >= startOfWeek();
}

function isThisMonth(iso) {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function daysAgo(days, hours = 12, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function giftById(id) {
  return gifts.find(gift => gift.id === id)
    || DEMO_GIFTS.find(gift => gift.id === id)
    || gifts[0]
    || DEMO_GIFTS[0];
}

function partnerPub() {
  return pubs.find(pub => pub.id === PARTNER_PUB_ID) || pubs[0];
}

function isPartnerVoucher(voucher) {
  return voucher?.pub?.id === PARTNER_PUB_ID;
}

function getVoucherActivityTime(voucher) {
  return voucher.status === "redeemed" && voucher.redeemedAt
    ? voucher.redeemedAt
    : voucher.createdAt;
}

function voucherMatchesPeriod(voucher, period) {
  const activityTime = getVoucherActivityTime(voucher);
  if (period === "today") return isToday(activityTime);
  if (period === "week") return isThisWeek(activityTime);
  if (period === "month") return isThisMonth(activityTime);
  return true;
}

function voucherSoldInPeriod(voucher, period) {
  if (period === "today") return isToday(voucher.createdAt);
  if (period === "week") return isThisWeek(voucher.createdAt);
  if (period === "month") return isThisMonth(voucher.createdAt);
  return true;
}

function formatActivityWhen(iso) {
  const date = new Date(iso);
  return {
    date: date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })
  };
}

function buildDemoVoucher({
  id,
  code,
  recipient,
  sender,
  message,
  giftId,
  createdAt,
  redeemedAt = null,
  status = "waiting"
}) {
  const gift = giftById(giftId);
  const resolvedStatus = redeemedAt ? "redeemed" : status;
  return {
    id,
    code,
    pub: partnerPub(),
    gift,
    recipient,
    phone: "+353 87 000 0000",
    sender,
    message,
    deliveryDate: createdAt.slice(0, 10),
    fee: calculateServiceFee(gift.price),
    total: calculateOrderTotal(gift.price),
    createdAt,
    expiresAt: null,
    status: resolvedStatus,
    redeemedAt
  };
}

function partnerDemoSeedVouchers() {
  const pub = partnerPub();
  return [
    buildDemoVoucher({
      id: "demo-pd-8w8s3",
      code: "PD-8W8S3",
      recipient: "Dad",
      sender: "Ryan",
      message: "Happy birthday Dad — have one on me 🍻",
      giftId: "pint",
      createdAt: daysAgo(0, 11, 15),
      redeemedAt: daysAgo(0, 13, 30),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-k4m2n",
      code: "PD-K4M2N",
      recipient: "Sarah",
      sender: "Emma",
      message: "Enjoy a glass on us tonight!",
      giftId: "wine",
      createdAt: daysAgo(0, 9, 40),
      status: "waiting"
    }),
    buildDemoVoucher({
      id: "demo-pd-r7t1p",
      code: "PD-R7T1P",
      recipient: "Michael",
      sender: "Aoife",
      message: "Thanks for covering last week — cheers!",
      giftId: "cocktail",
      createdAt: daysAgo(1, 18, 20),
      redeemedAt: daysAgo(1, 20, 5),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-h9c6v",
      code: "PD-H9C6V",
      recipient: "Niamh",
      sender: "Conor",
      message: "See you at the bar soon 🍸",
      giftId: "spirit",
      createdAt: daysAgo(2, 14, 10),
      status: "waiting"
    }),
    buildDemoVoucher({
      id: "demo-pd-b3x8q",
      code: "PD-B3X8Q",
      recipient: "Patrick",
      sender: "Megan",
      message: "Happy Friday pint!",
      giftId: "pint",
      createdAt: daysAgo(3, 17, 45),
      redeemedAt: daysAgo(3, 19, 10),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-w2n5j",
      code: "PD-W2N5J",
      recipient: "Ciara",
      sender: "James",
      message: "Catch up soon x",
      giftId: "soft",
      createdAt: daysAgo(4, 13, 0),
      redeemedAt: daysAgo(4, 15, 25),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-f6d1l",
      code: "PD-F6D1L",
      recipient: "Tom",
      sender: "Lisa",
      message: "One for the road!",
      giftId: "pint",
      createdAt: daysAgo(6, 16, 30),
      status: "waiting"
    }),
    buildDemoVoucher({
      id: "demo-pd-m8p4s",
      code: "PD-M8P4S",
      recipient: "Grainne",
      sender: "Sean",
      message: "Congratulations on the new job!",
      giftId: "wine",
      createdAt: daysAgo(10, 12, 0),
      redeemedAt: daysAgo(9, 19, 40),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-v5k2r",
      code: "PD-V5K2R",
      recipient: "Declan",
      sender: "Orla",
      message: "Weekend treat 🥃",
      giftId: "spirit",
      createdAt: daysAgo(18, 20, 15),
      redeemedAt: daysAgo(17, 21, 0),
      status: "redeemed"
    }),
    buildDemoVoucher({
      id: "demo-pd-j3h7t",
      code: "PD-J3H7T",
      recipient: "Kate",
      sender: "Brian",
      message: "Thanks for your help moving!",
      giftId: "cocktail",
      createdAt: daysAgo(22, 11, 30),
      status: "waiting"
    }),
    buildDemoVoucher({
      id: "demo-pd-s9l4c",
      code: "PD-S9L4C",
      recipient: "Eoin",
      sender: "Amy",
      message: "Soft drink on me — drive safe!",
      giftId: "soft",
      createdAt: daysAgo(35, 15, 45),
      redeemedAt: daysAgo(35, 17, 10),
      status: "redeemed"
    })
  ].map(voucher => ({ ...voucher, pub }));
}

function seedPartnerDemoData({ force = false } = {}) {
  if (!force && localStorage.getItem(PARTNER_DEMO_SEED_KEY)) return;

  const existing = readVouchers();
  const existingCodes = new Set(existing.map(v => v.code.toUpperCase()));
  const demoVouchers = partnerDemoSeedVouchers().filter(v => !existingCodes.has(v.code.toUpperCase()));
  const merged = [...existing, ...demoVouchers]
    .sort((a, b) => new Date(getVoucherActivityTime(b)) - new Date(getVoucherActivityTime(a)));

  writeVouchers(merged);
  localStorage.setItem(PARTNER_DEMO_SEED_KEY, "1");
}

function getPartnerVouchers() {
  if (!hasActivePartnerProfile()) return [];
  if (Array.isArray(partnerVouchers)) return partnerVouchers;
  return [];
}

function normalizePartnerHistoryError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();

  if (!message) return "Could not load recent redemptions. Please try again.";
  if (lower.includes("partner authentication required")) return "Please sign in again to view redemptions.";
  if (lower.includes("permission denied")) {
    return "Recent redemptions are unavailable right now. Please contact PintDrop support.";
  }
  return message;
}

function mergePartnerVouchersWithLocalDemo(remote) {
  const local = readVouchers().filter(isPartnerVoucher);
  const remoteByCode = new Map(remote.map(voucher => [voucher.code.toUpperCase(), voucher]));
  const demoOnly = local.filter(voucher => !remoteByCode.has(voucher.code.toUpperCase()));
  return [...remote, ...demoOnly]
    .sort((a, b) => new Date(getVoucherActivityTime(b)) - new Date(getVoucherActivityTime(a)));
}

async function loadPartnerVouchers() {
  const local = readVouchers().filter(isPartnerVoucher);
  partnerVouchersLoadError = null;

  if (!window.PintDropSupabase?.isConfigured?.()) {
    partnerVouchers = local;
    return partnerVouchers;
  }

  if (!hasActivePartnerProfile()) {
    partnerVouchers = [];
    return partnerVouchers;
  }

  const auth = getPartnerAuthApi();
  if (!auth?.fetchVouchers) {
    partnerVouchersLoadError = "Recent redemptions are not available in this build.";
    partnerVouchers = [];
    return partnerVouchers;
  }

  try {
    const remote = await auth.fetchVouchers();
    partnerVouchers = Array.isArray(remote) ? remote : [];
    return partnerVouchers;
  } catch (error) {
    console.warn("[PintDrop Partner Vouchers] Load failed:", error);
    partnerVouchersLoadError = normalizePartnerHistoryError(error);
    partnerVouchers = [];
    return partnerVouchers;
  }
}

function isVoucherForPartnerPub(voucher) {
  if (!voucher?.pub) return false;
  if (voucher.pub.id === PARTNER_PUB_ID) return true;
  if (voucher.pub.supabaseId === PARTNER_SUPABASE_PUB_ID) return true;
  return false;
}

function isBarTabVoucher(voucher) {
  if (!voucher) return false;
  if (isBarTabGift(voucher.gift)) return true;
  return String(voucher.gift?.name || "").toLowerCase().includes("bar tab");
}

function formatBarTabAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "€0.00";
  return `€${amount.toFixed(2)}`;
}

function getBarTabOriginal(voucher) {
  if (voucher?.barTab?.original != null && Number.isFinite(Number(voucher.barTab.original))) {
    return Number(voucher.barTab.original);
  }
  return Number(voucher?.gift?.price || 0);
}

function getBarTabRemaining(voucher) {
  if (voucher?.barTab?.remaining != null && Number.isFinite(Number(voucher.barTab.remaining))) {
    return Number(voucher.barTab.remaining);
  }
  if (voucher?.status === "redeemed") return 0;
  return getBarTabOriginal(voucher);
}

function getBarTabTotalRedeemed(voucher) {
  if (voucher?.barTab?.totalRedeemed != null && Number.isFinite(Number(voucher.barTab.totalRedeemed))) {
    return Number(voucher.barTab.totalRedeemed);
  }
  const original = getBarTabOriginal(voucher);
  const remaining = getBarTabRemaining(voucher);
  return Math.max(0, Math.round((original - remaining) * 100) / 100);
}

function getBarTabBalanceDisplay(voucher) {
  return {
    original: getBarTabOriginal(voucher),
    redeemed: getBarTabTotalRedeemed(voucher),
    remaining: getBarTabRemaining(voucher)
  };
}

function fillBarTabBalanceFields(voucher, { panelId, originalId, redeemedId, remainingId } = {}) {
  const panel = $(panelId);
  if (!panel) return;
  const show = isBarTabVoucher(voucher);
  panel.classList.toggle("hidden", !show);
  if (!show) return;

  const balances = getBarTabBalanceDisplay(voucher);
  const originalEl = $(originalId);
  const redeemedEl = $(redeemedId);
  const remainingEl = $(remainingId);
  if (originalEl) originalEl.textContent = formatBarTabAmount(balances.original);
  if (redeemedEl) redeemedEl.textContent = formatBarTabAmount(balances.redeemed);
  if (remainingEl) remainingEl.textContent = formatBarTabAmount(balances.remaining);
}

function isBarTabFullyRedeemed(voucher) {
  return isBarTabVoucher(voucher)
    && (voucher.status === "redeemed" || getBarTabRemaining(voucher) <= 0);
}

function parseRedemptionAmount(raw) {
  const normalized = String(raw ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function validateBarTabRedeemAmount(voucher, amount) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than €0." };
  }
  if (isBarTabFullyRedeemed(voucher)) {
    return { ok: false, error: "This Bar Tab is fully redeemed." };
  }
  if (amount > getBarTabRemaining(voucher) + 0.001) {
    return { ok: false, error: "Amount is more than the remaining balance." };
  }
  return { ok: true, amount };
}

function isBarTabRedeemAmountValid(voucher, rawAmount) {
  const amount = parseRedemptionAmount(rawAmount);
  return validateBarTabRedeemAmount(voucher, amount).ok;
}

function getBarTabRedeemButtonLabel(voucher, rawAmount) {
  const amount = parseRedemptionAmount(rawAmount);
  const check = validateBarTabRedeemAmount(voucher, amount);
  return check.ok ? `Redeem ${formatBarTabAmount(check.amount)}` : "Redeem";
}

function applyBarTabDebit(voucher, rawAmount) {
  if (!isBarTabVoucher(voucher)) {
    return { ok: false, error: "This voucher is not a Bar Tab." };
  }
  const amount = parseRedemptionAmount(rawAmount);
  const check = validateBarTabRedeemAmount(voucher, amount);
  if (!check.ok) return check;

  const remaining = Math.round((getBarTabRemaining(voucher) - check.amount) * 100) / 100;
  const original = getBarTabOriginal(voucher);
  const nextRemaining = Math.max(0, remaining);
  const fullyRedeemed = nextRemaining <= 0;
  return {
    ok: true,
    voucher: {
      ...voucher,
      status: fullyRedeemed ? "redeemed" : "waiting",
      redeemedAt: fullyRedeemed
        ? (voucher.redeemedAt || new Date().toISOString())
        : voucher.redeemedAt,
      barTab: {
        original,
        remaining: nextRemaining,
        totalRedeemed: Math.round((original - nextRemaining) * 100) / 100,
        redemptions: [
          ...(voucher.barTab?.redemptions || []),
          { amount_redeemed: check.amount, remaining_balance: nextRemaining }
        ]
      }
    },
    redemption: {
      amount_redeemed: check.amount,
      remaining_balance: nextRemaining
    }
  };
}

function formatBarTabNoticeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "€0";
  const cents = Math.round(amount * 100);
  if (cents % 100 === 0) return `€${cents / 100}`;
  return `€${(cents / 100).toFixed(2)}`;
}

function isFiniteBarTabAmount(value) {
  return value != null && Number.isFinite(Number(value));
}

function getBarTabStaffScreenState(voucher, options) {
  const lastBarTabRedemption = options && options.lastBarTabRedemption;
  const hasConfirmedDebit = isFiniteBarTabAmount(lastBarTabRedemption && lastBarTabRedemption.amount_redeemed);
  const remainingFromDebit = hasConfirmedDebit && isFiniteBarTabAmount(lastBarTabRedemption.remaining_balance)
    ? Number(lastBarTabRedemption.remaining_balance)
    : null;
  const remaining = remainingFromDebit != null ? remainingFromDebit : getBarTabRemaining(voucher);
  const fullyRedeemed = isBarTabFullyRedeemed(voucher) || remaining <= 0;

  if (fullyRedeemed) {
    return {
      hero: "❌ BAR TAB USED — DO NOT ACCEPT",
      tone: "used",
      instruction: "Enter the amount being spent now",
      allowDebit: false,
      fullyRedeemed: true,
      showConfirmed: false,
      redeemedNow: null,
      remaining
    };
  }

  if (hasConfirmedDebit) {
    return {
      hero: "REDEMPTION CONFIRMED",
      tone: "confirmed",
      instruction: "Enter the amount being spent now",
      allowDebit: false,
      fullyRedeemed: false,
      showConfirmed: true,
      redeemedNow: Number(lastBarTabRedemption.amount_redeemed),
      remaining
    };
  }

  return {
    hero: "Voucher scanned — NOT YET REDEEMED",
    tone: "waiting",
    instruction: "Enter the amount being spent now",
    allowDebit: true,
    fullyRedeemed: false,
    showConfirmed: false,
    redeemedNow: null,
    remaining
  };
}

function getLatestBarTabRedemption(voucher, redemption) {
  if (isFiniteBarTabAmount(redemption?.amount_redeemed)) {
    return {
      amount: Number(redemption.amount_redeemed),
      remaining: isFiniteBarTabAmount(redemption.remaining_balance)
        ? Number(redemption.remaining_balance)
        : getBarTabRemaining(voucher)
    };
  }

  const ledger = voucher?.barTab?.redemptions;
  if (Array.isArray(ledger) && ledger.length) {
    const last = ledger[ledger.length - 1];
    if (isFiniteBarTabAmount(last?.amount_redeemed)) {
      return {
        amount: Number(last.amount_redeemed),
        remaining: isFiniteBarTabAmount(last.remaining_balance)
          ? Number(last.remaining_balance)
          : getBarTabRemaining(voucher)
      };
    }
  }

  return null;
}

function buildSenderNotificationText(voucher, redemption) {
  if (!isBarTabVoucher(voucher)) {
    return `${voucher.recipient} has just redeemed the ${voucher.gift.name} you sent at ${voucher.pub.name}.`;
  }

  const latest = getLatestBarTabRedemption(voucher, redemption);
  const originalText = formatBarTabNoticeAmount(getBarTabOriginal(voucher));
  const remaining = latest ? latest.remaining : getBarTabRemaining(voucher);
  const remainingText = formatBarTabNoticeAmount(remaining);
  const remainingClause = remaining <= 0
    ? `Remaining balance: ${remainingText}.`
    : `${remainingText} remaining.`;

  if (latest) {
    return `${voucher.recipient} has just redeemed ${formatBarTabNoticeAmount(latest.amount)} from the ${originalText} Bar Tab you sent at ${voucher.pub.name}. ${remainingClause}`;
  }

  return `${voucher.recipient} has just redeemed the ${originalText} Bar Tab you sent at ${voucher.pub.name}. ${remainingClause}`;
}

function storePendingPartnerRedemption(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return;
  try {
    sessionStorage.setItem(PARTNER_PENDING_REDEEM_KEY, normalized);
  } catch (error) {
    console.warn("[PintDrop Partner Redemption] Could not store pending code:", error);
  }
}

function consumePendingPartnerRedemption() {
  try {
    const code = sessionStorage.getItem(PARTNER_PENDING_REDEEM_KEY);
    sessionStorage.removeItem(PARTNER_PENDING_REDEEM_KEY);
    return code || null;
  } catch {
    return null;
  }
}

function showPartnerLoginRedemptionNotice(code) {
  const errorEl = $("partnerLoginError");
  if (errorEl) {
    errorEl.textContent = code
      ? `Sign in to redeem voucher ${code}.`
      : "Sign in to redeem this voucher.";
    errorEl.classList.remove("hidden");
  }
  if ($("redeemCode") && code) {
    $("redeemCode").value = code;
  }
}

function normalizePartnerRedemptionError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();

  if (!message) return "Could not redeem this voucher. Please try again.";
  if (lower.includes("partner authentication required")) {
    return "Please sign in to redeem vouchers.";
  }
  if (lower.includes("expired")) return "This voucher is not redeemable.";
  if (lower.includes("permission denied")) {
    return "Redemption is unavailable right now. Please contact PintDrop support.";
  }
  if (lower.includes("exceeds remaining") || lower.includes("more than the remaining")) {
    return "Amount is more than the remaining balance.";
  }
  if (lower.includes("greater than zero") || lower.includes("must be greater than")) {
    return "Enter an amount greater than €0.";
  }
  if (lower.includes("fully redeemed") || lower.includes("already be fully redeemed")) {
    return "This Bar Tab is fully redeemed.";
  }
  if (lower.includes("not a bar tab")) {
    return "This voucher is not a Bar Tab.";
  }
  return message;
}

async function findPartnerVoucherByCode(code) {
  const normalized = (code || "").trim().toUpperCase();
  if (!normalized) return null;

  if (window.PintDropSupabase?.isConfigured?.()) {
    if (!hasActivePartnerProfile()) {
      return null;
    }

    const auth = getPartnerAuthApi();
    if (!auth?.fetchVoucherForRedemption) {
      throw new Error("Partner voucher lookup is not available in this build.");
    }

    return auth.fetchVoucherForRedemption(normalized);
  }

  return readVouchers().find(v => v.code.toUpperCase() === normalized) || null;
}

async function resumePendingPartnerRedemptionIfAny() {
  const code = consumePendingPartnerRedemption();
  if (!code || !hasActivePartnerProfile()) return;
  await processBarRedemption(code, { updateHash: true });
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

async function applyDemoDefaults() {
  selectedPub = pubs.find(pub => pub.participating) || pubs[0];
  await loadGiftsForPub(selectedPub);
  selectedGift = gifts[0];
  customerSubStep = "pub";
  $("recipientName").value = DEMO.recipient;
  if ($("recipientPhoneCountry")) $("recipientPhoneCountry").value = DEMO.phoneCountry;
  $("recipientPhone").value = DEMO.phone;
  if ($("recipientEmail")) $("recipientEmail").value = "";
  $("senderName").value = DEMO.sender;
  if ($("senderEmail")) $("senderEmail").value = DEMO.senderEmail;
  if ($("message")) $("message").value = "";
  setCustomerSubStep("pub");
  resetSuccessDeliveryState();
  renderChoices();
  renderSummary();
  clearStepErrors();
}

function pulseStatusBadge(element) {
  if (!element || element.textContent !== "VALID") return;
  element.classList.remove("status-pulse");
  void element.offsetWidth;
  element.classList.add("status-pulse");
}

const PROCESSING_STEPS = ["procStep1", "procStep2", "procStep3", "procStep4"];
const PROCESSING_LABELS = [
  "Authorising payment…",
  "Creating voucher…",
  "Sending SMS…",
  "PintDrop sent"
];

function setProcessingStep(stepIndex) {
  PROCESSING_STEPS.forEach((id, index) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("done", index < stepIndex);
    el.classList.toggle("active", index === stepIndex);
  });
  const title = $("processingTitle");
  if (title && stepIndex > 0 && stepIndex <= PROCESSING_LABELS.length) {
    title.textContent = PROCESSING_LABELS[stepIndex - 1];
  } else if (title) {
    title.textContent = "Processing payment…";
  }
}

function resetProcessingSteps() {
  PROCESSING_STEPS.forEach((id) => {
    const el = $(id);
    el?.classList.remove("done", "active");
  });
  if ($("processingTitle")) $("processingTitle").textContent = "Processing payment…";
}

function removeLegacyPaymentCollectors() {
  document.getElementById("paymentStep")?.remove();
  document.getElementById("paymentForm")?.remove();
}

function setPurchaseStep(step) {
  const steps = ["details", "review", "success"];
  steps.forEach(name => {
    $(`${name}Step`).classList.toggle("active", name === step);
  });

  if (step === "details") {
    updateJourneyProgress(customerSubStep === "pub" ? 1 : customerSubStep === "drink" ? 2 : 3);
  } else {
    const journeyMap = { review: 4, success: 6 };
    updateJourneyProgress(journeyMap[step], step === "success");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateJourneyProgress(activeStep, allComplete = false) {
  document.querySelectorAll("[data-journey-step]").forEach(el => {
    const index = Number(el.dataset.journeyStep);
    el.classList.toggle("active", !allComplete && index === activeStep);
    el.classList.toggle("complete", allComplete || index < activeStep);
  });

  document.querySelectorAll("[data-journey-line]").forEach(line => {
    const index = Number(line.dataset.journeyLine);
    line.classList.toggle("complete", allComplete || index < activeStep);
  });
}

function setCustomerSubStep(sub) {
  customerSubStep = sub;
  document.querySelectorAll("[data-customer-substep]").forEach(el => {
    el.classList.toggle("active", el.dataset.customerSubstep === sub);
  });

  const stepMap = { pub: 1, drink: 2, recipient: 3 };
  updateJourneyProgress(stepMap[sub]);
  clearStepErrors();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearStepErrors() {
  $("pubStepError")?.classList.add("hidden");
  $("giftStepError")?.classList.add("hidden");
  $("orderFormError")?.classList.add("hidden");
  $("reviewCheckoutError")?.classList.add("hidden");
}

function showStepError(id, message) {
  const el = $(id);
  if (!el) return;
  if (message) el.textContent = message;
  el.classList.remove("hidden");
}

function isParticipatingPub(pub) {
  return pub?.participating !== false;
}

const PHONE_COUNTRIES = {
  IE: { dial: "353", example: "087 123 4567" },
  GB: { dial: "44", example: "07700 900123" }
};

function getSelectedPhoneCountry() {
  const value = $("recipientPhoneCountry")?.value?.trim().toUpperCase();
  return PHONE_COUNTRIES[value] ? value : "IE";
}

function cleanPhoneInput(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  if (value.startsWith("+")) {
    return `+${value.slice(1).replace(/\D/g, "")}`;
  }

  return value.replace(/\D/g, "");
}

function normalizePhoneToE164(raw, countryCode = getSelectedPhoneCountry()) {
  const country = PHONE_COUNTRIES[countryCode] || PHONE_COUNTRIES.IE;
  const cleaned = cleanPhoneInput(raw);
  if (!cleaned) return "";

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  let digits = cleaned;

  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  if (digits.startsWith(country.dial)) {
    return `+${digits}`;
  }

  if (digits.startsWith("353") || digits.startsWith("44")) {
    return `+${digits}`;
  }

  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return `+${country.dial}${digits}`;
}

function isValidE164Phone(e164) {
  if (!e164?.startsWith("+")) return false;

  if (e164.startsWith("+353")) {
    // Irish mobile: 08x locally → +3538xxxxxxxx (9 national digits)
    return /^\+3538\d{8}$/.test(e164);
  }

  if (e164.startsWith("+44")) {
    // UK mobile: 07x locally → +447xxxxxxxxx (10 national digits)
    return /^\+447\d{9}$/.test(e164);
  }

  return false;
}

function getPhoneValidationMessage(raw, countryCode = getSelectedPhoneCountry()) {
  const normalized = normalizePhoneToE164(raw, countryCode);
  if (normalized.startsWith("+44")) {
    return "Please enter a valid UK mobile number (e.g. 07700 900123).";
  }
  return "Please enter a valid Irish mobile number (e.g. 087 123 4567).";
}

function formatPhoneForDisplay(e164) {
  if (!e164) return "";

  if (e164.startsWith("+353") && e164.length === 13) {
    const national = e164.slice(4);
    return `+353 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }

  if (e164.startsWith("+44") && e164.length === 13) {
    const national = e164.slice(3);
    return `+44 ${national.slice(0, 4)} ${national.slice(4)}`;
  }

  return e164;
}

function getNormalizedRecipientPhone() {
  return normalizePhoneToE164(
    $("recipientPhone").value,
    getSelectedPhoneCountry()
  );
}

function isValidPhone(phone, countryCode = getSelectedPhoneCountry()) {
  return isValidE164Phone(normalizePhoneToE164(phone, countryCode));
}

function validatePubStep() {
  if (!selectedPub || !isParticipatingPub(selectedPub)) {
    showStepError("pubStepError");
    return false;
  }
  return true;
}

function validateGiftStep() {
  if (!selectedGift) {
    showStepError("giftStepError");
    return false;
  }
  if (isBarTabGift(selectedGift) && !hasSavedDrinkSupabaseId(selectedGift)) {
    showStepError("giftStepError", "That Bar Tab is not available from this pub yet.");
    return false;
  }
  return true;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function validateOrderForm() {
  const recipient = $("recipientName").value.trim();
  const phoneRaw = $("recipientPhone").value.trim();
  const phoneCountry = getSelectedPhoneCountry();
  const sender = $("senderName").value.trim();
  const senderEmail = $("senderEmail").value.trim();
  const recipientEmailRaw = ($("recipientEmail")?.value || "").trim();

  if (!recipient) {
    showStepError("orderFormError", "Please enter the recipient's name.");
    return false;
  }
  if (!isValidPhone(phoneRaw, phoneCountry)) {
    showStepError("orderFormError", getPhoneValidationMessage(phoneRaw, phoneCountry));
    return false;
  }
  if (!sender) {
    showStepError("orderFormError", "Please enter your name as the sender.");
    return false;
  }
  if (!senderEmail) {
    showStepError("orderFormError", "Please enter your email address.");
    return false;
  }
  if (!isValidEmail(senderEmail)) {
    showStepError("orderFormError", "Please enter a valid email address.");
    return false;
  }
  if (recipientEmailRaw && !isValidEmail(recipientEmailRaw)) {
    showStepError("orderFormError", "Please enter a valid recipient email address, or leave it blank.");
    return false;
  }
  if (!validatePubStep() || !validateGiftStep()) {
    showStepError("orderFormError", "Please choose a pub and drink before continuing.");
    return false;
  }
  return true;
}

function renderVenueCard(pub) {
  const disabled = !isParticipatingPub(pub);
  return `
    <button type="button" class="venue-card venue-card--${pub.id} ${pub.id === selectedPub.id ? "selected" : ""} ${disabled ? "is-disabled" : ""}" data-pub="${pub.id}" ${disabled ? "disabled aria-disabled=\"true\"" : ""}>
      <div class="venue-banner">
        ${pub.image ? `<img class="venue-banner-photo" src="${pub.image}" alt="${pub.name}, ${pub.town}" loading="lazy" />` : `<span class="venue-banner-icon">${pub.icon}</span>`}
      </div>
      <div class="venue-card-content">
        <div class="venue-card-top">
          <strong>${pub.name}</strong>
        </div>
        <small class="venue-location">${pub.town || ""}</small>
        <span class="venue-tag">${disabled ? "Not yet available" : "Partner pub"}</span>
      </div>
      <span class="venue-check" aria-hidden="true">✓</span>
    </button>
  `;
}

function renderChoices() {
  const { townPubs, comingSoonPubs } = partitionPickerPubs(pubs);
  const townGroupsHtml = groupPubsByTown(townPubs).map(group => `
    <section class="venue-town-group" data-town-group="${group.town}">
      <h3 class="venue-town-heading">${group.town}</h3>
      <div class="venue-grid">${group.pubs.map(renderVenueCard).join("")}</div>
    </section>
  `).join("");
  const comingSoonHtml = comingSoonPubs.length
    ? `
    <section class="venue-town-group venue-coming-soon-group" data-town-group="coming-soon" data-coming-soon="true">
      <div class="venue-grid">${comingSoonPubs.map(renderVenueCard).join("")}</div>
    </section>
  `
    : "";
  $("pubList").innerHTML = `${townGroupsHtml}${comingSoonHtml}`;

  $("giftList").innerHTML = gifts.map(gift => `
    <button type="button" class="gift-card ${gift.id === selectedGift.id ? "selected" : ""}" data-gift="${gift.id}">
      <span class="gift-card-icon">${gift.icon}</span>
      <div class="gift-card-body">
        <strong>${gift.name}</strong>
        <small>Available to send</small>
      </div>
      <span class="gift-card-price">${money(gift.price)}</span>
    </button>
  `).join("");

  document.querySelectorAll("[data-pub]").forEach(btn => {
    btn.onclick = async () => {
      const pub = pubs.find(item => item.id === btn.dataset.pub);
      if (!isParticipatingPub(pub)) return;
      selectedPub = pub;
      await loadGiftsForPub(selectedPub);
      renderChoices();
      renderSummary();
      $("pubStepError")?.classList.add("hidden");
    };
  });

  document.querySelectorAll("[data-gift]").forEach(btn => {
    btn.onclick = () => {
      selectedGift = gifts.find(gift => gift.id === btn.dataset.gift);
      if (!selectedGift) return;
      renderChoices();
      renderSummary();
      $("giftStepError")?.classList.add("hidden");
    };
  });

  filterPubList($("pubSearch")?.value || "");
}

function filterPubList(query) {
  const term = query.toLowerCase().trim();
  document.querySelectorAll("[data-pub]").forEach(btn => {
    const pub = pubs.find(item => item.id === btn.dataset.pub);
    const visible = !term
      || pub.name.toLowerCase().includes(term)
      || String(pub.town || "").toLowerCase().includes(term);
    btn.classList.toggle("is-filtered", !visible);
  });
  document.querySelectorAll("[data-town-group]").forEach(group => {
    const hasVisiblePub = [...group.querySelectorAll("[data-pub]")]
      .some(btn => !btn.classList.contains("is-filtered"));
    group.classList.toggle("is-filtered", !hasVisiblePub);
    group.hidden = !hasVisiblePub;
  });
}

function renderSummary() {
  $("summaryPub").textContent = `${selectedPub.name}, ${selectedPub.town}`;
  $("summaryGift").textContent = selectedGift.name;
  $("summaryPrice").textContent = money(calculateOrderTotal(selectedGift.price));
}

function setRecipientVoucherMode(active) {
  document.body.classList.toggle("recipient-voucher-mode", active);
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(el => {
    el.classList.toggle("active", el.id === view);
  });
  document.querySelectorAll(".tab").forEach(el => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  document.body.classList.toggle("redemption-active", view === "redemption");
  document.body.classList.toggle("partner-active", view === "partner");
  if (view !== "voucher") {
    setRecipientVoucherMode(false);
  }
  if (view !== "partner") {
    void stopPartnerQrScan();
  }
  if (view === "sms") renderSms();
  if (view === "voucher") renderVoucher();
  if (view === "partner") void renderPartner();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function findVoucherByCode(code) {
  const normalized = (code || "").trim().toUpperCase();
  if (!normalized) return null;

  if (window.PintDropSupabase?.isConfigured?.()) {
    try {
      const remote = await window.PintDropSupabase.fetchVoucherByCode(code);
      if (remote) return remote;
    } catch (error) {
      console.warn("[PintDrop] Supabase voucher lookup error:", error);
    }
  }

  return readVouchers().find(v => v.code.toUpperCase() === normalized) || null;
}

function buildBarRedemptionUrl(code) {
  const origin = location.origin || "https://pintdrop-mvp-v1-3.vercel.app";
  const path = location.pathname || "/";
  const safeCode = encodeURIComponent(code.trim());
  return `${origin}${path}#redeem/${safeCode}?staff=1`;
}

function setBarRedemptionHash(code) {
  const safeCode = encodeURIComponent(code.trim());
  const target = `#redeem/${safeCode}?staff=1`;
  if (location.hash !== target) {
    history.replaceState(null, "", target);
  }
}

function setRecipientVoucherHash(code) {
  const safeCode = encodeURIComponent(code.trim());
  const target = `#redeem/${safeCode}`;
  if (location.hash !== target) {
    history.replaceState(null, "", target);
  }
}

function parseVoucherCodeFromScan(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const hashRoute = parseRedeemRouteFromHash(url.hash);
    if (hashRoute?.code) return hashRoute.code.toUpperCase();
  } catch {
    // Not a full URL — fall through to pattern matching.
  }

  const hashMatch = value.match(/#redeem\/([^/?#&]+)/i);
  if (hashMatch) {
    return decodeURIComponent(hashMatch[1]).trim().toUpperCase();
  }

  const redeemMatch = value.match(/redeem\/([^/?#&]+)/i);
  if (redeemMatch) {
    return decodeURIComponent(redeemMatch[1]).trim().toUpperCase();
  }

  const codeMatch = value.match(/PD-[A-Z0-9]+/i);
  if (codeMatch) return codeMatch[0].toUpperCase();

  return value.toUpperCase();
}

function parseRedeemRouteFromHash(hash) {
  const match = String(hash || "").match(/^#redeem\/([^/?#]+)(?:\?(.*))?$/i);
  if (!match) return null;

  return {
    code: decodeURIComponent(match[1]).trim(),
    isStaffRedemption: new URLSearchParams(match[2] || "").has("staff")
  };
}

function parseRedeemRoute() {
  return parseRedeemRouteFromHash(location.hash);
}

async function openRecipientVoucherView(code, { updateHash = true } = {}) {
  dismissSplash();
  publicVoucherDisplay = null;

  const voucher = await findVoucherByCode(code);
  if (updateHash && code) {
    setRecipientVoucherHash(code);
  }

  switchView("voucher");

  if (!voucher) {
    setRecipientVoucherMode(true);
    $("voucherEmpty").classList.remove("hidden");
    $("voucherTitle").textContent = "Voucher not found";
    $("voucherSubtitle").textContent = "This link may be invalid.";
    $("voucherBody").classList.add("hidden");
    return;
  }

  publicVoucherDisplay = voucher;
  setRecipientVoucherMode(true);
  $("voucherEmpty").classList.add("hidden");
  $("voucherBody").classList.remove("hidden");
  populateVoucherFields(voucher, "voucher");
  renderBarRedemptionQr(voucher.code);
}

async function processBarRedemption(code, { updateHash = true } = {}) {
  dismissSplash();
  redemptionJustConfirmed = false;

  const normalizedCode = (code || "").trim().toUpperCase();
  if (!normalizedCode) return;

  if (window.PintDropSupabase?.isConfigured?.() && !hasActivePartnerProfile()) {
    storePendingPartnerRedemption(normalizedCode);
    if (updateHash) setBarRedemptionHash(normalizedCode);
    switchView("partner");
    await ensurePartnerAuthReady();
    setPartnerPanelVisibility({ login: true });
    showPartnerLoginRedemptionNotice(normalizedCode);
    return;
  }

  let voucher = null;
  try {
    voucher = await findPartnerVoucherByCode(normalizedCode);
  } catch (error) {
    console.warn("[PintDrop Partner Redemption] Lookup failed:", error);
    activeRedemptionVoucherId = null;
    activeRedemptionVoucher = null;
    if (updateHash) setBarRedemptionHash(normalizedCode);
    switchView("redemption");
    renderRedemptionLookupError(normalizePartnerRedemptionError(error));
    return;
  }

  if (!voucher) {
    activeRedemptionVoucherId = null;
    activeRedemptionVoucher = null;
    if (updateHash) setBarRedemptionHash(normalizedCode);
    switchView("redemption");
    renderRedemptionNotFound();
    return;
  }

  if (!window.PintDropSupabase?.isConfigured?.() && !isVoucherForPartnerPub(voucher)) {
    activeRedemptionVoucherId = null;
    activeRedemptionVoucher = null;
    if (updateHash) setBarRedemptionHash(voucher.code);
    switchView("redemption");
    renderRedemptionWrongPub(voucher);
    return;
  }

  activeRedemptionVoucherId = voucher.id;
  activeRedemptionVoucher = voucher;
  if (updateHash) setBarRedemptionHash(voucher.code);
  switchView("redemption");

  if (isBarTabVoucher(voucher)) {
    renderRedemptionScreen(voucher, { barMode: true });
    return;
  }

  if (voucher.status === "redeemed") {
    renderRedemptionScreen(voucher, { barMode: true });
    return;
  }

  const result = await redeemVoucherById(voucher.id);
  if (!result.ok) {
    renderRedemptionScreen(voucher, {
      barMode: true,
      redeemFailed: true,
      errorMessage: result.error
    });
    return;
  }

  activeRedemptionVoucher = result.voucher;
  redemptionJustConfirmed = true;
  partnerVouchers = null;
  renderRedemptionScreen(result.voucher, { barMode: true });
  await renderPartner();
  renderVoucher();
  renderSms();
  showSenderNotification(result.voucher);
}

function stopPartnerQrDecodeLoop() {
  if (partnerQrScanFrameId) {
    cancelAnimationFrame(partnerQrScanFrameId);
    partnerQrScanFrameId = null;
  }
  partnerQrDecodeInFlight = false;
}

function getPartnerQrDecodeCanvas() {
  if (!partnerQrDecodeCanvas) {
    partnerQrDecodeCanvas = document.createElement("canvas");
    partnerQrDecodeContext = partnerQrDecodeCanvas.getContext("2d", {
      willReadFrequently: true
    });
  }
  return { canvas: partnerQrDecodeCanvas, context: partnerQrDecodeContext };
}

function capturePartnerQrFrame(video) {
  const { canvas, context } = getPartnerQrDecodeCanvas();
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const cropSize = Math.floor(Math.min(width, height) * 0.82);
  const sx = Math.floor((width - cropSize) / 2);
  const sy = Math.floor((height - cropSize) / 2);

  canvas.width = cropSize;
  canvas.height = cropSize;
  context.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, cropSize, cropSize);

  return context.getImageData(0, 0, cropSize, cropSize);
}

function decodePartnerQrImageData(imageData) {
  if (!imageData || typeof jsQR !== "function") return null;

  const result = jsQR(
    imageData.data,
    imageData.width,
    imageData.height,
    { inversionAttempts: "attemptBoth" }
  );

  return result?.data || null;
}

async function decodePartnerQrFrame(video) {
  const imageData = capturePartnerQrFrame(video);
  const jsQrText = decodePartnerQrImageData(imageData);
  if (jsQrText) return jsQrText;

  const BrowserQRCodeReader = window.ZXingBrowser?.BrowserQRCodeReader;
  if (!BrowserQRCodeReader || !partnerQrDecodeCanvas) return null;

  if (!partnerZxingReader) {
    partnerZxingReader = new BrowserQRCodeReader();
  }

  try {
    const result = await partnerZxingReader.decodeFromImageElement(partnerQrDecodeCanvas);
    return result?.getText?.() || null;
  } catch {
    return null;
  }
}

function startPartnerQrDecodeLoop(video) {
  stopPartnerQrDecodeLoop();

  let lastScanAt = 0;

  const tick = (now) => {
    if (!partnerQrScanActive) return;

    if (partnerQrDecodeInFlight || now - lastScanAt < 120) {
      partnerQrScanFrameId = requestAnimationFrame(tick);
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      partnerQrScanFrameId = requestAnimationFrame(tick);
      return;
    }

    lastScanAt = now;
    partnerQrDecodeInFlight = true;

    decodePartnerQrFrame(video)
      .then((decodedText) => {
        if (decodedText) void handlePartnerQrScan(decodedText);
      })
      .catch((error) => {
        console.warn("[PintDrop] QR decode frame failed:", error);
      })
      .finally(() => {
        partnerQrDecodeInFlight = false;
        if (partnerQrScanActive) {
          partnerQrScanFrameId = requestAnimationFrame(tick);
        }
      });
  };

  partnerQrScanFrameId = requestAnimationFrame(tick);
}

function configurePartnerQrVideo(video) {
  if (!video) return;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "true");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.controls = false;
}

function releasePartnerCameraSync() {
  stopPartnerQrDecodeLoop();

  const video = $("partnerQrVideo");
  const stream = video?.srcObject;

  if (stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.warn("[PintDrop] Could not stop camera track:", error);
      }
    });
  }

  if (video) {
    video.srcObject = null;
  }
}

function showPartnerScannerUi() {
  $("redeemResult").innerHTML = "";
  $("scannerDemo")?.classList.remove("hidden");
  $("scannerDemo")?.classList.add("is-scanning", "qr-scanner-active");
  $("scannerStatus").textContent = "Point the camera at the customer’s voucher QR code…";
  $("scannerStatus")?.classList.remove("hidden");
  const scanBtn = $("scanLatestVoucher");
  if (scanBtn) {
    scanBtn.textContent = "Stop scanning";
    scanBtn.classList.add("is-scanning");
    scanBtn.disabled = false;
  }
}

function showPartnerScannerError(message) {
  partnerQrScanActive = false;
  $("scannerStatus").textContent = message;
  $("scannerStatus")?.classList.remove("hidden");
  const scanBtn = $("scanLatestVoucher");
  if (scanBtn) {
    scanBtn.textContent = "SCAN PINTDROP";
    scanBtn.classList.remove("is-scanning");
    scanBtn.disabled = false;
  }
  $("scannerDemo")?.classList.remove("is-scanning", "qr-scanner-active");
}

async function stopPartnerQrScan() {
  partnerQrScanActive = false;
  releasePartnerCameraSync();
  $("scannerDemo")?.classList.add("hidden");
  $("scannerDemo")?.classList.remove("is-scanning", "qr-scanner-active");
  $("scannerStatus")?.classList.add("hidden");
  const scanBtn = $("scanLatestVoucher");
  if (scanBtn) {
    scanBtn.textContent = "SCAN PINTDROP";
    scanBtn.classList.remove("is-scanning");
    scanBtn.disabled = false;
  }
}

async function handlePartnerQrScan(decodedText) {
  if (partnerQrScanHandling) return;

  const code = parseVoucherCodeFromScan(decodedText);
  if (!code || !/^PD-[A-Z0-9]+$/i.test(code)) return;

  partnerQrScanHandling = true;
  $("scannerStatus").textContent = "Voucher found — redeeming…";
  $("scannerStatus")?.classList.remove("hidden");

  await stopPartnerQrScan();
  await processBarRedemption(code);
  partnerQrScanHandling = false;
}

function startPartnerQrScan() {
  const hasJsQr = typeof jsQR === "function";
  const hasZxing = Boolean(window.ZXingBrowser?.BrowserQRCodeReader);

  if (!hasJsQr && !hasZxing) {
    $("redeemResult").innerHTML =
      `<div class="result error">QR decoder could not load. Enter the voucher code manually below.</div>`;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showPartnerScannerUi();
    showPartnerScannerError(
      "Camera API unavailable in this browser. Enter the voucher code manually below."
    );
    $("scannerDemo")?.classList.add("hidden");
    return;
  }

  // iOS requires getUserMedia during the tap handler — never await before opening the camera.
  releasePartnerCameraSync();
  showPartnerScannerUi();

  const video = $("partnerQrVideo");
  configurePartnerQrVideo(video);

  const attachCameraStream = (stream) => {
    video.srcObject = stream;
    return video.play().catch(() => undefined);
  };

  const openCamera = (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints).then(attachCameraStream);

  const rearCameraConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 }
    }
  };

  // getUserMedia is invoked synchronously here, still inside the button tap handler.
  openCamera(rearCameraConstraints)
    .catch((error) => {
      console.warn("[PintDrop] Rear camera constraints failed:", error);
      return openCamera({
        audio: false,
        video: { facingMode: { ideal: "user" } }
      });
    })
    .then(() => {
      partnerQrScanActive = true;
      startPartnerQrDecodeLoop(video);
    })
    .catch((error) => {
      console.warn("[PintDrop] Camera scan failed:", error);
      releasePartnerCameraSync();
      $("scannerDemo")?.classList.add("hidden");
      showPartnerScannerError(
        "Camera access denied or unavailable. Enter the voucher code manually below."
      );
    });
}

async function openRedemptionScreen(code, { updateHash = true } = {}) {
  await processBarRedemption(code, { updateHash });
}

function renderRedemptionNotFound() {
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-already-banner, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-time, .redemption-success, .redemption-bar-tab-panel, .redemption-actions"
  ).forEach(el => el.classList.add("hidden"));
  $("redemptionEmptyMessage").textContent = "No voucher found.";
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionLookupError(message) {
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-already-banner, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-time, .redemption-success, .redemption-bar-tab-panel, .redemption-actions"
  ).forEach(el => el.classList.add("hidden"));
  $("redemptionEmptyMessage").textContent = message || "Could not look up this voucher.";
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionWrongPub(voucher) {
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-already-banner, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-time, .redemption-success, .redemption-bar-tab-panel, .redemption-actions"
  ).forEach(el => el.classList.add("hidden"));
  $("redemptionEmptyMessage").textContent =
    `This voucher is for ${voucher.pub.name}, not O'Flaherty's Bar.`;
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionScreen(voucher, { barMode = false, redeemFailed = false, errorMessage = null, lastBarTabRedemption = null } = {}) {
  $("redemptionEmpty")?.classList.add("hidden");
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-actions"
  ).forEach(el => el.classList.remove("hidden"));

  const barTab = isBarTabVoucher(voucher);
  const isRedeemed = barTab ? isBarTabFullyRedeemed(voucher) : voucher.status === "redeemed";
  const giftLabel = voucher.gift.name.toUpperCase();

  $("redemptionGift").textContent = `${voucher.gift.icon} ${voucher.gift.name}`;
  $("redemptionPub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  $("redemptionRecipient").textContent = voucher.recipient;
  $("redemptionSender").textContent = voucher.sender;
  $("redemptionMessage").textContent = `“${voucher.message}”`;
  $("redemptionCode").textContent = voucher.code;

  const barTabPanel = $("redemptionBarTabPanel");
  const barTabError = $("redemptionBarTabError");
  const barTabSuccess = $("redemptionBarTabSuccess");
  const amountWrap = $("redemptionBarTabAmountWrap");
  const amountInput = $("redemptionBarTabAmount");
  const barTabRedeemBtn = $("redemptionBarTabRedeemBtn");
  const holdWarning = $("redemptionBarTabHoldWarning");
  const confirmedBlock = $("redemptionBarTabConfirmed");
  const barTabState = barTab ? getBarTabStaffScreenState(voucher, { lastBarTabRedemption }) : null;
  if (barTabPanel) {
    barTabPanel.classList.toggle("hidden", !barTab);
    if (!barTab) {
      barTabPanel.classList.remove("is-used");
    }
    if (barTab && barTabState) {
      fillBarTabBalanceFields(voucher, {
        panelId: "redemptionBarTabPanel",
        originalId: "redemptionBarTabOriginal",
        redeemedId: "redemptionBarTabRedeemed",
        remainingId: "redemptionBarTabRemaining"
      });
      amountWrap?.classList.toggle("hidden", !barTabState.allowDebit);
      barTabRedeemBtn?.classList.toggle("hidden", !barTabState.allowDebit);
      holdWarning?.classList.toggle("hidden", !barTabState.allowDebit);
      if (amountInput) {
        amountInput.disabled = !barTabState.allowDebit;
        if (!barTabState.allowDebit) amountInput.value = "";
      }
      if (barTabRedeemBtn && !barTabState.allowDebit) {
        barTabRedeemBtn.disabled = true;
      }
      barTabPanel.classList.toggle("is-used", barTabState.tone === "used");
      const showConfirmed = barTabState.showConfirmed;
      if (confirmedBlock) {
        confirmedBlock.classList.toggle("hidden", !showConfirmed);
        if (showConfirmed) {
          const redeemedNowEl = $("redemptionBarTabRedeemedNow");
          const confirmedRemainingEl = $("redemptionBarTabConfirmedRemaining");
          if (redeemedNowEl) redeemedNowEl.textContent = formatBarTabAmount(barTabState.redeemedNow);
          if (confirmedRemainingEl) confirmedRemainingEl.textContent = formatBarTabAmount(barTabState.remaining);
        }
      }
      if (amountInput && barTabState.allowDebit && document.activeElement !== amountInput) {
        amountInput.value = amountInput.value || "";
      }
      if (barTabRedeemBtn && barTabState.allowDebit) {
        const raw = amountInput?.value;
        barTabRedeemBtn.textContent = getBarTabRedeemButtonLabel(voucher, raw);
        barTabRedeemBtn.disabled = !isBarTabRedeemAmountValid(voucher, raw);
      }
      if (redeemFailed && errorMessage) {
        barTabError.textContent = errorMessage;
        barTabError.classList.remove("hidden");
      } else {
        barTabError?.classList.add("hidden");
      }
      barTabSuccess?.classList.add("hidden");
    }
  }

  const statusEl = $("redemptionStatus");
  const successEl = $("redemptionSuccess");
  const alreadyBanner = $("redemptionAlreadyBanner");

  if (barTab && barTabState?.tone === "used") {
    statusEl.textContent = "❌ BAR TAB USED — DO NOT ACCEPT";
    statusEl.className = "redemption-status redemption-status-hero status redeemed redeemed-blocked bar-tab-used";
    alreadyBanner.classList.add("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.add("hidden");
    hideRedemptionConfirm();
  } else if (barTab && barTabState?.tone === "confirmed") {
    statusEl.textContent = "REDEMPTION CONFIRMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed redeemed-success";
    alreadyBanner.classList.add("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (barTab) {
    statusEl.textContent = "Voucher scanned — NOT YET REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status waiting not-yet-redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (redemptionJustConfirmed && isRedeemed) {
    statusEl.textContent = "✅ REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed redeemed-success";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = `${voucher.gift.name} redeemed successfully.`;
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (isRedeemed) {
    statusEl.textContent = "❌ ALREADY REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed redeemed-blocked";
    alreadyBanner.classList.remove("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.toggle("hidden", !voucher.redeemedAt);
    if (voucher.redeemedAt) {
      $("redemptionTime").textContent = `Redeemed ${formatDateTime(voucher.redeemedAt)}`;
    }
  } else if (redeemFailed) {
    statusEl.textContent = "ERROR";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = errorMessage || "Could not redeem this voucher. Try again.";
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else {
    statusEl.textContent = "VALID";
    statusEl.className = "redemption-status redemption-status-hero status waiting";
    alreadyBanner.classList.add("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.add("hidden");
  }

  const redeemBtn = $("redemptionRedeemBtn");
  redeemBtn.textContent = `REDEEM ${giftLabel}`;
  redeemBtn.disabled = isRedeemed;
  redeemBtn.classList.toggle("hidden", barTab || barMode || isRedeemed);

  $("redemptionConfirm")?.classList.add("hidden");
  $("redemptionConfirmCopy").textContent = barTab
    ? `Confirm ${formatBarTabAmount(pendingBarTabRedeemAmount || parseRedemptionAmount(amountInput?.value) || 0)} from this Bar Tab for ${voucher.recipient}.`
    : `Confirm ${voucher.recipient} has received their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}.`;
}

function showRedemptionConfirm() {
  $("redemptionConfirm")?.classList.remove("hidden");
}

function hideRedemptionConfirm() {
  $("redemptionConfirm")?.classList.add("hidden");
}

async function redeemVoucherById(voucherId) {
  const lookupCode = activeRedemptionVoucher?.id === voucherId
    ? activeRedemptionVoucher.code
    : null;

  if (window.PintDropSupabase?.isConfigured?.()) {
    if (!hasActivePartnerProfile()) {
      return { ok: false, error: "Please sign in to redeem vouchers." };
    }

    const auth = getPartnerAuthApi();
    if (!auth?.redeemVoucher) {
      return { ok: false, error: "Partner redemption is not available in this build." };
    }

    try {
      const remote = await auth.redeemVoucher({
        id: voucherId,
        code: lookupCode
      });
      if (remote?.status === "redeemed") {
        return { ok: true, voucher: remote };
      }
      return {
        ok: false,
        error: "This voucher could not be redeemed. It may already be redeemed or invalid."
      };
    } catch (error) {
      console.warn("[PintDrop Partner Redemption] redeem error:", error);
      return { ok: false, error: normalizePartnerRedemptionError(error) };
    }
  }

  const vouchers = readVouchers();
  const local = vouchers.find(v => v.id === voucherId);
  if (!local) {
    return { ok: false, error: "Voucher not found." };
  }
  if (local.status === "redeemed") {
    return { ok: true, voucher: local };
  }

  local.status = "redeemed";
  local.redeemedAt = new Date().toISOString();
  writeVouchers(vouchers);
  return { ok: true, voucher: local };
}

async function redeemBarTabById(voucherId, rawAmount) {
  const voucher = activeRedemptionVoucher?.id === voucherId
    ? activeRedemptionVoucher
    : readVouchers().find(v => v.id === voucherId);
  if (!voucher) {
    return { ok: false, error: "Voucher not found." };
  }
  if (!isBarTabVoucher(voucher)) {
    return { ok: false, error: "This voucher is not a Bar Tab." };
  }

  const amount = parseRedemptionAmount(rawAmount);
  const check = validateBarTabRedeemAmount(voucher, amount);
  if (!check.ok) return check;

  if (window.PintDropSupabase?.isConfigured?.()) {
    if (!hasActivePartnerProfile()) {
      return { ok: false, error: "Please sign in to redeem vouchers." };
    }

    const auth = getPartnerAuthApi();
    if (!auth?.redeemBarTab) {
      return { ok: false, error: "Bar Tab redemption is not available in this build." };
    }

    try {
      const remote = await auth.redeemBarTab({
        id: voucherId,
        code: voucher.code,
        amount: check.amount
      });
      if (!remote?.voucher) {
        return { ok: false, error: "This Bar Tab could not be redeemed. It may already be fully redeemed or invalid." };
      }
      return {
        ok: true,
        voucher: remote.voucher,
        redemption: remote.redemption
      };
    } catch (error) {
      console.warn("[PintDrop Partner Redemption] Bar Tab redeem error:", error);
      return { ok: false, error: normalizePartnerRedemptionError(error) };
    }
  }

  const localResult = applyBarTabDebit(voucher, check.amount);
  if (!localResult.ok) return localResult;

  const vouchers = readVouchers();
  const index = vouchers.findIndex(v => v.id === voucherId);
  if (index >= 0) {
    vouchers[index] = localResult.voucher;
    writeVouchers(vouchers);
  }
  return localResult;
}

function buildPendingOrder() {
  const recipient = $("recipientName").value.trim();
  const phone = getNormalizedRecipientPhone();
  const sender = $("senderName").value.trim();
  const senderEmail = $("senderEmail").value.trim().toLowerCase();
  const recipientEmail = ($("recipientEmail")?.value || "").trim().toLowerCase();
  const deliveryDate = new Date().toISOString().slice(0, 10);

  if (!recipient || !phone || !sender || !senderEmail) return null;

  return {
    pub: selectedPub,
    gift: selectedGift,
    recipient,
    phone,
    recipientEmail: recipientEmail || null,
    sender,
    senderEmail,
    message: $("message").value.trim(),
    deliveryDate,
    fee: calculateServiceFee(selectedGift.price),
    total: calculateOrderTotal(selectedGift.price)
  };
}

function renderReview() {
  if (!pendingOrder) return;
  const rows = [
    [pendingOrder.gift.icon, "Gift", pendingOrder.gift.name],
    ["📍", "Pub", `${pendingOrder.pub.name}, ${pendingOrder.pub.town}`],
    ["👤", "Recipient", `${pendingOrder.recipient} • ${formatPhoneForDisplay(pendingOrder.phone)}`],
    ...(pendingOrder.recipientEmail
      ? [["📧", "Recipient email", pendingOrder.recipientEmail]]
      : []),
    ["✉️", "From", pendingOrder.sender],
    ["📧", "Your email", pendingOrder.senderEmail],
    ...(pendingOrder.message ? [["💬", "Message", pendingOrder.message]] : [])
  ];

  $("reviewDetails").innerHTML = rows.map(([icon, label, value]) => `
    <div class="review-row checkout-review-row">
      <span class="review-icon">${icon}</span>
      <div class="review-copy"><small>${label}</small><strong>${value}</strong></div>
    </div>
  `).join("");

  $("reviewGiftPrice").textContent = money(pendingOrder.gift.price);
  $("reviewFee").textContent = money(pendingOrder.fee);
  $("reviewTotal").textContent = money(pendingOrder.total);
  const payButton = $("goToPayment");
  if (payButton) payButton.textContent = `Pay ${money(pendingOrder.total)} securely`;
}

async function startStripeCheckout() {
  if (!pendingOrder || paymentProcessing) return;

  if (isBarTabGift(pendingOrder.gift) && !hasSavedDrinkSupabaseId(pendingOrder.gift)) {
    showStepError(
      "reviewCheckoutError",
      "That Bar Tab is not available from this pub yet."
    );
    return;
  }

  paymentProcessing = true;
  const button = $("goToPayment");
  if (button) button.disabled = true;
  $("reviewCheckoutError")?.classList.add("hidden");
  updateJourneyProgress(5);

  try {
    savePendingOrderForStripe();
    const checkout = await createStripeCheckoutSession();
    window.location.href = checkout.url;
  } catch (error) {
    console.warn("[PintDrop Stripe] Checkout start failed:", error);
    showStepError(
      "reviewCheckoutError",
      error?.message || "Could not start secure checkout. Please try again."
    );
    paymentProcessing = false;
    if (button) button.disabled = false;
    updateJourneyProgress(4);
  }
}

async function completeCheckoutAfterPayment(sessionId) {
  const button = $("goToPayment");
  const overlay = $("processingOverlay");
  paymentProcessing = true;
  if (button) button.disabled = true;
  resetProcessingSteps();
  overlay?.classList.remove("hidden");

  setProcessingStep(1);
  await new Promise((resolve) => setTimeout(resolve, 400));
  setProcessingStep(2);

  const fulfillment = await pollCheckoutFulfillment(sessionId);
  setProcessingStep(3);

  if (!fulfillment?.voucher) {
    throw new Error(
      "Your payment was received, but your PintDrop is still being prepared. Please refresh this page in a moment."
    );
  }

  syncFulfilledVoucherToLocal(fulfillment.voucher);
  await new Promise((resolve) => setTimeout(resolve, 400));
  setProcessingStep(4);
  showCheckoutSuccess(fulfillment.voucher, fulfillment.delivery);
  overlay?.classList.add("hidden");
  resetProcessingSteps();
  setPurchaseStep("success");
  paymentProcessing = false;
  if (button) button.disabled = false;
  partnerVouchers = null;
  await renderPartner();
  renderSms();
  clearPendingOrderStorage();
}

async function fetchCheckoutFulfillment(sessionId) {
  const response = await fetch("/api/checkout-fulfillment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      expectedTotal: pendingOrder?.total
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    console.warn("[PintDrop Fulfillment] Invalid fulfillment response:", error);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Could not load checkout fulfillment.");
  }

  return data;
}

async function pollCheckoutFulfillment(sessionId) {
  const maxAttempts = 30;
  const delayMs = 1500;
  let lastResult = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResult = await fetchCheckoutFulfillment(sessionId);
    const status = lastResult?.status || lastResult?.delivery?.fulfillmentStatus;
    if (lastResult?.voucher && (status === "completed" || status === "partial")) {
      return lastResult;
    }
    if (lastResult?.voucher && attempt >= maxAttempts - 1) {
      return lastResult;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastResult;
}

function syncFulfilledVoucherToLocal(voucher) {
  if (!voucher?.code) return;

  const normalized = {
    id: voucher.id,
    code: voucher.code,
    pub: {
      ...voucher.pub,
      icon: voucher.pub?.icon || voucher.gift?.icon || "🍺",
      participating: true,
      source: "supabase"
    },
    gift: {
      ...voucher.gift,
      source: "supabase"
    },
    recipient: voucher.recipient,
    phone: voucher.phone,
    recipientEmail: voucher.recipientEmail || null,
    sender: voucher.sender,
    message: voucher.message,
    deliveryDate: voucher.deliveryDate,
    fee: voucher.fee,
    total: voucher.total,
    createdAt: voucher.createdAt || new Date().toISOString(),
    expiresAt: voucher.expiresAt,
    status: voucher.status || "waiting",
    redeemedAt: null,
    source: "supabase"
  };

  const vouchers = readVouchers().filter((item) => item.id !== normalized.id && item.code !== normalized.code);
  vouchers.unshift(normalized);
  writeVouchers(vouchers);
  localStorage.setItem("pintdrop_last_voucher", normalized.id);
}

function savePendingOrderForStripe() {
  if (!pendingOrder) return;
  sessionStorage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(pendingOrder));
}

function restorePendingOrderFromStripe() {
  const raw = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("[PintDrop Stripe] Could not restore pending order:", error);
    return null;
  }
}

function clearPendingOrderStorage() {
  sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
}

function clearStripeQueryParams() {
  const url = new URL(location.href);
  url.searchParams.delete("stripe");
  url.searchParams.delete("session_id");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function getCheckoutPubId(pub) {
  const supabaseId = Number(pub?.supabaseId);
  if (Number.isFinite(supabaseId) && supabaseId > 0) {
    return supabaseId;
  }
  if (pub?.id === PARTNER_PUB_ID) {
    return PARTNER_SUPABASE_PUB_ID;
  }
  return undefined;
}

function getCheckoutDrinkId(gift, pub) {
  const supabaseId = Number(gift?.supabaseId);
  if (Number.isFinite(supabaseId) && supabaseId > 0) {
    return supabaseId;
  }
  if (getCheckoutPubId(pub) === PARTNER_SUPABASE_PUB_ID && gift?.id) {
    const mapped = PARTNER_DRINK_SUPABASE_IDS[gift.id];
    if (Number.isFinite(mapped) && mapped > 0) {
      return mapped;
    }
  }
  return undefined;
}

async function createStripeCheckoutSession() {
  const drinkId = getCheckoutDrinkId(pendingOrder.gift, pendingOrder.pub);
  if (isBarTabGift(pendingOrder.gift) && (!Number.isFinite(drinkId) || drinkId <= 0)) {
    throw new Error("That Bar Tab is not available from this pub yet.");
  }

  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      total: pendingOrder.total,
      giftPrice: pendingOrder.gift.price,
      fee: pendingOrder.fee,
      giftName: pendingOrder.gift.name,
      drinkId,
      drinkIcon: pendingOrder.gift.icon,
      pubName: pendingOrder.pub.name,
      pubLocation: pendingOrder.pub.town,
      pubId: getCheckoutPubId(pendingOrder.pub),
      recipientName: pendingOrder.recipient,
      recipientPhone: pendingOrder.phone,
      recipientEmail: pendingOrder.recipientEmail || "",
      senderName: pendingOrder.sender,
      senderEmail: pendingOrder.senderEmail,
      message: pendingOrder.message,
      deliveryDate: pendingOrder.deliveryDate
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    console.warn("[PintDrop Stripe] Invalid checkout session response:", error);
  }

  if (!response.ok || !data?.url) {
    throw new Error(data?.error || "Could not start secure checkout.");
  }

  return data;
}

async function verifyStripeCheckoutSession(sessionId) {
  const response = await fetch("/api/verify-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      expectedTotal: pendingOrder?.total
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    console.warn("[PintDrop Stripe] Invalid verify session response:", error);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Payment could not be verified.");
  }

  return data;
}

async function handleStripeReturn() {
  const params = new URLSearchParams(location.search);
  const stripeState = params.get("stripe");
  if (!stripeState) return false;

  dismissSplash();
  switchView("customer");

  if (stripeState === "cancelled") {
    pendingOrder = restorePendingOrderFromStripe();
    clearStripeQueryParams();
    paymentProcessing = false;
    if (pendingOrder) {
      renderReview();
      setPurchaseStep("review");
      showStepError(
        "reviewCheckoutError",
        "Checkout was cancelled. You can try again when ready."
      );
    } else {
      setPurchaseStep("details");
    }
    return true;
  }

  if (stripeState === "success") {
    const sessionId = params.get("session_id");
    clearStripeQueryParams();
    pendingOrder = restorePendingOrderFromStripe();

    if (!pendingOrder || !sessionId) {
      console.warn("[PintDrop Stripe] Missing pending order or session id after return.");
      setPurchaseStep("details");
      return true;
    }

    try {
      await verifyStripeCheckoutSession(sessionId);
      setPurchaseStep("review");
      await completeCheckoutAfterPayment(sessionId);
    } catch (error) {
      console.warn("[PintDrop Stripe] Payment verification failed:", error);
      paymentProcessing = false;
      renderReview();
      setPurchaseStep("review");
      showStepError(
        "reviewCheckoutError",
        error?.message || "Payment could not be verified. Please try again."
      );
    }
    return true;
  }

  return false;
}

async function createVoucherFromPendingOrder() {
  const deliveryDate = (pendingOrder.deliveryDate || new Date().toISOString()).slice(0, 10);
  const voucher = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    code: createCode(),
    pub: pendingOrder.pub,
    gift: pendingOrder.gift,
    recipient: pendingOrder.recipient,
    phone: pendingOrder.phone,
    recipientEmail: pendingOrder.recipientEmail || null,
    sender: pendingOrder.sender,
    message: pendingOrder.message,
    deliveryDate,
    fee: pendingOrder.fee,
    total: pendingOrder.total,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    status: "waiting",
    redeemedAt: null
  };

  if (window.PintDropSupabase?.isConfigured?.()
    && pendingOrder.pub?.supabaseId
    && pendingOrder.gift?.supabaseId) {
    try {
      let remote = await window.PintDropSupabase.createVoucher(voucher);
      if (!remote) {
        voucher.code = createCode();
        remote = await window.PintDropSupabase.createVoucher(voucher);
      }
      if (remote) {
        const checkoutCode = voucher.code;
        const savedRecipientEmail = voucher.recipientEmail;
        Object.assign(voucher, remote);
        if (savedRecipientEmail && !voucher.recipientEmail) {
          voucher.recipientEmail = savedRecipientEmail;
        }
        if (!String(voucher.code || "").trim()) {
          voucher.code = checkoutCode;
        }
      } else {
        console.warn("[PintDrop] Supabase voucher was not created; saved locally only.");
      }
    } catch (error) {
      console.warn("[PintDrop] Supabase voucher create error:", error);
    }
  }

  const vouchers = readVouchers();
  vouchers.unshift(voucher);
  writeVouchers(vouchers);
  localStorage.setItem("pintdrop_last_voucher", voucher.id);
  partnerVouchers = null;
  return voucher;
}

function resetSuccessDeliveryState() {
  $("successSmsWarning")?.classList.add("hidden");
  $("successSmsWarning").textContent = "";
  $("successEmailWarning")?.classList.add("hidden");
  $("successEmailWarning").textContent = "";
  if ($("successSmsCheck")) $("successSmsCheck").textContent = "✓ SMS delivered";
  if ($("successEmailCheck")) $("successEmailCheck").textContent = "✓ Confirmation email sent";
}

async function deliverVoucherSms(voucher) {
  if (voucher?.source !== "supabase") {
    return { ok: false, skipped: true };
  }

  if (!pendingOrder) {
    console.warn("[PintDrop SMS] pendingOrder missing at SMS time");
    return { ok: false, error: "Checkout order missing for SMS." };
  }

  return window.PintDropSupabase.sendVoucherSms({
    phone: pendingOrder.phone,
    code: voucher.code,
    sender: pendingOrder.sender,
    recipient: pendingOrder.recipient,
    pub: pendingOrder.pub,
    gift: pendingOrder.gift
  });
}

async function deliverRecipientGiftEmail(voucher) {
  if (voucher?.source !== "supabase") {
    return { ok: false, skipped: true };
  }

  if (!pendingOrder?.recipientEmail) {
    return { ok: false, skipped: true };
  }

  return window.PintDropSupabase.sendRecipientGiftEmail(
    { ...voucher, gift: pendingOrder.gift || voucher.gift },
    pendingOrder.recipientEmail
  );
}

async function deliverSenderConfirmationEmail(voucher) {
  if (voucher?.source !== "supabase") {
    return { ok: false, skipped: true };
  }

  if (!pendingOrder?.senderEmail) {
    return { ok: false, error: "Checkout order missing sender email." };
  }

  return window.PintDropSupabase.sendSenderConfirmation(
    { ...voucher, gift: pendingOrder.gift || voucher.gift },
    pendingOrder.senderEmail
  );
}

function showCheckoutSuccess(voucher, delivery) {
  resetSuccessDeliveryState();
  $("successCode").textContent = voucher.code;

  const fulfillmentStatus = delivery?.fulfillmentStatus || "processing";
  const smsSent = delivery?.sms === "sent";
  const senderEmailSent = delivery?.senderEmail === "sent";
  const senderEmailSkipped = delivery?.senderEmail === "skipped";
  const recipientEmailSent = delivery?.recipientEmail === "sent";
  const stillProcessing = fulfillmentStatus === "processing" || fulfillmentStatus === "pending";

  if (stillProcessing) {
    $("successMessage").textContent =
      `Payment confirmed. We're still sending your PintDrop to ${voucher.recipient} — this usually takes a few seconds.`;
    $("successSmsCheck").textContent = "… SMS sending";
    $("successEmailCheck").textContent = "… Confirmation email sending";
    return;
  }

  if (smsSent) {
    let message =
      `${voucher.recipient} has just received a text message with your gift. They can redeem their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}. 🍻`;
    if (recipientEmailSent && voucher.recipientEmail) {
      message += ` We also emailed a backup copy to ${voucher.recipientEmail}.`;
    }
    $("successMessage").textContent = message;
  } else {
    $("successMessage").textContent =
      `Your PintDrop was created successfully for ${voucher.recipient} at ${voucher.pub.name}.`;
    $("successSmsCheck").textContent = "⚠ SMS not delivered";
    $("successSmsWarning").textContent =
      `The voucher was saved, but the SMS could not be sent${delivery?.error ? `: ${delivery.error}` : ""}. Please share the voucher code or link with the recipient manually.`;
    $("successSmsWarning").classList.remove("hidden");
  }

  if (!senderEmailSent && !senderEmailSkipped && delivery?.senderEmail === "failed") {
    $("successEmailCheck").textContent = "⚠ Email not sent";
    $("successEmailWarning").textContent =
      `Your PintDrop was created, but we could not send your confirmation email${delivery?.error ? `: ${delivery.error}` : ""}. Your receipt is still shown below.`;
    $("successEmailWarning").classList.remove("hidden");
  }

  if (voucher.recipientEmail && delivery?.recipientEmail === "failed") {
    const existingWarning = $("successSmsWarning").textContent.trim();
    const recipientWarning =
      `We could not send the backup email to ${voucher.recipientEmail}. The SMS is still the primary delivery method.`;
    $("successSmsWarning").textContent = existingWarning
      ? `${existingWarning} ${recipientWarning}`
      : recipientWarning;
    $("successSmsWarning").classList.remove("hidden");
  }
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.querySelectorAll("[data-back-to]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.backTo === "details") {
      setCustomerSubStep("recipient");
    }
    setPurchaseStep(btn.dataset.backTo);
  });
});

$("orderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateOrderForm()) return;
  pendingOrder = buildPendingOrder();
  if (!pendingOrder) return;
  renderReview();
  setPurchaseStep("review");
});

document.querySelectorAll("[data-next-substep]").forEach(btn => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.nextSubstep;
    if (next === "drink" && !validatePubStep()) return;
    if (next === "recipient" && !validateGiftStep()) return;
    setCustomerSubStep(next);
  });
});

document.querySelectorAll("[data-prev-substep]").forEach(btn => {
  btn.addEventListener("click", () => setCustomerSubStep(btn.dataset.prevSubstep));
});

$("goToPayment").addEventListener("click", () => {
  startStripeCheckout();
});

$("viewVoucher").addEventListener("click", () => switchView("sms"));
$("sendAnother").addEventListener("click", async () => {
  await applyDemoDefaults();
  pendingOrder = null;
  clearPendingOrderStorage();
  setPurchaseStep("details");
});

function getLastVoucher() {
  const vouchers = readVouchers();
  const id = localStorage.getItem("pintdrop_last_voucher");
  return vouchers.find(v => v.id === id) || vouchers[0];
}

function getDisplayVoucher() {
  return publicVoucherDisplay || getLastVoucher();
}

function renderFakeQr(code, targetId = "fakeQr") {
  const seed = [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const cells = [];
  for (let i = 0; i < 121; i += 1) {
    const on = ((i * 17 + seed * 13 + Math.floor(i / 11) * 7) % 5) < 2;
    cells.push(`<i class="${on ? "on" : ""}"></i>`);
  }
  $(targetId).innerHTML = cells.join("");
}

function renderBarRedemptionQr(code, targetId = "fakeQr") {
  const el = $(targetId);
  if (!el) return;

  el.innerHTML = "";
  el.classList.remove("fake-qr");
  el.classList.add("voucher-qr");

  const barUrl = buildBarRedemptionUrl(code);

  if (typeof QRCode === "function") {
    new QRCode(el, {
      text: barUrl,
      width: 220,
      height: 220,
      colorDark: "#07120d",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
    return;
  }

  el.classList.add("fake-qr");
  el.classList.remove("voucher-qr");
  renderFakeQr(code, targetId);
}

function populateVoucherFields(voucher, prefix = "") {
  const id = (name) => $(`${prefix}${name}`);
  id("GiftIcon").textContent = voucher.gift.icon;
  id("Gift").textContent = voucher.gift.name;
  id("Pub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  id("Message").textContent = `“${voucher.message}”`;
  id("Code").textContent = voucher.code;
  id("Recipient").textContent = voucher.recipient;
  id("Sender").textContent = voucher.sender;
  const expiryEl = id("Expiry");
  if (expiryEl) {
    expiryEl.textContent = voucher.expiresAt
      ? formatDate(voucher.expiresAt.slice(0, 10))
      : "";
  }
  const barTab = isBarTabVoucher(voucher);
  const isRedeemed = barTab ? isBarTabFullyRedeemed(voucher) : voucher.status === "redeemed";
  const statusEl = id("Status");
  if (prefix === "voucher") {
    statusEl.textContent = isRedeemed ? "REDEEMED" : "VALID";
    statusEl.className = `status voucher-status-badge ${isRedeemed ? "redeemed" : "waiting"}`;
    document.querySelector("#voucher .wallet-pass")?.classList.toggle("is-redeemed", isRedeemed);
  } else {
    statusEl.textContent = isRedeemed ? "REDEEMED" : "VALID";
    statusEl.className = `status ${isRedeemed ? "redeemed" : "waiting"}`;
  }
  pulseStatusBadge(statusEl);

  fillBarTabBalanceFields(voucher, {
    panelId: `${prefix}BarTabPanel`,
    originalId: `${prefix}BarTabOriginal`,
    redeemedId: `${prefix}BarTabRedeemed`,
    remainingId: `${prefix}BarTabRemaining`
  });

  const redeemedStamp = $(prefix === "voucher" ? "redeemedStamp" : `${prefix}RedeemedStamp`);
  const redeemedWhen = $(prefix === "voucher" ? "redeemedWhen" : `${prefix}RedeemedWhen`);
  if (redeemedStamp) {
    redeemedStamp.classList.toggle("hidden", !isRedeemed);
    if (isRedeemed && voucher.redeemedAt && redeemedWhen) {
      redeemedWhen.textContent = formatDateTime(voucher.redeemedAt);
    }
  }
}

let smsWalletClosing = false;

function resetSmsWalletAnimation() {
  const overlay = $("smsWalletOverlay");
  overlay.classList.remove("is-open", "is-closing");
  $("phoneStage").classList.remove("wallet-active");
  $("smsWalletQrArea").classList.remove("enlarged", "scanning");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  smsWalletClosing = false;
}

function openSmsWallet() {
  const voucher = getLastVoucher();
  if (!voucher) return;

  populateVoucherFields(voucher, "smsWallet");
  renderBarRedemptionQr(voucher.code, "smsWalletFakeQr");

  const overlay = $("smsWalletOverlay");
  const qrArea = $("smsWalletQrArea");
  const status = $("smsWalletStatus");
  overlay.classList.remove("hidden", "is-closing");
  overlay.setAttribute("aria-hidden", "false");
  $("phoneStage").classList.add("wallet-active");
  qrArea?.classList.remove("wallet-qr-revealed");
  status?.classList.remove("status-pulse");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      setTimeout(() => {
        qrArea?.classList.add("wallet-qr-revealed");
        pulseStatusBadge(status);
      }, 580);
    });
  });
}

function closeSmsWallet() {
  if (smsWalletClosing) return;
  smsWalletClosing = true;

  const overlay = $("smsWalletOverlay");
  overlay.classList.remove("is-open");
  overlay.classList.add("is-closing");
  $("phoneStage").classList.remove("wallet-active");
  $("smsWalletQrArea").classList.remove("enlarged", "scanning");

  setTimeout(resetSmsWalletAnimation, 580);
}

function renderSms() {
  const voucher = getDisplayVoucher();
  if (!voucher) {
    $("smsEmpty").classList.remove("hidden");
    $("smsThread").classList.add("hidden");
    return;
  }

  $("smsEmpty").classList.add("hidden");
  $("smsThread").classList.remove("hidden");
  $("smsHeadline").textContent = `${voucher.gift.icon} ${voucher.sender} has bought you a ${voucher.gift.name.toLowerCase()}!`;
  $("smsPersonalMessage").textContent = `“${voucher.message}”`;
  $("smsGiftIcon").textContent = voucher.gift.icon;
  $("smsGift").textContent = voucher.gift.name;
  $("smsPub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  $("smsRedeemedNotice").classList.toggle(
    "hidden",
    isBarTabVoucher(voucher) ? !isBarTabFullyRedeemed(voucher) : voucher.status !== "redeemed"
  );
  $("smsTime").textContent = new Date(voucher.createdAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });

  const overlay = $("smsWalletOverlay");
  if (!overlay.classList.contains("hidden") && overlay.classList.contains("is-open")) {
    populateVoucherFields(voucher, "smsWallet");
    renderBarRedemptionQr(voucher.code, "smsWalletFakeQr");
  }
}

$("openSmsVoucher").addEventListener("click", openSmsWallet);
$("closeSmsWallet").addEventListener("click", (event) => {
  event.stopPropagation();
  closeSmsWallet();
});
$("smsWalletBackdrop").addEventListener("click", closeSmsWallet);
$("smsWalletQrArea").addEventListener("click", () => {
  $("smsWalletQrArea").classList.toggle("enlarged");
  $("smsWalletQrArea").classList.toggle("scanning");
});
$("backFromSms").addEventListener("click", () => {
  closeSmsWallet();
  switchView("customer");
});
$("voucherQrArea").addEventListener("click", () => {
  $("voucherQrArea").classList.toggle("enlarged");
  $("voucherQrArea").classList.toggle("scanning");
});

function renderVoucher() {
  const voucher = getDisplayVoucher();
  setRecipientVoucherMode(Boolean(publicVoucherDisplay && voucher));

  if (!voucher) {
    $("voucherEmpty").classList.remove("hidden");
    $("voucherTitle").textContent = "No voucher created yet";
    $("voucherSubtitle").textContent = "Create one from the Customer tab.";
    $("voucherBody").classList.add("hidden");
    return;
  }

  $("voucherEmpty").classList.add("hidden");
  $("voucherBody").classList.remove("hidden");
  populateVoucherFields(voucher, "voucher");
  renderBarRedemptionQr(voucher.code);
}

$("shareVoucher").addEventListener("click", async () => {
  const voucher = getLastVoucher();
  if (!voucher) return;
  const text = `${voucher.sender} sent ${voucher.recipient} a ${voucher.gift.name} at ${voucher.pub.name}. Voucher ${voucher.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "PintDrop voucher", text });
    else {
      await navigator.clipboard.writeText(text);
      $("shareVoucher").textContent = "Copied!";
      setTimeout(() => $("shareVoucher").textContent = "Share voucher", 1400);
    }
  } catch {}
});

function partnerRedemptionItem(voucher) {
  const when = formatActivityWhen(getVoucherActivityTime(voucher));
  return `
    <article class="partner-redemption-row">
      <time class="partner-redemption-time">
        <strong>${when.time}</strong>
        <span>${when.date}</span>
      </time>
      <div class="partner-redemption-copy">
        <strong class="partner-redemption-drink">${voucher.gift.icon} ${voucher.gift.name}</strong>
        <span class="partner-redemption-recipient">${voucher.recipient}</span>
        <span class="partner-redemption-code">${voucher.code}</span>
      </div>
    </article>
  `;
}

function activityItem(voucher) {
  const when = formatActivityWhen(getVoucherActivityTime(voucher));
  const isRedeemed = voucher.status === "redeemed";
  const statusLabel = isRedeemed ? "Redeemed" : "Waiting";
  return `
    <div class="activity-row pintdrop-row activity-row--${isRedeemed ? "redeemed" : "waiting"}">
      <span class="activity-cell pintdrop-when">
        <strong>${when.date}</strong>
        <small>${when.time}</small>
      </span>
      <span class="activity-cell activity-recipient">${voucher.recipient}</span>
      <span class="activity-cell activity-gift">${voucher.gift.name}</span>
      <span class="activity-cell pintdrop-code">${voucher.code}</span>
      <span class="activity-cell activity-status pintdrop-status">${statusLabel}</span>
      <span class="activity-cell activity-value">${money(voucher.gift.price)}</span>
    </div>
  `;
}

function activityListHeader() {
  return `
    <div class="activity-row activity-row-head pintdrop-row">
      <span class="activity-cell">Time / date</span>
      <span class="activity-cell">Recipient</span>
      <span class="activity-cell">Drink</span>
      <span class="activity-cell">Voucher code</span>
      <span class="activity-cell">Status</span>
      <span class="activity-cell">Value</span>
    </div>
  `;
}

function voucherRedeemedInPeriod(voucher, period) {
  if (voucher.status !== "redeemed" || !voucher.redeemedAt) return false;
  if (period === "today") return isToday(voucher.redeemedAt);
  if (period === "week") return isThisWeek(voucher.redeemedAt);
  if (period === "month") return isThisMonth(voucher.redeemedAt);
  return true;
}

function periodSummaryLabel(period) {
  const labels = {
    today: "Today at O'Flaherty's Bar",
    week: "This week at O'Flaherty's Bar",
    month: "This month at O'Flaherty's Bar"
  };
  return labels[period] || labels.week;
}

function computePeriodSummary(vouchers, period) {
  const redeemed = vouchers.filter(v => voucherRedeemedInPeriod(v, period));
  const waiting = vouchers.filter(v => v.status === "waiting");

  return {
    redeemedCount: redeemed.length,
    valueRedeemed: redeemed.reduce((sum, v) => sum + v.gift.price, 0),
    waitingCount: waiting.length
  };
}

function voucherSoldInPeriod(voucher, period) {
  if (!voucher?.createdAt) return false;
  if (period === "today") return isToday(voucher.createdAt);
  if (period === "week") return isThisWeek(voucher.createdAt);
  if (period === "month") return isThisMonth(voucher.createdAt);
  return true;
}

function partnerTraceabilityRows(vouchers, period) {
  return vouchers
    .filter(voucher => voucherSoldInPeriod(voucher, period))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function redeemedVenueValue(voucher) {
  if (isBarTabVoucher(voucher)) {
    const amount = Number(voucher.barTab?.totalRedeemed);
    if (Number.isFinite(amount)) return amount;
  }
  return voucher.status === "redeemed" ? Number(voucher.gift?.price || 0) : 0;
}

function computeTraceabilitySummary(rows) {
  return rows.reduce((summary, voucher) => {
    summary.venueValue += Number(voucher.gift?.price || 0);
    summary.customerPaid += Number(voucher.total || 0);
    summary.fees += Number(voucher.fee || 0);
    summary.redeemedValue += redeemedVenueValue(voucher);
    if (voucher.status === "redeemed") summary.redeemedCount += 1;
    else summary.waitingCount += 1;
    return summary;
  }, { venueValue: 0, customerPaid: 0, fees: 0, redeemedValue: 0, redeemedCount: 0, waitingCount: 0 });
}

function computeSettlementSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.refunds += Number(row.refundAmount || 0);
    if (row.payoutStatus === "paid") {
      const venueValue = Number(row.venueValue || 0);
      const transferAmount = Number(row.transferAmount || venueValue);
      summary.paidOut += Math.min(venueValue, transferAmount);
    }
    summary.outstanding += Number(row.outstandingAmount || 0);
    return summary;
  }, { refunds: 0, paidOut: 0, outstanding: 0 });
}

async function loadPartnerAccountingReport(period, { force = false } = {}) {
  if (!force && partnerAccountingReports.has(period)) return partnerAccountingReports.get(period);
  partnerAccountingLoadError = null;
  const auth = getPartnerAuthApi();
  const session = partnerSession || (await auth?.getSession?.());
  const accessToken = session?.access_token;
  if (!accessToken) {
    partnerAccountingLoadError = "Sign in again to load payout reconciliation.";
    return [];
  }
  try {
    const response = await fetch("/api/partner/accounting-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-PintDrop-Partner-Token": accessToken
      },
      body: JSON.stringify({ period })
    });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load payout reconciliation.");
    const rows = Array.isArray(data.rows) ? data.rows : [];
    partnerAccountingReports.set(period, rows);
    return rows;
  } catch (error) {
    const message = String(error?.message || "Could not load payout reconciliation.");
    partnerAccountingLoadError = message === "Partner authentication required."
      ? "Payout details need a quick refresh. Sales totals are unaffected."
      : message;
    return [];
  }
}

function settlementRowForVoucher(voucher, settlementRows) {
  return settlementRows.find(row => row.saleReference === voucher.code) || {
    saleReference: voucher.code,
    itemSold: voucher.gift?.name || "Voucher",
    saleDate: voucher.createdAt,
    redemptionDate: voucher.redeemedAt,
    voucherStatus: voucher.status,
    venueValue: Number(voucher.gift?.price || 0),
    customerPaid: Number(voucher.total || 0),
    pintDropFee: Number(voucher.fee || 0),
    stripeFee: null,
    refundAmount: 0,
    paymentReference: null,
    transferReference: null,
    transferAmount: 0,
    payoutReference: null,
    payoutDate: null,
    payoutStatus: "loading",
    outstandingAmount: Number(voucher.gift?.price || 0)
  };
}

function payoutStatusLabel(value) {
  const labels = {
    paid: "Paid",
    pending: "Pending",
    in_transit: "In transit",
    awaiting_payout: "Awaiting payout",
    processing: "Processing",
    review: "Review",
    untracked: "Legacy / untracked",
    loading: "Loading"
  };
  return labels[value] || "Outstanding";
}

function formatTraceDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IE", { dateStyle: "short", timeStyle: "short" });
}

function traceabilityStatus(voucher) {
  if (voucher.status === "redeemed") return "Redeemed";
  if (redeemedVenueValue(voucher) > 0) return "Part redeemed";
  return "Awaiting redemption";
}

function escapeTraceHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderPartnerTraceability(vouchers) {
  const voucherRows = partnerTraceabilityRows(vouchers, partnerTraceabilityFilter);
  const settlementRows = partnerAccountingReports.get(partnerTraceabilityFilter) || [];
  const rows = voucherRows.map(voucher => ({ voucher, settlement: settlementRowForVoucher(voucher, settlementRows) }));
  const summary = computeTraceabilitySummary(voucherRows);
  const settlementSummary = computeSettlementSummary(rows.map(row => row.settlement));

  document.querySelectorAll("[data-partner-traceability-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.partnerTraceabilityFilter === partnerTraceabilityFilter);
  });

  $("partnerTraceVenueValue").textContent = money(summary.venueValue);
  $("partnerTraceCustomerPaid").textContent = money(summary.customerPaid);
  $("partnerTraceFees").textContent = money(summary.fees);
  $("partnerTraceRedeemed").textContent = `${summary.redeemedCount} · ${money(summary.redeemedValue)}`;
  $("partnerTraceWaiting").textContent = String(summary.waitingCount);
  $("partnerTraceRefunds").textContent = money(settlementSummary.refunds);
  $("partnerTracePaidOut").textContent = money(settlementSummary.paidOut);
  $("partnerTraceOutstanding").textContent = money(settlementSummary.outstanding);

  const errorEl = $("partnerTraceabilityError");
  const reportError = partnerVouchersLoadError || partnerAccountingLoadError || "";
  errorEl.textContent = reportError;
  errorEl.classList.toggle("hidden", !reportError);

  const tbody = $("partnerTraceabilityRows");
  tbody.innerHTML = rows.map(({ voucher, settlement }) => `
    <tr>
      <td>${escapeTraceHtml(formatTraceDate(voucher.createdAt))}</td>
      <td><span class="partner-trace-code">${escapeTraceHtml(voucher.code)}</span></td>
      <td>${escapeTraceHtml(voucher.gift?.name || "Voucher")}</td>
      <td><span class="partner-trace-status partner-trace-status--${voucher.status === "redeemed" ? "redeemed" : "waiting"}">${traceabilityStatus(voucher)}</span></td>
      <td>${money(Number(voucher.gift?.price || 0))}</td>
      <td>${money(Number(settlement.customerPaid || voucher.total || 0))}</td>
      <td>${money(Number(settlement.refundAmount || 0))}</td>
      <td><span class="partner-trace-code">${escapeTraceHtml(settlement.paymentReference || "—")}</span></td>
      <td><span class="partner-trace-code">${escapeTraceHtml(settlement.transferReference || "—")}</span></td>
      <td><span class="partner-trace-status partner-trace-status--${settlement.payoutStatus === "paid" ? "redeemed" : "waiting"}">${escapeTraceHtml(payoutStatusLabel(settlement.payoutStatus))}</span></td>
      <td>${escapeTraceHtml(settlement.payoutDate ? formatTraceDate(settlement.payoutDate) : "—")}</td>
      <td><span class="partner-trace-code">${escapeTraceHtml(settlement.payoutReference || "—")}</span></td>
    </tr>
  `).join("");

  $("partnerTraceabilityEmpty").classList.toggle("hidden", rows.length > 0 || Boolean(partnerVouchersLoadError));
  tbody.closest(".partner-traceability-table-wrap").classList.toggle("hidden", rows.length === 0);
  $("partnerExportCsv").disabled = rows.length === 0 || Boolean(partnerVouchersLoadError);
  $("partnerPrintStatement").disabled = rows.length === 0 || Boolean(partnerVouchersLoadError);
}

function safeCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportPartnerTraceabilityCsv() {
  const vouchers = partnerTraceabilityRows(getPartnerVouchers(), partnerTraceabilityFilter);
  if (!vouchers.length) return;
  const settlements = partnerAccountingReports.get(partnerTraceabilityFilter) || [];
  const headings = ["Sale date", "Sale reference", "Venue", "Item sold", "Voucher status", "Venue value EUR", "Customer paid EUR", "PintDrop fee EUR", "Stripe fee EUR", "Refund EUR", "Payment reference", "Transfer reference", "Payout status", "Payout date", "Payout reference", "Outstanding EUR", "Reconciliation note"];
  const body = vouchers.map(voucher => {
    const row = settlementRowForVoucher(voucher, settlements);
    return [formatTraceDate(voucher.createdAt), voucher.code, voucher.pub?.name || partnerProfile?.pub_name || "", voucher.gift?.name || "Voucher",
      traceabilityStatus(voucher), Number(row.venueValue || 0).toFixed(2), Number(row.customerPaid || 0).toFixed(2),
      Number(row.pintDropFee || 0).toFixed(2), row.stripeFee == null ? "" : Number(row.stripeFee).toFixed(2),
      Number(row.refundAmount || 0).toFixed(2), row.paymentReference || "", row.transferReference || "", payoutStatusLabel(row.payoutStatus),
      row.payoutDate ? formatTraceDate(row.payoutDate) : "", row.payoutReference || "", Number(row.outstandingAmount || 0).toFixed(2), row.reconciliationNote || ""];
  });
  const csv = `\uFEFF${[headings, ...body].map(row => row.map(safeCsvCell).join(",")).join("\r\n")}`;
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `pintdrop-accountant-${partnerTraceabilityFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

function printPartnerAccountantStatement() {
  const vouchers = partnerTraceabilityRows(getPartnerVouchers(), partnerTraceabilityFilter);
  if (!vouchers.length) return;
  const settlements = partnerAccountingReports.get(partnerTraceabilityFilter) || [];
  const rows = vouchers.map(voucher => settlementRowForVoucher(voucher, settlements));
  const totals = computeTraceabilitySummary(vouchers);
  const settlementTotals = computeSettlementSummary(rows);
  const venue = escapeTraceHtml(partnerProfile?.pub_name || vouchers[0]?.pub?.name || "PintDrop venue");
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>PintDrop accountant statement</title><style>body{font:14px Arial,sans-serif;color:#17211b;margin:32px}h1{margin-bottom:4px}.meta{color:#607067}.totals{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0}.totals div{border:1px solid #ccd7d0;padding:12px;border-radius:8px}.totals span{display:block;color:#607067;font-size:12px}.totals strong{display:block;margin-top:5px;font-size:17px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #dce4df;padding:8px;text-align:left}th{background:#eef3f0}.foot{margin-top:20px;color:#607067;font-size:11px}@media print{body{margin:12mm}}</style></head><body><h1>${venue}</h1><p class="meta">PintDrop accountant statement · ${escapeTraceHtml(partnerTraceabilityFilter)} · Generated ${escapeTraceHtml(formatTraceDate(new Date()))}</p><section class="totals"><div><span>Venue value sold</span><strong>${money(totals.venueValue)}</strong></div><div><span>Refunds</span><strong>${money(settlementTotals.refunds)}</strong></div><div><span>Paid to venue</span><strong>${money(settlementTotals.paidOut)}</strong></div><div><span>Outstanding</span><strong>${money(settlementTotals.outstanding)}</strong></div></section><table><thead><tr><th>Date</th><th>Sale ref</th><th>Item</th><th>Venue value</th><th>Refund</th><th>Payout</th><th>Payout ref</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeTraceHtml(formatTraceDate(row.saleDate))}</td><td>${escapeTraceHtml(row.saleReference)}</td><td>${escapeTraceHtml(row.itemSold)}</td><td>${money(row.venueValue)}</td><td>${money(row.refundAmount)}</td><td>${escapeTraceHtml(payoutStatusLabel(row.payoutStatus))}</td><td>${escapeTraceHtml(row.payoutReference || "—")}</td></tr>`).join("")}</tbody></table><p class="foot">Customer and recipient names are intentionally excluded. Match payouts using the Stripe payout reference.</p><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}

function getPartnerAuthApi() {
  return window.PintDropSupabase?.PartnerAuth || null;
}

function withPartnerAuthTimeout(promise, message = PARTNER_AUTH_STALL_MESSAGE) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), PARTNER_AUTH_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function finishPartnerAuthAttempt() {
  partnerAuthAttemptDepth = Math.max(0, partnerAuthAttemptDepth - 1);
}

function resetPartnerLoginButton(submitBtn) {
  if (!submitBtn) return;
  submitBtn.disabled = false;
  submitBtn.textContent = "Log in";
}

function readPartnerShiftWindow() {
  try {
    const raw = localStorage.getItem(PARTNER_SHIFT_STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    const startedAt = Number(data?.startedAt);
    const expiresAt = Number(data?.expiresAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || expiresAt <= startedAt) {
      return null;
    }

    return { startedAt, expiresAt };
  } catch {
    return null;
  }
}

function setPartnerShiftExpiry() {
  const startedAt = Date.now();
  const expiresAt = startedAt + PARTNER_SHIFT_DURATION_MS;

  try {
    localStorage.setItem(PARTNER_SHIFT_STORAGE_KEY, JSON.stringify({ startedAt, expiresAt }));
  } catch (error) {
    console.warn("[PintDrop Partner Auth] Could not persist shift window:", error);
  }

  return { startedAt, expiresAt };
}

function clearPartnerShiftExpiry() {
  try {
    localStorage.removeItem(PARTNER_SHIFT_STORAGE_KEY);
  } catch (error) {
    console.warn("[PintDrop Partner Auth] Could not clear shift window:", error);
  }
}

function isPartnerShiftExpired() {
  const shift = readPartnerShiftWindow();
  if (!shift) return true;
  return Date.now() >= shift.expiresAt;
}

function hasValidPartnerShift() {
  return !isPartnerShiftExpired();
}

async function expirePartnerShiftSession() {
  if (partnerShiftExpireInFlight || partnerAuthAttemptDepth > 0) {
    return;
  }
  partnerShiftExpireInFlight = true;
  try {
    resetPartnerDashboardDom();
    const auth = getPartnerAuthApi();
    if (auth?.signOut) {
      await withPartnerAuthTimeout(
        auth.signOut(),
        PARTNER_AUTH_STALL_MESSAGE
      );
    }
    clearPartnerShiftExpiry();
    clearPartnerSessionState();
  } finally {
    partnerShiftExpireInFlight = false;
  }
}

function setPartnerPanelVisibility({
  loading = false,
  login = false,
  denied = false,
  register = false,
  signup = false,
  confirmEmail = false,
  dashboard = false
} = {}) {
  $("partnerAuthLoading")?.classList.toggle("hidden", !loading);
  $("partnerLogin")?.classList.toggle("hidden", !login);
  $("partnerAccessDenied")?.classList.toggle("hidden", !denied);
  $("partnerRegister")?.classList.toggle("hidden", !register);
  $("partnerSignup")?.classList.toggle("hidden", !signup);
  $("partnerConfirmEmail")?.classList.toggle("hidden", !confirmEmail);
  $("partnerDashboard")?.classList.toggle("hidden", !dashboard);
  const onPartnerView = $("partner")?.classList.contains("active");
  document.body.classList.toggle(
    "partner-login-active",
    onPartnerView && (loading || login || denied || register || signup || confirmEmail)
  );
}

function resetPartnerDashboardDom() {
  const pubNameEl = $("partnerDashboardPubName");
  if (pubNameEl) pubNameEl.textContent = "Pub Partner";

  const payoutStatus = $("stripeConnectStatus");
  if (payoutStatus) payoutStatus.textContent = "Payout setup: Not started";
  setPartnerPayoutsAction(false);

  const menuList = $("partnerMenuItems");
  if (menuList) menuList.innerHTML = "";
  const offerBarTab = $("partnerMenuOfferBarTab");
  if (offerBarTab) offerBarTab.checked = false;
  $("partnerMenuBarTabFields")?.classList.add("hidden");
  document.querySelectorAll('input[name="partnerBarTabAmount"]').forEach((input) => {
    input.checked = false;
  });

  const historyErrorEl = $("partnerHistoryError");
  if (historyErrorEl) {
    historyErrorEl.textContent = "";
    historyErrorEl.classList.add("hidden");
  }
  const activity = $("activityList");
  if (activity) activity.innerHTML = "";

  const menuErrorEl = $("partnerMenuError");
  if (menuErrorEl) {
    menuErrorEl.textContent = "";
    menuErrorEl.classList.add("hidden");
  }
  $("partnerMenuSuccess")?.classList.add("hidden");
  $("partnerOnboardingCard")?.classList.add("hidden");
  showPartnerOnboardingError("");
  showPartnerOnboardingSuccess("");
  const redeemResult = $("redeemResult");
  if (redeemResult) redeemResult.innerHTML = "";

  $("partnerDashboard")?.classList.add("hidden");
}

function clearPartnerSessionState() {
  partnerSession = null;
  partnerProfile = null;
  partnerProfileOwnerUserId = null;
  partnerProfileLoadError = false;
  partnerOnboardingStatus = null;
  partnerStripeConnectData = null;
  partnerMenuData = null;
  partnerMenuLoading = false;
  partnerVouchers = null;
  partnerVouchersLoadError = null;
  partnerAccountingReports.clear();
  partnerAccountingLoadError = null;
}

function isEmailNotConfirmedError(error) {
  return String(error?.message || error || "").toLowerCase().includes("email not confirmed");
}

async function preparePartnerAuthAttempt({ forcedScreen = null } = {}) {
  // Do not localStorage.clear() or delete invite/claim tokens.
  // Owner-invite tokens (if present) must survive logout and account switch.
  partnerAuthAttemptDepth += 1;
  partnerForcedScreen = forcedScreen;
  partnerUnconfirmedLogin = false;
  if (forcedScreen !== "confirmEmail") {
    partnerPendingConfirmEmail = "";
  }

  resetPartnerDashboardDom();
  clearPartnerSessionState();
  clearPartnerShiftExpiry();

  const auth = getPartnerAuthApi();
  if (auth?.signOut) {
    try {
      await withPartnerAuthTimeout(
        auth.signOut(),
        PARTNER_AUTH_STALL_MESSAGE
      );
    } catch (error) {
      console.warn("[PintDrop Partner Auth] Could not clear previous session:", error);
    }
  }
}

async function applyPartnerSession(session) {
  const shiftExpired = isPartnerShiftExpired();
  const shouldExpire = window.PintDropPartnerAuthView?.shouldExpirePartnerShiftOnSession({
    session,
    authAttemptInProgress: partnerAuthAttemptDepth > 0,
    shiftExpired
  });
  if (shouldExpire) {
    await expirePartnerShiftSession();
    return "logged_out";
  }

  partnerSession = session || null;
  partnerProfile = null;
  partnerProfileOwnerUserId = null;
  partnerProfileLoadError = false;
  partnerOnboardingStatus = null;
  partnerStripeConnectData = null;

  if (!partnerSession) {
    clearPartnerSessionState();
    return "logged_out";
  }

  if (!isPartnerEmailConfirmed()) {
    return "needs_confirmation";
  }

  const auth = getPartnerAuthApi();
  if (!auth?.fetchProfile) {
    clearPartnerSessionState();
    return "denied";
  }

  let profile = null;
  try {
    profile = await withPartnerAuthTimeout(
      auth.fetchProfile(),
      PARTNER_AUTH_STALL_MESSAGE
    );
  } catch (error) {
    console.warn("[PintDrop Partner Auth] profile load error:", error);
    partnerProfile = null;
    partnerProfileOwnerUserId = null;
    partnerProfileLoadError = true;
    return "load_error";
  }

  partnerOnboardingStatus = await refreshPartnerOnboardingStatus();

  const pubId = Number(profile?.pub_id);
  if (Number.isFinite(pubId) && pubId > 0) {
    partnerProfile = profile;
    partnerProfileOwnerUserId = partnerSession.user?.id || null;
    return "logged_in";
  }

  partnerProfile = null;
  partnerProfileOwnerUserId = null;
  return "needs_registration";
}

async function handlePartnerAuthStateChange(session) {
  if (partnerAuthAttemptDepth > 0) {
    return;
  }
  const wasLoggedIn = hasActivePartnerProfile();
  await applyPartnerSession(session);
  if ($("partner")?.classList.contains("active")) {
    void renderPartner();
  }
  if (!wasLoggedIn && hasActivePartnerProfile()) {
    await resumePendingPartnerRedemptionIfAny();
  }
}

async function initPartnerAuth() {
  if (partnerAuthReady) return;

  const auth = getPartnerAuthApi();
  if (!auth) {
    partnerAuthReady = true;
    return;
  }

  if (!partnerAuthUnsubscribe && auth.onAuthStateChange) {
    partnerAuthUnsubscribe = auth.onAuthStateChange((session) => {
      void handlePartnerAuthStateChange(session);
    });
  }

  const session = await auth.getSession();
  if (session && isPartnerShiftExpired()) {
    await expirePartnerShiftSession();
  } else {
    await applyPartnerSession(session);
  }
  partnerAuthReady = true;
}

async function ensurePartnerAuthReady() {
  if (partnerAuthReady) return;
  await initPartnerAuth();
}

function hasActivePartnerProfile() {
  const sessionUserId = partnerSession?.user?.id || null;
  return Boolean(
    hasValidPartnerShift()
    && partnerSession
    && isPartnerEmailConfirmed()
    && partnerProfile
    && Number.isFinite(Number(partnerProfile.pub_id))
    && Number(partnerProfile.pub_id) > 0
    && sessionUserId
    && partnerProfileOwnerUserId === sessionUserId
    && !partnerProfileLoadError
  );
}

function isPartnerEmailConfirmed() {
  const user = partnerSession?.user;
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  if (typeof partnerOnboardingStatus?.email_confirmed === "boolean") {
    return partnerOnboardingStatus.email_confirmed === true;
  }
  return false;
}

async function refreshPartnerOnboardingStatus() {
  const auth = getPartnerAuthApi();
  if (!auth?.fetchOnboardingStatus) {
    partnerOnboardingStatus = null;
    return null;
  }

  try {
    partnerOnboardingStatus = await auth.fetchOnboardingStatus();
  } catch (error) {
    console.warn("[PintDrop Partner Auth] onboarding status fetch failed:", error);
    partnerOnboardingStatus = null;
  }

  return partnerOnboardingStatus;
}

function normalizePartnerOnboardingStatusValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getPartnerOnboardingStatusValue() {
  return normalizePartnerOnboardingStatusValue(
    partnerOnboardingStatus?.onboarding_status
    || partnerOnboardingStatus?.onboardingStatus
    || partnerProfile?.onboarding_status
    || partnerProfile?.onboardingStatus
  );
}

function isSelfSignupOnboardingPub() {
  const status = getPartnerOnboardingStatusValue();
  return status === "draft" || status === "pending_approval" || status === "rejected";
}

function partnerCanSubmitForApproval() {
  if (!isSelfSignupOnboardingPub()) return false;
  const status = getPartnerOnboardingStatusValue();
  if (status !== "draft" && status !== "rejected") return false;
  if (partnerOnboardingStatus?.active === true || partnerProfile?.active === true) {
    return false;
  }
  return (
    partnerOnboardingStatus?.can_submit_for_approval === true
    || partnerOnboardingStatus?.canSubmitForApproval === true
  );
}

function formatPartnerOnboardingStatusLabel(status) {
  switch (normalizePartnerOnboardingStatusValue(status)) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Pending approval";
    case "rejected":
      return "Rejected";
    case "approved":
      return "Approved";
    default:
      return status ? String(status) : "Unknown";
  }
}

function partnerOnboardingLeadCopy() {
  const status = getPartnerOnboardingStatusValue();
  const checklist = partnerOnboardingStatus?.checklist || {};
  const rejectionReason = String(
    partnerOnboardingStatus?.rejection_reason
    || partnerOnboardingStatus?.rejectionReason
    || partnerProfile?.rejection_reason
    || ""
  ).trim();

  if (status === "pending_approval") {
    return "PintDrop is reviewing your pub. It stays hidden from customers until it is approved.";
  }
  if (status === "rejected") {
    return rejectionReason
      ? `Rejected: ${rejectionReason}`
      : "Your application was not approved. Update your details and submit again when you are ready.";
  }
  if (partnerCanSubmitForApproval()) {
    return "Your pub is still a draft. Submit for PintDrop review when you are ready.";
  }

  const missing = [];
  if (checklist.account_verified === false) missing.push("email confirmation");
  if (checklist.pub_details === false) missing.push("pub details");
  if (checklist.menu_ready === false) missing.push("drinks & prices");
  if (checklist.payouts_ready === false) missing.push("payout setup");
  if (missing.length) {
    return `Finish ${missing.join(", ")} before you can submit for approval.`;
  }
  return "Your pub stays a draft until PintDrop reviews and approves it.";
}

function showPartnerOnboardingError(message) {
  const errorEl = $("partnerOnboardingError");
  if (!errorEl) return;
  errorEl.textContent = message || "";
  errorEl.classList.toggle("hidden", !message);
}

function showPartnerOnboardingSuccess(message) {
  const successEl = $("partnerOnboardingSuccess");
  if (!successEl) return;
  successEl.textContent = message || "";
  successEl.classList.toggle("hidden", !message);
}

function setPartnerOnboardingBusy(busy) {
  const button = $("partnerSubmitApprovalBtn");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Submitting…" : "Submit for approval";
}

function renderPartnerOnboardingCard() {
  const card = $("partnerOnboardingCard");
  const statusEl = $("partnerOnboardingStatus");
  const leadEl = $("partnerOnboardingLead");
  const submitBtn = $("partnerSubmitApprovalBtn");
  if (!card) return;

  const showCard = isSelfSignupOnboardingPub();
  card.classList.toggle("hidden", !showCard);
  if (!showCard) {
    showPartnerOnboardingError("");
    showPartnerOnboardingSuccess("");
    if (submitBtn) submitBtn.classList.add("hidden");
    return;
  }

  const status = getPartnerOnboardingStatusValue();
  if (statusEl) {
    statusEl.textContent = `Status: ${formatPartnerOnboardingStatusLabel(status)}`;
  }
  if (leadEl) {
    leadEl.textContent = partnerOnboardingLeadCopy();
  }

  const canSubmit = partnerCanSubmitForApproval();
  if (submitBtn) {
    submitBtn.classList.toggle("hidden", !canSubmit);
    if (!submitBtn.disabled) {
      submitBtn.textContent = "Submit for approval";
    }
  }
}

function normalizePartnerSubmitError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();
  if (!message) return "Could not submit your pub for approval. Please try again.";
  if (lower.includes("not complete enough")) {
    return "Finish drinks, payouts, and pub details before submitting for approval.";
  }
  if (lower.includes("partner authentication required")) {
    return "Please sign in again to submit for approval.";
  }
  return message;
}

async function handlePartnerSubmitForApproval() {
  const auth = getPartnerAuthApi();
  const submitBtn = $("partnerSubmitApprovalBtn");
  if (!partnerCanSubmitForApproval() || !submitBtn || submitBtn.classList.contains("hidden")) {
    return;
  }

  if (!auth?.submitMyPubForApproval) {
    showPartnerOnboardingSuccess("");
    showPartnerOnboardingError("Submit for approval is not available.");
    return;
  }

  showPartnerOnboardingError("");
  showPartnerOnboardingSuccess("");
  setPartnerOnboardingBusy(true);

  const result = await auth.submitMyPubForApproval();
  if (!result?.ok) {
    setPartnerOnboardingBusy(false);
    showPartnerOnboardingError(normalizePartnerSubmitError(result?.error));
    return;
  }

  await applyPartnerSession(partnerSession || (await auth.getSession()));
  setPartnerOnboardingBusy(false);
  renderPartnerOnboardingCard();
  showPartnerOnboardingSuccess("Submitted for approval. Your pub stays a draft until PintDrop reviews it.");
}

function getPartnerAccessToken() {
  return partnerSession?.access_token || null;
}

function buildPartnerConnectRequestInit(body = {}) {
  const headers = { "Content-Type": "application/json" };
  const accessToken = getPartnerAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  };
}

function normalizePartnerStripeConnectData(data) {
  if (!data) return null;

  return {
    stripe_payouts_ready: data.stripe_payouts_ready === true || data.stripePayoutsReady === true,
    stripe_onboarding_status: String(
      data.stripe_onboarding_status || data.stripeOnboardingStatus || "not_started"
    ).trim().toLowerCase(),
    stripe_account_id: data.stripe_account_id || data.stripeAccountId || null,
    active: data.active,
    onboarding_status: data.onboarding_status || data.onboardingStatus || null
  };
}

function applyPartnerPayoutStatusUi(data) {
  const status = $("stripeConnectStatus");
  if (!status) return;

  const normalized = normalizePartnerStripeConnectData(data);
  if (!normalized) return;

  if (normalized.stripe_payouts_ready) {
    status.textContent = "Payout setup: Payouts ready";
    setPartnerPayoutsAction(true);
    return;
  }

  setPartnerPayoutsAction(false);

  if (normalized.stripe_onboarding_status === "not_started") {
    status.textContent = "Payout setup: Not started";
    return;
  }

  status.textContent = "Payout setup: Setup incomplete";
}

function isPartnerStripeConnectReturn() {
  const params = new URLSearchParams(location.search);
  return params.get("connect") === "return";
}

function clearPartnerConnectReturnParam() {
  const params = new URLSearchParams(location.search);
  if (params.get("connect") !== "return") return;

  params.delete("connect");
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}

async function fetchPartnerAccountStatus() {
  const response = await fetch(
    "/api/stripe-connect/account-status",
    buildPartnerConnectRequestInit({})
  );

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    console.warn("[PintDrop Stripe Connect] Invalid account-status response:", error);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Could not load payout status.");
  }

  return data;
}

async function refreshPartnerPayoutStatus(options = {}) {
  const status = $("stripeConnectStatus");
  if (!status || !hasActivePartnerProfile()) return;

  partnerStripeConnectData = null;
  const forceLiveSync = options.forceLiveSync === true || isPartnerStripeConnectReturn();

  let rpcData = null;
  const auth = getPartnerAuthApi();
  if (auth?.fetchStripeConnect) {
    try {
      rpcData = await auth.fetchStripeConnect();
    } catch (error) {
      console.warn("[PintDrop Partner Auth] Stripe connect fetch failed:", error);
    }
  }

  const normalizedRpc = normalizePartnerStripeConnectData(rpcData);
  const shouldLiveSync =
    forceLiveSync
    || (
      Boolean(normalizedRpc?.stripe_account_id)
      && !normalizedRpc?.stripe_payouts_ready
    );

  if (shouldLiveSync && getPartnerAccessToken()) {
    try {
      const data = await fetchPartnerAccountStatus();
      partnerStripeConnectData = normalizePartnerStripeConnectData(data);
      applyPartnerPayoutStatusUi(data);
      if (isPartnerStripeConnectReturn()) {
        clearPartnerConnectReturnParam();
      }
      return;
    } catch (error) {
      console.warn("[PintDrop Stripe Connect] Live payout status refresh failed:", error);
    }
  }

  if (rpcData) {
    partnerStripeConnectData = normalizedRpc;
    applyPartnerPayoutStatusUi(rpcData);
    return;
  }

  if (!getPartnerAccessToken()) {
    return;
  }

  try {
    const data = await fetchPartnerAccountStatus();
    partnerStripeConnectData = normalizePartnerStripeConnectData(data);
    applyPartnerPayoutStatusUi(data);
  } catch (error) {
    console.warn("[PintDrop Stripe Connect] Payout status refresh failed:", error);
  }
}

function setPartnerPayoutsAction(ready) {
  const button = $("setupPayoutsBtn");
  if (!button) return;

  if (ready) {
    button.disabled = true;
    button.textContent = "✓ Payouts connected";
    button.classList.add("partner-payouts-connected");
    return;
  }

  button.disabled = false;
  button.textContent = "Set up payouts";
  button.classList.remove("partner-payouts-connected");
}

async function startPartnerPayoutSetup() {
  const button = $("setupPayoutsBtn");
  const status = $("stripeConnectStatus");
  if (!button || button.disabled || !hasActivePartnerProfile()) return;

  if (!getPartnerAccessToken()) {
    if (status) status.textContent = "Please sign in again to set up payouts.";
    return;
  }

  button.disabled = true;
  if (status) status.textContent = "Opening Stripe payout setup…";

  try {
    const response = await fetch(
      "/api/stripe-connect/account-link",
      buildPartnerConnectRequestInit({})
    );

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      console.warn("[PintDrop Stripe Connect] Invalid account-link response:", error);
    }

    if (!response.ok || !data?.url) {
      throw new Error(data?.error || "Could not start payout setup.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.warn("[PintDrop Stripe Connect] Payout setup failed:", error);
    if (status) {
      status.textContent = error?.message || "Could not start payout setup.";
    }
    button.disabled = false;
  }
}

function normalizePartnerMenuError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();

  if (!message) return "Could not save your menu. Please try again.";
  if (lower.includes("partner authentication required")) return "Please sign in to continue.";
  if (lower.includes("invalid drink type")) return "Invalid drink selection.";
  if (lower.includes("duplicate menu item")) return "Duplicate drink entries are not allowed.";
  if (lower.includes("invalid price")) return "Enter a valid price for each available drink.";
  if (lower.includes("price is required")) return "Enter a price for each available drink.";
  if (lower.includes("at least one standard drink")) return "Make at least one standard drink available.";
  if (lower.includes("enable bar tab")) return "Turn on Offer Bar Tab before configuring it.";
  if (lower.includes("choose at least one bar tab amount")) return "Choose at least one Bar Tab amount (€20, €30 or €50).";
  if (lower.includes("too many menu items")) return "Too many menu items.";
  if (lower.includes("at least one drink is required")) return "Add at least one drink.";

  return message;
}

function getSelectedPartnerBarTabPresets() {
  return [...document.querySelectorAll('input[name="partnerBarTabAmount"]:checked')]
    .map((input) => Number(input.value))
    .filter((value) => BAR_TAB_PRESETS.includes(value));
}

function setSelectedPartnerBarTabPresets(prices) {
  const selected = new Set((prices || []).filter((value) => BAR_TAB_PRESETS.includes(Number(value))).map(Number));
  document.querySelectorAll('input[name="partnerBarTabAmount"]').forEach((input) => {
    input.checked = selected.has(Number(input.value));
  });
}

function partnerMenuBarTabItems() {
  const items = Array.isArray(partnerMenuData?.items) ? partnerMenuData.items : [];
  return items.filter((item) => item.is_bar_tab || isBarTabSlug(item.slug));
}

function partnerMenuLegacyBarTabItem() {
  return partnerMenuBarTabItems().find((item) => item.slug === "tab" && item.saved !== false) || null;
}

function savedPartnerBarTabPresetPrices() {
  const prices = [];
  const seen = new Set();

  partnerMenuBarTabItems().forEach((item) => {
    if (item.saved === false || !item.active) return;
    const slugPreset = barTabPresetFromSlug(item.slug);
    if (slugPreset && Number(item.price) === slugPreset && !seen.has(slugPreset)) {
      seen.add(slugPreset);
      prices.push(slugPreset);
    }
  });

  if (prices.length) return prices;

  const legacy = partnerMenuLegacyBarTabItem();
  if (legacy?.active && isExactBarTabPreset(legacy.price) && !seen.has(Number(legacy.price))) {
    prices.push(Number(legacy.price));
  }

  return prices;
}

function updatePartnerBarTabLegacyNotice() {
  const notice = $("partnerMenuBarTabLegacy");
  if (!notice) return;

  const offersBarTab = Boolean($("partnerMenuOfferBarTab")?.checked);
  const legacy = partnerMenuLegacyBarTabItem();
  const hasLegacyNonPreset = Boolean(
    legacy
    && legacy.saved !== false
    && Number(legacy.price) > 0
    && !isExactBarTabPreset(legacy.price)
  );

  if (!offersBarTab || !hasLegacyNonPreset) {
    notice.classList.add("hidden");
    notice.textContent = "";
    return;
  }

  notice.textContent = "Your saved Bar Tab amount isn’t €20, €30 or €50. Choose one or both of those amounts to keep offering Bar Tab. The old amount is left unchanged until you save.";
  notice.classList.remove("hidden");
}

function formatPartnerMenuPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return "";
  return price.toFixed(2);
}

function renderPartnerMenuForm() {
  const list = $("partnerMenuItems");
  const barTabBlock = $("partnerMenuBarTab");
  if (!list) return;

  if (partnerMenuLoading) {
    list.innerHTML = `<p class="partner-menu-loading">Loading menu…</p>`;
    return;
  }

  if (!partnerMenuData) {
    list.innerHTML = `<p class="partner-menu-empty">Menu could not be loaded.</p>`;
    return;
  }

  const items = Array.isArray(partnerMenuData.items) ? partnerMenuData.items : [];
  const standardItems = items.filter(item => !item.is_bar_tab && !isBarTabSlug(item.slug));

  list.innerHTML = standardItems.map((item) => {
    const priceValue = formatPartnerMenuPrice(item.price);
    const activeChecked = item.active ? "checked" : "";
    return `
      <div class="partner-menu-row" data-menu-slug="${item.slug}">
        <span class="partner-menu-name">${item.name}</span>
        <label class="partner-menu-price-field">
          <span class="partner-menu-currency">€</span>
          <input
            type="number"
            min="0.01"
            max="500"
            step="0.01"
            inputmode="decimal"
            placeholder="0.00"
            value="${priceValue}"
            data-menu-price="${item.slug}"
          />
        </label>
        <label class="partner-menu-toggle partner-menu-toggle-inline">
          <input type="checkbox" data-menu-active="${item.slug}" ${activeChecked} />
          <span>Available</span>
        </label>
      </div>
    `;
  }).join("");

  const offersBarTab = Boolean(partnerMenuData.offers_bar_tab);
  if (barTabBlock) {
    const offerCheckbox = $("partnerMenuOfferBarTab");
    const fields = $("partnerMenuBarTabFields");

    if (offerCheckbox) offerCheckbox.checked = offersBarTab;
    if (fields) fields.classList.toggle("hidden", !offersBarTab);
    setSelectedPartnerBarTabPresets(savedPartnerBarTabPresetPrices());
    updatePartnerBarTabLegacyNotice();
  }
}

function collectPartnerMenuPayload() {
  const items = [];
  const standardRows = document.querySelectorAll("#partnerMenuItems .partner-menu-row");

  standardRows.forEach((row) => {
    const slug = row.getAttribute("data-menu-slug");
    const priceInput = row.querySelector(`[data-menu-price="${slug}"]`);
    const activeInput = row.querySelector(`[data-menu-active="${slug}"]`);
    const active = Boolean(activeInput?.checked);
    const rawPrice = String(priceInput?.value || "").trim();

    const item = { slug, active };
    if (rawPrice) item.price = Number(rawPrice);
    items.push(item);
  });

  const offersBarTab = Boolean($("partnerMenuOfferBarTab")?.checked);
  if (offersBarTab) {
    const selected = new Set(getSelectedPartnerBarTabPresets());
    BAR_TAB_PRESETS.forEach((price) => {
      const item = {
        slug: `tab-${price}`,
        active: selected.has(price)
      };
      if (selected.has(price)) item.price = price;
      items.push(item);
    });
  }

  return { offers_bar_tab: offersBarTab, items };
}

function validatePartnerMenuPayload(payload) {
  const items = payload?.items || [];
  const standardActive = items.filter(item => !isBarTabSlug(item.slug) && item.active);

  if (!standardActive.length) {
    return "Make at least one standard drink available.";
  }

  for (const item of items) {
    if (!item.active || isBarTabSlug(item.slug)) continue;
    if (!Number.isFinite(item.price) || item.price <= 0 || item.price > 500) {
      return "Enter a valid price for each available drink (€0.01–€500).";
    }
  }

  if (payload.offers_bar_tab) {
    const selectedPresets = items.filter((item) => (
      item.active && BAR_TAB_PRESETS.includes(barTabPresetFromSlug(item.slug))
    ));
    if (!selectedPresets.length) {
      return "Choose at least one Bar Tab amount (€20, €30 or €50).";
    }
  }

  return "";
}

async function loadPartnerMenu() {
  partnerMenuData = null;
  partnerMenuLoading = false;

  if (!hasActivePartnerProfile()) {
    const list = $("partnerMenuItems");
    if (list) list.innerHTML = "";
    return;
  }

  const auth = getPartnerAuthApi();
  if (!auth?.fetchMenu) {
    renderPartnerMenuForm();
    return;
  }

  partnerMenuLoading = true;
  renderPartnerMenuForm();

  const errorEl = $("partnerMenuError");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  try {
    partnerMenuData = await auth.fetchMenu();
  } catch (error) {
    console.warn("[PintDrop Partner Menu] Load failed:", error);
    partnerMenuData = null;
    if (errorEl) {
      errorEl.textContent = normalizePartnerMenuError(error);
      errorEl.classList.remove("hidden");
    }
  } finally {
    partnerMenuLoading = false;
  }

  renderPartnerMenuForm();
}

async function handlePartnerMenuSave(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const errorEl = $("partnerMenuError");
  const successEl = $("partnerMenuSuccess");
  const submitBtn = $("partnerMenuSaveBtn");
  const payload = collectPartnerMenuPayload();
  const validationError = validatePartnerMenuPayload(payload);

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
  if (successEl) successEl.classList.add("hidden");

  if (validationError) {
    if (errorEl) {
      errorEl.textContent = validationError;
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (!auth?.saveMenu) {
    if (errorEl) {
      errorEl.textContent = "Menu saving is not available.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
  }

  const result = await auth.saveMenu(payload);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save drinks & prices";
  }

  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = normalizePartnerMenuError(result.error);
      errorEl.classList.remove("hidden");
    }
    return;
  }

  partnerMenuData = result.menu || partnerMenuData;
  renderPartnerMenuForm();

  if (successEl) successEl.classList.remove("hidden");

  if (isSelfSignupOnboardingPub() || getPartnerAuthApi()?.fetchOnboardingStatus) {
    await refreshPartnerOnboardingStatus();
    renderPartnerOnboardingCard();
  }
}

async function renderPartner() {
  await ensurePartnerAuthReady();

  if (!getPartnerAuthApi()) {
    resetPartnerDashboardDom();
    setPartnerPanelVisibility({ login: true });
    const errorEl = $("partnerLoginError");
    if (errorEl) {
      errorEl.textContent = "Partner login is not configured.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (!partnerAuthReady) {
    setPartnerPanelVisibility({ loading: true });
    return;
  }

  if (partnerSession) {
    await applyPartnerSession(partnerSession);
  }

  const viewApi = window.PintDropPartnerAuthView;
  const view = viewApi?.resolvePartnerAuthView({
    session: partnerSession,
    emailConfirmed: isPartnerEmailConfirmed(),
    profile: partnerProfile,
    profileOwnerUserId: partnerProfileOwnerUserId,
    pendingConfirmEmail: partnerPendingConfirmEmail,
    unconfirmedLogin: partnerUnconfirmedLogin,
    profileLoadError: partnerProfileLoadError,
    forcedScreen: partnerForcedScreen
  }) || "login";

  if (view !== "dashboard") {
    resetPartnerDashboardDom();
  }

  if (view === "signup") {
    setPartnerPanelVisibility({ signup: true });
    return;
  }

  if (view === "confirmEmail") {
    setPartnerConfirmEmailCopy(
      partnerSession?.user?.email || partnerPendingConfirmEmail,
      { unconfirmedLogin: partnerUnconfirmedLogin }
    );
    setPartnerPanelVisibility({ confirmEmail: true });
    return;
  }

  if (view === "register") {
    partnerForcedScreen = null;
    partnerPendingConfirmEmail = "";
    setPartnerPanelVisibility({ register: true });
    return;
  }

  if (view !== "dashboard" || !hasActivePartnerProfile()) {
    if (partnerProfileLoadError) {
      const errorEl = $("partnerLoginError");
      if (errorEl) {
        errorEl.textContent = "Could not load your pub. Please try again.";
        errorEl.classList.remove("hidden");
      }
    }
    if (view !== "signup" && view !== "confirmEmail" && view !== "register") {
      setPartnerPanelVisibility({ login: true });
    }
    return;
  }

  partnerForcedScreen = null;
  partnerPendingConfirmEmail = "";
  partnerUnconfirmedLogin = false;
  setPartnerPanelVisibility({ dashboard: true });

  const pubNameEl = $("partnerDashboardPubName");
  if (pubNameEl) {
    pubNameEl.textContent = partnerProfile?.pub_name || "Pub Partner";
  }

  await refreshPartnerOnboardingStatus();
  renderPartnerOnboardingCard();

  await loadPartnerMenu();
  await loadPartnerVouchers();
  await loadPartnerAccountingReport(partnerTraceabilityFilter);
  const vouchers = getPartnerVouchers();

  document.querySelectorAll("[data-partner-history-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.partnerHistoryFilter === partnerHistoryFilter);
  });

  const historyErrorEl = $("partnerHistoryError");
  if (historyErrorEl) {
    if (partnerVouchersLoadError) {
      historyErrorEl.textContent = partnerVouchersLoadError;
      historyErrorEl.classList.remove("hidden");
    } else {
      historyErrorEl.textContent = "";
      historyErrorEl.classList.add("hidden");
    }
  }

  const activity = vouchers
    .filter(v => v.status === "redeemed")
    .filter(v => voucherMatchesPeriod(v, partnerHistoryFilter))
    .sort((a, b) => new Date(getVoucherActivityTime(b)) - new Date(getVoucherActivityTime(a)));

  $("activityList").innerHTML = partnerVouchersLoadError
    ? ""
    : (activity.length
      ? activity.map(voucher => partnerRedemptionItem(voucher)).join("")
      : `<p class="note partner-history-empty">No redemptions for this period.</p>`);

  renderPartnerTraceability(vouchers);

  void refreshPartnerPayoutStatus();
}

function setPartnerHistoryFilter(period) {
  partnerHistoryFilter = period;
  partnerActivityFilter = period;
  void renderPartner();
}

function setPartnerTraceabilityFilter(period) {
  partnerTraceabilityFilter = period;
  renderPartnerTraceability(getPartnerVouchers());
  void loadPartnerAccountingReport(period).then(() => renderPartnerTraceability(getPartnerVouchers()));
}

function voucherRow(voucher, waiting = false) {
  return `
    <div class="voucher-row ${waiting ? "voucher-row-waiting" : "voucher-row-redeemed"}">
      <div class="voucher-row-icon">${voucher.gift.icon}</div>
      <div class="voucher-row-copy">
        <strong>${voucher.recipient} · ${voucher.gift.name}</strong>
        <small>From ${voucher.sender} · ${voucher.pub.name}, ${voucher.pub.town}</small>
        <small class="voucher-row-code">${voucher.code}</small>
      </div>
      <div class="voucher-row-meta">
        <div class="amount">${money(voucher.gift.price)}</div>
        <span class="voucher-row-status ${voucher.status}">${voucher.status === "waiting" ? "Waiting" : "Redeemed"}</span>
      </div>
    </div>
  `;
}

function renderRedeemValid(voucher) {
  $("redeemResult").innerHTML = `
    <div class="result result-valid redeem-preview">
      <div class="redeem-valid-badge">Voucher valid</div>
      <dl class="redeem-details">
        <div><dt>Recipient</dt><dd>${voucher.recipient}</dd></div>
        <div><dt>Sender</dt><dd>${voucher.sender}</dd></div>
        <div><dt>Gift</dt><dd>${voucher.gift.icon} ${voucher.gift.name}</dd></div>
        <div><dt>Pub</dt><dd>${voucher.pub.name}, ${voucher.pub.town}</dd></div>
        <div><dt>Voucher ID</dt><dd>${voucher.code}</dd></div>
      </dl>
      <button type="button" class="primary redeem-pint-btn" id="confirmRedeem">Redeem ${voucher.gift.name}</button>
    </div>
  `;

  $("confirmRedeem").onclick = () => { void completeRedemption(voucher.id); };
}

async function completeRedemption(voucherId) {
  let existing = readVouchers().find(v => v.id === voucherId);
  if (!existing && activeRedemptionVoucher?.id === voucherId) {
    existing = activeRedemptionVoucher;
  }

  if (!existing) {
    $("redeemResult").innerHTML = `<div class="result error">Voucher not found. Check the code and try again.</div>`;
    return;
  }

  if (existing.status === "redeemed") {
    $("redeemResult").innerHTML = `<div class="result">This voucher has already been redeemed.</div>`;
    return;
  }

  const result = await redeemVoucherById(voucherId);
  if (!result.ok) {
    $("redeemResult").innerHTML = `<div class="result error">${result.error}</div>`;
    return;
  }

  const voucher = result.voucher;
  activeRedemptionVoucher = voucher;

  $("redeemResult").innerHTML = `
    <div class="result result-success result-success-animate">
      <div class="redeem-success-tick">✓</div>
      <strong>Voucher redeemed successfully</strong>
      <p>${voucher.recipient} collected their ${voucher.gift.name} at ${voucher.pub.name}</p>
      <p class="redeem-time">${formatDateTime(voucher.redeemedAt)}</p>
    </div>
  `;

  $("redeemCode").value = "";
  $("scannerDemo").classList.add("hidden");
  renderPartner();
  renderVoucher();
  renderSms();
  showSenderNotification(voucher);
}

$("redeemForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const input = $("redeemCode").value.trim();
  if (!input) return;

  $("redeemResult").innerHTML = "";
  await processBarRedemption(input);
});


function showSenderNotification(voucher, redemption) {
  const note = $("senderNotification");
  $("senderNotificationText").textContent = buildSenderNotificationText(voucher, redemption);
  note.classList.remove("hidden");
  requestAnimationFrame(() => note.classList.add("show"));
  setTimeout(() => note.classList.remove("show"), 5000);
  setTimeout(() => note.classList.add("hidden"), 5500);
}

$("scanLatestVoucher").addEventListener("click", () => {
  if (partnerQrScanActive || !$("scannerDemo").classList.contains("hidden")) {
    void stopPartnerQrScan();
    return;
  }

  startPartnerQrScan();
});

$("redemptionRedeemBtn")?.addEventListener("click", () => {
  if (!activeRedemptionVoucherId) return;
  const voucher = activeRedemptionVoucher
    || readVouchers().find(v => v.id === activeRedemptionVoucherId);
  if (!voucher || voucher.status === "redeemed") return;
  if (isBarTabVoucher(voucher)) return;
  showRedemptionConfirm();
});

$("redemptionBarTabAmount")?.addEventListener("input", () => {
  const voucher = activeRedemptionVoucher;
  if (!voucher || !isBarTabVoucher(voucher) || isBarTabFullyRedeemed(voucher)) return;
  const raw = $("redemptionBarTabAmount")?.value;
  const btn = $("redemptionBarTabRedeemBtn");
  if (btn) {
    btn.textContent = getBarTabRedeemButtonLabel(voucher, raw);
    btn.disabled = !isBarTabRedeemAmountValid(voucher, raw);
  }
});

$("redemptionBarTabRedeemBtn")?.addEventListener("click", () => {
  if (!activeRedemptionVoucherId) return;
  const voucher = activeRedemptionVoucher
    || readVouchers().find(v => v.id === activeRedemptionVoucherId);
  if (!voucher || !isBarTabVoucher(voucher)) return;
  if (isBarTabFullyRedeemed(voucher)) {
    renderRedemptionScreen(voucher, { barMode: true });
    return;
  }

  const amount = parseRedemptionAmount($("redemptionBarTabAmount")?.value);
  const check = validateBarTabRedeemAmount(voucher, amount);
  if (!check.ok) {
    renderRedemptionScreen(voucher, {
      barMode: true,
      redeemFailed: true,
      errorMessage: check.error
    });
    return;
  }

  pendingBarTabRedeemAmount = check.amount;
  $("redemptionConfirmCopy").textContent =
    `Confirm ${formatBarTabAmount(check.amount)} from this Bar Tab for ${voucher.recipient}.`;
  showRedemptionConfirm();
});

$("redemptionConfirmCancel")?.addEventListener("click", hideRedemptionConfirm);

$("redemptionConfirmOk")?.addEventListener("click", async () => {
  if (!activeRedemptionVoucherId) return;
  hideRedemptionConfirm();

  const before = activeRedemptionVoucher
    || readVouchers().find(v => v.id === activeRedemptionVoucherId);
  if (!before) return;

  if (isBarTabVoucher(before)) {
    if (isBarTabFullyRedeemed(before)) {
      renderRedemptionScreen(before, { barMode: true });
      return;
    }
    const result = await redeemBarTabById(activeRedemptionVoucherId, pendingBarTabRedeemAmount);
    pendingBarTabRedeemAmount = null;
    if (!result.ok) {
      renderRedemptionScreen(before, {
        barMode: true,
        redeemFailed: true,
        errorMessage: result.error
      });
      return;
    }
    activeRedemptionVoucher = result.voucher;
    if ($("redemptionBarTabAmount") && !isBarTabFullyRedeemed(result.voucher)) {
      $("redemptionBarTabAmount").value = "";
    }
    renderRedemptionScreen(result.voucher, {
      barMode: true,
      lastBarTabRedemption: result.redemption
    });
    partnerVouchers = null;
    void renderPartner();
    renderVoucher();
    renderSms();
    showSenderNotification(result.voucher, result.redemption);
    return;
  }

  if (before.status === "redeemed") {
    renderRedemptionScreen(before);
    return;
  }

  const result = await redeemVoucherById(activeRedemptionVoucherId);
  if (!result.ok) {
    renderRedemptionScreen(before, {
      barMode: true,
      redeemFailed: true,
      errorMessage: result.error
    });
    return;
  }

  const voucher = result.voucher;
  activeRedemptionVoucher = voucher;

  redemptionJustConfirmed = true;
  renderRedemptionScreen(voucher, { barMode: true });
  partnerVouchers = null;
  void renderPartner();
  renderVoucher();
  renderSms();
  showSenderNotification(voucher);
});

function leaveRedemptionScreen() {
  hideRedemptionConfirm();
  history.replaceState(null, "", location.pathname + location.search);
  switchView("partner");
}

$("redemptionBackBtn")?.addEventListener("click", leaveRedemptionScreen);
$("redemptionEmptyBack")?.addEventListener("click", leaveRedemptionScreen);

window.addEventListener("hashchange", async () => {
  const route = parseRedeemRoute();
  if (!route?.code) return;

  if (route.isStaffRedemption) {
    await processBarRedemption(route.code, { updateHash: false });
    return;
  }

  await openRecipientVoucherView(route.code, { updateHash: false });
});

async function resetDemoState() {
  localStorage.removeItem("pintdrop_vouchers");
  localStorage.removeItem("pintdrop_last_voucher");
  localStorage.removeItem(PARTNER_DEMO_SEED_KEY);
  partnerVouchers = null;
  activeRedemptionVoucherId = null;
  activeRedemptionVoucher = null;
  redemptionJustConfirmed = false;
  partnerHistoryFilter = "today";
  partnerActivityFilter = "today";
  hideRedemptionConfirm();
  history.replaceState(null, "", location.pathname + location.search);
  seedPartnerDemoData({ force: true });
  $("redeemResult").innerHTML = "";
  await stopPartnerQrScan();
  $("redeemCode").value = "";
  pendingOrder = null;
  paymentProcessing = false;
  clearPendingOrderStorage();
  resetProcessingSteps();
  await applyDemoDefaults();
  setPurchaseStep("details");
  switchView("customer");
  partnerVouchers = null;
  await renderPartner();
  renderVoucher();
  renderSms();
}

function showPartnerRegisterError(message) {
  const errorEl = $("partnerRegisterError");
  if (!errorEl) return;
  errorEl.textContent = message || "";
  errorEl.classList.toggle("hidden", !message);
}

function setPartnerRegisterBusy(busy, statusText) {
  const form = $("partnerRegisterForm");
  const submitBtn = $("partnerRegisterBtn");
  const statusEl = $("partnerRegisterStatus");
  const fieldIds = [
    "partnerRegisterPubName",
    "partnerRegisterLocation",
    "partnerRegisterContactName",
    "partnerRegisterContactPhone"
  ];

  if (busy) showPartnerRegisterError("");
  form?.setAttribute("aria-busy", busy ? "true" : "false");
  fieldIds.forEach((id) => {
    const field = $(id);
    if (field) field.disabled = busy;
  });
  if (submitBtn) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? "Creating pub account…" : "Create pub account";
  }
  if (statusEl) {
    statusEl.textContent = busy && statusText ? statusText : "";
    statusEl.classList.toggle("hidden", !(busy && statusText));
  }
}

function resetPartnerRegisterForm() {
  $("partnerRegisterForm")?.reset();
  showPartnerRegisterError("");
  setPartnerRegisterBusy(false);
}

function readPartnerRegisterFields() {
  return {
    pubName: String($("partnerRegisterPubName")?.value || "").trim(),
    location: String($("partnerRegisterLocation")?.value || "").trim(),
    contactName: String($("partnerRegisterContactName")?.value || "").trim(),
    contactPhone: String($("partnerRegisterContactPhone")?.value || "").trim()
  };
}

function validatePartnerRegisterFields(fields) {
  if (fields.pubName.length < 2 || fields.pubName.length > 120) {
    return "Pub name is required (2–120 characters).";
  }
  if (fields.location.length < 2 || fields.location.length > 160) {
    return "Town / location is required (2–160 characters).";
  }
  if (fields.contactName.length < 2 || fields.contactName.length > 120) {
    return "Contact name is required (2–120 characters).";
  }
  if (fields.contactPhone.length < 7 || fields.contactPhone.length > 40) {
    return "Contact phone is required (7–40 characters).";
  }
  return "";
}

function normalizePartnerRegisterError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();

  if (!message) return "Could not create your pub account. Please try again.";
  if (lower.includes("email confirmation required")) {
    return "Please confirm your email before creating a pub account.";
  }
  if (lower.includes("partner authentication required")) {
    return "Please sign in again to create your pub account.";
  }
  return message;
}

async function handlePartnerRegisterSubmit(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const fields = readPartnerRegisterFields();
  const validationError = validatePartnerRegisterFields(fields);
  if (validationError) {
    showPartnerRegisterError(validationError);
    return;
  }

  if (!auth?.registerDraftPub) {
    showPartnerRegisterError("Pub registration is not available.");
    return;
  }

  setPartnerRegisterBusy(true, "Creating your pub account…");
  const result = await auth.registerDraftPub(
    fields.pubName,
    fields.location,
    fields.contactName,
    fields.contactPhone
  );

  if (!result?.ok) {
    setPartnerRegisterBusy(false);
    showPartnerRegisterError(normalizePartnerRegisterError(result?.error));
    return;
  }

  setPartnerRegisterBusy(true, "Loading your pub dashboard…");
  const session = partnerSession || (await auth.getSession());
  const sessionState = await applyPartnerSession(session);
  setPartnerRegisterBusy(false);

  if (sessionState !== "logged_in") {
    showPartnerRegisterError(
      "Your pub account was created, but we could not load the dashboard. Please refresh."
    );
    return;
  }

  resetPartnerRegisterForm();
  await renderPartner();
}

function showPartnerSignupError(message) {
  const errorEl = $("partnerSignupError");
  if (!errorEl) return;
  errorEl.textContent = message || "";
  errorEl.classList.toggle("hidden", !message);
}

function setPartnerSignupBusy(busy, statusText) {
  const form = $("partnerSignupForm");
  const submitBtn = $("partnerSignupBtn");
  const statusEl = $("partnerSignupStatus");
  const fieldIds = ["partnerSignupEmail", "partnerSignupPassword", "partnerSignupPasswordConfirm"];

  if (busy) showPartnerSignupError("");
  form?.setAttribute("aria-busy", busy ? "true" : "false");
  fieldIds.forEach((id) => {
    const field = $(id);
    if (field) field.disabled = busy;
  });
  if (submitBtn) {
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? "Creating account…" : "Create account";
  }
  if (statusEl) {
    statusEl.textContent = busy && statusText ? statusText : "";
    statusEl.classList.toggle("hidden", !(busy && statusText));
  }
}

function resetPartnerSignupForm() {
  $("partnerSignupForm")?.reset();
  showPartnerSignupError("");
  setPartnerSignupBusy(false);
}

function setPartnerConfirmEmailCopy(email, { unconfirmedLogin = false } = {}) {
  const messageEl = $("partnerConfirmEmailMessage");
  const trimmed = String(email || "").trim();
  if (messageEl) {
    if (unconfirmedLogin) {
      messageEl.textContent = trimmed
        ? `Email not confirmed. Confirm ${trimmed} before you can open a pub dashboard.`
        : "Email not confirmed. Confirm your email before you can open a pub dashboard.";
    } else {
      messageEl.textContent = trimmed
        ? `We sent a confirmation link to ${trimmed}. Confirm your email, then log in to create your pub account.`
        : "Check your inbox and confirm your email, then log in to create your pub account.";
    }
  }
  const errorEl = $("partnerConfirmEmailError");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
  const statusEl = $("partnerConfirmEmailStatus");
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
  }
}

function showPartnerConfirmEmailError(message) {
  const errorEl = $("partnerConfirmEmailError");
  if (!errorEl) return;
  errorEl.textContent = message || "";
  errorEl.classList.toggle("hidden", !message);
}

function showPartnerConfirmEmailStatus(message) {
  const statusEl = $("partnerConfirmEmailStatus");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.classList.toggle("hidden", !message);
}

async function showPartnerLoginScreen() {
  partnerForcedScreen = "login";
  partnerUnconfirmedLogin = false;
  partnerPendingConfirmEmail = "";
  resetPartnerDashboardDom();
  setPartnerPanelVisibility({ login: true });
}

async function showPartnerSignupScreen() {
  showPartnerSignupError("");
  setPartnerSignupBusy(false);
  try {
    await preparePartnerAuthAttempt({ forcedScreen: "signup" });
    resetPartnerDashboardDom();
    setPartnerPanelVisibility({ signup: true });
  } finally {
    finishPartnerAuthAttempt();
  }
}

function validatePartnerSignupFields(email, password, confirmPassword) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return "Enter a valid email address.";
  }
  if (String(password || "").length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return "";
}

function normalizePartnerSignupError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();
  if (!message) return "Could not create your account. Please try again.";
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "An account with this email already exists. Log in instead.";
  }
  if (lower.includes("password")) return message;
  if (lower.includes("email")) return message;
  return message;
}

function normalizePartnerLoginError(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return "Confirm your email before logging in. Check your inbox for the confirmation link.";
  }
  return message || "Sign in failed.";
}

async function handlePartnerSignupSubmit(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const email = String($("partnerSignupEmail")?.value || "").trim();
  const password = String($("partnerSignupPassword")?.value || "");
  const confirmPassword = String($("partnerSignupPasswordConfirm")?.value || "");
  const validationError = validatePartnerSignupFields(email, password, confirmPassword);
  if (validationError) {
    showPartnerSignupError(validationError);
    return;
  }

  if (!auth?.signUp) {
    showPartnerSignupError("Account signup is not available.");
    return;
  }

  setPartnerSignupBusy(true, "Creating your account…");
  try {
    await preparePartnerAuthAttempt({ forcedScreen: "signup" });
    const result = await withPartnerAuthTimeout(
      auth.signUp(email, password),
      PARTNER_AUTH_STALL_MESSAGE
    );

    if (!result?.ok) {
      showPartnerSignupError(normalizePartnerSignupError(result?.error));
      setPartnerPanelVisibility({ signup: true });
      return;
    }

    // Auth user only. Never create a pub from this step.
    if (result.needsEmailConfirmation || !result.session) {
      partnerForcedScreen = null;
      partnerPendingConfirmEmail = email;
      partnerUnconfirmedLogin = false;
      resetPartnerDashboardDom();
      setPartnerConfirmEmailCopy(email);
      setPartnerPanelVisibility({ confirmEmail: true });
      return;
    }

    partnerPendingConfirmEmail = "";
    partnerForcedScreen = null;
    setPartnerShiftExpiry();
    await applyPartnerSession(result.session || (await auth.getSession()));
    resetPartnerSignupForm();
    await renderPartner();
  } catch (error) {
    resetPartnerDashboardDom();
    showPartnerSignupError(error?.message || PARTNER_AUTH_STALL_MESSAGE);
    setPartnerPanelVisibility({ signup: true });
  } finally {
    finishPartnerAuthAttempt();
    setPartnerSignupBusy(false);
  }
}

async function handlePartnerLoginSubmit(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const email = $("partnerLoginEmail")?.value || "";
  const password = $("partnerLoginPassword")?.value || "";
  const errorEl = $("partnerLoginError");
  const submitBtn = $("partnerLoginBtn");

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
  }

  if (!auth?.signIn) {
    if (errorEl) {
      errorEl.textContent = "Partner login is not available.";
      errorEl.classList.remove("hidden");
    }
    resetPartnerLoginButton(submitBtn);
    return;
  }

  try {
    await preparePartnerAuthAttempt({ forcedScreen: "login" });
    setPartnerPanelVisibility({ login: true });
    const result = await withPartnerAuthTimeout(
      auth.signIn(email, password),
      PARTNER_AUTH_STALL_MESSAGE
    );
    if (!result.ok) {
      resetPartnerDashboardDom();
      clearPartnerSessionState();
      clearPartnerShiftExpiry();
      if (isEmailNotConfirmedError(result.error)) {
        partnerForcedScreen = null;
        partnerUnconfirmedLogin = true;
        partnerPendingConfirmEmail = String(email || "").trim();
        setPartnerConfirmEmailCopy(partnerPendingConfirmEmail, { unconfirmedLogin: true });
        setPartnerPanelVisibility({ confirmEmail: true });
      } else {
        partnerForcedScreen = "login";
        partnerUnconfirmedLogin = false;
        setPartnerPanelVisibility({ login: true });
        if (errorEl) {
          errorEl.textContent = normalizePartnerLoginError(result.error);
          errorEl.classList.remove("hidden");
        }
      }
      return;
    }

    partnerForcedScreen = null;
    partnerUnconfirmedLogin = false;
    setPartnerShiftExpiry();
    await applyPartnerSession(result.session || (await auth.getSession()));
    await renderPartner();
    await resumePendingPartnerRedemptionIfAny();
  } catch (error) {
    resetPartnerDashboardDom();
    clearPartnerSessionState();
    clearPartnerShiftExpiry();
    partnerForcedScreen = "login";
    setPartnerPanelVisibility({ login: true });
    if (errorEl) {
      errorEl.textContent = error?.message || PARTNER_AUTH_STALL_MESSAGE;
      errorEl.classList.remove("hidden");
    }
  } finally {
    finishPartnerAuthAttempt();
    resetPartnerLoginButton(submitBtn);
  }
}

async function handlePartnerLogout() {
  resetPartnerDashboardDom();
  setPartnerPanelVisibility({ login: true });
  const auth = getPartnerAuthApi();
  if (auth?.signOut) {
    await auth.signOut();
  }
  clearPartnerShiftExpiry();
  clearPartnerSessionState();
  partnerPendingConfirmEmail = "";
  partnerUnconfirmedLogin = false;
  partnerForcedScreen = "login";
  resetPartnerRegisterForm();
  resetPartnerSignupForm();
  void renderPartner();
}

async function handlePartnerResendConfirmationEmail() {
  const auth = getPartnerAuthApi();
  const email = partnerPendingConfirmEmail || partnerSession?.user?.email || "";
  const button = $("partnerConfirmEmailResendBtn");
  if (!auth?.resendConfirmationEmail) {
    showPartnerConfirmEmailError("Resend is not available.");
    return;
  }
  if (!String(email || "").trim()) {
    showPartnerConfirmEmailError("Enter your email on the login screen, then resend.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Sending…";
  }
  showPartnerConfirmEmailError("");
  showPartnerConfirmEmailStatus("");

  const result = await auth.resendConfirmationEmail(email);
  if (button) {
    button.disabled = false;
    button.textContent = "Resend confirmation email";
  }
  if (!result?.ok) {
    showPartnerConfirmEmailError(result?.error || "Could not resend the confirmation email.");
    return;
  }
  showPartnerConfirmEmailStatus(`Confirmation email sent to ${String(email).trim()}.`);
}

$("partnerLoginForm")?.addEventListener("submit", (event) => {
  void handlePartnerLoginSubmit(event);
});
$("partnerCreateAccountBtn")?.addEventListener("click", () => {
  void showPartnerSignupScreen();
});
$("partnerSignupForm")?.addEventListener("submit", (event) => {
  void handlePartnerSignupSubmit(event);
});
$("partnerSignupBackToLoginBtn")?.addEventListener("click", () => {
  void showPartnerLoginScreen();
});
$("partnerConfirmEmailLoginBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerConfirmEmailResendBtn")?.addEventListener("click", () => {
  void handlePartnerResendConfirmationEmail();
});
$("partnerRegisterForm")?.addEventListener("submit", (event) => {
  void handlePartnerRegisterSubmit(event);
});
$("partnerLogoutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerDeniedSignOutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerRegisterSignOutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});

$("resetDemo").addEventListener("click", resetDemoState);
$("setupPayoutsBtn")?.addEventListener("click", () => {
  void startPartnerPayoutSetup();
});
$("partnerSubmitApprovalBtn")?.addEventListener("click", () => {
  void handlePartnerSubmitForApproval();
});

$("partnerMenuOfferBarTab")?.addEventListener("change", (event) => {
  const enabled = Boolean(event.target.checked);
  $("partnerMenuBarTabFields")?.classList.toggle("hidden", !enabled);
  if (enabled) {
    setSelectedPartnerBarTabPresets(savedPartnerBarTabPresetPrices());
  }
  updatePartnerBarTabLegacyNotice();
});

document.querySelectorAll('input[name="partnerBarTabAmount"]').forEach((input) => {
  input.addEventListener("change", updatePartnerBarTabLegacyNotice);
});

$("partnerMenuForm")?.addEventListener("submit", (event) => {
  void handlePartnerMenuSave(event);
});

document.querySelectorAll("[data-partner-history-filter]").forEach(btn => {
  btn.addEventListener("click", () => setPartnerHistoryFilter(btn.dataset.partnerHistoryFilter));
});

document.querySelectorAll("[data-partner-traceability-filter]").forEach(btn => {
  btn.addEventListener("click", () => setPartnerTraceabilityFilter(btn.dataset.partnerTraceabilityFilter));
});

$("partnerExportCsv")?.addEventListener("click", exportPartnerTraceabilityCsv);
$("partnerPrintStatement")?.addEventListener("click", printPartnerAccountantStatement);

function dismissSplash() {
  const splash = $("splashScreen");
  if (!splash || splash.classList.contains("is-hidden")) return;
  splash.classList.add("is-hidden");
  splash.setAttribute("aria-hidden", "true");
  document.body.classList.remove("splash-open");
  sessionStorage.setItem("pintdrop_splash_seen", "1");
}

$("splashDismiss")?.addEventListener("click", dismissSplash);

if (sessionStorage.getItem("pintdrop_splash_seen")) {
  $("splashScreen")?.classList.add("is-hidden");
  $("splashScreen")?.setAttribute("aria-hidden", "true");
} else {
  document.body.classList.add("splash-open");
}

(async function initApp() {
  removeLegacyPaymentCollectors();
  await loadPubs();
  seedPartnerDemoData();
  await applyDemoDefaults();
  $("pubSearch")?.addEventListener("input", (event) => filterPubList(event.target.value));
  await initPartnerAuth();

  const params = new URLSearchParams(location.search);
  if (params.get("view") === "partner") {
    dismissSplash();
    switchView("partner");
  }

  renderSms();

  const handledStripeReturn = await handleStripeReturn();
  if (handledStripeReturn) return;

  const initialRoute = parseRedeemRoute();
  if (initialRoute?.code) {
    dismissSplash();
    if (initialRoute.isStaffRedemption) {
      await processBarRedemption(initialRoute.code, { updateHash: false });
    } else {
      await openRecipientVoucherView(initialRoute.code, { updateHash: false });
    }
  }
})();
