const { handleAdminTransactionsRequest } = require("../_lib/admin-transactions");

module.exports = async function handler(req, res) {
  await handleAdminTransactionsRequest(req, res, { asCsv: false });
};

