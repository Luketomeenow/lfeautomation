const express = require('express');
const { FORMS, POLL_INTERVAL_MS } = require('./config');
const { getRowCount, getNewRows } = require('./sheets');
const { sendEmbed } = require('./discord');
const { buildEmbed } = require('./formatters');
const { parsePayload, buildLeadFromParsed } = require('./typeform');
const { buildNewLeadEmbed } = require('./typeformFormatter');
const { buildGhlBookedCallEmbed, buildGhlWorkflowEmbed, buildGhlOpportunityEmbed } = require('./ghlFormatter');
const state = require('./state');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), forms: FORMS.length });
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
  const v = (value || '').toLowerCase().replace(/[\s-]/g, '_');
  if (v.includes('no_show') || v.includes('noshow')) return 'no_show';
  if (v.includes('follow') || v.includes('followup')) return 'follow_up';
  if (v.includes('closed') || v.includes('deal')) return 'closed_deal';
  return null;
}

app.post('/ghl/opportunity', (req, res) => {
  const body = req.body || {};
  const stageRaw = body.stage ?? body.stageName ?? body.pipelineStage ?? body.status ?? body.pipeline_stage ?? '';
  const stageKey = normalizePipelineStage(stageRaw);

  if (!stageKey || !OPPORTUNITY_WEBHOOKS[stageKey]) {
    console.error('[GHL Opportunity] Unknown or missing stage:', stageRaw);
    res.status(200).json({ success: false, error: 'Unknown stage. Use: no_show, follow_up, or closed_deal' });
    return;
  }

  const webhookUrl = (process.env[OPPORTUNITY_WEBHOOKS[stageKey]] || '').trim();
  if (!webhookUrl) {
    console.error('[GHL Opportunity]', OPPORTUNITY_WEBHOOKS[stageKey], 'not set');
    res.status(200).json({ success: false, error: `Webhook not configured for ${stageKey}` });
    return;
  }

  const embed = buildGhlOpportunityEmbed(stageKey, body);
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
      const embed = buildEmbed(form, headers, row);
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
