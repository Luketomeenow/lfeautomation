/**
 * Parse Typeform webhook payload into an ordered list of { title, value } pairs.
 * Typeform sends: event_type, form_response: { answers[], definition?, hidden?, submitted_at }
 */
function getAnswerValue(answer) {
  if (!answer) return '';
  if (answer.text !== undefined) return answer.text;
  if (answer.email !== undefined) return answer.email;
  if (answer.url !== undefined) return answer.url;
  if (answer.phone_number !== undefined) return answer.phone_number;
  if (answer.number !== undefined) return String(answer.number);
  if (answer.boolean !== undefined) return answer.boolean ? 'Yes' : 'No';
  if (answer.date !== undefined) return answer.date;
  if (answer.file_url !== undefined) return answer.file_url;
  if (answer.payment !== undefined) return answer.payment?.amount ?? '';
  if (answer.choice !== undefined) {
    const c = answer.choice;
    return typeof c === 'object' && c !== null && 'label' in c ? c.label : String(c);
  }
  if (answer.choices !== undefined) {
    const labels = (answer.choices.labels || []).join(', ');
    return labels || (answer.choices.other || '');
  }
  return '';
}

function parsePayload(body) {
  const eventType = body?.event_type;
  const formResponse = body?.form_response;
  if (eventType !== 'form_response' || !formResponse) {
    return null;
  }

  const submittedAt = formResponse.submitted_at || new Date().toISOString();
  const d = new Date(submittedAt);
  const dateStr = [
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    d.getFullYear(),
  ].join('/');

  const answers = formResponse.answers || [];
  const definition = formResponse.definition || {};
  const fieldsDef = definition.fields || [];

  // Build ordered list of { title, value } from answers, using definition for titles
  const fields = [];
  for (const answer of answers) {
    const fieldId = answer.field?.id || '';
    const fieldDef = fieldsDef.find((f) => f.id === fieldId);
    const title = fieldDef?.title || answer.field?.ref || `Field ${fieldId}`;
    const value = getAnswerValue(answer);
    fields.push({ title, value });
  }

  // Hidden fields (UTM etc.)
  const hidden = formResponse.hidden || {};

  return { submittedAt, dateStr, fields, hidden };
}

/**
 * Keywords in the question title that indicate the cost/investment qualification question.
 */
const COST_KEYWORDS = ['invest', 'investment', 'cost', 'program', 'available to invest', 'budget'];

function isQualificationQuestion(title) {
  const lower = (title || '').toLowerCase();
  return COST_KEYWORDS.some((kw) => lower.includes(kw));
}

function isYesAnswer(value) {
  const lower = (value || '').toLowerCase().trim();
  return lower.startsWith('yes') || lower === 'y' || lower === 'true' || lower.startsWith('i can') || lower.startsWith('i agree');
}

function buildLeadFromParsed(parsed) {
  const { dateStr, fields, hidden } = parsed;

  // Find name from first/last name fields or a "name" field
  let firstName = '';
  let lastName = '';
  let email = '';
  let phone = '';
  let qualified = false;
  let costAnswer = '';

  for (const f of fields) {
    const lower = f.title.toLowerCase();
    if (lower.includes('first name')) firstName = f.value;
    else if (lower.includes('last name')) lastName = f.value;
    else if (lower === 'name' || lower === 'full name') firstName = f.value;
    else if (lower.includes('email')) email = f.value;
    else if (lower.includes('phone')) phone = f.value;

    if (isQualificationQuestion(f.title)) {
      costAnswer = f.value;
      if (isYesAnswer(f.value)) qualified = true;
    }
  }

  const name = [firstName, lastName].filter(Boolean).join(' ') || 'N/A';

  // Check for calendar link in any answer
  let calendarLink = null;
  for (const f of fields) {
    if (typeof f.value === 'string' && f.value.includes('calendly.com')) {
      calendarLink = f.value.trim();
      if (!qualified) qualified = true;
      break;
    }
  }

  return {
    dateStr,
    name,
    email: email || 'N/A',
    phone: phone || 'N/A',
    fields,
    hidden,
    costAnswer: costAnswer || 'N/A',
    calendarLink,
    qualified,
  };
}

module.exports = { parsePayload, buildLeadFromParsed };
