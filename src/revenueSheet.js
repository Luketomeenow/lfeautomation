/**
 * Build a single row for the LFE Business Worksheet "Revenue" tab.
 * Columns: DUE DATE, CLIENT NAME, EMAIL ADDRESS, OFFER, CASH COLLECTED, CONTRACTED, INSTALMENT, STATUS, PAYMENT METHOD, PLATFORM, COMMISSION %, PAYOUT
 */

function toDateStr(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  const d = date instanceof Date ? date : new Date(date);
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function numToDollars(centsOrDollars, isCents = false) {
  if (centsOrDollars == null || centsOrDollars === '') return '';
  const n = Number(centsOrDollars);
  if (Number.isNaN(n)) return '';
  const amount = isCents ? n / 100 : n;
  return amount.toFixed(2);
}

function safe(val, fallback = '') {
  const s = (val ?? '').toString().trim();
  return s || fallback;
}

/**
 * One row = 12 cells for Revenue columns A–L.
 */
function buildRevenueRow({
  dueDate,
  clientName,
  email,
  offer,
  cashCollected,
  contracted,
  instalment,
  status,
  paymentMethod,
  platform,
  commissionPct,
  payout,
}) {
  return [
    dueDate ?? '',
    clientName ?? '',
    email ?? '',
    offer ?? '',
    cashCollected ?? '',
    contracted ?? '',
    instalment ?? '',
    status ?? '',
    paymentMethod ?? '',
    platform ?? '',
    commissionPct ?? '',
    payout ?? '',
  ];
}

/**
 * Build Revenue row from WHOP webhook payload (eventType + data).
 */
function buildWhopRevenueRow(eventType, data) {
  const d = data || {};
  const user = d.user ?? d.member ?? d.customer ?? {};
  const clientName = user.username ?? user.name ?? [user.first_name, user.last_name].filter(Boolean).join(' ') ?? user.email ?? '';
  const email = user.email ?? d.email ?? '';
  const product = d.product ?? d.plan ?? {};
  const offer = product.name ?? product.title ?? d.product_name ?? '';

  let amount = d.amount ?? d.total ?? d.value;
  const isCents = typeof amount === 'number' && (amount >= 1000 || amount <= -1000);
  const cashCollected = amount != null && eventType === 'payment.succeeded' ? numToDollars(amount, isCents) : '';
  const contracted = cashCollected;

  const statusMap = {
    'payment.succeeded': 'Paid',
    'payment.failed': 'Failed',
    'refund.created': 'Refund',
    'dispute.created': 'Dispute',
  };
  const status = statusMap[eventType] || eventType.replace(/\./g, ' ');

  return buildRevenueRow({
    dueDate: toDateStr(d.created_at ?? d.date ?? new Date()),
    clientName: safe(clientName),
    email: safe(email),
    offer: safe(offer),
    cashCollected,
    contracted,
    instalment: '',
    status,
    paymentMethod: 'Card',
    platform: 'Whop',
    commissionPct: '',
    payout: '',
  });
}

/**
 * Build Revenue row from Stripe webhook payload (eventType + event.data.object).
 */
function buildStripeRevenueRow(eventType, obj) {
  const o = obj || {};
  let email = o.receipt_email ?? o.billing_details?.email ?? o.customer_email ?? o.email ?? '';
  const clientName = o.billing_details?.name ?? '';
  const offer = o.description ?? (o.lines?.data?.[0]?.description ?? '');

  const amount = o.amount ?? o.amount_paid ?? o.amount_received ?? o.total;
  const isSuccess =
    eventType === 'payment_intent.succeeded' ||
    eventType === 'charge.succeeded' ||
    eventType === 'invoice.paid';
  const cashCollected = amount != null && isSuccess ? numToDollars(amount, true) : '';
  const contracted = cashCollected;

  const statusMap = {
    'payment_intent.succeeded': 'Paid',
    'payment_intent.payment_failed': 'Failed',
    'charge.succeeded': 'Paid',
    'charge.failed': 'Failed',
    'invoice.paid': 'Paid',
    'invoice.payment_failed': 'Failed',
  };
  const status = statusMap[eventType] || eventType.replace(/\./g, ' ');

  return buildRevenueRow({
    dueDate: toDateStr(o.created ? o.created * 1000 : new Date()),
    clientName: safe(clientName),
    email: safe(email),
    offer: safe(offer),
    cashCollected,
    contracted,
    instalment: '',
    status,
    paymentMethod: 'Card',
    platform: 'Stripe',
    commissionPct: '',
    payout: '',
  });
}

module.exports = { buildRevenueRow, buildWhopRevenueRow, buildStripeRevenueRow };
