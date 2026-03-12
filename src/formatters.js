const MAX_FIELD_VALUE = 1024;
const MAX_FIELDS = 25;

function truncate(str, max = MAX_FIELD_VALUE) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function buildEmbed(formConfig, headers, rowValues) {
  const fields = [];
  for (let i = 0; i < headers.length && fields.length < MAX_FIELDS; i++) {
    const name = headers[i] || `Column ${i + 1}`;
    const value = truncate(rowValues[i] || '');

    if (name.toLowerCase() === 'timestamp') continue;

    fields.push({
      name,
      value,
      inline: value.length < 100,
    });
  }

  const timestamp = rowValues[0] || null;
  const description = timestamp ? `Submitted at ${timestamp}` : null;

  return {
    title: `${formConfig.emoji} ${formConfig.name}`,
    description,
    color: formConfig.color,
    fields,
    footer: { text: 'BSM Form Bot' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = { buildEmbed };
