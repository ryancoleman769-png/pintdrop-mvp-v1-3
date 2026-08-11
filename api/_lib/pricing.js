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

function calculateBasketTotals(lineItems) {
  const pubValue = roundMoney(
    (lineItems || []).reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0)
  );
  if (pubValue <= 0) {
    return { pubValue: 0, fee: 0, total: 0 };
  }
  const fee = calculateServiceFee(pubValue);
  const total = calculateOrderTotal(pubValue);
  return { pubValue, fee, total };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

module.exports = {
  SERVICE_FEE_RATE,
  calculateServiceFee,
  calculateOrderTotal,
  calculateBasketTotals,
  roundMoney
};
