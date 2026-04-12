/**
 * Build Discord embed for GHL calendar appointment booked (call booked).
 * Uses DISCORD_WEBHOOK_BOOKED_CALL - same channel as Google Form "Booked Call".
 */
function buildGhlBookedCallEmbed(appointment) {
  const start = appointment.startTime ? formatGhlDate(appointment.startTime) : '—';
  const end = appointment.endTime ? formatGhlDate(appointment.endTime) : '—';
  const title = appointment.title || 'Call booked';
  const status = appointment.appointmentStatus || '—';
  const source = appointment.source || '—';
  const notes = appointment.notes || '—';
  const address = appointment.address || '';

  const fields = [
    { name: 'Title', value: title, inline: true },
    { name: 'Status', value: status, inline: true },
    { name: 'Source', value: source, inline: true },
    { name: 'Start', value: start, inline: true },
    { name: 'End', value: end, inline: true },
    { name: 'Calendar ID', value: appointment.calendarId || '—', inline: true },
    { name: 'Notes', value: notes || '—', inline: false },
  ];

  if (address) {
    fields.push({ name: 'Meeting link', value: address, inline: false });
  }

  return {
    title: '📅 Call booked (GHL)',
    color: 0x1abc9c, // teal - same as Booked Call form
    fields,
    footer: { text: 'BSM Bot · GoHighLevel Calendar' },
    timestamp: new Date().toISOString(),
  };
}

function formatGhlDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/**
 * Build embed from GHL workflow webhook payload (contact details + any custom/trigger data).
 * GHL workflow "Fire a webhook" sends contact and custom data, not the developer AppointmentCreate shape.
 */
function buildGhlWorkflowEmbed(body) {
  const contact = body.contact || body;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.name || contact.fullName || '—';
  const email = contact.email || body.email || '—';
  const phone = contact.phone || contact.phoneNumber || body.phone || '—';

  const fields = [
    { name: 'Name', value: name, inline: true },
    { name: 'Email', value: email, inline: true },
    { name: 'Phone', value: phone, inline: true },
  ];

  // Include any other top-level or contact fields that look useful (avoid huge objects)
  const skip = new Set(['contact', 'firstName', 'lastName', 'name', 'fullName', 'email', 'phone', 'phoneNumber']);
  for (const [key, value] of Object.entries(body)) {
    if (skip.has(key) || value == null || typeof value === 'object') continue;
    const str = String(value).trim();
    if (str.length > 0 && str.length < 1024) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      fields.push({ name: label, value: str, inline: true });
    }
  }

  return {
    title: '📅 Call booked (GHL)',
    color: 0x1abc9c,
    fields,
    footer: { text: 'BSM Bot · GoHighLevel Calendar' },
    timestamp: new Date().toISOString(),
  };
}

const OPPORTUNITY_STAGES = {
  no_show: { label: 'No show', color: 0xe74c3c },
  follow_up: { label: 'Follow up', color: 0xf39c12 },
  closed_deal: { label: 'Closed deal', color: 0x2ecc71 },
};

/** Normalize object keys for skip matching (Contact_id → contactid). */
function normOppKey(k) {
  return String(k || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

/** Keys we never show on pipeline embeds (IDs / internal noise). */
const OPPORTUNITY_SKIPPED_KEYS = new Set([
  'contact',
  'opportunity',
  'stage',
  'stagename',
  'pipelinestage',
  'pipelinestageid',
  'pipelinestage',
  'status',
  'firstname',
  'lastname',
  'name',
  'fullname',
  'displayname',
  'email',
  'phone',
  'phonenumber',
  'customdata',
  'custom_data',
  'contactid',
  'contacttype',
  'opportunitysource',
  'pipelineid',
  'id',
  'opportunityid',
  'calendarid',
  'userid',
  'locationid', // shown implicitly via link; still in payload
]);

function shouldSkipOpportunityField(key) {
  const n = normOppKey(key);
  if (OPPORTUNITY_SKIPPED_KEYS.has(n)) return true;
  if (n === 'pipelineid' || n.endsWith('pipelineid')) return true;
  if (n.endsWith('contactid') && n !== 'contactsource') return true;
  return false;
}

/**
 * GHL CRM contact page (location + contact id required).
 * @see https://app.gohighlevel.com — path pattern may vary by account region.
 */
function buildGhlContactDetailUrl(contactId, locationId) {
  if (!contactId || !locationId) return null;
  const cid = encodeURIComponent(String(contactId).trim());
  const lid = encodeURIComponent(String(locationId).trim());
  return `https://app.gohighlevel.com/v2/location/${lid}/contacts/detail/${cid}`;
}

function linkLabelForDiscord(name) {
  return String(name || '—')
    .replace(/[\[\]()]/g, '')
    .trim()
    .slice(0, 200);
}

/**
 * GHL workflow webhooks vary: contact may be object, array, nested under opportunity, or flat on body.
 */
function extractGhlContact(body) {
  const b = body || {};
  let c = b.contact;
  if (Array.isArray(c) && c.length > 0) c = c[0];
  if (c && typeof c === 'object') return c;
  if (b.attributionContact && typeof b.attributionContact === 'object') return b.attributionContact;
  if (b.lead && typeof b.lead === 'object') return b.lead;
  const opp = b.opportunity;
  if (opp?.contact && typeof opp.contact === 'object') {
    let oc = opp.contact;
    if (Array.isArray(oc) && oc[0]) oc = oc[0];
    return oc;
  }
  return b;
}

/**
 * Build embed for opportunity pipeline stage (No show, Follow up, Closed deal).
 * stageKey: 'no_show' | 'follow_up' | 'closed_deal'
 */
function buildGhlOpportunityEmbed(stageKey, body) {
  const stage = OPPORTUNITY_STAGES[stageKey] || { label: stageKey, color: 0x3498db };

  const contact = extractGhlContact(body);
  const name =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.name ||
    contact.fullName ||
    contact.displayName ||
    body.full_name ||
    body.fullName ||
    '—';

  const contactId =
    contact.id ||
    contact.contactId ||
    body.contact_id ||
    body.contactId ||
    body.Contact_id;
  const locationId =
    (process.env.GHL_LOCATION_ID || '').trim() ||
    body.locationId ||
    body.location_id ||
    body.LocationId ||
    contact.locationId;

  const ghlUrl = buildGhlContactDetailUrl(contactId, locationId);
  const label = linkLabelForDiscord(name === '—' ? '' : name);
  let nameFieldValue = String(name).slice(0, 1024) || '—';
  if (ghlUrl && label && label !== '—') {
    nameFieldValue = `[${label}](${ghlUrl})`.slice(0, 1024);
  }

  const email = contact.email || body.email || contact.emailAddress || '—';
  const phone =
    contact.phone ||
    contact.phoneNumber ||
    contact.phone_number ||
    body.phone ||
    body.phoneNumber ||
    '—';

  const fields = [
    { name: 'Stage', value: stage.label, inline: true },
    { name: 'Name', value: nameFieldValue, inline: true },
    { name: 'Email', value: String(email).slice(0, 1024) || '—', inline: true },
    { name: 'Phone', value: String(phone).slice(0, 1024) || '—', inline: true },
  ];

  const opp = body.opportunity;
  if (opp && typeof opp === 'object') {
    if (opp.name) fields.push({ name: 'Opportunity', value: String(opp.name).slice(0, 1024), inline: false });
    if (opp.monetaryValue != null && opp.monetaryValue !== '')
      fields.push({ name: 'Value', value: String(opp.monetaryValue), inline: true });
    if (opp.pipelineStageName || opp.pipeline_stage_name) {
      const ps = opp.pipelineStageName || opp.pipeline_stage_name;
      fields.push({ name: 'Pipeline stage', value: String(ps).slice(0, 1024), inline: true });
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (shouldSkipOpportunityField(key)) continue;
    if (value == null || typeof value === 'object') continue;
    const str = String(value).trim();
    if (str.length > 0 && str.length < 1024) {
      const labelKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      fields.push({ name: labelKey, value: str, inline: true });
    }
  }

  return {
    title: `📌 Pipeline: ${stage.label}`,
    color: stage.color,
    fields,
    footer: { text: 'BSM Bot · Opportunity Pipeline' },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  buildGhlBookedCallEmbed,
  buildGhlWorkflowEmbed,
  buildGhlOpportunityEmbed,
  extractGhlContact,
};
