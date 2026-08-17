const DEMO_PUBS = [
  { id: "oflahertys", supabaseId: 1, name: "O'Flaherty's Bar", town: "Buncrana", icon: "🍺", image: "images/oflahertys-bar.jpg", participating: true },
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

async function loadPubs() {
  pubs = DEMO_PUBS.map(pub => ({ ...pub }));

  if (!window.PintDropSupabase?.isConfigured?.()) {
    return;
  }

  try {
    const remotePubs = await window.PintDropSupabase.fetchPubs();
    if (!remotePubs?.length) return;

    const remoteById = new Map(remotePubs.map(pub => [pub.id, pub]));
    // When Supabase supplies customer-ready pubs, keep only non-participating demo placeholders.
    const demoOnly = DEMO_PUBS.filter(pub => !remoteById.has(pub.id) && pub.participating === false);
    pubs = sortPubs([
      ...remotePubs,
      ...demoOnly.map(pub => ({ ...pub, source: "demo" }))
    ]);
  } catch (error) {
    console.warn("[PintDrop] Using demo pubs after Supabase error:", error);
  }
}

const DEMO_GIFTS = [
  { id: "pint", name: "Pint", price: 6.50, icon: "🍺" },
  { id: "wine", name: "Glass of Wine", price: 6.50, icon: "🍷" },
  { id: "cocktail", name: "Cocktail", price: 8.50, icon: "🍸" },
  { id: "spirit", name: "Spirit & Mixer", price: 6.50, icon: "🥃" },
  { id: "soft", name: "Soft Drink", price: 3.50, icon: "🥤" },
  { id: "tab", name: "€20 Bar Tab", price: 20.00, icon: "💶" }
];

const PURCHASE_HIDDEN_DRINK_IDS = new Set(["soft"]);
const BAR_TAB_DRINK_ID = "tab";

function isBarTabVoucher(voucher) {
  if (!voucher) return false;
  if (voucher.isBarTab) return true;
  const giftId = String(voucher.gift?.id || "").trim().toLowerCase();
  return giftId === BAR_TAB_DRINK_ID
    || String(voucher.gift?.name || "").toLowerCase().includes("bar tab");
}

function getBarTabOriginal(voucher) {
  if (voucher?.barTab?.original != null) return Number(voucher.barTab.original);
  return Number(voucher?.gift?.price || 0);
}

function getBarTabRemaining(voucher) {
  if (voucher?.barTab?.remaining != null) return Number(voucher.barTab.remaining);
  if (voucher?.status === "redeemed") return 0;
  return getBarTabOriginal(voucher);
}

function isBarTabFullyRedeemed(voucher) {
  return isBarTabVoucher(voucher)
    && (voucher.status === "redeemed" || getBarTabRemaining(voucher) <= 0);
}

function isVoucherRedeemed(voucher) {
  if (!voucher) return false;
  if (isBarTabVoucher(voucher)) return isBarTabFullyRedeemed(voucher);
  return voucher.status === "redeemed";
}

function parseRedemptionAmount(raw) {
  const normalized = String(raw ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100) / 100;
}

function formatBarTabAmount(amount) {
  return money(Number(amount || 0));
}

let gifts = DEMO_GIFTS.map(gift => ({ ...gift }));

function filterPurchasableGifts(list) {
  return (list || []).filter(gift => !PURCHASE_HIDDEN_DRINK_IDS.has(gift.id));
}

function getMenuDrinks() {
  return gifts.filter(gift => gift.id !== BAR_TAB_DRINK_ID);
}

function getBarTabGift() {
  return gifts.find(gift => gift.id === BAR_TAB_DRINK_ID) || null;
}

let orderMode = "drinks";
let selectedDrinkId = null;

function resetBasket() {
  orderMode = "drinks";
  selectedDrinkId = null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatOrderSummary(lineItems) {
  if (window.PintDropSupabase?.formatOrderSummary) {
    return window.PintDropSupabase.formatOrderSummary(lineItems);
  }
  return (lineItems || [])
    .map(item => `${item.quantity}× ${item.name}`)
    .join(", ");
}

function getVoucherGiftLabel(voucher) {
  if (!voucher) return "";
  if (voucher.lineItems?.length) {
    return formatOrderSummary(voucher.lineItems);
  }
  return voucher.gift?.name || "";
}

function calculateBasketTotalsFromLineItems(lineItems) {
  const pubValue = roundMoney(
    (lineItems || []).reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0)
  );
  return {
    pubValue,
    fee: calculateServiceFee(pubValue),
    total: calculateOrderTotal(pubValue)
  };
}

function getBasketLineItems() {
  if (orderMode === "tab") {
    const tab = getBarTabGift();
    if (!tab) return [];
    const drinkId = getCheckoutDrinkId(tab, selectedPub);
    if (!drinkId) return [];
    return [{
      drinkId,
      slug: tab.id,
      name: tab.name,
      icon: tab.icon,
      unitPrice: tab.price,
      quantity: 1,
      lineSubtotal: roundMoney(tab.price)
    }];
  }

  if (!selectedDrinkId) return [];

  const gift = getMenuDrinks().find(item => item.id === selectedDrinkId);
  if (!gift) return [];

  const drinkId = getCheckoutDrinkId(gift, selectedPub);
  if (!drinkId) return [];

  return [{
    drinkId,
    slug: gift.id,
    name: gift.name,
    icon: gift.icon,
    unitPrice: gift.price,
    quantity: 1,
    lineSubtotal: roundMoney(gift.price)
  }];
}

function selectDrink(giftId) {
  selectedDrinkId = giftId;
  orderMode = "drinks";
  renderChoices();
  renderSummary();
  $("giftStepError")?.classList.add("hidden");
}

function selectBarTab() {
  orderMode = "tab";
  selectedDrinkId = null;
  renderChoices();
  renderSummary();
  $("giftStepError")?.classList.add("hidden");
}

async function loadGiftsForPub(pub) {
  gifts = filterPurchasableGifts(DEMO_GIFTS).map(gift => ({ ...gift, source: "demo" }));

  if (!pub?.supabaseId || !window.PintDropSupabase?.isConfigured?.()) {
    ensureBasketValid();
    return;
  }

  try {
    const remoteGifts = await window.PintDropSupabase.fetchDrinks(pub.supabaseId);
    if (remoteGifts?.length) {
      gifts = remoteGifts;
    }
  } catch (error) {
    console.warn("[PintDrop] Using demo drinks after Supabase error:", error);
  }

  ensureBasketValid();
}

function ensureBasketValid() {
  if (selectedDrinkId && !gifts.some(gift => gift.id === selectedDrinkId)) {
    selectedDrinkId = null;
  }
  if (orderMode === "tab" && !getBarTabGift()) {
    orderMode = "drinks";
  }
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
const CHECKOUT_SUCCESS_STORAGE_KEY = "pintdrop_checkout_success";
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
let pendingOrder = null;
let paymentProcessing = false;
let customerSubStep = "pub";
let activeCheckoutSessionId = null;
let deliveryStatusPollTimer = null;
let activeRedemptionVoucherId = null;
let activeRedemptionVoucher = null;
let redemptionJustConfirmed = false;
let partnerActivityFilter = "today";
let partnerHistoryFilter = "today";

const PARTNER_PUB_ID = "oflahertys";
const PARTNER_SUPABASE_PUB_ID = 1;
const PARTNER_DRINK_SUPABASE_IDS = {
  pint: 1,
  wine: 2,
  cocktail: 3,
  spirit: 4,
  soft: 5,
  tab: 6
};
const PARTNER_DEMO_SEED_KEY = "pintdrop_partner_demo_seeded";

let partnerVouchers = null;
let publicVoucherDisplay = null;
let partnerSession = null;
let partnerProfile = null;
let partnerAuthReady = false;
let partnerAuthUnsubscribe = null;
let partnerAuthScreen = "login";
let partnerSignupMode = "standard";
const OWNER_INVITE_STORAGE_KEY = "pintdrop_owner_invite";
const OWNER_INVITE_QUERY_PARAM = "owner_invite";
let partnerOwnerInviteClaimInFlight = false;
let partnerPendingConfirmEmail = "";
let partnerPasswordRecoveryActive = false;
let partnerPasswordRecoveryNotice = "";
let partnerMenuData = null;
let partnerStripeConnectData = null;
let partnerQrScanActive = false;
let partnerQrScanHandling = false;
let partnerQrScanFrameId = null;
let partnerQrDecodeCanvas = null;
let partnerQrDecodeContext = null;
let partnerQrDecodeInFlight = false;
let partnerZxingReader = null;

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

function getPartnerAuthApi() {
  return window.PintDropSupabase?.PartnerAuth || null;
}

function getStoredOwnerInviteToken() {
  try {
    return String(
      sessionStorage.getItem(OWNER_INVITE_STORAGE_KEY)
      || localStorage.getItem(OWNER_INVITE_STORAGE_KEY)
      || ""
    ).trim();
  } catch (error) {
    return "";
  }
}

function setStoredOwnerInviteToken(token) {
  const value = String(token || "").trim();
  if (!value) return;
  try {
    sessionStorage.setItem(OWNER_INVITE_STORAGE_KEY, value);
    localStorage.setItem(OWNER_INVITE_STORAGE_KEY, value);
  } catch (error) {
    console.warn("[PintDrop Partner Invite] Could not persist invite token:", error);
  }
}

function clearStoredOwnerInviteToken() {
  try {
    sessionStorage.removeItem(OWNER_INVITE_STORAGE_KEY);
    localStorage.removeItem(OWNER_INVITE_STORAGE_KEY);
  } catch (error) {
    console.warn("[PintDrop Partner Invite] Could not clear invite token:", error);
  }
}

function consumeOwnerInviteFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = String(params.get(OWNER_INVITE_QUERY_PARAM) || "").trim();
  if (!token) return false;

  setStoredOwnerInviteToken(token);
  partnerSignupMode = "invited";
  params.delete(OWNER_INVITE_QUERY_PARAM);
  if (!params.has("view")) {
    params.set("view", "partner");
  }
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  return true;
}

function hasPendingOwnerInviteToken() {
  return Boolean(getStoredOwnerInviteToken());
}

function isPartnerEmailConfirmed(session = partnerSession) {
  const user = session?.user || null;
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function updatePartnerInviteAwaitingUi({ mode = "default", error = "" } = {}) {
  const titleEl = $("partnerAwaitingTitle");
  const leadEl = $("partnerAwaitingLead");
  const noticeEl = $("partnerAwaitingNotice");
  const errorEl = $("partnerAwaitingError");

  if (mode === "verify") {
    if (titleEl) titleEl.textContent = "Confirm your email";
    if (leadEl) {
      leadEl.textContent = "We sent a confirmation link to your email. After confirming, log in here and your pub will be linked automatically.";
    }
    if (noticeEl) {
      noticeEl.innerHTML = "Keep this browser tab — your invite link is saved for after verification.";
    }
  } else if (mode === "claiming") {
    if (titleEl) titleEl.textContent = "Linking your pub…";
    if (leadEl) leadEl.textContent = "Please wait while we securely connect your account to your pub.";
    if (noticeEl) noticeEl.textContent = "";
  } else if (mode === "error") {
    if (titleEl) titleEl.textContent = "Could not link pub";
    if (leadEl) leadEl.textContent = "Your account is ready, but the invite could not be completed.";
    if (noticeEl) {
      noticeEl.innerHTML = 'Contact <a href="mailto:support@pintdrop.ie">support@pintdrop.ie</a> for a new invite link.';
    }
  } else if (hasPendingOwnerInviteToken()) {
    if (titleEl) titleEl.textContent = "Invite saved";
    if (leadEl) {
      leadEl.textContent = "Your login is ready. Log in after email verification to link your existing pub automatically.";
    }
    if (noticeEl) {
      noticeEl.innerHTML = "If you were not invited by PintDrop, contact <a href=\"mailto:support@pintdrop.ie\">support@pintdrop.ie</a>.";
    }
  } else {
    if (titleEl) titleEl.textContent = "Account ready";
    if (leadEl) {
      leadEl.textContent = "Your login is set up. PintDrop will link your pub to this account shortly — you will not need to register a new pub here.";
    }
    if (noticeEl) {
      noticeEl.innerHTML = "If you were not invited by PintDrop, contact <a href=\"mailto:support@pintdrop.ie\">support@pintdrop.ie</a>.";
    }
  }

  if (errorEl) {
    if (error) {
      errorEl.textContent = error;
      errorEl.classList.remove("hidden");
    } else {
      errorEl.textContent = "";
      errorEl.classList.add("hidden");
    }
  }
}

async function tryClaimOwnerInviteIfNeeded() {
  const token = getStoredOwnerInviteToken();
  if (!token || partnerOwnerInviteClaimInFlight) {
    return { attempted: false };
  }
  if (!partnerSession) {
    return { attempted: false, pendingAuth: true };
  }
  if (hasActivePartnerProfile()) {
    clearStoredOwnerInviteToken();
    return { attempted: false, alreadyLinked: true };
  }
  if (!isPartnerEmailConfirmed()) {
    return { attempted: false, pendingVerification: true };
  }

  const auth = getPartnerAuthApi();
  if (!auth?.claimPubOwner) {
    return { attempted: false, error: "Pub claim is not available." };
  }

  partnerOwnerInviteClaimInFlight = true;
  try {
    const result = await auth.claimPubOwner(token);
    if (!result.ok) {
      return {
        attempted: true,
        ok: false,
        error: result.error || "Could not claim pub ownership."
      };
    }
    clearStoredOwnerInviteToken();
    await applyPartnerSession(partnerSession);
    return { attempted: true, ok: true };
  } finally {
    partnerOwnerInviteClaimInFlight = false;
  }
}

function hasActivePartnerProfile() {
  // Partner access = authenticated session + active pub_partner_users mapping (RPC returns pub_id).
  // profile.active is pubs.active (customer go-live) — must not block partner dashboard access.
  return Boolean(
    partnerSession
    && partnerProfile
    && Number.isFinite(Number(partnerProfile.pub_id))
    && Number(partnerProfile.pub_id) > 0
  );
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

function getAuthenticatedPartnerPubId() {
  if (!hasActivePartnerProfile()) return null;
  return Number(partnerProfile.pub_id);
}

function isVoucherForAuthenticatedPartner(voucher) {
  if (!voucher?.pub || !hasActivePartnerProfile()) return false;
  const partnerPubId = getAuthenticatedPartnerPubId();
  if (voucher.pub.supabaseId === partnerPubId) return true;
  return false;
}

const VOUCHER_VALIDITY_YEARS = 5;

function computeVoucherExpiresAt(fromDate = new Date()) {
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const expires = new Date(base.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + VOUCHER_VALIDITY_YEARS);
  return expires.toISOString();
}

function isVoucherExpired(voucher) {
  if (!voucher?.expiresAt) return false;
  const expiresAt = new Date(voucher.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function setPartnerPanelVisibility({
  loading = false,
  login = false,
  signup = false,
  emailConfirm = false,
  completeRegistration = false,
  awaitingAssignment = false,
  denied = false,
  passwordRecovery = false,
  dashboard = false
} = {}) {
  $("partnerAuthLoading")?.classList.toggle("hidden", !loading);
  $("partnerLogin")?.classList.toggle("hidden", !login);
  $("partnerSignup")?.classList.toggle("hidden", !signup);
  $("partnerEmailConfirm")?.classList.toggle("hidden", !emailConfirm);
  $("partnerCompleteRegistration")?.classList.toggle("hidden", !completeRegistration);
  $("partnerAwaitingAssignment")?.classList.toggle("hidden", !awaitingAssignment);
  $("partnerAccessDenied")?.classList.toggle("hidden", !denied);
  $("partnerPasswordRecovery")?.classList.toggle("hidden", !passwordRecovery);
  $("partnerDashboard")?.classList.toggle("hidden", !dashboard);
  document.body.classList.toggle(
    "partner-login-active",
    login || signup || emailConfirm || completeRegistration || awaitingAssignment || denied || loading || passwordRecovery
  );
}

function clearPartnerSessionState() {
  partnerSession = null;
  partnerProfile = null;
  partnerVouchers = null;
}

function isPasswordRecoveryUrl() {
  const hashParams = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  if (hashParams.get("type") === "recovery") return true;
  const searchParams = new URLSearchParams(location.search);
  return searchParams.get("type") === "recovery";
}

function clearAuthHashFromUrl() {
  const hash = String(location.hash || "");
  if (!hash) return;
  if (hash.includes("access_token") || hash.includes("type=recovery") || hash.includes("error=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function showPartnerPasswordRecoveryScreen() {
  partnerAuthScreen = "recovery";
  const email = partnerSession?.user?.email || "";
  const emailEl = $("partnerRecoveryEmail");
  if (emailEl) {
    emailEl.textContent = email || "your account";
  }
  $("partnerPasswordRecoveryError")?.classList.add("hidden");
  if ($("partnerRecoveryPassword")) $("partnerRecoveryPassword").value = "";
  if ($("partnerRecoveryPasswordConfirm")) $("partnerRecoveryPasswordConfirm").value = "";
  setPartnerPanelVisibility({ passwordRecovery: true });
}

function showPartnerLoginScreen(notice = "") {
  partnerAuthScreen = "login";
  partnerPasswordRecoveryActive = false;
  setPartnerPanelVisibility({ login: true });

  const noticeEl = $("partnerLoginNotice");
  const errorEl = $("partnerLoginError");
  if (noticeEl) {
    if (notice) {
      noticeEl.textContent = notice;
      noticeEl.classList.remove("hidden");
    } else if (partnerPasswordRecoveryNotice) {
      noticeEl.textContent = partnerPasswordRecoveryNotice;
      noticeEl.classList.remove("hidden");
      partnerPasswordRecoveryNotice = "";
    } else {
      noticeEl.textContent = "";
      noticeEl.classList.add("hidden");
    }
  }
  if (errorEl && notice) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
}

async function handlePartnerAuthEvent(event, session) {
  if (event === "PASSWORD_RECOVERY") {
    partnerPasswordRecoveryActive = true;
    partnerSession = session || null;
    partnerProfile = null;
    partnerVouchers = null;
    dismissSplash();
    if (!$("partner")?.classList.contains("active")) {
      switchView("partner");
    } else {
      showPartnerPasswordRecoveryScreen();
    }
    return;
  }

  if (partnerPasswordRecoveryActive) {
    if (event === "SIGNED_OUT") {
      partnerPasswordRecoveryActive = false;
      partnerSession = null;
      partnerProfile = null;
      return;
    }
    if (event === "INITIAL_SESSION") {
      partnerSession = session || null;
      partnerProfile = null;
      partnerVouchers = null;
      dismissSplash();
      if (!$("partner")?.classList.contains("active")) {
        switchView("partner");
      } else {
        showPartnerPasswordRecoveryScreen();
      }
      return;
    }
    return;
  }

  await applyPartnerSession(session);
  if ($("partner")?.classList.contains("active")) {
    void renderPartner();
  }
}

async function applyPartnerSession(session) {
  partnerSession = session || null;
  partnerProfile = null;

  if (!partnerSession) {
    clearPartnerSessionState();
    return "logged_out";
  }

  const auth = getPartnerAuthApi();
  if (!auth?.fetchProfile) {
    clearPartnerSessionState();
    return "denied";
  }

  const profile = await auth.fetchProfile();
  if (!profile?.pub_id) {
    partnerProfile = null;
    partnerVouchers = null;
    return "needs_registration";
  }

  partnerProfile = profile;
  partnerVouchers = null;
  return "logged_in";
}

async function ensurePartnerAuthReady() {
  if (partnerAuthReady) return;
  await initPartnerAuth();
}

async function initPartnerAuth() {
  if (partnerAuthReady) return;

  const auth = getPartnerAuthApi();
  if (!auth) {
    partnerAuthReady = true;
    return;
  }

  if (!partnerAuthUnsubscribe) {
    partnerAuthUnsubscribe = auth.onAuthStateChange((event, session) => {
      void handlePartnerAuthEvent(event, session);
    });
  }

  if (isPasswordRecoveryUrl()) {
    partnerPasswordRecoveryActive = true;
  }

  const session = await auth.getSession();
  if (partnerPasswordRecoveryActive) {
    partnerSession = session || null;
    partnerProfile = null;
    partnerVouchers = null;
  } else {
    await applyPartnerSession(session);
  }
  partnerAuthReady = true;
}

function isInvitedPartnerSession(session = partnerSession) {
  const user = session?.user || null;
  if (!user) return false;
  const metadata = user.user_metadata || {};
  const appMetadata = user.app_metadata || {};
  return metadata.partner_invited === true || appMetadata.partner_invited === true;
}

function updatePartnerSignupModeUi() {
  const invited = partnerSignupMode === "invited" || hasPendingOwnerInviteToken();
  $("partnerSignupTitle") && ($("partnerSignupTitle").textContent = invited ? "Pub already on PintDrop" : "Join PintDrop");
  $("partnerSignupLead") && ($("partnerSignupLead").textContent = invited
    ? (hasPendingOwnerInviteToken()
      ? "Create your partner login to claim your existing pub using your secure invite link."
      : "Create your partner login only. PintDrop will link your existing pub after admin confirmation.")
    : "Create your pub partner account to get started.");
  $("partnerSignupPubFields")?.classList.toggle("hidden", invited);
  $("partnerSignupPubName") && ($("partnerSignupPubName").required = !invited);
  $("partnerSignupPubLocation") && ($("partnerSignupPubLocation").required = !invited);
  $("partnerSignupBtn") && ($("partnerSignupBtn").textContent = invited ? "Create partner login" : "Create partner account");
  $("partnerSignupModeHint") && ($("partnerSignupModeHint").textContent = invited
    ? "Registering a new pub instead?"
    : "Already listed on PintDrop?");
  $("partnerToggleInvitedSignupBtn") && ($("partnerToggleInvitedSignupBtn").textContent = invited
    ? "Register a new pub"
    : "My pub is already on PintDrop");
}

function showPartnerSignupScreen(mode = partnerSignupMode) {
  partnerAuthScreen = "signup";
  partnerSignupMode = mode === "invited" ? "invited" : "standard";
  $("partnerSignupError")?.classList.add("hidden");
  updatePartnerSignupModeUi();
  setPartnerPanelVisibility({ signup: true });
}

function togglePartnerSignupMode() {
  showPartnerSignupScreen(partnerSignupMode === "invited" ? "standard" : "invited");
}

function showPartnerEmailConfirmScreen(email) {
  partnerPendingConfirmEmail = String(email || "").trim();
  const addressEl = $("partnerEmailConfirmAddress");
  if (addressEl) {
    addressEl.textContent = partnerPendingConfirmEmail || "your email";
  }
  setPartnerPanelVisibility({ emailConfirm: true });
}

function isPartnerOnboardingDraft(profile) {
  const status = String(profile?.onboarding_status || "").trim().toLowerCase();
  return status === "draft" || status === "pending_approval" || status === "rejected";
}

function isPartnerSubmissionReady() {
  return Boolean(partnerMenuData?.menu_configured && partnerStripeConnectData?.stripe_payouts_ready);
}

function updatePartnerOnboardingCard() {
  const card = $("partnerOnboardingCard");
  if (!card) return;

  const show = hasActivePartnerProfile() && isPartnerOnboardingDraft(partnerProfile);
  card.classList.toggle("hidden", !show);

  const menuReady = Boolean(partnerMenuData?.menu_configured);
  const payoutsReady = Boolean(partnerStripeConnectData?.stripe_payouts_ready);
  const submissionReady = menuReady && payoutsReady;
  const onboardingStatus = String(partnerProfile?.onboarding_status || "draft").trim().toLowerCase();
  const rejectionReason = String(partnerProfile?.rejection_reason || "").trim();

  const menuItem = $("partnerChecklistMenu");
  if (menuItem) {
    menuItem.classList.toggle("is-done", menuReady);
    menuItem.innerHTML = menuReady
      ? '<span class="partner-onboarding-icon">✓</span> Drinks &amp; prices'
      : '<span class="partner-onboarding-icon">○</span> Drinks &amp; prices — Not set up';
  }

  const payoutsItem = $("partnerChecklistPayouts");
  if (payoutsItem) {
    const stripeOnboardingStatus = String(
      partnerStripeConnectData?.stripe_onboarding_status || "not_started"
    ).trim().toLowerCase();

    payoutsItem.classList.toggle("is-done", payoutsReady);
    if (payoutsReady) {
      payoutsItem.innerHTML = '<span class="partner-onboarding-icon">✓</span> Payouts';
    } else if (stripeOnboardingStatus === "not_started") {
      payoutsItem.innerHTML = '<span class="partner-onboarding-icon">○</span> Payouts — Not set up';
    } else {
      payoutsItem.innerHTML = '<span class="partner-onboarding-icon">○</span> Payouts — Setup incomplete';
    }
  }

  const approvalItem = $("partnerChecklistApproval");
  if (approvalItem) {
    if (onboardingStatus === "pending_approval") {
      approvalItem.classList.add("is-done");
      approvalItem.innerHTML = '<span class="partner-onboarding-icon">✓</span> Approval — Submitted for PintDrop approval';
    } else if (onboardingStatus === "rejected") {
      approvalItem.classList.remove("is-done");
      approvalItem.innerHTML = '<span class="partner-onboarding-icon">○</span> Approval — Rejected';
    } else if (submissionReady) {
      approvalItem.classList.remove("is-done");
      approvalItem.innerHTML = '<span class="partner-onboarding-icon">○</span> Approval — Ready to submit';
    } else {
      approvalItem.classList.remove("is-done");
      approvalItem.innerHTML = '<span class="partner-onboarding-icon">○</span> Approval — Not submitted';
    }
  }

  const continueBtn = $("partnerContinueSetupBtn");
  const submissionStatus = $("partnerSubmissionStatus");
  const continueNote = $("partnerContinueSetupNote");
  const submissionError = $("partnerSubmissionError");

  if (submissionError && onboardingStatus !== "rejected") {
    submissionError.classList.add("hidden");
    submissionError.textContent = "";
  }

  if (continueBtn) {
    continueBtn.classList.remove("partner-submit-approval-btn", "hidden");
    if (onboardingStatus === "pending_approval") {
      continueBtn.classList.add("hidden");
      continueBtn.disabled = true;
      continueBtn.setAttribute("aria-hidden", "true");
    } else {
      continueBtn.removeAttribute("aria-hidden");
      if ((onboardingStatus === "draft" || onboardingStatus === "rejected") && submissionReady) {
        continueBtn.disabled = false;
        continueBtn.textContent = "Submit pub for approval";
        continueBtn.classList.add("partner-submit-approval-btn");
      } else {
        continueBtn.disabled = true;
        continueBtn.textContent = "Continue setup";
        continueBtn.classList.remove("partner-submit-approval-btn");
      }
    }
  }

  if (submissionStatus) {
    const isPending = onboardingStatus === "pending_approval";
    submissionStatus.classList.toggle("hidden", !isPending);
    submissionStatus.textContent = "Submitted for PintDrop approval";
  }

  if (continueNote) {
    if (onboardingStatus === "pending_approval") {
      continueNote.textContent = "Your pub is awaiting PintDrop review and is not visible to customers until approved.";
    } else if (onboardingStatus === "rejected") {
      continueNote.textContent = rejectionReason
        ? `Rejected: ${rejectionReason} Fix the issues above, then submit again.`
        : "Your submission was rejected. Fix the issues above, then submit again.";
    } else if (!menuReady) {
      continueNote.textContent = "Save your drinks and prices to continue.";
    } else if (!payoutsReady) {
      continueNote.textContent = "Complete payout setup to continue.";
    } else {
      continueNote.textContent = "You can submit your pub for PintDrop approval.";
    }
  }
}

function shouldShowPartnerMenuSetup() {
  return hasActivePartnerProfile() && isPartnerOnboardingDraft(partnerProfile);
}

function formatPartnerMenuPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return "";
  return price.toFixed(2);
}

function renderPartnerMenuForm() {
  const section = $("partnerMenuSetup");
  const list = $("partnerMenuItems");
  const barTabBlock = $("partnerMenuBarTab");
  if (!section || !list) return;

  const show = shouldShowPartnerMenuSetup();
  section.classList.toggle("hidden", !show);
  if (!show) return;

  const items = Array.isArray(partnerMenuData?.items) ? partnerMenuData.items : [];
  const standardItems = items.filter(item => !item.is_bar_tab);

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

  const tabItem = items.find(item => item.is_bar_tab) || null;
  const offersBarTab = Boolean(partnerMenuData?.offers_bar_tab);
  if (barTabBlock) {
    barTabBlock.classList.remove("hidden");
    const offerCheckbox = $("partnerMenuOfferBarTab");
    const fields = $("partnerMenuBarTabFields");
    const priceInput = $("partnerMenuBarTabPrice");
    const activeInput = $("partnerMenuBarTabActive");

    if (offerCheckbox) offerCheckbox.checked = offersBarTab;
    if (fields) fields.classList.toggle("hidden", !offersBarTab);
    if (priceInput) priceInput.value = formatPartnerMenuPrice(tabItem?.price);
    if (activeInput) activeInput.checked = Boolean(tabItem?.active);
  }
}

function bindPartnerMenuFormEvents() {
  $("partnerMenuOfferBarTab")?.addEventListener("change", (event) => {
    $("partnerMenuBarTabFields")?.classList.toggle("hidden", !event.target.checked);
  });

  $("partnerMenuForm")?.addEventListener("submit", (event) => {
    void handlePartnerMenuSave(event);
  });
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
    const rawTabPrice = String($("partnerMenuBarTabPrice")?.value || "").trim();
    const tabItem = {
      slug: "tab",
      active: Boolean($("partnerMenuBarTabActive")?.checked)
    };
    if (rawTabPrice) tabItem.price = Number(rawTabPrice);
    items.push(tabItem);
  }

  return { offers_bar_tab: offersBarTab, items };
}

function validatePartnerMenuPayload(payload) {
  const items = payload?.items || [];
  const standardActive = items.filter(item => item.slug !== "tab" && item.active);

  if (!standardActive.length) {
    return "Make at least one standard drink available.";
  }

  for (const item of items) {
    if (!item.active) continue;
    if (!Number.isFinite(item.price) || item.price <= 0 || item.price > 500) {
      return "Enter a valid price for each available drink.";
    }
  }

  if (payload.offers_bar_tab) {
    const tab = items.find(item => item.slug === "tab");
    if (tab?.active && (!Number.isFinite(tab.price) || tab.price <= 0 || tab.price > 500)) {
      return "Enter a valid Bar Tab price.";
    }
  }

  return "";
}

async function loadPartnerMenu() {
  partnerMenuData = null;
  if (!shouldShowPartnerMenuSetup()) {
    renderPartnerMenuForm();
    updatePartnerOnboardingCard();
    return;
  }

  const auth = getPartnerAuthApi();
  if (!auth?.fetchMenu) {
    renderPartnerMenuForm();
    updatePartnerOnboardingCard();
    return;
  }

  try {
    partnerMenuData = await auth.fetchMenu();
  } catch (error) {
    console.warn("[PintDrop Partner Menu] Load failed:", error);
    partnerMenuData = null;
  }

  renderPartnerMenuForm();
  updatePartnerOnboardingCard();
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
      errorEl.textContent = result.error || "Could not save your menu.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  partnerMenuData = result.menu || partnerMenuData;
  renderPartnerMenuForm();
  updatePartnerOnboardingCard();

  if (successEl) successEl.classList.remove("hidden");
}

async function handlePartnerSubmitForApproval() {
  const continueBtn = $("partnerContinueSetupBtn");
  const continueNote = $("partnerContinueSetupNote");
  const submissionError = $("partnerSubmissionError");
  const auth = getPartnerAuthApi();

  if (!continueBtn || continueBtn.disabled || !auth?.submitForApproval) return;

  if (submissionError) {
    submissionError.classList.add("hidden");
    submissionError.textContent = "";
  }

  continueBtn.disabled = true;
  continueBtn.textContent = "Submitting…";

  const result = await auth.submitForApproval();

  if (!result.ok) {
    if (submissionError) {
      submissionError.textContent = result.error || "Could not submit for approval.";
      submissionError.classList.remove("hidden");
    } else if (continueNote) {
      continueNote.textContent = result.error || "Could not submit for approval.";
    }
    updatePartnerOnboardingCard();
    return;
  }

  if (auth.fetchProfile) {
    partnerProfile = await auth.fetchProfile();
  } else if (result.pub) {
    partnerProfile = {
      ...(partnerProfile || {}),
      ...result.pub,
      pub_id: result.pub.pub_id,
      onboarding_status: result.pub.onboarding_status,
      active: result.pub.active,
      rejection_reason: result.pub.rejection_reason || null,
      submitted_at: result.pub.submitted_at || null
    };
  }

  updatePartnerOnboardingCard();
}

async function registerPartnerPubDetails({ pubName, pubLocation, errorEl, submitBtn, busyLabel, idleLabel }) {
  const auth = getPartnerAuthApi();
  if (!auth?.registerAccount) {
    if (errorEl) {
      errorEl.textContent = "Partner signup is not available.";
      errorEl.classList.remove("hidden");
    }
    return { ok: false };
  }

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = busyLabel;
  }

  const result = await auth.registerAccount({ pubName, pubLocation });

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = idleLabel;
  }

  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error || "Could not create your pub account.";
      errorEl.classList.remove("hidden");
    }
    return result;
  }

  const state = await applyPartnerSession(partnerSession || (await auth.getSession()));
  if (state !== "logged_in") {
    if (errorEl) {
      errorEl.textContent = "Pub created, but your session could not be refreshed. Try logging in.";
      errorEl.classList.remove("hidden");
    }
    return { ok: false };
  }

  void renderPartner();
  return { ok: true };
}

async function handlePartnerSignupSubmit(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const email = $("partnerSignupEmail")?.value || "";
  const password = $("partnerSignupPassword")?.value || "";
  const confirmPassword = $("partnerSignupPasswordConfirm")?.value || "";
  const pubName = $("partnerSignupPubName")?.value || "";
  const pubLocation = $("partnerSignupPubLocation")?.value || "";
  const errorEl = $("partnerSignupError");
  const submitBtn = $("partnerSignupBtn");

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";
  }

  if (!auth?.signUp || !auth?.registerAccount) {
    if (errorEl) {
      errorEl.textContent = "Partner signup is not available.";
      errorEl.classList.remove("hidden");
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create partner account";
    }
    return;
  }

  const signUpResult = await auth.signUp({
    email,
    password,
    confirmPassword,
    invited: partnerSignupMode === "invited"
  });
  if (!signUpResult.ok) {
    if (errorEl) {
      errorEl.textContent = signUpResult.error || "Could not create your account.";
      errorEl.classList.remove("hidden");
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = partnerSignupMode === "invited" ? "Create partner login" : "Create partner account";
    }
    return;
  }

  if (signUpResult.needsEmailConfirmation) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = partnerSignupMode === "invited" ? "Create partner login" : "Create partner account";
    }
    showPartnerEmailConfirmScreen(signUpResult.email);
    return;
  }

  if (partnerSignupMode === "invited") {
    partnerSession = signUpResult.session || (await auth.getSession());
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create partner login";
    }
    if (signUpResult.needsEmailConfirmation) {
      updatePartnerInviteAwaitingUi({ mode: "verify" });
      showPartnerEmailConfirmScreen(signUpResult.email);
      return;
    }
    if (hasPendingOwnerInviteToken()) {
      setPartnerPanelVisibility({ awaitingAssignment: true });
      updatePartnerInviteAwaitingUi({ mode: "claiming" });
      const claim = await tryClaimOwnerInviteIfNeeded();
      if (claim.ok) {
        void renderPartner();
        return;
      }
      if (claim.pendingVerification) {
        updatePartnerInviteAwaitingUi({ mode: "verify" });
        setPartnerPanelVisibility({ awaitingAssignment: true });
        return;
      }
      updatePartnerInviteAwaitingUi({ mode: "error", error: claim.error || "Invite claim failed." });
      setPartnerPanelVisibility({ awaitingAssignment: true });
      return;
    }
    setPartnerPanelVisibility({ awaitingAssignment: true });
    updatePartnerInviteAwaitingUi();
    return;
  }

  partnerSession = signUpResult.session || (await auth.getSession());
  const registerResult = await registerPartnerPubDetails({
    pubName,
    pubLocation,
    errorEl,
    submitBtn,
    busyLabel: "Creating pub…",
    idleLabel: "Create partner account"
  });

  if (!registerResult.ok && partnerSession) {
    setPartnerPanelVisibility({ completeRegistration: true });
  }
}

async function handlePartnerCompleteRegistrationSubmit(event) {
  event.preventDefault();

  const pubName = $("partnerCompletePubName")?.value || "";
  const pubLocation = $("partnerCompletePubLocation")?.value || "";
  const errorEl = $("partnerCompleteRegistrationError");
  const submitBtn = $("partnerCompleteRegistrationBtn");

  await registerPartnerPubDetails({
    pubName,
    pubLocation,
    errorEl,
    submitBtn,
    busyLabel: "Creating pub…",
    idleLabel: "Create draft pub"
  });
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
  if ($("partnerLoginNotice")) {
    $("partnerLoginNotice").classList.add("hidden");
    $("partnerLoginNotice").textContent = "";
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
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
    return;
  }

  const result = await auth.signIn(email, password);
  const state = await applyPartnerSession(result.ok ? result.session : null);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
  }

  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error || "Sign in failed. Check your email and password.";
      errorEl.classList.remove("hidden");
    }
    void renderPartner();
    return;
  }

  if (state === "denied") {
    void renderPartner();
    return;
  }

  if (state === "needs_registration") {
    if (hasPendingOwnerInviteToken()) {
      updatePartnerInviteAwaitingUi({ mode: "claiming" });
      setPartnerPanelVisibility({ awaitingAssignment: true });
      const claim = await tryClaimOwnerInviteIfNeeded();
      if (claim.ok) {
        void renderPartner();
        return;
      }
      if (claim.pendingVerification) {
        updatePartnerInviteAwaitingUi({ mode: "verify" });
        setPartnerPanelVisibility({ awaitingAssignment: true });
        return;
      }
      if (claim.attempted && !claim.ok) {
        updatePartnerInviteAwaitingUi({ mode: "error", error: claim.error });
        setPartnerPanelVisibility({ awaitingAssignment: true });
        return;
      }
    }
    void renderPartner();
    return;
  }

  void renderPartner();
}

async function handlePartnerPasswordRecoverySubmit(event) {
  event.preventDefault();

  const auth = getPartnerAuthApi();
  const password = $("partnerRecoveryPassword")?.value || "";
  const confirmPassword = $("partnerRecoveryPasswordConfirm")?.value || "";
  const errorEl = $("partnerPasswordRecoveryError");
  const submitBtn = $("partnerPasswordRecoveryBtn");

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  const validation = auth?.validatePasswordPair
    ? auth.validatePasswordPair(password, confirmPassword)
    : null;
  if (!validation?.ok) {
    if (errorEl) {
      errorEl.textContent = validation?.error || "Passwords do not match.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (!auth?.updatePassword) {
    if (errorEl) {
      errorEl.textContent = "Password reset is not available.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
  }

  const result = await auth.updatePassword(validation.password);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update password";
  }

  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error || "Could not update your password.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  partnerPasswordRecoveryActive = false;
  partnerPasswordRecoveryNotice = "Your password was updated. Log in with your new password.";
  clearAuthHashFromUrl();

  const loginEmailValue = partnerSession?.user?.email || "";

  if (auth.signOut) {
    await auth.signOut();
  }
  clearPartnerSessionState();
  partnerAuthScreen = "login";

  const loginEmail = $("partnerLoginEmail");
  if (loginEmail && loginEmailValue) {
    loginEmail.value = loginEmailValue;
  }

  showPartnerLoginScreen(partnerPasswordRecoveryNotice);
}

async function handlePartnerForgotPassword() {
  const auth = getPartnerAuthApi();
  const email = $("partnerLoginEmail")?.value || "";
  const errorEl = $("partnerLoginError");
  const noticeEl = $("partnerLoginNotice");
  const button = $("partnerForgotPasswordBtn");

  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }
  if (noticeEl) {
    noticeEl.classList.add("hidden");
    noticeEl.textContent = "";
  }

  if (!auth?.requestPasswordRecovery) {
    if (errorEl) {
      errorEl.textContent = "Password recovery is not available.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (button) button.disabled = true;

  const result = await auth.requestPasswordRecovery(email);

  if (button) button.disabled = false;

  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error || "Could not send recovery email.";
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (noticeEl) {
    noticeEl.textContent = "If an account exists for that email, a password reset link is on its way.";
    noticeEl.classList.remove("hidden");
  }
}

async function handlePartnerLogout() {
  const auth = getPartnerAuthApi();
  if (auth?.signOut) {
    await auth.signOut();
  }
  clearPartnerSessionState();
  partnerAuthScreen = "login";
  partnerPendingConfirmEmail = "";
  partnerPasswordRecoveryActive = false;
  partnerMenuData = null;
  await stopPartnerQrScan();
  $("redeemResult").innerHTML = "";
  void renderPartner();
}

function updatePartnerDashboardHeading() {
  const heading = $("partnerDashboardPubName");
  if (!heading) return;
  heading.textContent = partnerProfile?.pub_name || "Pub Partner";
}

function getPartnerPeriodSummaryLabel(period) {
  const pubName = partnerProfile?.pub_name || "your pub";
  const labels = {
    today: `Today at ${pubName}`,
    week: `This week at ${pubName}`,
    month: `This month at ${pubName}`
  };
  return labels[period] || labels.week;
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
    expiresAt: computeVoucherExpiresAt(new Date(createdAt)),
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
  if (partnerVouchers) return partnerVouchers;
  return readVouchers().filter(isPartnerVoucher);
}

async function loadPartnerVouchers() {
  if (hasActivePartnerProfile()) {
    const auth = getPartnerAuthApi();
    if (!auth?.fetchVouchers) {
      partnerVouchers = [];
      return partnerVouchers;
    }

    try {
      const remote = await auth.fetchVouchers();
      partnerVouchers = Array.isArray(remote) ? remote : [];
    } catch (error) {
      console.warn("[PintDrop Partner Auth] Voucher list failed:", error);
      partnerVouchers = [];
    }

    return partnerVouchers;
  }

  partnerVouchers = [];
  return partnerVouchers;
}

function isVoucherForPartnerPub(voucher) {
  if (!voucher?.pub) return false;
  if (voucher.pub.id === PARTNER_PUB_ID) return true;
  if (voucher.pub.supabaseId === PARTNER_SUPABASE_PUB_ID) return true;
  return false;
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

async function applyDemoDefaults() {
  selectedPub = pubs.find(pub => pub.participating) || pubs[0];
  await loadGiftsForPub(selectedPub);
  resetBasket();
  ensureBasketValid();
  customerSubStep = "pub";
  $("recipientName").value = "";
  if ($("recipientPhoneCountry")) $("recipientPhoneCountry").value = DEMO.phoneCountry;
  $("recipientPhone").value = DEMO.phone;
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
  if (!getBasketLineItems().length) {
    showStepError("giftStepError", "Please choose at least one drink or a Bar Tab to continue.");
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
  if (!validatePubStep() || !validateGiftStep()) {
    showStepError("orderFormError", "Please choose a pub and drink before continuing.");
    return false;
  }
  return true;
}

const venueMeta = {
  oflahertys: { rating: "4.9", open: true },
  drift: { rating: "4.7", open: true },
  local: { rating: "—", open: false }
};

function renderChoices() {
  $("pubList").innerHTML = pubs.map(pub => {
    const meta = venueMeta[pub.id] || { rating: "4.8", open: pub.participating !== false };
    const disabled = !isParticipatingPub(pub);
    return `
    <button type="button" class="venue-card venue-card--${pub.id} ${pub.id === selectedPub.id ? "selected" : ""} ${disabled ? "is-disabled" : ""}" data-pub="${pub.id}" ${disabled ? "disabled aria-disabled=\"true\"" : ""}>
      <div class="venue-banner">
        ${pub.image ? `<img class="venue-banner-photo" src="${pub.image}" alt="${pub.name}, ${pub.town}" loading="lazy" />` : `<span class="venue-banner-icon">${pub.icon}</span>`}
        <span class="venue-open-badge ${meta.open ? "is-open" : "is-soon"}">${disabled ? "Coming soon" : "Open now"}</span>
      </div>
      <div class="venue-card-content">
        <div class="venue-card-top">
          <strong>${pub.name}</strong>
          <span class="venue-rating">★ ${meta.rating}</span>
        </div>
        <small class="venue-location">${pub.town}</small>
        <span class="venue-tag">${disabled ? "Not yet available" : "Partner pub"}</span>
      </div>
      <span class="venue-check" aria-hidden="true">✓</span>
    </button>
  `;
  }).join("");

  $("menuDrinkList").innerHTML = getMenuDrinks().map(gift => {
    const selected = orderMode === "drinks" && selectedDrinkId === gift.id;
    return `
    <button type="button" class="gift-card drink-qty-card ${selected ? "selected" : ""}" data-gift-select="${gift.id}">
      <div class="drink-qty-card-top">
        <span class="gift-card-icon">${gift.icon}</span>
        <div class="gift-card-body">
          <strong>${gift.name}</strong>
          <small>${money(gift.price)}</small>
        </div>
      </div>
    </button>
  `;
  }).join("");

  const barTab = getBarTabGift();
  $("barTabList").innerHTML = barTab ? `
    <button type="button" class="gift-card bar-tab-card ${orderMode === "tab" ? "selected" : ""}" data-bar-tab="${barTab.id}">
      <span class="gift-card-icon">${barTab.icon}</span>
      <div class="gift-card-body">
        <strong>${barTab.name}</strong>
        <small>Standalone gift — not combinable with drinks yet</small>
      </div>
      <span class="gift-card-price">${money(barTab.price)}</span>
    </button>
  ` : "";

  const lineItems = getBasketLineItems();
  const basketPanel = $("basketPanel");
  if (basketPanel) {
    if (!lineItems.length) {
      basketPanel.classList.add("hidden");
      basketPanel.innerHTML = "";
    } else {
      const totals = calculateBasketTotalsFromLineItems(lineItems);
      basketPanel.classList.remove("hidden");
      basketPanel.innerHTML = `
        <div class="basket-panel-head">
          <strong>Your order</strong>
        </div>
        <ul class="basket-line-list">
          ${lineItems.map(item => `
            <li class="basket-line-item">
              <span class="basket-line-label">${item.quantity} × ${item.name}</span>
              <span class="basket-line-amount">${money(item.lineSubtotal)}</span>
            </li>
          `).join("")}
        </ul>
        <div class="basket-summary-divider" aria-hidden="true"></div>
        <div class="basket-totals">
          <div class="basket-total-row">
            <span>Pub value</span>
            <span class="basket-total-amount">${money(totals.pubValue)}</span>
          </div>
          <div class="basket-total-row">
            <span>Service fee (15%)</span>
            <span class="basket-total-amount">${money(totals.fee)}</span>
          </div>
          <div class="basket-total-row basket-total-row--grand">
            <span>Total</span>
            <span class="basket-total-amount-wrap">
              <strong class="basket-total-amount">${money(totals.total)}</strong>
              <small>incl. fee</small>
            </span>
          </div>
        </div>
      `;
    }
  }

  document.querySelectorAll("[data-pub]").forEach(btn => {
    btn.onclick = async () => {
      const pub = pubs.find(item => item.id === btn.dataset.pub);
      if (!isParticipatingPub(pub)) return;
      selectedPub = pub;
      resetBasket();
      await loadGiftsForPub(selectedPub);
      renderChoices();
      renderSummary();
      $("pubStepError")?.classList.add("hidden");
    };
  });

  document.querySelectorAll("[data-gift-select]").forEach(btn => {
    btn.onclick = () => {
      selectDrink(btn.dataset.giftSelect);
    };
  });

  document.querySelectorAll("[data-bar-tab]").forEach(btn => {
    btn.onclick = () => {
      selectBarTab();
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
      || pub.town.toLowerCase().includes(term);
    btn.classList.toggle("is-filtered", !visible);
  });
}

function renderSummary() {
  const lineItems = getBasketLineItems();
  $("summaryPub").textContent = `${selectedPub.name}, ${selectedPub.town}`;
  if (!lineItems.length) {
    $("summaryGift").textContent = "Not selected";
    $("summaryPrice").textContent = money(0);
    return;
  }
  const summaryLabel = formatOrderSummary(lineItems);
  $("summaryGift").textContent = summaryLabel;
  $("summaryPrice").textContent = money(calculateBasketTotalsFromLineItems(lineItems).total);
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

async function findPartnerVoucherByCode(code) {
  const normalized = (code || "").trim();
  if (!normalized || !hasActivePartnerProfile()) return null;

  const auth = getPartnerAuthApi();
  if (!auth?.fetchVoucherForRedemption) return null;

  try {
    return await auth.fetchVoucherForRedemption(normalized);
  } catch (error) {
    console.warn("[PintDrop Partner Auth] Voucher lookup failed:", error);
    return null;
  }
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
    $("voucherSubtitle").textContent = "This link may be invalid or expired.";
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

  let voucher = null;
  if (hasActivePartnerProfile()) {
    voucher = await findPartnerVoucherByCode(code);
  } else {
    voucher = await findVoucherByCode(code);
  }

  if (!voucher) {
    activeRedemptionVoucherId = null;
    activeRedemptionVoucher = null;
    if (updateHash) setBarRedemptionHash(code);
    switchView("redemption");
    renderRedemptionNotFound();
    return;
  }

  if (hasActivePartnerProfile()) {
    if (!isVoucherForAuthenticatedPartner(voucher)) {
      activeRedemptionVoucherId = null;
      activeRedemptionVoucher = null;
      if (updateHash) setBarRedemptionHash(voucher.code);
      switchView("redemption");
      renderRedemptionWrongPub(voucher);
      return;
    }
  } else if (!isVoucherForPartnerPub(voucher)) {
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
  renderRedemptionScreen(voucher, { barMode: true });
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
  $("scannerStatus").textContent = "Voucher found — loading voucher…";
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
    ".redemption-header, .redemption-already-banner, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-time, .redemption-success, .redemption-actions"
  ).forEach(el => el.classList.add("hidden"));
  $("redemptionEmptyMessage").textContent = "No voucher found.";
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionWrongPub(voucher) {
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-already-banner, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-time, .redemption-success, .redemption-actions"
  ).forEach(el => el.classList.add("hidden"));
  $("redemptionEmptyMessage").textContent =
    `This voucher is for ${voucher.pub.name}, not your pub.`;
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionScreen(voucher, { barMode = false, redeemFailed = false, lastBarTabRedemption = null } = {}) {
  $("redemptionEmpty")?.classList.add("hidden");
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-actions"
  ).forEach(el => el.classList.remove("hidden"));

  const barTab = isBarTabVoucher(voucher);
  const isRedeemed = isVoucherRedeemed(voucher);
  const isExpired = !isRedeemed && isVoucherExpired(voucher);
  const giftLabel = barTab ? "PintDrop Bar Tab" : getVoucherGiftLabel(voucher);
  const pubLabel = $("redemptionPubLabel");
  if (pubLabel) {
    pubLabel.textContent = `${voucher.pub.name} · Pub Partner`;
  }

  $("redemptionGift").textContent = barTab ? `💶 ${giftLabel}` : `${voucher.gift.icon} ${giftLabel}`;
  $("redemptionPub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  $("redemptionRecipient").textContent = voucher.recipient;
  $("redemptionSender").textContent = voucher.sender;
  $("redemptionMessage").textContent = `“${voucher.message}”`;
  $("redemptionCode").textContent = voucher.code;

  const barTabPanel = $("redemptionBarTabPanel");
  const barTabError = $("redemptionBarTabError");
  const barTabSuccess = $("redemptionBarTabSuccess");
  if (barTabPanel) {
    barTabPanel.classList.toggle("hidden", !barTab);
    if (barTab) {
      $("redemptionBarTabOriginal").textContent = formatBarTabAmount(getBarTabOriginal(voucher));
      $("redemptionBarTabRemaining").textContent = formatBarTabAmount(getBarTabRemaining(voucher));
      const amountInput = $("redemptionBarTabAmount");
      if (amountInput && document.activeElement !== amountInput) {
        amountInput.value = amountInput.value || "6.50";
      }
      barTabError?.classList.add("hidden");
      if (lastBarTabRedemption) {
        barTabSuccess.textContent = `Redeemed: ${formatBarTabAmount(lastBarTabRedemption.amount_redeemed)}. Remaining balance: ${formatBarTabAmount(lastBarTabRedemption.remaining_balance)}.`;
        barTabSuccess.classList.remove("hidden");
      } else if (isRedeemed) {
        barTabSuccess.textContent = "Bar Tab fully redeemed";
        barTabSuccess.classList.remove("hidden");
      } else {
        barTabSuccess?.classList.add("hidden");
      }
    }
  }

  const statusEl = $("redemptionStatus");
  const successEl = $("redemptionSuccess");
  const alreadyBanner = $("redemptionAlreadyBanner");

  if (redemptionJustConfirmed && isRedeemed) {
    statusEl.textContent = "REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = barTab ? "Bar Tab fully redeemed." : `${giftLabel} redeemed successfully.`;
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (isRedeemed) {
    statusEl.textContent = "REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.toggle("hidden", barTab);
    if (!barTab) alreadyBanner.classList.remove("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.toggle("hidden", !voucher.redeemedAt);
    if (voucher.redeemedAt) {
      $("redemptionTime").textContent = `Redeemed ${formatDateTime(voucher.redeemedAt)}`;
    }
  } else if (isExpired) {
    statusEl.textContent = "EXPIRED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = "This voucher has expired and cannot be redeemed.";
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (redeemFailed) {
    statusEl.textContent = "ERROR";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = barTab
      ? (barTabError?.textContent || "Could not redeem this Bar Tab. Try again.")
      : "Could not redeem this voucher. Try again.";
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else {
    statusEl.textContent = barTab ? "VALID" : "WAITING";
    statusEl.className = "redemption-status redemption-status-hero status waiting";
    alreadyBanner.classList.add("hidden");
    successEl.classList.add("hidden");
    $("redemptionTime").classList.add("hidden");
  }

  const redeemBtn = $("redemptionRedeemBtn");
  if (barTab) {
    const amount = parseRedemptionAmount($("redemptionBarTabAmount")?.value) || 6.5;
    redeemBtn.textContent = `Redeem ${formatBarTabAmount(amount)}`;
  } else {
    redeemBtn.textContent = "Redeem PintDrop";
  }
  redeemBtn.disabled = isRedeemed || isExpired;
  redeemBtn.classList.toggle("hidden", isRedeemed || isExpired);

  $("redemptionConfirm")?.classList.add("hidden");
  $("redemptionConfirmCopy").textContent = barTab
    ? `Confirm ${formatBarTabAmount(parseRedemptionAmount($("redemptionBarTabAmount")?.value) || 0)} from this Bar Tab for ${voucher.recipient}.`
    : `Confirm ${voucher.recipient} has received their ${giftLabel.toLowerCase()} at ${voucher.pub.name}.`;
}

function showRedemptionConfirm() {
  $("redemptionConfirm")?.classList.remove("hidden");
}

function hideRedemptionConfirm() {
  $("redemptionConfirm")?.classList.add("hidden");
}

async function redeemVoucherById(voucherId, { amount = null } = {}) {
  const vouchers = readVouchers();
  const local = vouchers.find(v => v.id === voucherId);
  const lookupCode = local?.code || activeRedemptionVoucher?.code;
  const voucherRef = local || activeRedemptionVoucher;
  const barTab = isBarTabVoucher(voucherRef);

  if (barTab) {
    const redeemAmount = parseRedemptionAmount(amount);
    if (redeemAmount == null || redeemAmount <= 0) {
      throw new Error("Enter a valid redemption amount greater than zero.");
    }
    if (redeemAmount > getBarTabRemaining(voucherRef) + 0.001) {
      throw new Error("Redemption amount exceeds remaining balance.");
    }

    if (hasActivePartnerProfile()) {
      const auth = getPartnerAuthApi();
      if (auth?.redeemBarTab) {
        const result = await auth.redeemBarTab({
          id: voucherId,
          code: lookupCode,
          amount: redeemAmount
        });
        if (result?.voucher) {
          return { ...result.voucher, lastBarTabRedemption: result.redemption };
        }
        return null;
      }
    }
    return null;
  }

  if (hasActivePartnerProfile()) {
    const auth = getPartnerAuthApi();
    if (auth?.redeemVoucher) {
      try {
        const remote = await auth.redeemVoucher({
          id: voucherId,
          code: lookupCode
        });
        if (remote) {
          if (local) {
            local.status = "redeemed";
            local.redeemedAt = remote.redeemedAt;
            writeVouchers(vouchers);
          }
          return remote;
        }
        if (remote === null && !local) {
          return null;
        }
      } catch (error) {
        console.warn("[PintDrop Partner Auth] Voucher redeem error:", error);
        throw error;
      }
    }
  }

  if (window.PintDropSupabase?.isConfigured?.()) {
    try {
      const remote = await window.PintDropSupabase.redeemVoucher({
        id: voucherId,
        code: lookupCode
      });
      if (remote) {
        if (local) {
          local.status = "redeemed";
          local.redeemedAt = remote.redeemedAt;
          writeVouchers(vouchers);
        }
        return remote;
      }
      if (remote === null && !local) {
        return null;
      }
    } catch (error) {
      console.warn("[PintDrop] Supabase voucher redeem error:", error);
      throw error;
    }
  }

  if (!local) return null;
  if (local.status === "redeemed") return local;

  local.status = "redeemed";
  local.redeemedAt = new Date().toISOString();
  writeVouchers(vouchers);
  return local;
}

function buildPendingOrder() {
  const recipient = $("recipientName").value.trim();
  const phone = getNormalizedRecipientPhone();
  const sender = $("senderName").value.trim();
  const senderEmail = $("senderEmail").value.trim().toLowerCase();
  const deliveryDate = new Date().toISOString().slice(0, 10);
  const lineItems = getBasketLineItems();

  if (!recipient || !phone || !sender || !senderEmail || !lineItems.length) return null;

  const totals = calculateBasketTotalsFromLineItems(lineItems);
  const summaryLabel = lineItems.length === 1 && lineItems[0].quantity === 1
    ? lineItems[0].name
    : formatOrderSummary(lineItems);

  return {
    pub: selectedPub,
    lineItems,
    orderMode,
    gift: {
      id: lineItems[0].slug,
      supabaseId: lineItems[0].drinkId,
      name: summaryLabel,
      icon: lineItems.length === 1 ? lineItems[0].icon : "🍻",
      price: totals.pubValue
    },
    pubValue: totals.pubValue,
    recipient,
    phone,
    recipientEmail: null,
    sender,
    senderEmail,
    message: $("message").value.trim(),
    deliveryDate,
    fee: totals.fee,
    total: totals.total
  };
}

function renderReviewRow(icon, label, value, extraClass = "") {
  return `
    <div class="review-row checkout-review-row ${extraClass}">
      <span class="review-icon" aria-hidden="true">${icon}</span>
      <div class="review-copy">
        <small>${label}</small>
        <strong>${value}</strong>
      </div>
    </div>
  `;
}

function renderReview() {
  if (!pendingOrder) return;

  const lineItemRows = pendingOrder.lineItems.map(item => renderReviewRow(
    item.icon,
    `${item.quantity}× ${item.name}`,
    `${money(item.unitPrice)} each · ${money(item.lineSubtotal)}`,
    "basket-review-row"
  )).join("");

  const deliveryRows = [
    renderReviewRow("📍", "Pub", `${pendingOrder.pub.name}, ${pendingOrder.pub.town}`),
    renderReviewRow("👤", "Recipient name", pendingOrder.recipient),
    renderReviewRow("📱", "Mobile number", formatPhoneForDisplay(pendingOrder.phone)),
    ...(pendingOrder.message
      ? [renderReviewRow("💬", "Personal message", pendingOrder.message, "checkout-review-message")]
      : []),
    renderReviewRow("✉️", "From", pendingOrder.sender)
  ].join("");

  $("reviewDetails").innerHTML = `
    <section class="review-section" aria-label="Selected drinks">
      <h3 class="review-section-title">Selected drinks</h3>
      <div class="review-section-rows">${lineItemRows}</div>
    </section>
    <section class="review-section" aria-label="Delivery details">
      <h3 class="review-section-title">Delivery details</h3>
      <div class="review-section-rows">${deliveryRows}</div>
    </section>
  `;

  $("reviewGiftPrice").textContent = money(pendingOrder.pubValue);
  $("reviewFee").textContent = money(pendingOrder.fee);
  $("reviewTotal").textContent = money(pendingOrder.total);
  const payButton = $("goToPayment");
  if (payButton) payButton.textContent = `Pay ${money(pendingOrder.total)} securely`;
}

async function startStripeCheckout() {
  if (!pendingOrder || paymentProcessing) return;

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

  const checkoutReturnStartedAt = performance.now();
  activeCheckoutSessionId = sessionId;
  console.log("[PintDrop Fulfillment] Return from Stripe", { sessionId });

  setProcessingStep(1);
  await new Promise((resolve) => setTimeout(resolve, 250));
  setProcessingStep(2);

  const pollStartedAt = performance.now();
  const fulfillment = await pollCheckoutFulfillment(sessionId, { triggerDelivery: true });
  const pollMs = Math.round(performance.now() - pollStartedAt);
  console.log("[PintDrop Fulfillment] Voucher poll finished", {
    sessionId,
    pollMs,
    hasVoucher: Boolean(fulfillment?.voucher),
    status: fulfillment?.status || fulfillment?.delivery?.fulfillmentStatus || null
  });

  if (!fulfillment?.voucher) {
    throw new Error(
      "Your payment was received, but your PintDrop is still being prepared. Please refresh this page in a moment."
    );
  }

  syncFulfilledVoucherToLocal(fulfillment.voucher);
  setProcessingStep(3);
  await new Promise((resolve) => setTimeout(resolve, 200));
  setProcessingStep(4);
  showCheckoutSuccess(fulfillment.voucher, fulfillment.delivery);
  saveCheckoutSuccessState(sessionId, fulfillment.voucher, fulfillment.delivery);
  startDeliveryStatusPolling(sessionId, fulfillment.voucher);
  overlay?.classList.add("hidden");
  resetProcessingSteps();
  setPurchaseStep("success");
  paymentProcessing = false;
  if (button) button.disabled = false;
  partnerVouchers = null;
  await renderPartner();
  renderSms();
  clearPendingOrderStorage();
  console.log("[PintDrop Fulfillment] Success screen shown", {
    sessionId,
    totalMs: Math.round(performance.now() - checkoutReturnStartedAt),
    voucherCode: fulfillment?.voucher?.code || null
  });
}

async function fetchCheckoutFulfillment(sessionId, options = {}) {
  const { triggerDelivery = false } = options;
  const startedAt = performance.now();
  const response = await fetch("/api/checkout-fulfillment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      expectedTotal: pendingOrder?.total,
      triggerDelivery
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

  console.log("[PintDrop Fulfillment] Poll response", {
    sessionId,
    triggerDelivery,
    requestMs: Math.round(performance.now() - startedAt),
    status: data?.status || data?.delivery?.fulfillmentStatus || null,
    hasVoucher: Boolean(data?.voucher),
    sms: data?.delivery?.sms || null
  });

  return data;
}

async function pollCheckoutFulfillment(sessionId, options = {}) {
  const { triggerDelivery = true } = options;
  const maxAttempts = 20;
  const delayMs = 800;
  let lastResult = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResult = await fetchCheckoutFulfillment(sessionId, {
      triggerDelivery: attempt === 0 ? triggerDelivery : false
    });
    console.log("[PintDrop Fulfillment] Voucher poll attempt", {
      sessionId,
      attempt: attempt + 1,
      hasVoucher: Boolean(lastResult?.voucher)
    });
    if (lastResult?.voucher) {
      return lastResult;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastResult;
}

function isDeliverySettled(delivery) {
  if (!delivery) return false;
  const channels = [delivery.sms, delivery.senderEmail, delivery.recipientEmail];
  return channels.every((status) => ["sent", "skipped", "failed"].includes(status));
}

function stopDeliveryStatusPolling() {
  if (deliveryStatusPollTimer) {
    clearInterval(deliveryStatusPollTimer);
    deliveryStatusPollTimer = null;
  }
}

function startDeliveryStatusPolling(sessionId, voucher) {
  stopDeliveryStatusPolling();
  if (!sessionId || !voucher?.code) return;

  let attempts = 0;
  const maxAttempts = 30;

  deliveryStatusPollTimer = setInterval(async () => {
    attempts += 1;
    try {
      const result = await fetchCheckoutFulfillment(sessionId, { triggerDelivery: false });
      if (result?.delivery) {
        updateSuccessDeliveryUI(voucher, result.delivery);
        updateSavedCheckoutSuccessDelivery(result.delivery);
      }
      if (isDeliverySettled(result?.delivery) || attempts >= maxAttempts) {
        stopDeliveryStatusPolling();
      }
    } catch (error) {
      console.warn("[PintDrop Fulfillment] Delivery status poll failed:", error);
      if (attempts >= maxAttempts) {
        stopDeliveryStatusPolling();
      }
    }
  }, 2000);
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
    lineItems: Array.isArray(voucher.lineItems) ? voucher.lineItems : [],
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

function saveCheckoutSuccessState(sessionId, voucher, delivery) {
  if (!sessionId || !voucher?.code) return;
  sessionStorage.setItem(CHECKOUT_SUCCESS_STORAGE_KEY, JSON.stringify({
    sessionId,
    voucher,
    delivery: delivery || null,
    expectedTotal: pendingOrder?.total ?? voucher.total ?? null,
    savedAt: Date.now()
  }));
}

function restoreCheckoutSuccessState() {
  const raw = sessionStorage.getItem(CHECKOUT_SUCCESS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionId || !parsed?.voucher?.code) return null;
    return parsed;
  } catch (error) {
    console.warn("[PintDrop Checkout Success] Could not restore saved success state:", error);
    return null;
  }
}

function clearCheckoutSuccessStorage() {
  sessionStorage.removeItem(CHECKOUT_SUCCESS_STORAGE_KEY);
}

function updateSavedCheckoutSuccessDelivery(delivery) {
  const saved = restoreCheckoutSuccessState();
  if (!saved || !delivery) return;
  saveCheckoutSuccessState(saved.sessionId, saved.voucher, delivery);
}

async function tryRestoreCheckoutSuccess() {
  const saved = restoreCheckoutSuccessState();
  if (!saved) return false;

  dismissSplash();
  switchView("customer");
  activeCheckoutSessionId = saved.sessionId;
  pendingOrder = pendingOrder || (saved.expectedTotal ? { total: saved.expectedTotal } : null);
  syncFulfilledVoucherToLocal(saved.voucher);
  showCheckoutSuccess(saved.voucher, saved.delivery);
  setPurchaseStep("success");
  startDeliveryStatusPolling(saved.sessionId, saved.voucher);
  renderSms();
  partnerVouchers = null;
  await renderPartner();
  console.log("[PintDrop Checkout Success] Restored success screen from session", {
    sessionId: saved.sessionId,
    voucherCode: saved.voucher.code
  });
  return true;
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
  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lineItems: pendingOrder.lineItems.map((item) => ({
        drinkId: item.drinkId,
        slug: item.slug,
        name: item.name,
        icon: item.icon,
        unitPrice: item.unitPrice,
        quantity: item.quantity
      })),
      total: pendingOrder.total,
      giftPrice: pendingOrder.pubValue,
      fee: pendingOrder.fee,
      pubName: pendingOrder.pub.name,
      pubLocation: pendingOrder.pub.town,
      pubId: getCheckoutPubId(pendingOrder.pub),
      recipientName: pendingOrder.recipient,
      recipientPhone: pendingOrder.phone,
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
    expiresAt: computeVoucherExpiresAt(),
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
  if ($("successSmsCheck")) $("successSmsCheck").textContent = "… SMS sending";
  if ($("successEmailCheck")) $("successEmailCheck").textContent = "… Confirmation email sending";
}

function formatDeliveryStatus(status, { pending, success, failed, skipped }) {
  if (status === "sent") return success;
  if (status === "skipped") return skipped || success;
  if (status === "failed") return failed;
  return pending;
}

function updateSuccessDeliveryUI(voucher, delivery) {
  if (!voucher || !delivery) return;

  const smsSent = delivery.sms === "sent";
  const smsFailed = delivery.sms === "failed";
  const smsPending = delivery.sms === "pending" || delivery.sms === "processing";
  const senderEmailSent = delivery.senderEmail === "sent";
  const senderEmailSkipped = delivery.senderEmail === "skipped";
  const senderEmailFailed = delivery.senderEmail === "failed";
  const senderEmailPending = delivery.senderEmail === "pending" || delivery.senderEmail === "processing";
  const recipientEmailSent = delivery.recipientEmail === "sent";
  const recipientEmailFailed = delivery.recipientEmail === "failed";
  const allSettled = isDeliverySettled(delivery);

  $("successSmsCheck").textContent = formatDeliveryStatus(delivery.sms, {
    pending: "… SMS sending",
    success: "✓ SMS delivered",
    failed: "⚠ SMS not delivered"
  });

  $("successEmailCheck").textContent = formatDeliveryStatus(delivery.senderEmail, {
    pending: "… Confirmation email sending",
    success: "✓ Confirmation email sent",
    failed: "⚠ Email not sent",
    skipped: "✓ Confirmation email sent"
  });

  if (smsPending || senderEmailPending) {
    $("successMessage").textContent =
      `Payment confirmed. Your PintDrop ${voucher.code} is ready — we're sending it to ${voucher.recipient} now.`;
  } else if (smsSent) {
    let message =
      `${voucher.recipient} has just received a text message with your gift. They can redeem their ${getVoucherGiftLabel(voucher).toLowerCase()} at ${voucher.pub.name}. 🍻`;
    if (recipientEmailSent && voucher.recipientEmail) {
      message += ` We also emailed a backup copy to ${voucher.recipientEmail}.`;
    }
    $("successMessage").textContent = message;
  } else if (allSettled) {
    $("successMessage").textContent =
      `Your PintDrop ${voucher.code} was created successfully for ${voucher.recipient} at ${voucher.pub.name}.`;
  }

  $("successSmsWarning").classList.add("hidden");
  $("successSmsWarning").textContent = "";
  $("successEmailWarning").classList.add("hidden");
  $("successEmailWarning").textContent = "";

  if (smsFailed) {
    $("successSmsWarning").textContent =
      `The voucher was saved, but the SMS could not be sent${delivery.error ? `: ${delivery.error}` : ""}. Please share the voucher code or link with the recipient manually.`;
    $("successSmsWarning").classList.remove("hidden");
  }

  if (senderEmailFailed && !senderEmailSkipped) {
    $("successEmailWarning").textContent =
      `Your PintDrop was created, but we could not send your confirmation email${delivery.error ? `: ${delivery.error}` : ""}. Your receipt is still shown below.`;
    $("successEmailWarning").classList.remove("hidden");
  }

  if (voucher.recipientEmail && recipientEmailFailed) {
    const recipientWarning =
      `We could not send the backup email to ${voucher.recipientEmail}. The SMS is still the primary delivery method.`;
    if ($("successSmsWarning").classList.contains("hidden")) {
      $("successSmsWarning").textContent = recipientWarning;
      $("successSmsWarning").classList.remove("hidden");
    } else {
      $("successSmsWarning").textContent += ` ${recipientWarning}`;
    }
  }
}

function showCheckoutSuccess(voucher, delivery) {
  resetSuccessDeliveryState();
  $("successCode").textContent = voucher.code;
  updateSuccessDeliveryUI(voucher, delivery || {
    sms: "pending",
    senderEmail: "pending",
    recipientEmail: voucher.recipientEmail ? "pending" : "skipped"
  });
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
  stopDeliveryStatusPolling();
  activeCheckoutSessionId = null;
  clearCheckoutSuccessStorage();
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
  const giftLabel = getVoucherGiftLabel(voucher);
  const barTab = isBarTabVoucher(voucher);
  const redeemed = isVoucherRedeemed(voucher);
  id("GiftIcon").textContent = voucher.gift.icon;
  id("Gift").textContent = barTab ? "PintDrop Bar Tab" : giftLabel;
  id("Pub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  id("Message").textContent = `“${voucher.message}”`;
  id("Code").textContent = voucher.code;
  id("Recipient").textContent = voucher.recipient;
  id("Sender").textContent = voucher.sender;
  id("Expiry").textContent = formatDate((voucher.expiresAt || computeVoucherExpiresAt()).slice(0, 10));
  const isExpired = !redeemed && isVoucherExpired(voucher);
  const statusEl = id("Status");
  const statusLabel = redeemed ? "REDEEMED" : isExpired ? "EXPIRED" : "VALID";
  if (prefix === "voucher") {
    statusEl.textContent = statusLabel;
    statusEl.className = `status voucher-status-badge ${redeemed ? "redeemed" : isExpired ? "expired" : "waiting"}`;
    document.querySelector("#voucher .wallet-pass")?.classList.toggle("is-redeemed", redeemed);
    const barTabPanel = $("voucherBarTabBalance");
    if (barTabPanel) {
      barTabPanel.classList.toggle("hidden", !barTab);
      if (barTab) {
        $("voucherBarTabOriginal").textContent = formatBarTabAmount(getBarTabOriginal(voucher));
        $("voucherBarTabRemaining").textContent = formatBarTabAmount(getBarTabRemaining(voucher));
      }
    }
  } else {
    statusEl.textContent = statusLabel;
    statusEl.className = `status ${redeemed ? "redeemed" : isExpired ? "expired" : "waiting"}`;
  }
  pulseStatusBadge(statusEl);

  const redeemedStamp = $(prefix === "voucher" ? "redeemedStamp" : `${prefix}RedeemedStamp`);
  const redeemedWhen = $(prefix === "voucher" ? "redeemedWhen" : `${prefix}RedeemedWhen`);
  if (redeemedStamp) {
    redeemedStamp.classList.toggle("hidden", !redeemed);
    if (redeemed && voucher.redeemedAt && redeemedWhen) {
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
  const giftLabel = getVoucherGiftLabel(voucher);
  $("smsHeadline").textContent = `${voucher.gift.icon} ${voucher.sender} has bought you a ${giftLabel.toLowerCase()}!`;
  $("smsPersonalMessage").textContent = `“${voucher.message}”`;
  $("smsGiftIcon").textContent = voucher.gift.icon;
  $("smsGift").textContent = giftLabel;
  $("smsPub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  $("smsRedeemedNotice").classList.toggle("hidden", !isVoucherRedeemed(voucher));
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
      updatePartnerOnboardingCard();
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
    updatePartnerOnboardingCard();
    return;
  }

  if (!getPartnerAccessToken()) {
    updatePartnerOnboardingCard();
    return;
  }

  try {
    const data = await fetchPartnerAccountStatus();
    partnerStripeConnectData = normalizePartnerStripeConnectData(data);
    applyPartnerPayoutStatusUi(data);
  } catch (error) {
    console.warn("[PintDrop Stripe Connect] Payout status refresh failed:", error);
  }

  updatePartnerOnboardingCard();
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

async function renderPartner() {
  await ensurePartnerAuthReady();

  if (!getPartnerAuthApi()) {
    setPartnerPanelVisibility({ login: true });
    if ($("partnerLoginError")) {
      $("partnerLoginError").textContent = "Partner login is not configured.";
      $("partnerLoginError").classList.remove("hidden");
    }
    return;
  }

  if (!partnerAuthReady) {
    setPartnerPanelVisibility({ loading: true });
    return;
  }

  if (partnerPasswordRecoveryActive) {
    showPartnerPasswordRecoveryScreen();
    return;
  }

  if (!partnerSession) {
    if (partnerAuthScreen === "signup") {
      setPartnerPanelVisibility({ signup: true });
    } else {
      setPartnerPanelVisibility({ login: true });
    }
    return;
  }

  const sessionState = partnerProfile?.pub_id
    ? "logged_in"
    : (await applyPartnerSession(partnerSession));

  if (sessionState === "needs_registration") {
    if (hasPendingOwnerInviteToken()) {
      updatePartnerInviteAwaitingUi({ mode: "claiming" });
      setPartnerPanelVisibility({ awaitingAssignment: true });
      const claim = await tryClaimOwnerInviteIfNeeded();
      if (claim.ok) {
        void renderPartner();
        return;
      }
      if (claim.pendingVerification) {
        updatePartnerInviteAwaitingUi({ mode: "verify" });
        setPartnerPanelVisibility({ awaitingAssignment: true });
        return;
      }
      if (claim.attempted && !claim.ok) {
        updatePartnerInviteAwaitingUi({ mode: "error", error: claim.error });
        setPartnerPanelVisibility({ awaitingAssignment: true });
        return;
      }
      setPartnerPanelVisibility({ awaitingAssignment: true });
      return;
    }
    if (isInvitedPartnerSession(partnerSession)) {
      updatePartnerInviteAwaitingUi();
      setPartnerPanelVisibility({ awaitingAssignment: true });
    } else {
      setPartnerPanelVisibility({ completeRegistration: true });
    }
    return;
  }

  if (!hasActivePartnerProfile()) {
    setPartnerPanelVisibility({ denied: true });
    return;
  }

  setPartnerPanelVisibility({ dashboard: true });
  updatePartnerDashboardHeading();
  await loadPartnerMenu();
  updatePartnerOnboardingCard();

  await loadPartnerVouchers();
  const vouchers = getPartnerVouchers();

  document.querySelectorAll("[data-partner-history-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.partnerHistoryFilter === partnerHistoryFilter);
  });

  const activity = vouchers
    .filter(v => v.status === "redeemed")
    .filter(v => voucherMatchesPeriod(v, partnerHistoryFilter))
    .sort((a, b) => new Date(getVoucherActivityTime(b)) - new Date(getVoucherActivityTime(a)));

  $("activityList").innerHTML = activity.length
    ? activity.map(voucher => partnerRedemptionItem(voucher)).join("")
    : `<p class="note partner-history-empty">No redemptions for this period.</p>`;

  await renderBarTabRedemptionHistory();
  void refreshPartnerPayoutStatus();
}

async function renderBarTabRedemptionHistory() {
  const section = $("barTabRedemptionHistory");
  const list = $("barTabRedemptionList");
  if (!section || !list) return;

  const auth = getPartnerAuthApi();
  if (!auth?.fetchBarTabRedemptions || !hasActivePartnerProfile()) {
    section.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  const rows = await auth.fetchBarTabRedemptions(50);
  if (!rows.length) {
    section.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  list.innerHTML = `
    <div class="activity-row activity-row-head pintdrop-row">
      <span class="activity-cell">Time / date</span>
      <span class="activity-cell">Recipient</span>
      <span class="activity-cell">Voucher</span>
      <span class="activity-cell">Redeemed</span>
      <span class="activity-cell">Remaining</span>
    </div>
    ${rows.map((row) => `
      <div class="activity-row pintdrop-row activity-row--redeemed">
        <span class="activity-cell pintdrop-when">
          <strong>${formatDateTime(row.redeemed_at).split(" at ")[0] || ""}</strong>
          <small>${formatDateTime(row.redeemed_at).split(" at ")[1] || ""}</small>
        </span>
        <span class="activity-cell activity-recipient">${row.recipient_name || "—"}</span>
        <span class="activity-cell pintdrop-code">${row.voucher_code || "—"}</span>
        <span class="activity-cell activity-value">${formatBarTabAmount(row.amount_redeemed)}</span>
        <span class="activity-cell activity-value">${formatBarTabAmount(row.remaining_balance)}</span>
      </div>
    `).join("")}
  `;
}

function setPartnerHistoryFilter(period) {
  partnerHistoryFilter = period;
  partnerActivityFilter = period;
  void renderPartner();
}

function voucherRow(voucher, waiting = false) {
  const expired = waiting && isVoucherExpired(voucher);
  const statusLabel = expired ? "Expired" : waiting ? "Waiting" : "Redeemed";
  const statusClass = expired ? "expired" : voucher.status;
  return `
    <div class="voucher-row ${waiting ? "voucher-row-waiting" : "voucher-row-redeemed"}">
      <div class="voucher-row-icon">${voucher.gift.icon}</div>
      <div class="voucher-row-copy">
        <strong>${voucher.recipient} · ${voucher.gift.name}</strong>
        <small>From ${voucher.sender} · ${voucher.pub.name}, ${voucher.pub.town}</small>
        <small class="voucher-row-code">${voucher.code}</small>
        <small class="voucher-row-expiry">Expires ${formatDate(voucher.expiresAt.slice(0, 10))}</small>
      </div>
      <div class="voucher-row-meta">
        <div class="amount">${money(voucher.gift.price)}</div>
        <span class="voucher-row-status ${statusClass}">${statusLabel}</span>
      </div>
    </div>
  `;
}

function renderRedeemRedeemed(voucher) {
  $("redeemResult").innerHTML = `
    <div class="result redeem-preview redeem-preview--redeemed">
      <div class="redeem-valid-badge redeemed">Already redeemed</div>
      <dl class="redeem-details">
        <div><dt>Recipient</dt><dd>${voucher.recipient}</dd></div>
        <div><dt>Sender</dt><dd>${voucher.sender}</dd></div>
        <div><dt>Gift</dt><dd>${voucher.gift.icon} ${voucher.gift.name}</dd></div>
        <div><dt>Personal message</dt><dd>“${voucher.message}”</dd></div>
        <div><dt>Pub</dt><dd>${voucher.pub.name}, ${voucher.pub.town}</dd></div>
        <div><dt>PintDrop reference</dt><dd>${voucher.code}</dd></div>
      </dl>
      ${voucher.redeemedAt ? `<p class="redeem-time">Redeemed ${formatDateTime(voucher.redeemedAt)}</p>` : ""}
    </div>
  `;
}

function renderRedeemValid(voucher) {
  const barTab = isBarTabVoucher(voucher);
  $("redeemResult").innerHTML = barTab ? `
    <div class="result result-valid redeem-preview redeem-preview--bar-tab">
      <div class="redeem-valid-badge">PintDrop Bar Tab</div>
      <dl class="redeem-details">
        <div><dt>Original value</dt><dd>${formatBarTabAmount(getBarTabOriginal(voucher))}</dd></div>
        <div><dt>Remaining balance</dt><dd>${formatBarTabAmount(getBarTabRemaining(voucher))}</dd></div>
        <div><dt>Recipient</dt><dd>${voucher.recipient}</dd></div>
        <div><dt>Sender</dt><dd>${voucher.sender}</dd></div>
        <div><dt>Pub</dt><dd>${voucher.pub.name}, ${voucher.pub.town}</dd></div>
        <div><dt>PintDrop reference</dt><dd>${voucher.code}</dd></div>
      </dl>
      <label class="field redemption-bar-tab-amount">
        <span>Amount to redeem</span>
        <div class="redemption-amount-row">
          <span aria-hidden="true">€</span>
          <input id="manualBarTabAmount" type="number" min="0.01" step="0.01" value="6.50" inputmode="decimal" />
        </div>
      </label>
      <p id="manualBarTabError" class="redemption-bar-tab-error hidden" role="alert"></p>
      <button type="button" class="primary redeem-pint-btn" id="confirmRedeem">Redeem Bar Tab</button>
    </div>
  ` : `
    <div class="result result-valid redeem-preview">
      <div class="redeem-valid-badge">Waiting to redeem</div>
      <dl class="redeem-details">
        <div><dt>Recipient</dt><dd>${voucher.recipient}</dd></div>
        <div><dt>Sender</dt><dd>${voucher.sender}</dd></div>
        <div><dt>Gift</dt><dd>${voucher.gift.icon} ${voucher.gift.name}</dd></div>
        <div><dt>Personal message</dt><dd>“${voucher.message}”</dd></div>
        <div><dt>Pub</dt><dd>${voucher.pub.name}, ${voucher.pub.town}</dd></div>
        <div><dt>PintDrop reference</dt><dd>${voucher.code}</dd></div>
        <div><dt>Expiry date</dt><dd>${formatDate(voucher.expiresAt.slice(0, 10))}</dd></div>
      </dl>
      <button type="button" class="primary redeem-pint-btn" id="confirmRedeem">Redeem PintDrop</button>
    </div>
  `;

  $("confirmRedeem").onclick = () => { void completeRedemption(voucher.id); };
  $("manualBarTabAmount")?.addEventListener("input", () => {
    const amount = parseRedemptionAmount($("manualBarTabAmount")?.value);
    $("confirmRedeem").textContent = amount
      ? `Redeem ${formatBarTabAmount(amount)}`
      : "Redeem Bar Tab";
  });
}

async function lookupPartnerVoucherForManualEntry(rawCode) {
  dismissSplash();
  redemptionJustConfirmed = false;

  const code = parseVoucherCodeFromScan(String(rawCode || "").trim()) || String(rawCode || "").trim();
  if (!code) return;

  $("redeemResult").innerHTML = `<div class="result">Looking up voucher…</div>`;

  let voucher = null;
  if (hasActivePartnerProfile()) {
    voucher = await findPartnerVoucherByCode(code);
  } else {
    voucher = await findVoucherByCode(code);
  }

  if (!voucher) {
    $("redeemResult").innerHTML = `<div class="result error">No voucher found.</div>`;
    return;
  }

  if (hasActivePartnerProfile()) {
    if (!isVoucherForAuthenticatedPartner(voucher)) {
      $("redeemResult").innerHTML = `<div class="result error">This voucher is for ${voucher.pub.name}, not your pub.</div>`;
      return;
    }
  } else if (!isVoucherForPartnerPub(voucher)) {
    $("redeemResult").innerHTML = `<div class="result error">This voucher is for ${voucher.pub.name}, not your pub.</div>`;
    return;
  }

  activeRedemptionVoucherId = voucher.id;
  activeRedemptionVoucher = voucher;

  if (isVoucherRedeemed(voucher)) {
    renderRedeemRedeemed(voucher);
    return;
  }

  if (isVoucherExpired(voucher)) {
    $("redeemResult").innerHTML = `<div class="result error">This voucher has expired and cannot be redeemed.</div>`;
    return;
  }

  renderRedeemValid(voucher);
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

  if (isVoucherRedeemed(existing)) {
    renderRedeemRedeemed(existing);
    return;
  }

  const barTab = isBarTabVoucher(existing);
  const amount = barTab
    ? parseRedemptionAmount($("manualBarTabAmount")?.value)
    : null;

  if (barTab && (amount == null || amount <= 0)) {
    $("manualBarTabError").textContent = "Enter an amount greater than zero.";
    $("manualBarTabError")?.classList.remove("hidden");
    return;
  }

  try {
    const result = await redeemVoucherById(voucherId, { amount });
    if (!result) {
      $("redeemResult").innerHTML = `<div class="result error">Could not redeem this voucher. Try again.</div>`;
      return;
    }

    const lastBarTabRedemption = result.lastBarTabRedemption || null;
    activeRedemptionVoucher = lastBarTabRedemption
      ? { ...result, lastBarTabRedemption: undefined }
      : result;
    if (activeRedemptionVoucher.lastBarTabRedemption) {
      delete activeRedemptionVoucher.lastBarTabRedemption;
    }
    partnerVouchers = null;

    if (barTab && !isVoucherRedeemed(activeRedemptionVoucher)) {
      $("redeemResult").innerHTML = `
        <div class="result result-success result-success-animate">
          <div class="redeem-success-tick">✓</div>
          <p>Redeemed: ${formatBarTabAmount(lastBarTabRedemption?.amount_redeemed || amount)}</p>
          <p>Remaining balance: ${formatBarTabAmount(getBarTabRemaining(activeRedemptionVoucher))}</p>
          <button type="button" class="secondary" id="redeemAnotherPartial">Redeem another amount</button>
        </div>
      `;
      $("redeemAnotherPartial")?.addEventListener("click", () => renderRedeemValid(activeRedemptionVoucher));
      void renderPartner();
      renderVoucher();
      renderSms();
      return;
    }

    $("redeemResult").innerHTML = `
      <div class="result result-success result-success-animate">
        <div class="redeem-success-tick">✓</div>
        <p>${barTab ? "Bar Tab fully redeemed." : `${getVoucherGiftLabel(activeRedemptionVoucher)} redeemed successfully.`}</p>
      </div>
    `;
    $("redeemCode").value = "";
    $("scannerDemo")?.classList.add("hidden");
    void renderPartner();
    renderVoucher();
    renderSms();
    showSenderNotification(activeRedemptionVoucher);
  } catch (error) {
    const message = String(error?.message || error || "Could not redeem this voucher. Try again.");
    if (barTab) {
      $("manualBarTabError").textContent = message;
      $("manualBarTabError")?.classList.remove("hidden");
      return;
    }
    $("redeemResult").innerHTML = `<div class="result error">${message}</div>`;
  }
}

$("redeemForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const input = parseVoucherCodeFromScan($("redeemCode").value.trim()) || $("redeemCode").value.trim();
  if (!input) return;

  $("redeemResult").innerHTML = "";
  await lookupPartnerVoucherForManualEntry(input);
});


function showSenderNotification(voucher) {
  const note = $("senderNotification");
  $("senderNotificationText").textContent = `${voucher.recipient} has just redeemed the ${voucher.gift.name} you sent at ${voucher.pub.name}.`;
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
  if (!voucher || isVoucherRedeemed(voucher)) return;

  if (isBarTabVoucher(voucher)) {
    void (async () => {
      const amount = parseRedemptionAmount($("redemptionBarTabAmount")?.value);
      const errorEl = $("redemptionBarTabError");
      if (amount == null || amount <= 0) {
        errorEl.textContent = "Enter an amount greater than zero.";
        errorEl?.classList.remove("hidden");
        return;
      }
      errorEl?.classList.add("hidden");
      try {
        const result = await redeemVoucherById(activeRedemptionVoucherId, { amount });
        if (!result) {
          renderRedemptionScreen(voucher, { barMode: true, redeemFailed: true });
          return;
        }
        const lastBarTabRedemption = result.lastBarTabRedemption || null;
        activeRedemptionVoucher = { ...result };
        delete activeRedemptionVoucher.lastBarTabRedemption;
        redemptionJustConfirmed = isVoucherRedeemed(activeRedemptionVoucher);
        renderRedemptionScreen(activeRedemptionVoucher, {
          barMode: true,
          lastBarTabRedemption
        });
        partnerVouchers = null;
        void renderPartner();
        renderVoucher();
        renderSms();
        if (redemptionJustConfirmed) showSenderNotification(activeRedemptionVoucher);
      } catch (error) {
        $("redemptionBarTabError").textContent = String(error?.message || error);
        $("redemptionBarTabError")?.classList.remove("hidden");
        renderRedemptionScreen(voucher, { barMode: true, redeemFailed: true });
      }
    })();
    return;
  }

  showRedemptionConfirm();
});

$("redemptionBarTabAmount")?.addEventListener("input", () => {
  const voucher = activeRedemptionVoucher;
  if (!voucher || !isBarTabVoucher(voucher)) return;
  const amount = parseRedemptionAmount($("redemptionBarTabAmount")?.value);
  const redeemBtn = $("redemptionRedeemBtn");
  if (redeemBtn && amount) {
    redeemBtn.textContent = `Redeem ${formatBarTabAmount(amount)}`;
  }
});

$("redemptionConfirmCancel")?.addEventListener("click", hideRedemptionConfirm);

$("redemptionConfirmOk")?.addEventListener("click", async () => {
  if (!activeRedemptionVoucherId) return;
  hideRedemptionConfirm();

  const before = activeRedemptionVoucher
    || readVouchers().find(v => v.id === activeRedemptionVoucherId);
  if (isVoucherRedeemed(before)) {
    renderRedemptionScreen(before);
    return;
  }

  try {
    const voucher = await redeemVoucherById(activeRedemptionVoucherId);
    if (!voucher) return;

    activeRedemptionVoucher = voucher;
    redemptionJustConfirmed = true;
    renderRedemptionScreen(voucher, { barMode: true });
    partnerVouchers = null;
    void renderPartner();
    renderVoucher();
    renderSms();
    showSenderNotification(voucher);
  } catch (error) {
    renderRedemptionScreen(before, { barMode: true, redeemFailed: true });
  }
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
  stopDeliveryStatusPolling();
  activeCheckoutSessionId = null;
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
  clearCheckoutSuccessStorage();
  resetProcessingSteps();
  await applyDemoDefaults();
  setPurchaseStep("details");
  switchView("customer");
  partnerVouchers = null;
  await renderPartner();
  renderVoucher();
  renderSms();
}

$("resetDemo").addEventListener("click", resetDemoState);
bindPartnerMenuFormEvents();
$("partnerLoginForm")?.addEventListener("submit", (event) => {
  void handlePartnerLoginSubmit(event);
});
$("partnerPasswordRecoveryForm")?.addEventListener("submit", (event) => {
  void handlePartnerPasswordRecoverySubmit(event);
});
$("partnerForgotPasswordBtn")?.addEventListener("click", () => {
  void handlePartnerForgotPassword();
});
$("partnerSignupForm")?.addEventListener("submit", (event) => {
  void handlePartnerSignupSubmit(event);
});
$("partnerCompleteRegistrationForm")?.addEventListener("submit", (event) => {
  void handlePartnerCompleteRegistrationSubmit(event);
});
$("partnerShowSignupBtn")?.addEventListener("click", () => {
  showPartnerSignupScreen("standard");
});
$("partnerToggleInvitedSignupBtn")?.addEventListener("click", () => {
  togglePartnerSignupMode();
});
$("partnerShowLoginBtn")?.addEventListener("click", () => {
  showPartnerLoginScreen();
});
$("partnerEmailConfirmLoginBtn")?.addEventListener("click", () => {
  showPartnerLoginScreen();
});
$("partnerCompleteRegistrationSignOutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerLogoutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerDeniedSignOutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("partnerAwaitingAssignmentSignOutBtn")?.addEventListener("click", () => {
  void handlePartnerLogout();
});
$("setupPayoutsBtn")?.addEventListener("click", () => {
  void startPartnerPayoutSetup();
});
$("partnerContinueSetupBtn")?.addEventListener("click", () => {
  void handlePartnerSubmitForApproval();
});

document.querySelectorAll("[data-partner-history-filter]").forEach(btn => {
  btn.addEventListener("click", () => setPartnerHistoryFilter(btn.dataset.partnerHistoryFilter));
});

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
  $("pubSearch")?.addEventListener("input", (event) => filterPubList(event.target.value));
  await initPartnerAuth();

  if (partnerPasswordRecoveryActive) {
    dismissSplash();
    switchView("partner");
    void renderPartner();
    return;
  }

  const restoredCheckoutSuccess = await tryRestoreCheckoutSuccess();
  if (restoredCheckoutSuccess) return;

  await applyDemoDefaults();
  renderSms();

  const handledStripeReturn = await handleStripeReturn();
  if (handledStripeReturn) return;

  const hadOwnerInvite = consumeOwnerInviteFromUrl();
  if (hadOwnerInvite) {
    dismissSplash();
    partnerAuthScreen = "signup";
    showPartnerSignupScreen("invited");
  }

  const params = new URLSearchParams(location.search);
  if (params.get("view") === "partner") {
    dismissSplash();
    switchView("partner");
    if (hadOwnerInvite) {
      showPartnerSignupScreen("invited");
    }
  }

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
