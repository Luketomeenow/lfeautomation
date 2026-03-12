const FORMS = [
  {
    id: 'setter_eod',
    name: 'Setter EOD',
    sheetId: process.env.SHEET_SETTER_EOD,
    webhookUrl: process.env.DISCORD_WEBHOOK_DAILY_REPORTS,
    color: 0x2ecc71, // green
    emoji: '📋',
  },
  {
    id: 'closer_eod',
    name: 'Closer EOD',
    sheetId: process.env.SHEET_CLOSER_EOD,
    webhookUrl: process.env.DISCORD_WEBHOOK_DAILY_REPORTS,
    color: 0x27ae60, // dark green
    emoji: '📊',
  },
  {
    id: 'post_call',
    name: 'Post Call Form',
    sheetId: process.env.SHEET_POST_CALL,
    webhookUrl: process.env.DISCORD_WEBHOOK_CALL_NOTES,
    color: 0xe67e22, // orange
    emoji: '📞',
  },
  {
    id: 'company_eod',
    name: 'Company-wide EOD',
    sheetId: process.env.SHEET_COMPANY_EOD,
    webhookUrl: process.env.DISCORD_WEBHOOK_DAILY_REPORTS,
    color: 0x3498db, // blue
    emoji: '🏢',
  },
  {
    id: 'sales_eod',
    name: 'Sales / Setter Manager EOD',
    sheetId: process.env.SHEET_SALES_EOD,
    webhookUrl: process.env.DISCORD_WEBHOOK_DAILY_REPORTS,
    color: 0x9b59b6, // purple
    emoji: '💼',
  },
  {
    id: 'ad_reports',
    name: 'Ad Reports',
    sheetId: process.env.SHEET_AD_REPORTS,
    webhookUrl: process.env.DISCORD_WEBHOOK_AD_REPORTS,
    color: 0xe74c3c, // red
    emoji: '📈',
  },
  {
    id: 'booked_call',
    name: 'Booked Call',
    sheetId: process.env.SHEET_BOOKED_CALL,
    webhookUrl: process.env.DISCORD_WEBHOOK_BOOKED_CALL,
    color: 0x1abc9c, // teal
    emoji: '✅',
  },
];

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);

module.exports = { FORMS, POLL_INTERVAL_MS };
