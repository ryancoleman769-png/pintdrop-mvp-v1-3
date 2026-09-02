const {
  createStripeClient,
  getSupabaseUrl,
  getSupabaseServiceRoleKey,
  handleOptions,
  readJsonBody,
  requirePost,
  resolveAuthenticatedPartnerPub,
  loadPubStripeConnect,
  sendJson
} = require("../_lib/connect-helpers");

const ALLOWED_PERIODS = new Set(["today", "week", "month", "all"]);

function periodStart(period, now = new Date()) {
  if (period === "all") return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  }
  if (period === "month") start.setDate(1);
  return start;
}

async function loadVenueVouchers(pubId, period) {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const params = new URLSearchParams({
    pub_id: `eq.${pubId}`,
    select: "id,code,pub_id,drink_name,drink_price,service_fee,total,status,created_at,redeemed_at,stripe_checkout_session_id",
    order: "created_at.desc"
  });
  const start = periodStart(period);
  if (start) params.set("created_at", `gte.${start.toISOString()}`);

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/vouchers?${params}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "Could not load venue sales.");
  return Array.isArray(data) ? data : [];
}

function asId(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

async function loadPayoutMap(stripe, stripeAccountId) {
  const transferToPayout = new Map();
  const payouts = await stripe.payouts.list({ limit: 100 }, { stripeAccount: stripeAccountId });

  for (const payout of payouts.data || []) {
    if (!["paid", "pending", "in_transit"].includes(payout.status)) continue;
    const transactions = await stripe.balanceTransactions.list(
      { payout: payout.id, limit: 100 },
      { stripeAccount: stripeAccountId }
    );
    for (const transaction of transactions.data || []) {
      const source = asId(transaction.source);
      if (source?.startsWith("tr_")) {
        transferToPayout.set(source, {
          id: payout.id,
          status: payout.status,
          arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
          amount: Number(payout.amount || 0) / 100
        });
      }
    }
  }
  return transferToPayout;
}

async function reconcileVoucher(stripe, voucher, payoutMap) {
  const base = {
    voucherId: voucher.id,
    saleReference: voucher.code,
    itemSold: voucher.drink_name || "Voucher",
    saleDate: voucher.created_at,
    redemptionDate: voucher.redeemed_at,
    voucherStatus: voucher.status,
    venueValue: Number(voucher.drink_price || 0),
    customerPaid: Number(voucher.total || 0),
    pintDropFee: Number(voucher.service_fee || 0),
    stripeFee: null,
    refundAmount: 0,
    paymentReference: voucher.stripe_checkout_session_id || null,
    transferReference: null,
    transferAmount: 0,
    payoutReference: null,
    payoutDate: null,
    payoutStatus: voucher.stripe_checkout_session_id ? "processing" : "untracked",
    outstandingAmount: Number(voucher.drink_price || 0),
    reconciliationNote: voucher.stripe_checkout_session_id ? null : "Legacy sale: no Stripe checkout reference"
  };

  if (!voucher.stripe_checkout_session_id) return base;

  try {
    const session = await stripe.checkout.sessions.retrieve(voucher.stripe_checkout_session_id, {
      expand: ["payment_intent.latest_charge.balance_transaction"]
    });
    const intent = session.payment_intent;
    const charge = intent && typeof intent !== "string" ? intent.latest_charge : null;
    const balanceTransaction = charge && typeof charge !== "string" ? charge.balance_transaction : null;
    const transferId = charge && typeof charge !== "string" ? asId(charge.transfer) : null;
    let transfer = null;
    if (transferId) transfer = await stripe.transfers.retrieve(transferId);
    const payout = transferId ? payoutMap.get(transferId) : null;
    const refundAmount = charge && typeof charge !== "string" ? Number(charge.amount_refunded || 0) / 100 : 0;
    const transferAmount = Number(transfer?.amount || 0) / 100;
    const reversedAmount = Number(transfer?.amount_reversed || 0) / 100;
    const settledAmount = Math.max(0, transferAmount - reversedAmount);

    return {
      ...base,
      paymentReference: asId(intent) || session.payment_intent || session.id,
      transferReference: transferId,
      transferAmount: settledAmount,
      stripeFee: balanceTransaction && typeof balanceTransaction !== "string"
        ? Number(balanceTransaction.fee || 0) / 100
        : null,
      refundAmount,
      payoutReference: payout?.id || null,
      payoutDate: payout?.arrivalDate || null,
      payoutStatus: payout?.status || (transferId ? "awaiting_payout" : "processing"),
      outstandingAmount: payout?.status === "paid" ? 0 : settledAmount || base.venueValue,
      reconciliationNote: refundAmount > 0 && reversedAmount === 0
        ? "Refund recorded; transfer reversal requires review"
        : null
    };
  } catch (error) {
    console.warn("[partner/accounting-report] Stripe reconciliation failed", voucher.code, error?.code || error?.type || "unknown");
    return { ...base, payoutStatus: "review", reconciliationNote: "Stripe reconciliation unavailable for this sale" };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (handleOptions(req, res)) return;
  if (!requirePost(req, res)) return;
  if (!getSupabaseServiceRoleKey()) {
    sendJson(res, 500, { ok: false, error: "Settlement reporting is not configured." });
    return;
  }

  try {
    const partner = await resolveAuthenticatedPartnerPub(req);
    if (!partner) {
      sendJson(res, 401, { ok: false, error: "Partner authentication required." });
      return;
    }
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const period = ALLOWED_PERIODS.has(body?.period) ? body.period : "month";
    const stripeResult = createStripeClient();
    if (stripeResult.error) {
      sendJson(res, 500, { ok: false, error: stripeResult.error });
      return;
    }
    const pub = await loadPubStripeConnect(partner.pubId);
    const vouchers = await loadVenueVouchers(partner.pubId, period);
    let payoutMap = new Map();
    if (pub?.stripe_account_id) {
      try {
        payoutMap = await loadPayoutMap(stripeResult.stripe, pub.stripe_account_id);
      } catch (error) {
        console.warn("[partner/accounting-report] Payout history unavailable", error?.code || error?.type || "unknown");
      }
    }
    const rows = [];
    for (const voucher of vouchers) {
      rows.push(await reconcileVoucher(stripeResult.stripe, voucher, payoutMap));
    }
    sendJson(res, 200, {
      ok: true,
      venue: { id: partner.pubId, name: partner.profile?.pub_name || pub?.name || "Venue" },
      period,
      generatedAt: new Date().toISOString(),
      rows
    });
  } catch (error) {
    console.error("[partner/accounting-report]", error?.code || error?.type || error?.message || "unknown");
    sendJson(res, 500, { ok: false, error: "Could not prepare the settlement report." });
  }
};

module.exports._test = { periodStart, reconcileVoucher };
