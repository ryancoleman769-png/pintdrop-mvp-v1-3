const { calculateServiceFee, calculateOrderTotal } = require("./pricing");

const METADATA_MAX_LENGTH = 500;
const BAR_TAB_DRINK_IDS = new Set([6]);
const BAR_TAB_SLUGS = new Set(["tab"]);
const PURCHASE_HIDDEN_DRINK_IDS = new Set([5]);
const PURCHASE_HIDDEN_SLUGS = new Set(["soft"]);
const MAX_LINE_ITEM_QUANTITY = 20;
const MAX_LINE_ITEMS = 12;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeLineItem(raw = {}) {
  const drinkId = Number(raw.drinkId ?? raw.drink_id ?? raw.id);
  const quantity = Number(raw.quantity ?? raw.q ?? 1);
  const unitPrice = roundMoney(raw.unitPrice ?? raw.unit_price ?? raw.p ?? raw.price);
  const name = String(raw.name ?? raw.drink_name ?? raw.n ?? "").trim();
  const icon = String(raw.icon ?? raw.drink_icon ?? raw.ic ?? "🍺").trim() || "🍺";
  const slug = String(raw.slug ?? raw.drink_slug ?? "").trim().toLowerCase();

  if (!Number.isFinite(drinkId) || drinkId <= 0) return null;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_LINE_ITEM_QUANTITY) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  if (!name) return null;

  const lineSubtotal = roundMoney(unitPrice * quantity);

  return {
    drinkId,
    slug,
    name,
    icon,
    unitPrice,
    quantity,
    lineSubtotal
  };
}

function parseLineItemsFromBody(body = {}) {
  const source = Array.isArray(body.lineItems)
    ? body.lineItems
    : (Array.isArray(body.line_items) ? body.line_items : []);

  if (source.length) {
    return source.map(normalizeLineItem).filter(Boolean);
  }

  const legacyGiftPrice = Number(body.giftPrice);
  const legacyDrinkId = Number(body.drinkId);
  const legacyName = String(body.giftName || "").trim();
  const legacyIcon = String(body.drinkIcon || "🍺").trim() || "🍺";

  if (!Number.isFinite(legacyGiftPrice) || legacyGiftPrice <= 0) return [];
  if (!Number.isFinite(legacyDrinkId) || legacyDrinkId <= 0) return [];
  if (!legacyName) return [];

  return [{
    drinkId: legacyDrinkId,
    slug: "",
    name: legacyName,
    icon: legacyIcon,
    unitPrice: roundMoney(legacyGiftPrice),
    quantity: 1,
    lineSubtotal: roundMoney(legacyGiftPrice)
  }];
}

function isBarTabItem(item) {
  return BAR_TAB_DRINK_IDS.has(item.drinkId) || BAR_TAB_SLUGS.has(item.slug);
}

function isHiddenPurchaseItem(item) {
  return PURCHASE_HIDDEN_DRINK_IDS.has(item.drinkId) || PURCHASE_HIDDEN_SLUGS.has(item.slug);
}

function validateLineItems(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return { ok: false, error: "At least one drink is required." };
  }

  if (lineItems.length > MAX_LINE_ITEMS) {
    return { ok: false, error: "Too many items in this order." };
  }

  if (lineItems.some(isHiddenPurchaseItem)) {
    return { ok: false, error: "Soft drinks are no longer available for new orders." };
  }

  const hasBarTab = lineItems.some(isBarTabItem);
  if (hasBarTab && lineItems.length !== 1) {
    return { ok: false, error: "Bar Tab must be purchased on its own." };
  }

  if (hasBarTab) {
    const tabItem = lineItems[0];
    if (tabItem.quantity !== 1) {
      return { ok: false, error: "Bar Tab quantity must be 1." };
    }
  }

  return { ok: true };
}

function calculateBasketTotals(lineItems) {
  const pubValue = roundMoney(
    lineItems.reduce((sum, item) => sum + item.lineSubtotal, 0)
  );
  const fee = calculateServiceFee(pubValue);
  const total = calculateOrderTotal(pubValue);
  return { pubValue, fee, total };
}

function formatOrderSummary(lineItems) {
  return lineItems
    .map((item) => `${item.quantity}× ${item.name}`)
    .join(", ");
}

function buildVoucherSummaryFields(lineItems) {
  const first = lineItems[0];
  const pubValue = roundMoney(
    lineItems.reduce((sum, item) => sum + item.lineSubtotal, 0)
  );

  if (lineItems.length === 1 && first.quantity === 1) {
    return {
      drinkId: first.drinkId,
      drinkName: first.name,
      drinkIcon: first.icon,
      pubValue
    };
  }

  return {
    drinkId: first.drinkId,
    drinkName: formatOrderSummary(lineItems),
    drinkIcon: lineItems.length === 1 ? first.icon : "🍻",
    pubValue
  };
}

function lineItemsToRpcJson(lineItems) {
  return lineItems.map((item, index) => ({
    drink_id: item.drinkId,
    drink_name: item.name,
    drink_icon: item.icon,
    unit_price: item.unitPrice,
    quantity: item.quantity,
    line_subtotal: item.lineSubtotal,
    sort_order: index + 1
  }));
}

function compactOrderItemsForMetadata(lineItems) {
  return JSON.stringify(lineItems.map((item) => ({
    i: item.drinkId,
    q: item.quantity,
    p: item.unitPrice,
    n: item.name.slice(0, 40),
    ic: item.icon.slice(0, 4)
  })));
}

function parseOrderItemsFromMetadata(metadata = {}) {
  const raw = metadata.order_items || metadata.orderItems || "";
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeLineItem({
      drinkId: item.i ?? item.drinkId,
      quantity: item.q ?? item.quantity,
      unitPrice: item.p ?? item.unitPrice,
      name: item.n ?? item.name,
      icon: item.ic ?? item.icon
    })).filter(Boolean);
  } catch {
    return [];
  }
}

function buildStripeLineItems(lineItems, fee, description) {
  const drinkLines = lineItems.map((item) => ({
    price_data: {
      currency: "eur",
      product_data: {
        name: item.name,
        description
      },
      unit_amount: Math.round(item.unitPrice * 100)
    },
    quantity: item.quantity
  }));

  if (fee > 0) {
    drinkLines.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: "PintDrop service fee",
          description: "15% service fee"
        },
        unit_amount: Math.round(fee * 100)
      },
      quantity: 1
    });
  }

  return drinkLines;
}

module.exports = {
  METADATA_MAX_LENGTH,
  parseLineItemsFromBody,
  validateLineItems,
  calculateBasketTotals,
  formatOrderSummary,
  buildVoucherSummaryFields,
  lineItemsToRpcJson,
  compactOrderItemsForMetadata,
  parseOrderItemsFromMetadata,
  buildStripeLineItems
};
