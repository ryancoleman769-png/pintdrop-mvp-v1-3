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

module.exports = {
  SERVICE_FEE_RATE,
  calculateServiceFee,
  calculateOrderTotal
};
