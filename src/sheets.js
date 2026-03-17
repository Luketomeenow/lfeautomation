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
 * Append one or more rows to a sheet. Range is the A1 notation for the sheet (e.g. "Revenue" or "Revenue!A:L").
 * Values should be an array of rows, each row an array of cell values.
 */
async function appendRows(spreadsheetId, rangeSheetOrA1, values) {
  if (!values || values.length === 0) return;
  const range = rangeSheetOrA1.includes('!') ? rangeSheetOrA1 : `${rangeSheetOrA1}!A:ZZ`;
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

module.exports = { getRows, getRowCount, getNewRows, appendRows };
