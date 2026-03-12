const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function load() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function save(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to persist state:', err.message);
  }
}

function getLastRow(state, formId) {
  return state[formId] || 0;
}

function setLastRow(state, formId, rowIndex) {
  state[formId] = rowIndex;
  save(state);
}

module.exports = { load, save, getLastRow, setLastRow };
