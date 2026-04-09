const crypto = require('crypto');
const express = require('express');
const { FORMS, POLL_INTERVAL_MS } = require('./config');
const { getRowCount, getNewRows } = require('./sheets');
const { sendEmbed } = require('./discord');
const { buildSheetEmbed } = require('./formatters');
const { parsePayload, buildLeadFromParsed } = require('./typeform');
const { buildNewLeadEmbed } = require('./typeformFormatter');
const { buildGhlBookedCallEmbed, buildGhlWorkflowEmbed, buildGhlOpportunityEmbed } = require('./ghlFormatter');
const { buildWhopPaymentEmbed } = require('./whopFormatter');
const { buildStripePaymentEmbed } = require('./stripeFormatter');
const { buildFanBasisPaymentEmbed } = require('./fanbasisFormatter');
const { appendRows } = require('./sheets');
const { buildWhopRevenueRow, buildStripeRevenueRow, buildFanBasisRevenueRow, buildRevenueRow } = require('./revenueSheet');
const state = require('./state');

function appendToRevenueSheet(row) {
  const sheetId = (process.env.REVENUE_SHEET_ID || '').trim();
  if (!sheetId) {
    return Promise.resolve();
  }
  if (!row || !Array.isArray(row)) {
    console.warn('[Revenue] Skip append: invalid row');
    return Promise.resolve();
  }
  const sheetName = (process.env.REVENUE_SHEET_NAME || '').trim() || 'Revenue';
  return appendRows(sheetId, sheetName, [row])
    .then(() => console.log('[Revenue] Row appended to tab', JSON.stringify(sheetName), 'spreadsheet', sheetId.slice(0, 8) + '…'))
    .catch((err) => {
      const detail = err.response?.data;
      console.error(
        '[Revenue] Google Sheets append failed:',
        err.message,
        detail ? JSON.stringify(detail) : '(check REVENUE_SHEET_ID, tab name REVENUE_SHEET_NAME, and share sheet with service account as Editor)',
      );
    });
}

const app = express();
const PORT = process.env.PORT || 3000;

const STRIPE_FAILURE_EVENTS = new Set([
  'payment_intent.payment_failed',
  'charge.failed',
  'invoice.payment_failed',
]);

const FANBASIS_FAILURE_EVENTS = new Set(['payment.failed', 'subscription.payment_failed']);

function validateFanBasisSignature(rawBuf, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  try {
    const a = Buffer.from(String(signatureHeader).trim(), 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Stripe webhook needs raw body for signature verification; register before express.json()
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body;
  const sig = req.headers['stripe-signature'];
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  let event;
  try {
    if (secret && sig) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_dummy');
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } else {
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    }
  } catch (err) {
    console.error('[Stripe] Webhook parse/verify error:', err.message);
    res.status(400).json({ received: false, error: err.message });
    return;
  }

  const eventType = event.type || '';
  const obj = event.data?.object || {};
  // Revenue sheet: successful payments only (not failed payment events)
  if (!STRIPE_FAILURE_EVENTS.has(eventType)) {
    appendToRevenueSheet(buildStripeRevenueRow(eventType, obj));
  }

  const stripeFailed = STRIPE_FAILURE_EVENTS.has(eventType);
  const webhookUrl = (
    stripeFailed ? process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS : process.env.DISCORD_WEBHOOK_NEW_PAYMENTS
  ).trim();

  if (!webhookUrl) {
    console.error(
      stripeFailed ? '[Stripe] DISCORD_WEBHOOK_FAILED_PAYMENTS not set' : '[Stripe] DISCORD_WEBHOOK_NEW_PAYMENTS not set',
    );
    res.status(200).json({
      received: true,
      error: stripeFailed ? 'Failed-payments webhook not configured' : 'New payments webhook not configured',
    });
    return;
  }

  const embed = buildStripePaymentEmbed(eventType, obj);

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log(`[Stripe] Report sent to Discord: ${eventType}`);
      res.status(200).json({ received: true });
    })
    .catch((err) => {
      console.error('[Stripe] Discord webhook failed:', err.message);
      res.status(200).json({ received: true, error: err.message });
    });
});

// FanBasis — raw body for HMAC verification (x-webhook-signature). Register webhook URL in FanBasis dashboard.
app.post('/fanbasis/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8');
  const sig = req.headers['x-webhook-signature'];
  const secret = (process.env.FANBASIS_WEBHOOK_SECRET || '').trim();

  if (secret) {
    if (!validateFanBasisSignature(rawBuf, sig, secret)) {
      console.error('[FanBasis] Invalid webhook signature (check FANBASIS_WEBHOOK_SECRET)');
      res.status(401).send('Invalid signature');
      return;
    }
  } else {
    console.warn('[FanBasis] FANBASIS_WEBHOOK_SECRET not set — signature not verified');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBuf.toString('utf8'));
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  let eventType = parsed.type ?? parsed.event_type ?? parsed.event ?? '';
  const data = parsed.data != null ? parsed.data : parsed;

  if (!eventType && data.status === 'paid') eventType = 'payment.succeeded';
  if (!eventType && data.status === 'failed') eventType = 'payment.failed';

  if (!eventType) {
    console.error('[FanBasis] Missing event type:', JSON.stringify(parsed).slice(0, 500));
    res.status(200).json({ received: true, error: 'Missing event type' });
    return;
  }

  if (eventType === 'payment.succeeded') {
    appendToRevenueSheet(buildFanBasisRevenueRow(data));
  }

  const fanbasisFailed = FANBASIS_FAILURE_EVENTS.has(eventType);
  const webhookUrl = (
    fanbasisFailed
      ? process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS
      : (process.env.DISCORD_WEBHOOK_FANBASIS || process.env.DISCORD_WEBHOOK_NEW_PAYMENTS)
  ).trim();

  if (!webhookUrl) {
    console.error(
      fanbasisFailed
        ? '[FanBasis] DISCORD_WEBHOOK_FAILED_PAYMENTS not set'
        : '[FanBasis] DISCORD_WEBHOOK_FANBASIS or DISCORD_WEBHOOK_NEW_PAYMENTS not set',
    );
    res.status(200).json({ received: true, error: 'Discord webhook not configured' });
    return;
  }

  const embed = buildFanBasisPaymentEmbed(eventType, data);

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log(`[FanBasis] Report sent to Discord: ${eventType}`);
      res.status(200).json({ received: true });
    })
    .catch((err) => {
      console.error('[FanBasis] Discord webhook failed:', err.message);
      res.status(200).json({ received: true, error: err.message });
    });
});

app.get('/fanbasis/test', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_FANBASIS || process.env.DISCORD_WEBHOOK_NEW_PAYMENTS || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'Set DISCORD_WEBHOOK_FANBASIS or DISCORD_WEBHOOK_NEW_PAYMENTS' });
    return;
  }
  const embed = buildFanBasisPaymentEmbed('payment.succeeded', {
    payment_id: 'txn_test',
    amount: 2900,
    currency: 'USD',
    status: 'paid',
    buyer: { name: 'Test Customer', email: 'test@example.com' },
    item: { name: 'Test Product', type: 'one_time' },
    payment_method: 'card',
  });
  embed.title = `🧪 Test – ${embed.title}`;
  sendEmbed(webhookUrl, embed)
    .then(() => res.json({ success: true, message: 'Test FanBasis embed sent to Discord' }))
    .catch((err) => res.json({ success: false, error: err.message }));
});

app.use(express.json());

/** Append one test row to Revenue tab (debug sharing + REVENUE_SHEET_ID / REVENUE_SHEET_NAME). */
app.get('/revenue/test', async (_req, res) => {
  const sheetId = (process.env.REVENUE_SHEET_ID || '').trim();
  const sheetName = (process.env.REVENUE_SHEET_NAME || '').trim() || 'Revenue';
  if (!sheetId) {
    res.status(400).json({
      success: false,
      error: 'REVENUE_SHEET_ID not set. Add it in Railway with the spreadsheet ID from the sheet URL.',
    });
    return;
  }
  const row = buildRevenueRow({
    dueDate: new Date().toISOString().slice(0, 10),
    clientName: 'Revenue test (bsmbot)',
    email: 'test@example.com',
    offer: 'Manual /revenue/test',
    cashCollected: '1.00',
    contracted: '1.00',
    instalment: '',
    status: 'Test',
    paymentMethod: '—',
    platform: 'Health check',
    commissionPct: '',
    payout: '',
  });
  try {
    await appendRows(sheetId, sheetName, [row]);
    res.json({
      success: true,
      message: `Appended 1 row to tab "${sheetName}". Scroll to the bottom of that tab in Google Sheets.`,
      sheetIdPreview: `${sheetId.slice(0, 12)}…`,
    });
  } catch (err) {
    const detail = err.response?.data;
    res.status(500).json({
      success: false,
      error: err.message,
      google: detail || undefined,
      hint:
        'Share the spreadsheet with your GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor. Tab name must match REVENUE_SHEET_NAME exactly.',
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    forms: FORMS.length,
    revenueSheetConfigured: Boolean((process.env.REVENUE_SHEET_ID || '').trim()),
  });
});

app.post('/typeform/webhook', (req, res) => {
  const rawUrl = process.env.DISCORD_WEBHOOK_NEW_LEAD;
  const webhookUrl = rawUrl ? rawUrl.trim() : '';
  if (!webhookUrl) {
    console.error('[Typeform] DISCORD_WEBHOOK_NEW_LEAD not set');
    res.status(500).json({ error: 'New lead webhook not configured', detail: 'Set DISCORD_WEBHOOK_NEW_LEAD in Railway Variables' });
    return;
  }

  let parsed;
  let lead;
  let embed;
  try {
    parsed = parsePayload(req.body);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid Typeform webhook payload' });
      return;
    }
    lead = buildLeadFromParsed(parsed);
    embed = buildNewLeadEmbed(lead);
  } catch (err) {
    console.error('[Typeform] Parse/format error:', err.message);
    res.status(500).json({ error: 'Error processing payload', detail: err.message });
    return;
  }

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log(`[Typeform] New lead sent to Discord (${lead.qualified ? 'QUALIFIED' : 'Unqualified'})`);
      res.status(200).send();
    })
    .catch((err) => {
      console.error('[Typeform] Discord webhook failed:', err.message);
      res.status(500).json({
        error: 'Failed to send to Discord',
        detail: err.message,
      });
    });
});

app.post('/ghl/webhook', (req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_BOOKED_CALL || '').trim();
  if (!webhookUrl) {
    console.error('[GHL] DISCORD_WEBHOOK_BOOKED_CALL not set');
    res.status(200).json({ success: false, error: 'Call-booked webhook not configured' });
    return;
  }

  const body = req.body || {};
  console.log('[GHL] Received payload keys:', Object.keys(body));
  console.log('[GHL] Payload:', JSON.stringify(body).slice(0, 500));
  console.log('[GHL] Sending to webhook URL ending in:', '...' + webhookUrl.slice(-20));

  let embed;
  if (body.type === 'AppointmentCreate' && body.appointment) {
    embed = buildGhlBookedCallEmbed(body.appointment);
  } else {
    embed = buildGhlWorkflowEmbed(body);
  }

  console.log('[GHL] Embed title:', embed.title, '| fields:', embed.fields.length);

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log('[GHL] Call booked sent to Discord successfully');
      res.status(200).json({ success: true });
    })
    .catch((err) => {
      console.error('[GHL] Discord webhook failed:', err.message);
      res.status(200).json({ success: false, error: err.message });
    });
});

const OPPORTUNITY_WEBHOOKS = {
  no_show: 'DISCORD_WEBHOOK_NO_SHOW',
  follow_up: 'DISCORD_WEBHOOK_FOLLOW_UP',
  closed_deal: 'DISCORD_WEBHOOK_CLOSED_DEAL',
};

function normalizePipelineStage(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  // Ignore UUIDs / long IDs so we don't mis-route on random fields
  if (/^[0-9a-f-]{36}$/i.test(s) || /^[a-z0-9]{20,}$/i.test(s)) return null;
  const v = s.toLowerCase().replace(/[\s-]/g, '_');
  if (v.includes('no_show') || v.includes('noshow') || v === 'no_show') return 'no_show';
  if (v.includes('follow') || v.includes('followup') || v === 'follow_up') return 'follow_up';
  if (v.includes('closed') || v.includes('deal') || v === 'closed_deal') return 'closed_deal';
  return null;
}

function getOpportunityStage(body) {
  const b = body || {};
  const opportunity = b.opportunity || {};
  const custom = b.customData || b.custom_data || {};
  return (
    b.stage ??
    b.stageName ??
    b.pipelineStage ??
    b.pipelineStageName ??
    b.pipeline_stage_name ??
    b.toStage ??
    b.to_stage ??
    b.newStage ??
    b.new_stage ??
    b.status ??
    b.pipeline_stage ??
    opportunity.stageName ??
    opportunity.stage ??
    opportunity.pipelineStageName ??
    opportunity.pipeline_stage_name ??
    opportunity.status ??
    opportunity.title ??
    custom.stage ??
    custom.stageName ??
    custom.pipelineStage ??
    b['Pipeline Stage'] ??
    b['To Stage'] ??
    ''
  );
}

/** If known keys miss, scan shallow string fields (GHL custom data often lands here). */
function inferStageKeyFromBody(body) {
  const rawPrimary = getOpportunityStage(body);
  const primaryKey =
    rawPrimary != null && rawPrimary !== '' ? normalizePipelineStage(String(rawPrimary)) : null;
  if (primaryKey) return { stageKey: primaryKey, stageRaw: rawPrimary };

  const tryVal = (val) => {
    if (val == null || typeof val !== 'string') return null;
    const t = val.trim();
    if (t.length === 0 || t.length > 120) return null;
    return normalizePipelineStage(t);
  };

  const b = body || {};
  for (const val of Object.values(b)) {
    const k = tryVal(typeof val === 'string' ? val : null);
    if (k) return { stageKey: k, stageRaw: val };
  }
  const opp = b.opportunity;
  if (opp && typeof opp === 'object') {
    for (const val of Object.values(opp)) {
      const k = tryVal(typeof val === 'string' ? val : null);
      if (k) return { stageKey: k, stageRaw: val };
    }
  }
  for (const val of Object.values(b.customData || b.custom_data || {})) {
    const k = tryVal(typeof val === 'string' ? val : null);
    if (k) return { stageKey: k, stageRaw: val };
  }
  return { stageKey: null, stageRaw: getOpportunityStage(body) };
}

app.post('/ghl/opportunity', (req, res) => {
  const body = req.body || {};
  const { stageKey, stageRaw } = inferStageKeyFromBody(body);

  if (!stageKey || !OPPORTUNITY_WEBHOOKS[stageKey]) {
    console.error(
      '[GHL Opportunity] Unknown or missing stage. stageRaw=',
      JSON.stringify(stageRaw),
      '| keys:',
      Object.keys(body).join(', '),
      '| sample:',
      JSON.stringify(body).slice(0, 800),
    );
    res.status(200).json({
      success: false,
      error:
        'Unknown stage. Add Custom Data in GHL: key "stage" with value "No Show", "Follow Up", or "Closed Deal" (or set pipeline stage name to include those words).',
    });
    return;
  }

  const webhookUrl = (process.env[OPPORTUNITY_WEBHOOKS[stageKey]] || '').trim();
  if (!webhookUrl) {
    console.error('[GHL Opportunity]', OPPORTUNITY_WEBHOOKS[stageKey], 'not set');
    res.status(200).json({ success: false, error: `Webhook not configured for ${stageKey}` });
    return;
  }

  const embed = buildGhlOpportunityEmbed(stageKey, body);
  console.log(
    '[GHL Opportunity] Routing',
    stageKey,
    '→ Discord webhook …',
    webhookUrl.slice(-24),
    '| fields:',
    embed.fields?.length,
  );

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log('[GHL Opportunity] Sent to Discord:', stageKey);
      res.status(200).json({ success: true });
    })
    .catch((err) => {
      console.error('[GHL Opportunity] Discord failed:', err.message);
      res.status(200).json({ success: false, error: err.message });
    });
});

app.get('/ghl/test', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_BOOKED_CALL || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'DISCORD_WEBHOOK_BOOKED_CALL not set' });
    return;
  }

  const testEmbed = {
    title: '📅 Test - Call booked (GHL)',
    color: 0x1abc9c,
    description: 'This is a test message to verify the webhook is working.',
    fields: [
      { name: 'Name', value: 'Test Contact', inline: true },
      { name: 'Email', value: 'test@example.com', inline: true },
    ],
    footer: { text: 'BSM Bot · Test' },
    timestamp: new Date().toISOString(),
  };

  sendEmbed(webhookUrl, testEmbed)
    .then(() => {
      res.json({ success: true, message: 'Test message sent to Discord' });
    })
    .catch((err) => {
      res.json({ success: false, error: err.message });
    });
});

/** Send a test embed to all three opportunity channels: no show, follow up, closed deal */
app.get('/ghl/opportunity/test', async (_req, res) => {
  const stages = [
    { key: 'no_show', env: 'DISCORD_WEBHOOK_NO_SHOW' },
    { key: 'follow_up', env: 'DISCORD_WEBHOOK_FOLLOW_UP' },
    { key: 'closed_deal', env: 'DISCORD_WEBHOOK_CLOSED_DEAL' },
  ];

  const testBody = {
    contact: { firstName: 'Test', lastName: 'User', email: 'test@example.com', phone: '555-0000' },
    stage: 'Test',
  };

  const results = {};
  for (const { key, env } of stages) {
    const webhookUrl = (process.env[env] || '').trim();
    if (!webhookUrl) {
      results[key] = { success: false, error: `${env} not set` };
      continue;
    }
    try {
      const embed = buildGhlOpportunityEmbed(key, { ...testBody, stage: key });
      embed.title = `🧪 Test – ${embed.title}`;
      await sendEmbed(webhookUrl, embed);
      results[key] = { success: true };
    } catch (err) {
      results[key] = { success: false, error: err.message };
    }
  }

  const allOk = stages.every((s) => results[s.key]?.success);
  res.status(allOk ? 200 : 207).json({
    message: allOk ? 'Test sent to all opportunity channels' : 'Some channels failed',
    results,
  });
});

// —— WHOP payment/refund/dispute reports to Discord ——
function getWhopEventAndData(body) {
  const b = body || {};
  const event = b.event ?? b.type ?? b.event_type ?? b.name ?? '';
  const data = b.data ?? b.payload ?? b.object ?? b;
  return { event: String(event).trim(), data };
}

app.post('/whop/webhook', (req, res) => {
  const { event, data } = getWhopEventAndData(req.body);
  if (!event) {
    res.status(400).json({ success: false, error: 'Missing event type (event / type / event_type)' });
    return;
  }

  const whopFailed = event === 'payment.failed';
  const webhookUrl = (
    whopFailed ? process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS : process.env.DISCORD_WEBHOOK_WHOP
  ).trim();

  if (!webhookUrl) {
    console.error(
      whopFailed ? '[WHOP] DISCORD_WEBHOOK_FAILED_PAYMENTS not set' : '[WHOP] DISCORD_WEBHOOK_WHOP not set',
    );
    res.status(200).json({
      success: false,
      error: whopFailed
        ? 'Failed-payments webhook not configured (set DISCORD_WEBHOOK_FAILED_PAYMENTS)'
        : 'WHOP report webhook not configured',
    });
    return;
  }

  const embed = buildWhopPaymentEmbed(event, data);
  // Revenue sheet: successful payments only (not Whop payment.failed)
  if (event !== 'payment.failed') {
    appendToRevenueSheet(buildWhopRevenueRow(event, data));
  }

  sendEmbed(webhookUrl, embed)
    .then(() => {
      console.log(`[WHOP] Report sent to Discord: ${event}`);
      res.status(200).json({ success: true });
    })
    .catch((err) => {
      console.error('[WHOP] Discord webhook failed:', err.message);
      res.status(200).json({ success: false, error: err.message });
    });
});

app.get('/whop/test', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_WHOP || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'DISCORD_WEBHOOK_WHOP not set' });
    return;
  }

  const testData = {
    amount: 4900,
    currency: 'USD',
    status: 'payment.succeeded',
    user: { username: 'Test User', email: 'test@example.com' },
    product: { name: 'Test Product', plan_name: 'Monthly' },
    id: 'test_whop_123',
  };
  const embed = buildWhopPaymentEmbed('payment.succeeded', testData);
  embed.title = `🧪 Test – ${embed.title}`;

  sendEmbed(webhookUrl, embed)
    .then(() => {
      res.json({ success: true, message: 'Test WHOP report sent to Discord' });
    })
    .catch((err) => {
      res.json({ success: false, error: err.message });
    });
});

app.get('/whop/test-failed', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'DISCORD_WEBHOOK_FAILED_PAYMENTS not set' });
    return;
  }
  const embed = buildWhopPaymentEmbed('payment.failed', {
    amount: 50000,
    currency: 'USD',
    status: 'open',
    user: { username: 'Test User', email: 'test@example.com' },
    product: { name: 'Test Product' },
    id: 'pay_test_failed',
    failure_reason: 'Test failure',
  });
  embed.title = `🧪 Test – ${embed.title}`;
  sendEmbed(webhookUrl, embed)
    .then(() => res.json({ success: true, message: 'Test failed-payment embed sent to #failed-payments' }))
    .catch((err) => res.json({ success: false, error: err.message }));
});

// —— Stripe: test embed to #new-payments ——
app.get('/stripe/test', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_NEW_PAYMENTS || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'DISCORD_WEBHOOK_NEW_PAYMENTS not set' });
    return;
  }
  const testObj = {
    amount: 4900,
    currency: 'usd',
    status: 'succeeded',
    id: 'pi_test_123',
    receipt_email: 'test@example.com',
    description: 'Test payment',
  };
  const embed = buildStripePaymentEmbed('payment_intent.succeeded', testObj);
  embed.title = `🧪 Test – ${embed.title}`;
  sendEmbed(webhookUrl, embed)
    .then(() => {
      res.json({ success: true, message: 'Test Stripe report sent to #new-payments' });
    })
    .catch((err) => {
      res.json({ success: false, error: err.message });
    });
});

app.get('/stripe/test-failed', (_req, res) => {
  const webhookUrl = (process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS || '').trim();
  if (!webhookUrl) {
    res.json({ error: 'DISCORD_WEBHOOK_FAILED_PAYMENTS not set' });
    return;
  }
  const embed = buildStripePaymentEmbed('payment_intent.payment_failed', {
    amount: 5000,
    currency: 'usd',
    status: 'requires_payment_method',
    id: 'pi_test_failed',
    receipt_email: 'test@example.com',
    last_payment_error: { message: 'Your card was declined.' },
  });
  embed.title = `🧪 Test – ${embed.title}`;
  sendEmbed(webhookUrl, embed)
    .then(() => res.json({ success: true, message: 'Test Stripe failure sent to #failed-payments' }))
    .catch((err) => res.json({ success: false, error: err.message }));
});

async function initState(savedState) {
  console.log('Initialising row counts for each form...');
  const activeForms = FORMS.filter((f) => f.sheetId && f.webhookUrl);

  for (const form of activeForms) {
    if (savedState[form.id]) {
      console.log(`  ${form.name}: resuming from row ${savedState[form.id]}`);
      continue;
    }
    try {
      const count = await getRowCount(form.sheetId);
      state.setLastRow(savedState, form.id, count);
      console.log(`  ${form.name}: ${count} existing rows (will skip these)`);
    } catch (err) {
      console.error(`  ${form.name}: failed to read sheet — ${err.message}`);
    }
  }
}

async function pollForm(form, savedState) {
  const lastRow = state.getLastRow(savedState, form.id);
  const { headers, newRows, totalRows } = await getNewRows(form.sheetId, lastRow);

  if (newRows.length === 0) return 0;

  console.log(`[${form.name}] ${newRows.length} new submission(s)`);

  let sent = 0;
  for (const row of newRows) {
    try {
      const embed = buildSheetEmbed(form, headers, row);
      await sendEmbed(form.webhookUrl, embed);
      sent++;
      // Small delay between messages to respect Discord rate limits
      if (newRows.length > 1) await sleep(1000);
    } catch (err) {
      console.error(`[${form.name}] Failed to send to Discord: ${err.message}`);
    }
  }

  state.setLastRow(savedState, form.id, totalRows);
  return sent;
}

async function pollAll(savedState) {
  const activeForms = FORMS.filter((f) => f.sheetId && f.webhookUrl);

  for (const form of activeForms) {
    try {
      await pollForm(form, savedState);
    } catch (err) {
      console.error(`[${form.name}] Poll error: ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const savedState = state.load();

  await initState(savedState);

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  console.log(`Polling ${FORMS.filter((f) => f.sheetId && f.webhookUrl).length} form(s) every ${POLL_INTERVAL_MS / 1000}s`);

  // Poll loop
  while (true) {
    await pollAll(savedState);
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
