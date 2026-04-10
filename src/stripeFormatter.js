/**
 * Build Discord embeds for Stripe webhooks: payment success, failure, invoice paid.
 * Stripe amounts are in cents; we display in dollars.
 */
function formatAmount(cents, currency) {
  if (cents == null) return '—';
  const num = Number(cents);
  if (Number.isNaN(num)) return String(cents);
  const cur = currency || 'usd';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(num / 100);
}

function safe(str, fallback = '—') {
  const s = (str ?? '').toString().trim();
  return s.length > 0 ? s : fallback;
}

function truncate(str, max = 1024) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

const EVENT_CONFIG = {
  'payment_intent.succeeded': { title: 'New payment', color: 0x2ecc71, emoji: '✅' },
  'payment_intent.payment_failed': { title: 'Payment failed', color: 0xe74c3c, emoji: '❌' },
  'charge.succeeded': { title: 'Charge succeeded', color: 0x2ecc71, emoji: '💳' },
  'charge.failed': { title: 'Charge failed', color: 0xe74c3c, emoji: '❌' },
  'invoice.paid': { title: 'Invoice paid', color: 0x2ecc71, emoji: '🧾' },
  'invoice.payment_failed': { title: 'Invoice payment failed', color: 0xe74c3c, emoji: '❌' },
};

/**
 * Extract customer email from PaymentIntent, Charge, or Invoice.
 */
function getEmail(obj) {
  if (!obj) return '—';
  const receipt = obj.receipt_email;
  if (receipt) return receipt;
  const billing = obj.billing_details || obj.billing_details_address;
  if (billing && billing.email) return billing.email;
  return obj.customer_email || obj.email || '—';
}

/**
 * Customer display name from Stripe object (billing_details, shipping, invoice).
 */
function getCustomerName(obj) {
  if (!obj) return '—';
  const b = obj.billing_details;
  if (b?.name && String(b.name).trim()) return String(b.name).trim();
  if (obj.shipping?.name && String(obj.shipping.name).trim()) return String(obj.shipping.name).trim();
  if (obj.customer_name && String(obj.customer_name).trim()) return String(obj.customer_name).trim();
  if (obj.metadata?.customer_name) return String(obj.metadata.customer_name).trim();
  if (obj.metadata?.name) return String(obj.metadata.name).trim();
  return '—';
}

const STRIPE_SUCCESS_PAYMENT_TYPES = new Set([
  'payment_intent.succeeded',
  'charge.succeeded',
  'invoice.paid',
]);

function getAmountCents(obj) {
  const o = obj || {};
  const amount = o.amount ?? o.amount_paid ?? o.amount_received ?? o.total;
  if (amount == null) return null;
  const n = Number(amount);
  return Number.isNaN(n) ? null : n;
}

/**
 * True if this is a successful payment at or below STRIPE_LOW_TICKET_MAX_CENTS (default $50.00).
 */
function isStripeLowTicketPayment(eventType, obj) {
  if (!STRIPE_SUCCESS_PAYMENT_TYPES.has(eventType)) return false;
  const maxCents = parseInt(process.env.STRIPE_LOW_TICKET_MAX_CENTS || '5000', 10);
  const cents = getAmountCents(obj);
  if (cents == null || cents <= 0) return false;
  return cents <= maxCents;
}

/**
 * Embed for #new-lead: name + email first, then amount and context.
 */
function buildStripeLowTicketLeadEmbed(eventType, obj) {
  const o = obj || {};
  const name = safe(getCustomerName(o));
  const email = safe(getEmail(o));
  const currency = (o.currency || 'usd').toLowerCase();
  const amountStr = formatAmount(getAmountCents(o), currency);
  const id = o.id ? truncate(o.id, 64) : '—';

  const fields = [
    { name: 'Name', value: truncate(name), inline: true },
    { name: 'Email', value: truncate(email), inline: true },
    { name: 'Amount', value: amountStr, inline: true },
    { name: 'Status', value: safe(o.status || 'succeeded'), inline: true },
    { name: 'Payment ID', value: id, inline: false },
  ];
  if (o.description) {
    fields.push({ name: 'Description', value: truncate(o.description), inline: false });
  }

  return {
    title: '💰 Low ticket · New lead (Stripe)',
    color: 0x3498db,
    fields,
    footer: { text: 'BSM Bot · Stripe → New leads' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build Discord embed from a Stripe event (event.type + event.data.object).
 */
function buildStripePaymentEmbed(eventType, obj) {
  const config = EVENT_CONFIG[eventType] || { title: eventType.replace(/\./g, ' '), color: 0x3498db, emoji: '💳' };
  const o = obj || {};

  let amount = o.amount ?? o.amount_paid ?? o.amount_received ?? o.total;
  const currency = (o.currency || 'usd').toLowerCase();
  const amountStr = formatAmount(amount, currency);
  const name = safe(getCustomerName(o));
  const email = safe(getEmail(o));
  const id = o.id ? truncate(o.id, 64) : '—';
  const status = safe(o.status);

  const fields = [
    { name: 'Amount', value: amountStr, inline: true },
    { name: 'Status', value: status, inline: true },
    { name: 'Name', value: truncate(name), inline: true },
    { name: 'Email', value: truncate(email), inline: true },
    { name: 'ID', value: id, inline: false },
  ];

  if (o.description) {
    fields.push({ name: 'Description', value: truncate(o.description), inline: false });
  }
  if (o.failure_message || o.last_payment_error?.message) {
    const msg = o.failure_message || o.last_payment_error?.message;
    fields.push({ name: 'Reason', value: truncate(msg), inline: false });
  }
  // Invoice line items summary
  if (o.lines && o.lines.data && o.lines.data.length > 0) {
    const line = o.lines.data[0];
    const desc = line.description || line.plan?.nickname || 'Invoice line';
    fields.push({ name: 'Line', value: truncate(desc, 256), inline: false });
  }

  return {
    title: `${config.emoji} ${config.title}`,
    color: config.color,
    fields,
    footer: { text: 'BSM Bot · Stripe' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  buildStripePaymentEmbed,
  buildStripeLowTicketLeadEmbed,
  formatAmount,
  getCustomerName,
  getEmail,
  isStripeLowTicketPayment,
};
