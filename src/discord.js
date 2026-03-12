async function sendWebhook(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed (${res.status}): ${text}`);
  }

  return res;
}

async function sendEmbed(webhookUrl, embed) {
  return sendWebhook(webhookUrl, {
    username: 'BSM Forms',
    embeds: [embed],
  });
}

module.exports = { sendWebhook, sendEmbed };
