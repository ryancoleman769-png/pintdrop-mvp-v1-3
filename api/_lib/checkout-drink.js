const { calculateServiceFee, calculateOrderTotal } = require("./pricing");
const { getSupabaseUrl, getSupabaseServiceRoleKey } = require("./connect-helpers");

const BAR_TAB_PRESETS = [20, 30];

function barTabPresetFromSlug(slug) {
  const match = /^tab-(20|30)$/.exec(String(slug || "").trim().toLowerCase());
  return match ? Number(match[1]) : null;
}

function isBarTabDrinkRow(row) {
  const slug = String(row?.slug || row?.id || "").trim().toLowerCase();
  if (slug === "tab" || slug.startsWith("tab-")) return true;
  return String(row?.name || "").toLowerCase().includes("bar tab");
}

function isDrinkActive(row) {
  return row && row.active !== false && row.active !== 0;
}

function isSellableCheckoutDrink(row, pubId) {
  if (!row) {
    return { ok: false, error: "That drink is not available." };
  }
  if (Number(row.pub_id) !== Number(pubId)) {
    return { ok: false, error: "That drink is not available." };
  }
  if (!isDrinkActive(row)) {
    return { ok: false, error: "That drink is not available." };
  }

  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "That drink is not available." };
  }

  if (isBarTabDrinkRow(row)) {
    const slug = String(row.slug || "").trim().toLowerCase();
    const presetFromSlug = barTabPresetFromSlug(slug);
    if (presetFromSlug) {
      if (price !== presetFromSlug) {
        return { ok: false, error: "That drink is not available." };
      }
    } else if (slug === "tab") {
      if (!BAR_TAB_PRESETS.includes(price)) {
        return { ok: false, error: "That drink is not available." };
      }
    } else {
      return { ok: false, error: "That drink is not available." };
    }
  }

  return { ok: true, price };
}

function quoteVerifiedDrink(row, pubId) {
  const check = isSellableCheckoutDrink(row, pubId);
  if (!check.ok) return check;

  const giftPrice = check.price;
  return {
    ok: true,
    giftPrice,
    serviceFee: calculateServiceFee(giftPrice),
    total: calculateOrderTotal(giftPrice),
    drinkId: Number(row.id),
    pubId: Number(row.pub_id),
    drinkName: String(row.name || "").trim(),
    drinkIcon: String(row.icon || "").trim()
  };
}

async function loadCheckoutDrinkRow(pubId, drinkId) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) {
    return { ok: false, statusCode: 500, error: "Could not verify drink price." };
  }

  const params = new URLSearchParams();
  params.set("id", `eq.${drinkId}`);
  params.set("pub_id", `eq.${pubId}`);
  params.set("select", "id,pub_id,name,slug,price,active,icon");

  let response;
  try {
    response = await fetch(`${getSupabaseUrl()}/rest/v1/drinks?${params.toString()}`, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json"
      }
    });
  } catch (error) {
    console.warn("[checkout-drink] Drink lookup failed:", error);
    return { ok: false, statusCode: 500, error: "Could not verify drink price." };
  }

  if (!response.ok) {
    return { ok: false, statusCode: 500, error: "Could not verify drink price." };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, statusCode: 500, error: "Could not verify drink price." };
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return { ok: false, statusCode: 400, error: "That drink is not available." };
  }

  return { ok: true, row };
}

async function loadVerifiedCheckoutQuote(pubId, drinkId) {
  const loaded = await loadCheckoutDrinkRow(pubId, drinkId);
  if (!loaded.ok) return loaded;
  const quoted = quoteVerifiedDrink(loaded.row, pubId);
  if (!quoted.ok) {
    return { ok: false, statusCode: 400, error: quoted.error };
  }
  return quoted;
}

module.exports = {
  BAR_TAB_PRESETS,
  barTabPresetFromSlug,
  isBarTabDrinkRow,
  isSellableCheckoutDrink,
  quoteVerifiedDrink,
  loadCheckoutDrinkRow,
  loadVerifiedCheckoutQuote
};

