const { google } = require('googleapis');

let sheetsClient = null;

function getClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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

/**
 * A1 range for a tab name (quotes if spaces, emoji, or special chars).
 */
function sheetRangeA1(sheetName, columnRange = 'A:L') {
  if (sheetName.includes('!')) return sheetName; // already full A1
  const escaped = String(sheetName).replace(/'/g, "''");
  const needsQuote = /[^a-zA-Z0-9_]/.test(sheetName) || /^\d/.test(sheetName);
  const tab = needsQuote ? `'${escaped}'` : escaped;
  return `${tab}!${columnRange}`;
}

/**
 * Append one or more rows to a sheet tab.
 * Values: array of rows, each row an array of cell values.
 */
async function appendRows(spreadsheetId, sheetName, values) {
  if (!values || values.length === 0) return;
  if (!spreadsheetId || !sheetName) {
    throw new Error('appendRows: missing spreadsheetId or sheetName');
  }
  const range = sheetRangeA1(sheetName, 'A:L');
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  return res.data;
}

module.exports = { getRows, getRowCount, getNewRows, appendRows };
