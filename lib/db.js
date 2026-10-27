// Armazenamento em arquivo JSON. Simples de copiar, fazer backup e abrir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.RADAR_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = () => ({
  leads: [],
  searches: [],
  settings: { googleApiKey: '', pagespeedApiKey: '', googleMonthlyLimit: 900, myName: '', whatsappTemplate: '' },
  usage: {}, // { '2026-10': { google: 12 } }
});

let state = EMPTY();
let timer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const base = EMPTY();
    state = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  }
  return state;
}

function saveNow() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (!timer) timer = setTimeout(saveNow, 400);
}

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

function usage(kind) {
  return (state.usage[monthKey()] || {})[kind] || 0;
}
function addUsage(kind, n = 1) {
  const k = monthKey();
  state.usage[k] = state.usage[k] || {};
  state.usage[k][kind] = (state.usage[k][kind] || 0) + n;
  save();
}

module.exports = { load, save, saveNow, get state() { return state; }, id, now, usage, addUsage, DATA_DIR };
