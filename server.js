// Radar de Sites: servidor local, sem dependências externas (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const discover = require('./lib/discover');
const { analyze, normalizeUrl, registrableDomain } = require('./lib/analyze');
const { score, pitch, whatsappMessage, whatsappNumber, ISSUE_LABEL } = require('./lib/score');

const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || '127.0.0.1';
const STAGES = ['Novo', 'Contatado', 'Respondeu', 'Proposta', 'Fechado', 'Perdido'];
const CONCURRENCY = Number(process.env.RADAR_CONCURRENCY || 3);

db.load();
const S = () => db.state;

// ---------- fila de análise ----------
let running = 0;
function pump() {
  while (running < CONCURRENCY) {
    const lead = S().leads.find(l => l.status === 'pendente');
    if (!lead) return;
    running++;
    lead.status = 'analisando';
    runAnalysis(lead).finally(() => { running--; db.save(); pump(); });
  }
}

async function runAnalysis(lead) {
  try {
    if (lead.website) {
      lead.analysis = await analyze(lead.website, { pagespeedKey: S().settings.pagespeedApiKey || S().settings.googleApiKey });
      if (lead.analysis.instagram && !lead.instagram) lead.instagram = '@' + lead.analysis.instagram;
    }
    refresh(lead);
    lead.status = 'ok';
  } catch (e) {
    lead.status = 'erro';
    lead.error = String(e.message || e);
  }
  lead.updatedAt = db.now();
  for (const sid of lead.searchIds || []) updateSearchProgress(sid);
}

function refresh(lead) {
  const r = score(lead);
  lead.score = r.score; lead.issues = r.issues; lead.parts = r.parts;
  lead.pitch = pitch(lead);
}

function updateSearchProgress(searchId) {
  const s = S().searches.find(x => x.id === searchId);
  if (!s) return;
  const ls = S().leads.filter(l => l.searchIds?.includes(searchId));
  s.total = ls.length;
  s.done = ls.filter(l => l.status === 'ok' || l.status === 'erro').length;
  s.hot = ls.filter(l => l.score >= 70).length;
  if (s.status === 'analisando' && s.done >= s.total) { s.status = 'concluida'; s.finishedAt = db.now(); }
}

function keyFor(c) {
  const u = c.website && normalizeUrl(c.website);
  if (u) return 'd:' + registrableDomain(u.hostname);
  const phone = (c.phone || '').replace(/\D/g, '');
  return 'n:' + c.name.toLowerCase().trim() + (phone ? ':' + phone.slice(-8) : '');
}

// Domínios que não são o site do negócio (redes sociais, agregadores)
const NOT_A_SITE = /(^|\.)(facebook|instagram|linktr|linktree|wa\.me|whatsapp|youtube|tiktok|doctoralia|ifood|booking|tripadvisor|google|goo\.gl|bit\.ly|sites\.google)\./i;

async function runSearch(search) {
  try {
    search.status = 'buscando';
    let found;
    if (search.source === 'google') found = await discover.google(search);
    else if (search.source === 'osm') found = await discover.osm(search);
    else found = discover.csv(search);
    delete search.csvText;
    let added = 0;
    const byKey = new Map(S().leads.map(l => [l.key, l]));
    for (const c of found) {
      let social = '';
      if (c.website) {
        const u = normalizeUrl(c.website);
        if (!u || NOT_A_SITE.test(u.hostname + '.')) { social = c.website; c.website = ''; }
      }
      const key = keyFor(c);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.searchIds.includes(search.id)) existing.searchIds.push(search.id);
        continue;
      }
      const lead = {
        id: db.id(), key, ...c, socialUrl: social, niche: search.niche, city: search.city,
        searchIds: [search.id], source: search.source, stage: 'Novo', value: null, notes: [],
        followUp: null, status: 'pendente', createdAt: db.now(), updatedAt: db.now(),
      };
      S().leads.push(lead); byKey.set(key, lead); added++;
    }
    search.found = found.length; search.added = added;
    search.status = 'analisando';
    updateSearchProgress(search.id);
    db.save();
    pump();
  } catch (e) {
    search.status = 'erro'; search.error = String(e.message || e);
    db.save();
  }
}

// ---------- HTTP ----------
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function body(req) {
  let raw = '';
  for await (const ch of req) { raw += ch; if (raw.length > 20e6) throw new Error('Arquivo grande demais'); }
  return raw ? JSON.parse(raw) : {};
}
const publicLead = l => ({ ...l, waNumber: whatsappNumber(l.phone), waText: whatsappMessage(l, S().settings) });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const routes = {
  'GET /api/state': () => ({
    leads: S().leads.map(publicLead),
    searches: [...S().searches].reverse(),
    stages: STAGES,
    issueLabels: ISSUE_LABEL,
    settings: { ...S().settings, googleApiKey: S().settings.googleApiKey ? '••••' + S().settings.googleApiKey.slice(-4) : '', pagespeedApiKey: S().settings.pagespeedApiKey ? '••••' + S().settings.pagespeedApiKey.slice(-4) : '' },
    usage: { google: db.usage('google') },
    queue: S().leads.filter(l => l.status === 'pendente' || l.status === 'analisando').length,
  }),

  'POST /api/searches': async (req) => {
    const b = await body(req);
    const source = ['google', 'osm', 'csv'].includes(b.source) ? b.source : 'osm';
    if (source !== 'csv' && (!b.niche?.trim() || !b.city?.trim())) throw Object.assign(new Error('Informe o segmento e a cidade.'), { code: 400 });
    const s = { id: db.id(), niche: (b.niche || 'Lista importada').trim(), city: (b.city || '').trim(), source, status: 'na fila', createdAt: db.now(), total: 0, done: 0, hot: 0, csvText: b.csvText };
    S().searches.push(s);
    db.save();
    runSearch(s);
    return { id: s.id };
  },

  'POST /api/leads': async (req) => {
    const b = await body(req);
    if (!normalizeUrl(b.website)) throw Object.assign(new Error('Endereço de site inválido.'), { code: 400 });
    const s = { id: db.id(), niche: 'Adicionado à mão', city: '', source: 'csv', status: 'na fila', createdAt: db.now(), csvText: `nome,site,telefone\n"${(b.name || b.website).replace(/"/g, '""')}","${b.website}","${(b.phone || '').replace(/"/g, '')}"` };
    S().searches.push(s);
    await runSearch(s);
    return { ok: true };
  },

  'PATCH /api/leads/:id': async (req, lead) => {
    const b = await body(req);
    if (b.stage && STAGES.includes(b.stage) && b.stage !== lead.stage) {
      lead.notes.push({ at: db.now(), text: `Etapa: ${lead.stage} → ${b.stage}`, auto: true });
      lead.stage = b.stage;
    }
    if ('value' in b) lead.value = b.value === '' || b.value == null ? null : Number(b.value);
    if ('followUp' in b) lead.followUp = b.followUp || null;
    if ('phone' in b) lead.phone = String(b.phone);
    if (b.note?.trim()) lead.notes.push({ at: db.now(), text: b.note.trim() });
    lead.updatedAt = db.now();
    db.save();
    return publicLead(lead);
  },

  'POST /api/leads/:id/reanalyze': async (req, lead) => {
    lead.status = 'pendente'; db.save(); pump();
    return { ok: true };
  },

  'DELETE /api/leads/:id': async (req, lead) => {
    S().leads = S().leads.filter(l => l !== lead); db.save();
    return { ok: true };
  },

  'DELETE /api/searches/:id': async (req, _, id) => {
    S().searches = S().searches.filter(s => s.id !== id); db.save();
    return { ok: true };
  },

  'PUT /api/settings': async (req) => {
    const b = await body(req);
    const st = S().settings;
    for (const k of ['googleApiKey', 'pagespeedApiKey']) if (typeof b[k] === 'string' && !b[k].startsWith('••••')) st[k] = b[k].trim();
    if (b.googleMonthlyLimit != null) st.googleMonthlyLimit = Math.max(0, Number(b.googleMonthlyLimit) || 0);
    if (typeof b.myName === 'string') st.myName = b.myName.trim();
    if (typeof b.whatsappTemplate === 'string') st.whatsappTemplate = b.whatsappTemplate;
    db.save();
    return { ok: true };
  },

  'GET /api/export.csv': () => {
    const cols = ['name', 'website', 'phone', 'address', 'niche', 'city', 'score', 'issues', 'stage', 'value', 'rating', 'reviews'];
    const esc = v => `"${String(Array.isArray(v) ? v.map(i => ISSUE_LABEL[i]).join(' | ') : v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(';'), ...S().leads.map(l => cols.map(c => esc(l[c])).join(';'))].join('\n');
    return { __raw: csv, type: 'text/csv; charset=utf-8' };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const parts = url.pathname.split('/');
      let handler = routes[`${req.method} ${url.pathname}`], lead, id;
      if (!handler && parts.length >= 4) {
        id = parts[3];
        const pattern = `${req.method} /api/${parts[2]}/:id${parts[4] ? '/' + parts[4] : ''}`;
        handler = routes[pattern];
        if (handler && parts[2] === 'leads') {
          lead = S().leads.find(l => l.id === id);
          if (!lead) return send(res, 404, { error: 'Oportunidade não encontrada.' });
        }
      }
      if (!handler) return send(res, 404, { error: 'Rota não encontrada.' });
      const out = await handler(req, lead, id);
      if (out?.__raw) return send(res, 200, out.__raw, out.type);
      return send(res, 200, out);
    }
    const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Não encontrado', 'text/plain');
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, e.code === 400 ? 400 : 500, { error: String(e.message || e) });
  }
});

// Retoma análises interrompidas
for (const l of S().leads) if (l.status === 'analisando') l.status = 'pendente';
for (const s of S().searches) if (s.status === 'buscando' || s.status === 'na fila') { s.status = 'erro'; s.error = 'Interrompida ao fechar o programa. Rode de novo.'; }
for (const s of S().searches) if (s.status === 'analisando') updateSearchProgress(s.id);
pump();

process.on('SIGINT', () => { db.saveNow(); process.exit(0); });
process.on('SIGTERM', () => { db.saveNow(); process.exit(0); });

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`\n  Radar de Sites rodando em http://localhost:${PORT}\n  (Ctrl+C para parar)\n`));
}
module.exports = { server, runAnalysis, refresh };
