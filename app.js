const pubs = [
  { id: "oflahertys", name: "O'Flaherty's Bar", town: "Buncrana", icon: "🍺", image: "images/oflahertys-bar.jpg" },
  { id: "drift", name: "The Drift Inn", town: "Buncrana", icon: "🍻" },
  { id: "local", name: "Your Local", town: "Coming soon", icon: "📍" }
];

const gifts = [
  { id: "pint", name: "Pint", price: 6.50, icon: "🍺" },
  { id: "wine", name: "Glass of Wine", price: 6.50, icon: "🍷" },
  { id: "cocktail", name: "Cocktail", price: 8.50, icon: "🍸" },
  { id: "spirit", name: "Spirit & Mixer", price: 6.50, icon: "🥃" },
  { id: "tab", name: "€20 Bar Tab", price: 20.50, icon: "💶" }
];

const SERVICE_FEE = 0.50;
const LOGO = {
  mark: "images/pintdrop-mark.png",
  full: "images/pintdrop-logo.png"
};
const DEMO = {
  sender: "Ryan",
  recipient: "Dad",
  phone: "+353 87 123 4567",
  message: "Happy birthday Dad — have one on me 🍻"
};
let selectedPub = pubs[0];
let selectedGift = gifts[0];
let pendingOrder = null;
let paymentProcessing = false;

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

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function applyDemoDefaults() {
  selectedPub = pubs[0];
  selectedGift = gifts[0];
  $("recipientName").value = DEMO.recipient;
  $("recipientPhone").value = DEMO.phone;
  $("senderName").value = DEMO.sender;
  $("message").value = DEMO.message;
  $("deliveryDate").value = new Date().toISOString().slice(0, 10);
  if ($("cardName")) $("cardName").value = DEMO.sender;
  renderChoices();
  renderSummary();
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

  const journeyMap = { details: 1, review: 3, payment: 4, success: 5 };
  const journeyIndex = journeyMap[step];

  document.querySelectorAll("[data-journey-step]").forEach(el => {
    const index = Number(el.dataset.journeyStep);
    const isSuccess = step === "success";
    el.classList.toggle("active", !isSuccess && index === Math.min(journeyIndex, 4));
    el.classList.toggle("complete", isSuccess || index < journeyIndex);
  });

  document.querySelectorAll("[data-journey-line]").forEach(line => {
    const index = Number(line.dataset.journeyLine);
    line.classList.toggle("complete", step === "success" || index < journeyIndex);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

const venueMeta = {
  oflahertys: { rating: "4.9", open: true },
  drift: { rating: "4.7", open: true },
  local: { rating: "—", open: false }
};

function renderChoices() {
  $("pubList").innerHTML = pubs.map(pub => {
    const meta = venueMeta[pub.id] || { rating: "4.8", open: true };
    return `
    <button type="button" class="venue-card venue-card--${pub.id} ${pub.id === selectedPub.id ? "selected" : ""}" data-pub="${pub.id}">
      <div class="venue-banner">
        ${pub.image ? `<img class="venue-banner-photo" src="${pub.image}" alt="${pub.name}, ${pub.town}" loading="lazy" />` : `<span class="venue-banner-icon">${pub.icon}</span>`}
        <span class="venue-open-badge ${meta.open ? "is-open" : "is-soon"}">${meta.open ? "Open now" : "Coming soon"}</span>
      </div>
      <div class="venue-card-content">
        <div class="venue-card-top">
          <strong>${pub.name}</strong>
          <span class="venue-rating">★ ${meta.rating}</span>
        </div>
        <small class="venue-location">${pub.town}</small>
        <span class="venue-tag">Partner pub</span>
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
    btn.onclick = () => {
      selectedPub = pubs.find(pub => pub.id === btn.dataset.pub);
      renderChoices();
      renderSummary();
    };
  });

  document.querySelectorAll("[data-gift]").forEach(btn => {
    btn.onclick = () => {
      selectedGift = gifts.find(gift => gift.id === btn.dataset.gift);
      renderChoices();
      renderSummary();
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
  $("summaryPrice").textContent = money(selectedGift.price + SERVICE_FEE);
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(el => {
    el.classList.toggle("active", el.id === view);
  });
  document.querySelectorAll(".tab").forEach(el => {
    el.classList.toggle("active", el.dataset.view === view);
  });
  if (view === "sms") renderSms();
  if (view === "voucher") renderVoucher();
  if (view === "partner") renderPartner();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function buildPendingOrder() {
  const recipient = $("recipientName").value.trim();
  const phone = $("recipientPhone").value.trim();
  const sender = $("senderName").value.trim();
  const deliveryDate = $("deliveryDate").value || new Date().toISOString().slice(0, 10);

  if (!recipient || !phone || !sender) return null;

  return {
    pub: selectedPub,
    gift: selectedGift,
    recipient,
    phone,
    sender,
    message: $("message").value.trim() || `A PintDrop from ${sender}`,
    deliveryDate,
    fee: SERVICE_FEE,
    total: selectedGift.price + SERVICE_FEE
  };
}

function renderReview() {
  if (!pendingOrder) return;
  const rows = [
    [pendingOrder.gift.icon, "Gift", pendingOrder.gift.name],
    ["📍", "Pub", `${pendingOrder.pub.name}, ${pendingOrder.pub.town}`],
    ["👤", "Recipient", `${pendingOrder.recipient} • ${pendingOrder.phone}`],
    ["💬", "Message", pendingOrder.message],
    ["📅", "Delivery", formatDate(pendingOrder.deliveryDate)]
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

function createVoucherFromPendingOrder() {
  const voucher = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    code: createCode(),
    pub: pendingOrder.pub,
    gift: pendingOrder.gift,
    recipient: pendingOrder.recipient,
    phone: pendingOrder.phone,
    sender: pendingOrder.sender,
    message: pendingOrder.message,
    deliveryDate: pendingOrder.deliveryDate,
    fee: pendingOrder.fee,
    total: pendingOrder.total,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: "waiting",
    redeemedAt: null
  };

  const vouchers = readVouchers();
  vouchers.unshift(voucher);
  writeVouchers(vouchers);
  localStorage.setItem("pintdrop_last_voucher", voucher.id);
  return voucher;
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.querySelectorAll("[data-back-to]").forEach(btn => {
  btn.addEventListener("click", () => setPurchaseStep(btn.dataset.backTo));
});

$("orderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  pendingOrder = buildPendingOrder();
  if (!pendingOrder) return;
  renderReview();
  setPurchaseStep("review");
});

$("goToPayment").addEventListener("click", () => {
  renderPayment();
  setPurchaseStep("payment");
});

$("paymentForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingOrder || paymentProcessing) return;

  paymentProcessing = true;
  const button = $("payButton");
  const overlay = $("processingOverlay");
  button.disabled = true;
  resetProcessingSteps();
  overlay.classList.remove("hidden");

  setTimeout(() => setProcessingStep(1), 400);
  setTimeout(() => setProcessingStep(2), 900);
  setTimeout(() => setProcessingStep(3), 1400);
  setTimeout(() => setProcessingStep(4), 1800);

  setTimeout(() => {
    const voucher = createVoucherFromPendingOrder();
    $("successMessage").textContent = `${voucher.recipient} has just received a text message with your gift. They can redeem their ${voucher.gift.name.toLowerCase()} at ${voucher.pub.name}. 🍻`;
    $("successCode").textContent = voucher.code;
    overlay.classList.add("hidden");
    resetProcessingSteps();
    setPurchaseStep("success");
    paymentProcessing = false;
    button.disabled = false;
    renderPartner();
    renderSms();
  }, 2000);
});

$("viewVoucher").addEventListener("click", () => switchView("sms"));
$("sendAnother").addEventListener("click", () => {
  applyDemoDefaults();
  pendingOrder = null;
  setPurchaseStep("details");
});

function getLastVoucher() {
  const vouchers = readVouchers();
  const id = localStorage.getItem("pintdrop_last_voucher");
  return vouchers.find(v => v.id === id) || vouchers[0];
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
  id("Status").textContent = voucher.status === "redeemed" ? "REDEEMED" : "VALID";
  id("Status").className = `status ${voucher.status}`;
  pulseStatusBadge(id("Status"));

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
  renderFakeQr(voucher.code, "smsWalletFakeQr");

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
  const voucher = getLastVoucher();
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
    renderFakeQr(voucher.code, "smsWalletFakeQr");
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
  const voucher = getLastVoucher();

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
  renderFakeQr(voucher.code);
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

function activityItem(voucher, type) {
  const time = type === "redeemed" && voucher.redeemedAt
    ? formatDateTime(voucher.redeemedAt)
    : formatDateTime(voucher.createdAt);
  const statusLabel = type === "redeemed" ? "Redeemed" : "Waiting";
  return `
    <div class="activity-row activity-row--${type}">
      <span class="activity-cell activity-recipient">${voucher.recipient}</span>
      <span class="activity-cell activity-gift">${voucher.gift.icon} ${voucher.gift.name}</span>
      <span class="activity-cell activity-value">${money(voucher.gift.price)}</span>
      <span class="activity-cell activity-status">${statusLabel}</span>
      <span class="activity-cell activity-time">${time}</span>
    </div>
  `;
}

function activityListHeader() {
  return `
    <div class="activity-row activity-row-head">
      <span class="activity-cell">Recipient</span>
      <span class="activity-cell">Gift</span>
      <span class="activity-cell">Value</span>
      <span class="activity-cell">Status</span>
      <span class="activity-cell">Time</span>
    </div>
  `;
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

function renderPartner() {
  const vouchers = readVouchers();
  const waiting = vouchers.filter(v => v.status === "waiting");
  const redeemedToday = vouchers.filter(v => v.status === "redeemed" && isToday(v.redeemedAt));

  $("statWaiting").textContent = waiting.length;
  $("statRedeemedToday").textContent = redeemedToday.length;
  $("statValueToday").textContent = money(
    redeemedToday.reduce((sum, voucher) => sum + voucher.gift.price, 0)
  );

  $("waitingList").innerHTML = waiting.length
    ? waiting.map(v => voucherRow(v, true)).join("")
    : `<p class="note">No waiting vouchers.</p>`;

  const redeemed = vouchers.filter(v => v.status === "redeemed");
  $("redeemedList").innerHTML = redeemed.length
    ? redeemed.map(v => voucherRow(v, false)).join("")
    : `<p class="note">No redeemed vouchers yet.</p>`;

  const activity = [
    ...redeemed.map(v => ({ voucher: v, type: "redeemed", time: v.redeemedAt || v.createdAt })),
    ...waiting.map(v => ({ voucher: v, type: "waiting", time: v.createdAt }))
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 8);

  $("activityList").innerHTML = activity.length
    ? activityListHeader() + activity.map(({ voucher, type }) => activityItem(voucher, type)).join("")
    : `<p class="note">Activity will appear here after your first PintDrop.</p>`;
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

  $("confirmRedeem").onclick = () => completeRedemption(voucher.id);
}

function completeRedemption(voucherId) {
  const vouchers = readVouchers();
  const voucher = vouchers.find(v => v.id === voucherId);

  if (!voucher) {
    $("redeemResult").innerHTML = `<div class="result error">Voucher not found. Check the code and try again.</div>`;
    return;
  }

  if (voucher.status === "redeemed") {
    $("redeemResult").innerHTML = `<div class="result">This voucher has already been redeemed.</div>`;
    return;
  }

  voucher.status = "redeemed";
  voucher.redeemedAt = new Date().toISOString();
  writeVouchers(vouchers);

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

$("redeemForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const input = $("redeemCode").value.trim().toUpperCase();
  const vouchers = readVouchers();
  const voucher = vouchers.find(v => v.code.toUpperCase() === input);

  if (!voucher) {
    $("redeemResult").innerHTML = `<div class="result error">Voucher not found. Check the code and try again.</div>`;
    return;
  }

  if (voucher.status === "redeemed") {
    $("redeemResult").innerHTML = `<div class="result">This voucher has already been redeemed.</div>`;
    return;
  }

  renderRedeemValid(voucher);
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
  const voucher = getLastVoucher();
  if (!voucher) {
    $("redeemResult").innerHTML = `<div class="result error">Create a voucher first.</div>`;
    return;
  }

  if (voucher.status === "redeemed") {
    $("redeemResult").innerHTML = `<div class="result">This voucher has already been redeemed.</div>`;
    return;
  }

  $("redeemResult").innerHTML = "";
  $("scannerDemo").classList.remove("hidden");
  $("scannerDemo").classList.add("is-scanning");
  $("scannerStatus")?.classList.remove("hidden");
  $("scanLatestVoucher").disabled = true;

  setTimeout(() => {
    $("redeemCode").value = voucher.code;
    $("scannerDemo").classList.add("hidden");
    $("scannerDemo").classList.remove("is-scanning");
    $("scannerStatus")?.classList.add("hidden");
    $("scanLatestVoucher").disabled = false;
    renderRedeemValid(voucher);
  }, 1500);
});

function resetDemoState() {
  localStorage.removeItem("pintdrop_vouchers");
  localStorage.removeItem("pintdrop_last_voucher");
  $("redeemResult").innerHTML = "";
  $("scannerDemo").classList.add("hidden");
  $("scannerDemo").classList.remove("is-scanning");
  $("scannerStatus")?.classList.add("hidden");
  $("scanLatestVoucher").disabled = false;
  $("redeemCode").value = "";
  pendingOrder = null;
  paymentProcessing = false;
  resetProcessingSteps();
  applyDemoDefaults();
  setPurchaseStep("details");
  switchView("customer");
  renderPartner();
  renderVoucher();
  renderSms();
}

$("resetDemo").addEventListener("click", resetDemoState);

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

$("deliveryDate").min = new Date().toISOString().slice(0, 10);
applyDemoDefaults();
$("pubSearch")?.addEventListener("input", (event) => filterPubList(event.target.value));
renderPartner();
renderSms();
