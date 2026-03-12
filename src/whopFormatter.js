/**
 * Build Discord embeds for WHOP payment webhooks: new payments, failed, refunds, disputes.
 * WHOP may send amount in cents; we display in dollars.
 */
function formatAmount(value, currency) {
  if (value == null) return '—';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  const inDollars = num >= 1000 || num <= -1000 ? num / 100 : num;
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(inDollars);
}

const EVENT_CONFIG = {
  'payment.succeeded': { title: '✅ New payment', color: 0x2ecc71, emoji: '✅' },
  'payment.failed': { title: '❌ Failed payment', color: 0xe74c3c, emoji: '❌' },
  'refund.created': { title: '↩️ Refund', color: 0xf39c12, emoji: '↩️' },
  'dispute.created': { title: '⚠️ Dispute', color: 0xe67e22, emoji: '⚠️' },
};

function buildWhopPaymentEmbed(eventType, data) {
  const config = EVENT_CONFIG[eventType] || { title: eventType, color: 0x3498db, emoji: '💳' };
  const d = data || {};

  const amount = d.amount ?? d.total ?? d.value;
  const currency = d.currency ?? d.currency_code ?? 'USD';
  const amountStr = formatAmount(amount, currency);

  const user = d.user ?? d.member ?? d.customer ?? {};
  const userName = user.username ?? user.name ?? [user.first_name, user.last_name].filter(Boolean).join(' ') ?? user.email ?? '—';
  const email = user.email ?? d.email ?? '—';

  const product = d.product ?? d.plan ?? {};
  const productName = product.name ?? product.title ?? d.product_name ?? '—';
  const planName = product.plan_name ?? d.plan_name ?? '—';

  const fields = [
    { name: 'Amount', value: amountStr, inline: true },
    { name: 'Status', value: (d.status || eventType).replace(/\./g, ' '), inline: true },
    { name: 'User', value: String(userName).slice(0, 1024), inline: true },
    { name: 'Email', value: String(email).slice(0, 1024), inline: true },
    { name: 'Product', value: String(productName).slice(0, 1024), inline: true },
    { name: 'Plan', value: String(planName).slice(0, 1024), inline: true },
  ];

  if (d.id) fields.push({ name: 'Payment ID', value: String(d.id).slice(0, 1024), inline: true });
  if (d.reason || d.failure_reason) {
    fields.push({ name: 'Reason', value: String(d.reason || d.failure_reason).slice(0, 1024), inline: false });
  }

  return {
    title: `${config.emoji} ${config.title}`,
    color: config.color,
    fields,
    footer: { text: 'BSM Bot · WHOP' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = { buildWhopPaymentEmbed, formatAmount };
