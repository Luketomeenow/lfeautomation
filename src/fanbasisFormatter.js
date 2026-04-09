/**
 * Discord embeds for FanBasis webhooks (payment.succeeded, payment.failed, etc.).
 * Docs: https://apidocs.fan/ — amounts often in cents; buyer/item shapes vary slightly.
 */

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  const num = Number(amount);
  if (Number.isNaN(num)) return String(amount);
  const cur = (currency || 'USD').toUpperCase();
  const dollars = num > 1000 || num < -1000 ? num / 100 : num;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(dollars);
}

function buildFanBasisPaymentEmbed(eventType, data) {
  const d = data || {};
  const isFailure =
    eventType === 'payment.failed' ||
    eventType === 'subscription.payment_failed' ||
    d.status === 'failed';

  const buyer = d.buyer || {};
  const item = d.item || {};
  const productName = item.name ?? item.title ?? '—';
  const buyerName = buyer.name ?? buyer.email ?? '—';
  const email = buyer.email ?? '—';

  const amount = d.amount ?? d.total_amount;
  const currency = d.currency ?? 'USD';
  const amountStr = formatMoney(amount, currency);

  const fields = [
    { name: 'Amount', value: amountStr, inline: true },
    { name: 'Status', value: String(d.status || eventType || '—'), inline: true },
    { name: 'Customer', value: String(buyerName).slice(0, 1024), inline: true },
    { name: 'Email', value: String(email).slice(0, 1024), inline: true },
    { name: 'Product', value: String(productName).slice(0, 1024), inline: true },
    { name: 'Item type', value: String(item.type ?? '—'), inline: true },
  ];

  if (d.payment_id) fields.push({ name: 'Payment ID', value: String(d.payment_id).slice(0, 1024), inline: true });
  if (d.checkout_session_id != null) {
    fields.push({ name: 'Checkout session', value: String(d.checkout_session_id), inline: true });
  }

  if (isFailure && (d.failure_reason || d.failure_message)) {
    fields.push({
      name: 'Reason',
      value: String(d.failure_reason || d.failure_message).slice(0, 1024),
      inline: false,
    });
  }

  const title = isFailure ? '❌ FanBasis payment failed' : '✅ FanBasis payment';
  const color = isFailure ? 0xe74c3c : 0x2ecc71;

  return {
    title,
    color,
    fields,
    footer: { text: 'BSM Bot · FanBasis' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = { buildFanBasisPaymentEmbed, formatMoney };
