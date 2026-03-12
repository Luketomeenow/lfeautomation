const { google } = require('googleapis');

let sheetsClient = null;

function getClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function getRows(spreadsheetId) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A:ZZ',
  });
  return res.data.values || [];
}

async function getRowCount(spreadsheetId) {
  const rows = await getRows(spreadsheetId);
  return rows.length;
}

async function getNewRows(spreadsheetId, afterIndex) {
  const rows = await getRows(spreadsheetId);
  if (rows.length <= afterIndex) return { headers: rows[0] || [], newRows: [], totalRows: rows.length };

  const headers = rows[0] || [];
  const newRows = rows.slice(afterIndex);
  return { headers, newRows, totalRows: rows.length };
}

module.exports = { getRows, getRowCount, getNewRows };
