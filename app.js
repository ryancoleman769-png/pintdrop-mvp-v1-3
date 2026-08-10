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
    const demoOnly = DEMO_PUBS.filter(pub => !remoteById.has(pub.id));
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
  { id: "tab", name: "€20 Bar Tab", price: 20.50, icon: "💶" }
];

let gifts = DEMO_GIFTS.map(gift => ({ ...gift }));

async function loadGiftsForPub(pub) {
  gifts = DEMO_GIFTS.map(gift => ({ ...gift, source: "demo" }));

  if (!pub?.supabaseId || !window.PintDropSupabase?.isConfigured?.()) {
    ensureSelectedGiftValid();
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

  ensureSelectedGiftValid();
}

function ensureSelectedGiftValid() {
  if (!gifts.length) return;
  if (!selectedGift || !gifts.some(gift => gift.id === selectedGift.id)) {
    selectedGift = gifts.find(gift => gift.id === "pint") || gifts[0];
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
const LOGO = {
  mark: "images/pintdrop-mark.png",
  full: "images/pintdrop-logo.png"
};
const DEMO = {
  sender: "Ryan",
  senderEmail: "ryan@example.com",
  recipient: "Dad",
  phone: "087 123 4567",
  phoneCountry: "IE",
  message: "Happy birthday Dad — have one on me 🍻"
};
let selectedPub = pubs[0];
let selectedGift = gifts[0];
let pendingOrder = null;
let paymentProcessing = false;
let customerSubStep = "pub";
let activeRedemptionVoucherId = null;
let activeRedemptionVoucher = null;
let redemptionJustConfirmed = false;
let partnerActivityFilter = "today";
let partnerHistoryFilter = "today";

const PARTNER_PUB_ID = "oflahertys";
const PARTNER_SUPABASE_PUB_ID = 1;
const PARTNER_DEMO_SEED_KEY = "pintdrop_partner_demo_seeded";

let partnerVouchers = null;
let publicVoucherDisplay = null;
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
    expiresAt: new Date(new Date(createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
  const local = readVouchers().filter(isPartnerVoucher);

  if (!window.PintDropSupabase?.isConfigured?.()) {
    partnerVouchers = local;
    return partnerVouchers;
  }

  try {
    const remote = await window.PintDropSupabase.fetchPartnerVouchers(PARTNER_SUPABASE_PUB_ID);
    if (!remote?.length) {
      partnerVouchers = local;
      return partnerVouchers;
    }

    const remoteByCode = new Map(remote.map(voucher => [voucher.code.toUpperCase(), voucher]));
    const demoOnly = local.filter(voucher => !remoteByCode.has(voucher.code.toUpperCase()));
    partnerVouchers = [...remote, ...demoOnly]
      .sort((a, b) => new Date(getVoucherActivityTime(b)) - new Date(getVoucherActivityTime(a)));
  } catch (error) {
    console.warn("[PintDrop] Using local partner vouchers after Supabase error:", error);
    partnerVouchers = local;
  }

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
  selectedGift = gifts[0];
  customerSubStep = "pub";
  $("recipientName").value = DEMO.recipient;
  if ($("recipientPhoneCountry")) $("recipientPhoneCountry").value = DEMO.phoneCountry;
  $("recipientPhone").value = DEMO.phone;
  if ($("recipientEmail")) $("recipientEmail").value = "";
  $("senderName").value = DEMO.sender;
  if ($("senderEmail")) $("senderEmail").value = DEMO.senderEmail;
  $("message").value = DEMO.message;
  if ($("cardName")) $("cardName").value = DEMO.sender;
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

function setPurchaseStep(step) {
  const steps = ["details", "review", "payment", "success"];
  steps.forEach(name => {
    $(`${name}Step`).classList.toggle("active", name === step);
  });

  if (step === "details") {
    updateJourneyProgress(customerSubStep === "pub" ? 1 : customerSubStep === "drink" ? 2 : 3);
  } else {
    const journeyMap = { review: 4, payment: 5, success: 6 };
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
  $("paymentFormError")?.classList.add("hidden");
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
      || pub.town.toLowerCase().includes(term);
    btn.classList.toggle("is-filtered", !visible);
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
  const voucher = await findVoucherByCode(code);
  redemptionJustConfirmed = false;

  if (!voucher) {
    activeRedemptionVoucherId = null;
    activeRedemptionVoucher = null;
    if (updateHash) setBarRedemptionHash(code);
    switchView("redemption");
    renderRedemptionNotFound();
    return;
  }

  if (!isVoucherForPartnerPub(voucher)) {
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

  if (voucher.status === "redeemed") {
    renderRedemptionScreen(voucher, { barMode: true });
    return;
  }

  const redeemed = await redeemVoucherById(voucher.id);
  if (!redeemed) {
    renderRedemptionScreen(voucher, { barMode: true, redeemFailed: true });
    return;
  }

  activeRedemptionVoucher = redeemed;
  redemptionJustConfirmed = true;
  partnerVouchers = null;
  renderRedemptionScreen(redeemed, { barMode: true });
  await renderPartner();
  renderVoucher();
  renderSms();
  showSenderNotification(redeemed);
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
    `This voucher is for ${voucher.pub.name}, not O'Flaherty's Bar.`;
  $("redemptionEmpty")?.classList.remove("hidden");
  $("redemptionConfirm")?.classList.add("hidden");
}

function renderRedemptionScreen(voucher, { barMode = false, redeemFailed = false } = {}) {
  $("redemptionEmpty")?.classList.add("hidden");
  document.querySelector(".redemption-page")?.querySelectorAll(
    ".redemption-header, .redemption-status-wrap, .redemption-gift-block, .redemption-details, .redemption-actions"
  ).forEach(el => el.classList.remove("hidden"));

  const isRedeemed = voucher.status === "redeemed";
  const giftLabel = voucher.gift.name.toUpperCase();

  $("redemptionGift").textContent = `${voucher.gift.icon} ${voucher.gift.name}`;
  $("redemptionPub").textContent = `${voucher.pub.name}, ${voucher.pub.town}`;
  $("redemptionRecipient").textContent = voucher.recipient;
  $("redemptionSender").textContent = voucher.sender;
  $("redemptionMessage").textContent = `“${voucher.message}”`;
  $("redemptionCode").textContent = voucher.code;

  const statusEl = $("redemptionStatus");
  const successEl = $("redemptionSuccess");
  const alreadyBanner = $("redemptionAlreadyBanner");

  if (redemptionJustConfirmed && isRedeemed) {
    statusEl.textContent = "REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
    alreadyBanner.classList.add("hidden");
    successEl.textContent = `${voucher.gift.name} redeemed successfully.`;
    successEl.classList.remove("hidden");
    $("redemptionTime").classList.add("hidden");
  } else if (isRedeemed) {
    statusEl.textContent = "REDEEMED";
    statusEl.className = "redemption-status redemption-status-hero status redeemed";
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
    successEl.textContent = "Could not redeem this voucher. Try again.";
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
  redeemBtn.classList.toggle("hidden", barMode || isRedeemed);

  $("redemptionConfirm")?.classList.add("hidden");
  $("redemptionConfirmCopy").textContent =
    `Confirm ${voucher.recipient} has received their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}.`;
}

function showRedemptionConfirm() {
  $("redemptionConfirm")?.classList.remove("hidden");
}

function hideRedemptionConfirm() {
  $("redemptionConfirm")?.classList.add("hidden");
}

async function redeemVoucherById(voucherId) {
  const vouchers = readVouchers();
  const local = vouchers.find(v => v.id === voucherId);
  const lookupCode = local?.code || activeRedemptionVoucher?.code;

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
    message: $("message").value.trim() || `A PintDrop from ${sender}`,
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
    ["💬", "Message", pendingOrder.message]
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
}

function renderPayment() {
  if (!pendingOrder) return;
  $("paymentGiftIcon").textContent = pendingOrder.gift.icon;
  $("paymentGiftName").textContent = pendingOrder.gift.name;
  $("paymentPubName").textContent = `${pendingOrder.pub.name}, ${pendingOrder.pub.town}`;
  $("paymentTotal").textContent = money(pendingOrder.total);
  $("payButton").textContent = `Pay ${money(pendingOrder.total)} securely`;
  $("cardName").value = pendingOrder.sender;
}

async function completeCheckoutAfterPayment() {
  const button = $("payButton");
  const overlay = $("processingOverlay");
  paymentProcessing = true;
  if (button) button.disabled = true;
  resetProcessingSteps();
  overlay?.classList.remove("hidden");

  setProcessingStep(1);
  await new Promise((resolve) => setTimeout(resolve, 400));
  setProcessingStep(2);

  const voucher = await createVoucherFromPendingOrder();
  setProcessingStep(3);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const smsResult = await deliverVoucherSms(voucher);
  const emailResult = await deliverSenderConfirmationEmail(voucher);
  try {
    await deliverRecipientGiftEmail(voucher);
  } catch (error) {
    console.warn("[PintDrop Recipient Email] delivery failed:", error);
  }

  setProcessingStep(4);
  showCheckoutSuccess(voucher, smsResult, emailResult);
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

async function createStripeCheckoutSession() {
  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      total: pendingOrder.total,
      giftPrice: pendingOrder.gift.price,
      fee: pendingOrder.fee,
      giftName: pendingOrder.gift.name,
      pubName: pendingOrder.pub.name,
      senderEmail: pendingOrder.senderEmail,
      pubId: getCheckoutPubId(pendingOrder.pub)
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
      renderPayment();
      setPurchaseStep("payment");
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
      setPurchaseStep("payment");
      await completeCheckoutAfterPayment();
    } catch (error) {
      console.warn("[PintDrop Stripe] Payment verification failed:", error);
      paymentProcessing = false;
      renderPayment();
      setPurchaseStep("payment");
      showStepError(
        "paymentFormError",
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
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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

function showCheckoutSuccess(voucher, smsResult, emailResult) {
  resetSuccessDeliveryState();
  $("successCode").textContent = voucher.code;

  if (voucher.source === "supabase" && smsResult?.ok) {
    $("successMessage").textContent =
      `${voucher.recipient} has just received a text message with your gift. They can redeem their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}. 🍻`;
  } else if (voucher.source === "supabase" && !smsResult?.ok) {
    $("successMessage").textContent =
      `Your PintDrop was created successfully for ${voucher.recipient} at ${voucher.pub.name}.`;
    $("successSmsCheck").textContent = "⚠ SMS not delivered";
    $("successSmsWarning").textContent =
      `The voucher was saved, but the SMS could not be sent${smsResult?.error ? `: ${smsResult.error}` : ""}. Please share the voucher code or link with the recipient manually.`;
    $("successSmsWarning").classList.remove("hidden");
  } else {
    $("successMessage").textContent =
      `${voucher.recipient} has just received a text message with your gift. They can redeem their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}. 🍻`;
  }

  if (voucher.source === "supabase" && !emailResult?.ok && !emailResult?.skipped) {
    $("successEmailCheck").textContent = "⚠ Email not sent";
    $("successEmailWarning").textContent =
      `Your PintDrop was created, but we could not send your confirmation email${emailResult?.error ? `: ${emailResult.error}` : ""}. Your receipt is still shown below.`;
    $("successEmailWarning").classList.remove("hidden");
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
  renderPayment();
  setPurchaseStep("payment");
});

$("paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingOrder || paymentProcessing) return;

  paymentProcessing = true;
  const button = $("payButton");
  button.disabled = true;
  $("paymentFormError")?.classList.add("hidden");

  try {
    savePendingOrderForStripe();
    const checkout = await createStripeCheckoutSession();
    window.location.href = checkout.url;
  } catch (error) {
    console.warn("[PintDrop Stripe] Checkout start failed:", error);
    showStepError(
      "paymentFormError",
      error?.message || "Could not start secure checkout. Please try again."
    );
    paymentProcessing = false;
    button.disabled = false;
  }
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
  id("Expiry").textContent = formatDate((voucher.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString()).slice(0, 10));
  const statusEl = id("Status");
  if (prefix === "voucher") {
    statusEl.textContent = voucher.status === "redeemed" ? "REDEEMED" : "VALID";
    statusEl.className = `status voucher-status-badge ${voucher.status === "redeemed" ? "redeemed" : "waiting"}`;
    document.querySelector("#voucher .wallet-pass")?.classList.toggle("is-redeemed", voucher.status === "redeemed");
  } else {
    statusEl.textContent = voucher.status === "redeemed" ? "REDEEMED" : "VALID";
    statusEl.className = `status ${voucher.status}`;
  }
  pulseStatusBadge(statusEl);

  const redeemedStamp = $(prefix === "voucher" ? "redeemedStamp" : `${prefix}RedeemedStamp`);
  const redeemedWhen = $(prefix === "voucher" ? "redeemedWhen" : `${prefix}RedeemedWhen`);
  if (redeemedStamp) {
    redeemedStamp.classList.toggle("hidden", voucher.status !== "redeemed");
    if (voucher.status === "redeemed" && voucher.redeemedAt && redeemedWhen) {
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
  $("smsRedeemedNotice").classList.toggle("hidden", voucher.status !== "redeemed");
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

async function refreshPartnerPayoutStatus() {
  const status = $("stripeConnectStatus");
  if (!status) return;

  try {
    const response = await fetch("/api/stripe-connect/account-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubId: PARTNER_SUPABASE_PUB_ID })
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      console.warn("[PintDrop Stripe Connect] Invalid account-status response:", error);
    }

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Could not load payout status.");
    }

    if (data.stripePayoutsReady === true) {
      status.textContent = "Payout setup: Payouts ready";
      setPartnerPayoutsAction(true);
      return;
    }

    setPartnerPayoutsAction(false);

    if (data.stripeOnboardingStatus === "not_started") {
      status.textContent = "Payout setup: Not started";
      return;
    }

    status.textContent = "Payout setup: Setup incomplete";
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
  if (!button || button.disabled) return;

  button.disabled = true;
  if (status) status.textContent = "Opening Stripe payout setup…";

  try {
    const response = await fetch("/api/stripe-connect/account-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubId: PARTNER_SUPABASE_PUB_ID })
    });

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

  void refreshPartnerPayoutStatus();
}

function setPartnerHistoryFilter(period) {
  partnerHistoryFilter = period;
  partnerActivityFilter = period;
  void renderPartner();
}

function voucherRow(voucher, waiting = false) {
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
        <div><dt>Expiry date</dt><dd>${formatDate(voucher.expiresAt.slice(0, 10))}</dd></div>
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

  const voucher = await redeemVoucherById(voucherId);
  if (!voucher) return;

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
  if (!voucher || voucher.status === "redeemed") return;
  showRedemptionConfirm();
});

$("redemptionConfirmCancel")?.addEventListener("click", hideRedemptionConfirm);

$("redemptionConfirmOk")?.addEventListener("click", async () => {
  if (!activeRedemptionVoucherId) return;
  hideRedemptionConfirm();

  const before = activeRedemptionVoucher
    || readVouchers().find(v => v.id === activeRedemptionVoucherId);
  if (before?.status === "redeemed") {
    renderRedemptionScreen(before);
    return;
  }

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

$("resetDemo").addEventListener("click", resetDemoState);
$("setupPayoutsBtn")?.addEventListener("click", () => {
  void startPartnerPayoutSetup();
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
  await loadPubs();
  seedPartnerDemoData();
  await applyDemoDefaults();
  $("pubSearch")?.addEventListener("input", (event) => filterPubList(event.target.value));
  await renderPartner();
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
