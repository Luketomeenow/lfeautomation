const MAX_FIELD_VALUE = 1024;
const MAX_FIELDS = 25;

function truncate(str, max = MAX_FIELD_VALUE) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/** Treat "/", empty, etc. as missing (Google Forms / Sheets quirks). */
function displayValue(v) {
  const s = String(v ?? '').trim();
  if (s === '' || s === '/' || s === '\\' || s === '—' || s === 'N/A' || s.toLowerCase() === 'n/a') {
    return '—';
  }
  return truncate(s);
}

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^\w\s/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Setter EOD: map columns by header text (not column index) so reordered form questions still align.
 * If "Follow Ups" is empty but "Notes" is numeric-only, treat that as follow-up count (common form mix-up).
 */
function buildSetterEodEmbed(formConfig, headers, rowValues) {
  const used = new Set();

  function firstMatch(matchesFn) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const n = normalizeHeader(headers[i]);
      if (!n) continue;
      if (matchesFn(n)) {
        used.add(i);
        return i;
      }
    }
    return -1;
  }

  const defs = [
    {
      label: 'Date',
      matches: (n) => n.includes('timestamp') || (n.includes('date') && !n.includes('candidate')),
    },
    {
      label: 'Name',
      matches: (n) =>
        (n.includes('name') || n.includes('setter')) &&
        !n.includes('unique') &&
        !n.includes('company') &&
        !n.includes('email'),
    },
    {
      label: 'Total Calls',
      matches: (n) =>
        (n.includes('total') && n.includes('call')) ||
        (n.includes('calls') && !n.includes('booked') && !n.includes('book')),
    },
    {
      label: 'Unique Leads',
      matches: (n) => n.includes('unique') && (n.includes('lead') || n.includes('leads')),
    },
    {
      label: 'Total DMs / Text',
      matches: (n) =>
        n.includes('dm') ||
        n.includes('dms') ||
        (n.includes('text') && !n.includes('context')) ||
        n.includes('message'),
    },
    {
      label: 'Booked Calls',
      matches: (n) => n.includes('booked') || (n.includes('book') && n.includes('call')),
    },
    {
      label: 'Follow Ups',
      matches: (n) =>
        (n.includes('follow') && (n.includes('up') || n.includes('ups'))) ||
        n.includes('followup') ||
        n.includes('follow-up'),
    },
    {
      label: 'Notes',
      matches: (n) =>
        (n.includes('note') && !n.includes('follow')) ||
        n.includes('additional') ||
        n.includes('comments') ||
        n.includes('remarks'),
    },
  ];

  const fields = [];
  let nameForTitle = '';
  let dateForDescription = '';

  for (const def of defs) {
    const idx = firstMatch(def.matches);
    const raw = idx >= 0 ? rowValues[idx] : '';
    let value = displayValue(raw);

    fields.push({ label: def.label, value, _idx: idx });

    if (def.label === 'Name' && value !== '—') nameForTitle = value;
    if (def.label === 'Date' && value !== '—') dateForDescription = value;
  }

  if (!dateForDescription && rowValues[0]) {
    const t = String(rowValues[0]).trim();
    if (t) dateForDescription = t;
  }

  const follow = fields.find((f) => f.label === 'Follow Ups');
  const notes = fields.find((f) => f.label === 'Notes');
  if (follow && notes) {
    const fu = String(follow.value === '—' ? '' : follow.value).trim();
    const nt = String(notes.value === '—' ? '' : notes.value).trim();
    const notesLooksNumeric = nt !== '' && /^[\d.,]+$/.test(nt.replace(/\s/g, ''));
    if ((fu === '' || fu === '—') && notesLooksNumeric) {
      follow.value = displayValue(nt);
      notes.value = '—';
    }
  }

  const embedFields = fields.map(({ label, value }) => ({
    name: label,
    value,
    inline: String(value).length < 100,
  }));

  const titleSuffix = nameForTitle ? ` — ${nameForTitle}` : '';
  const description = dateForDescription ? `Date: ${dateForDescription}` : null;

  return {
    title: `${formConfig.emoji} ${formConfig.name}${titleSuffix}`,
    description,
    color: formConfig.color,
    fields: embedFields.slice(0, MAX_FIELDS),
    footer: { text: 'BSM Form Bot' },
    timestamp: new Date().toISOString(),
  };
}

function buildEmbed(formConfig, headers, rowValues) {
  const fields = [];
  for (let i = 0; i < headers.length && fields.length < MAX_FIELDS; i++) {
    const name = headers[i] || `Column ${i + 1}`;
    const value = displayValue(rowValues[i] || '');

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

function buildSheetEmbed(formConfig, headers, rowValues) {
  if (formConfig.id === 'setter_eod') {
    return buildSetterEodEmbed(formConfig, headers, rowValues);
  }
  return buildEmbed(formConfig, headers, rowValues);
}

module.exports = { buildEmbed, buildSheetEmbed, buildSetterEodEmbed };
