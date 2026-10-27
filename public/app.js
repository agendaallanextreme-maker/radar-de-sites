// Interface do Radar de Sites (JS puro).
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const today = () => new Date().toISOString().slice(0, 10);
const col = s => s >= 70 ? 'var(--crit)' : s >= 50 ? 'var(--warn)' : 'var(--ok)';
const ISSUE_TONE = { nosite: 'c', offline: 'c', cert: 'c', slow: 'c', mobile: 'c', ssl: 'c', old: 'w', broken: 'w', seo: 'w' };
const PART_LABEL = { perf: ['Velocidade', 30], tech: ['Tecnologia antiga', 25], mobile: ['Celular', 15], security: ['Segurança (HTTPS)', 15], seo: ['SEO básico', 15] };
const SOURCE = { google: 'Google Maps', osm: 'OpenStreetMap', csv: 'Lista CSV' };

let S = { leads: [], searches: [], stages: [], issueLabels: {}, settings: {}, usage: {}, queue: 0 };
let ui = { view: 'ops', filt: 'all', sel: null, q: '', search: '', stage: '', min: 0, sort: 'score', confirmDel: false };
try { Object.assign(ui, JSON.parse(localStorage.getItem('radar-ui') || '{}'), { confirmDel: false }); } catch {}
const persist = () => { try { localStorage.setItem('radar-ui', JSON.stringify({ view: ui.view, filt: ui.filt, sort: ui.sort, search: ui.search, stage: ui.stage, min: ui.min })); } catch {} };

async function api(method, url, data) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Erro ${res.status}`);
  return j;
}
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }

const ring = (s, sz = 48) => { const r = sz / 2 - 3, c = 2 * Math.PI * r; return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="4"/><circle cx="${sz / 2}" cy="${sz / 2}" r="${r}" fill="none" stroke="${col(s)}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c * s / 100} ${c}" transform="rotate(-90 ${sz / 2} ${sz / 2})"/></svg>`; };
const scoreBadge = (l, sz = 48) => l.status === 'ok' ? `<div class="score" style="width:${sz}px;height:${sz}px">${ring(l.score, sz)}<span>${l.score}</span></div>` : `<div class="score" style="width:${sz}px;height:${sz}px;color:var(--muted);font-size:11px">${l.status === 'erro' ? 'erro' : '…'}</div>`;
const tags = l => (l.issues || []).map(i => `<span class="tag ${ISSUE_TONE[i] || 'n'}">${esc(S.issueLabels[i] || i)}</span>`).join('');
const siteYear = l => l.analysis?.copyrightYear || (l.analysis?.registeredAt ? Number(l.analysis.registeredAt.slice(0, 4)) : null);

// ---------- Oportunidades ----------
function filtered() {
  const q = ui.q.trim().toLowerCase();
  let rows = S.leads.filter(l =>
    (ui.filt === 'all' || (l.issues || []).includes(ui.filt)) &&
    (!ui.search || l.searchIds?.includes(ui.search)) &&
    (!ui.stage || l.stage === ui.stage) &&
    (!ui.min || (l.score || 0) >= ui.min) &&
    (!q || (l.name + ' ' + (l.website || '')).toLowerCase().includes(q)));
  const by = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    reviews: (a, b) => (b.reviews || 0) - (a.reviews || 0),
    old: (a, b) => (siteYear(a) || 9999) - (siteYear(b) || 9999),
    perf: (a, b) => (a.analysis?.psi?.performance ?? 101) - (b.analysis?.psi?.performance ?? 101),
    recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
  }[ui.sort];
  return rows.sort(by);
}

function renderFilters() {
  const counts = {};
  for (const l of S.leads) for (const i of l.issues || []) counts[i] = (counts[i] || 0) + 1;
  const keys = ['nosite', 'slow', 'old', 'mobile', 'ssl', 'broken', 'offline', 'cert', 'seo'].filter(k => counts[k]);
  $('#filters').innerHTML = `<button class="chip" aria-pressed="${ui.filt === 'all'}" data-f="all">Todos <span class="count">${S.leads.length}</span></button>` +
    keys.map(k => `<button class="chip" aria-pressed="${ui.filt === k}" data-f="${k}">${esc(S.issueLabels[k])} <span class="count">${counts[k]}</span></button>`).join('');
  const sOpts = `<option value="">Todas as buscas</option>` + S.searches.map(s => `<option value="${s.id}" ${ui.search === s.id ? 'selected' : ''}>${esc(s.niche)}${s.city ? ' · ' + esc(s.city) : ''}</option>`).join('');
  $('#f-search').innerHTML = sOpts;
  $('#f-stage').innerHTML = `<option value="">Todas as etapas</option>` + S.stages.map(s => `<option ${ui.stage === s ? 'selected' : ''}>${s}</option>`).join('');
  $('#f-min').value = ui.min; $('#sort').value = ui.sort;
}

function renderKpis() {
  const ok = S.leads.filter(l => l.status === 'ok');
  const hot = ok.filter(l => l.score >= 70).length;
  const nosite = ok.filter(l => l.issues?.includes('nosite')).length;
  const inFunnel = S.leads.filter(l => !['Novo', 'Perdido'].includes(l.stage));
  const due = S.leads.filter(l => l.followUp && l.followUp <= today() && !['Fechado', 'Perdido'].includes(l.stage)).length;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="l">Negócios analisados</div><div class="v">${ok.length}</div><div class="d">${S.queue ? S.queue + ' na fila de análise' : 'de ' + S.leads.length + ' encontrados'}</div></div>
    <div class="kpi"><div class="l">Alta prioridade (score ≥ 70)</div><div class="v" style="color:var(--crit)">${hot}</div><div class="d">${ok.length ? Math.round(hot / ok.length * 100) : 0}% dos analisados</div></div>
    <div class="kpi"><div class="l">Sem site nenhum</div><div class="v">${nosite}</div><div class="d">oportunidade de site novo</div></div>
    <div class="kpi"><div class="l">No funil</div><div class="v">${inFunnel.length}</div><div class="d">${due ? `<b style="color:var(--crit)">${due} retorno(s) para hoje</b>` : brl(inFunnel.reduce((s, l) => s + (l.value || 0), 0)) + ' em negociação'}</div></div>`;
}

function renderList() {
  const rows = filtered();
  $('#c-ops').textContent = S.leads.length;
  if (!S.leads.length) {
    $('#list').innerHTML = `<div class="empty"><b>Nenhuma oportunidade ainda</b>Faça a primeira busca por segmento e cidade.<button class="btn" data-go="buscas">Fazer uma busca</button></div>`;
    $('#detail').hidden = true; return;
  }
  $('#detail').hidden = false;
  if (!rows.find(r => r.id === ui.sel)) ui.sel = rows[0]?.id || null;
  $('#list').innerHTML = rows.length ? rows.slice(0, 400).map(l => `
    <button class="row" role="option" aria-selected="${l.id === ui.sel}" data-id="${l.id}">
      ${scoreBadge(l)}
      <div style="min-width:0"><div class="name">${esc(l.name)}</div>
        <div class="meta">${l.analysis?.domain ? `<span class="dom">${esc(l.analysis.domain)}</span>` : l.website ? `<span class="dom">${esc(l.website)}</span>` : ''}${l.city ? `<span>${esc(l.city)}</span>` : ''}${l.rating ? `<span>★ ${String(l.rating).replace('.', ',')} (${l.reviews})</span>` : ''}${siteYear(l) ? `<span>site de ${siteYear(l)}</span>` : ''}</div>
        <div class="tags">${l.status === 'ok' ? tags(l) : `<span class="st-pend">${l.status === 'erro' ? 'Falha na análise' : 'Analisando…'}</span>`}${(l.analysis?.tech || []).slice(0, 2).map(t => `<span class="tag n">${esc(t)}</span>`).join('')}</div>
      </div>
      <span class="stage">${esc(l.stage)}</span>
    </button>`).join('') + (rows.length > 400 ? `<p class="hint" style="padding:10px 14px">Mostrando 400 de ${rows.length}. Use os filtros.</p>` : '')
    : `<div class="empty">Nenhum negócio com esses filtros.</div>`;
  renderDetail();
}

function fact(k, v, cls = '') { return `<div class="fact"><div class="k">${k}</div><div class="val ${cls}">${v}</div></div>`; }

function renderDetail() {
  const l = S.leads.find(x => x.id === ui.sel);
  const el = $('#detail');
  if (!l) { el.innerHTML = '<p class="hint">Selecione um negócio.</p>'; return; }
  const a = l.analysis || {};
  const q = v => v == null ? '' : v < 50 ? 'bad' : v < 90 ? 'mid' : 'good';
  const siteHref = a.finalUrl || a.url || (l.website ? (/^https?:/.test(l.website) ? l.website : 'http://' + l.website) : '');
  const waHref = l.waNumber ? `https://wa.me/${l.waNumber}?text=${encodeURIComponent(l.waText)}` : '';
  const facts = l.status !== 'ok' || !l.website ? '' : `<div class="facts">
    ${fact('Velocidade no celular', a.psi ? a.psi.performance + '/100' : 'sem medição', q(a.psi?.performance))}
    ${fact('Conteúdo aparece em', a.psi?.lcpMs ? (a.psi.lcpMs / 1000).toFixed(1).replace('.', ',') + ' s' : a.loadMs ? (a.loadMs / 1000).toFixed(1).replace('.', ',') + ' s (HTML)' : '—', a.psi?.lcpMs > 4000 ? 'bad' : a.psi?.lcpMs > 2500 ? 'mid' : '')}
    ${fact('Domínio registrado', a.registeredAt ? a.registeredAt.slice(0, 4) + ' · ' + (new Date().getFullYear() - a.registeredAt.slice(0, 4)) + ' anos' : '—')}
    ${fact('Ano no rodapé', a.copyrightYear || '—', a.copyrightYear && new Date().getFullYear() - a.copyrightYear >= 4 ? 'bad' : '')}
    ${fact('HTTPS', a.offline ? '—' : a.https ? (a.httpRedirectsToHttps === false ? 'Sim, sem redirecionar' : 'Sim') : 'Não', a.https ? 'good' : 'bad')}
    ${fact('Versão para celular', a.offline ? '—' : a.hasViewport ? 'Sim' : 'Não', a.hasViewport ? 'good' : 'bad')}
    ${fact('Links quebrados', a.brokenLinks ? a.brokenLinks.length : '—', a.brokenLinks?.length ? 'bad' : 'good')}
    ${fact('Plataforma', esc([...(a.tech || []), a.jquery ? 'jQuery ' + a.jquery : ''].filter(Boolean).join(', ') || '—'))}
  </div>${a.errors?.length ? `<p class="hint">Não medido: ${esc(a.errors.join('; '))}</p>` : ''}`;
  const bars = l.parts ? `<div><div class="sec-t">Por que é oportunidade</div><div class="bars">${Object.entries(PART_LABEL).map(([k, [lab, w]]) => `
    <div class="bar"><span>${lab} <span style="color:var(--muted)">${w}%</span></span><div class="track"><div class="fill" style="width:${l.parts[k]}%;background:${col(l.parts[k])}"></div></div><span class="n">${l.parts[k]}</span></div>`).join('')}</div></div>` : '';
  el.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center">${scoreBadge(l, 60)}
      <div style="min-width:0"><h2>${esc(l.name)}</h2><div class="dom">${esc(a.domain || l.website || 'sem site')}</div></div></div>
    ${l.status === 'ok' ? `<div class="tags">${tags(l)}</div>` : l.status === 'erro' ? `<p class="errline">Falha: ${esc(l.error)}</p>` : '<p class="hint">Análise em andamento…</p>'}
    ${bars}${facts}
    ${l.pitch ? `<div class="pitch"><div class="who">Argumento de venda</div><span id="pitch">${esc(l.pitch)}</span></div>` : ''}
    <div><div class="sec-t">Contato</div><div class="contact">
      ${l.phone ? `<div>Telefone: <span>${esc(l.phone)}</span></div>` : '<div class="hint">Sem telefone na fonte.</div>'}
      ${l.instagram ? `<div>Instagram: <span>${esc(l.instagram)}</span></div>` : ''}
      ${l.address ? `<div class="hint">${esc(l.address)}</div>` : ''}
    </div></div>
    <div class="links">${siteHref ? `<a class="lk" href="${esc(siteHref)}" target="_blank" rel="noopener">Abrir site</a>` : ''}${l.mapsUrl ? `<a class="lk" href="${esc(l.mapsUrl)}" target="_blank" rel="noopener">Ver no mapa</a>` : ''}${l.socialUrl ? `<a class="lk" href="${esc(/^https?:/.test(l.socialUrl) ? l.socialUrl : 'https://' + l.socialUrl)}" target="_blank" rel="noopener">Rede social</a>` : ''}${a.url && !a.offline ? `<a class="lk" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(a.finalUrl || a.url)}" target="_blank" rel="noopener">Teste do Google</a>` : ''}</div>
    <div class="actions">
      ${waHref ? `<a class="btn wa" id="wa" href="${waHref}" target="_blank" rel="noopener" style="text-decoration:none">Chamar no WhatsApp</a>` : ''}
      <button class="btn ghost sm" id="copy">Copiar mensagem</button>
    </div>
    <div class="grid2">
      <div class="field"><label for="d-stage">Etapa do funil</label><select id="d-stage">${S.stages.map(s => `<option ${s === l.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="d-value">Valor da proposta (R$)</label><input id="d-value" type="number" min="0" step="100" value="${l.value ?? ''}"></div>
      <div class="field"><label for="d-follow">Próximo retorno</label><input id="d-follow" type="date" value="${l.followUp || ''}"></div>
      <div class="field"><label for="d-phone">Telefone</label><input id="d-phone" value="${esc(l.phone || '')}"></div>
    </div>
    <div><div class="sec-t">Histórico</div>
      <div class="addnote"><input id="d-note" placeholder="Anotar: liguei, pediu proposta…"><button class="btn sm" id="d-addnote">Anotar</button></div>
      <div class="notes" style="margin-top:8px">${[...l.notes].reverse().map(n => `<div class="note ${n.auto ? 'auto' : ''}"><time>${fmtDate(n.at)}</time>${esc(n.text)}</div>`).join('') || '<span class="hint">Nada anotado.</span>'}</div>
    </div>
    <div class="actions">
      <button class="btn ghost sm" id="d-re">Analisar de novo</button>
      ${ui.confirmDel ? `<button class="btn danger sm" id="d-del2">Confirmar exclusão</button><button class="btn ghost sm" id="d-cancel">Cancelar</button>` : `<button class="btn ghost sm" id="d-del">Excluir</button>`}
    </div>`;

  const patch = async data => { try { Object.assign(l, await api('PATCH', `/api/leads/${l.id}`, data)); renderAll(); } catch (e) { toast(e.message); } };
  $('#wa')?.addEventListener('click', () => { if (l.stage === 'Novo') { patch({ stage: 'Contatado', note: 'Mensagem enviada pelo WhatsApp' }); toast('Movido para Contatado'); } });
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(l.waText); toast('Mensagem copiada'); } catch { toast(l.waText); } };
  $('#d-stage').onchange = e => patch({ stage: e.target.value });
  $('#d-value').onchange = e => patch({ value: e.target.value });
  $('#d-follow').onchange = e => patch({ followUp: e.target.value });
  $('#d-phone').onchange = e => patch({ phone: e.target.value });
  const addNote = () => { const v = $('#d-note').value.trim(); if (v) patch({ note: v }); };
  $('#d-addnote').onclick = addNote;
  $('#d-note').onkeydown = e => { if (e.key === 'Enter') addNote(); };
  $('#d-re').onclick = async () => { await api('POST', `/api/leads/${l.id}/reanalyze`); l.status = 'pendente'; renderAll(); load(); };
  if ($('#d-del')) $('#d-del').onclick = () => { ui.confirmDel = true; renderDetail(); };
  if ($('#d-cancel')) $('#d-cancel').onclick = () => { ui.confirmDel = false; renderDetail(); };
  if ($('#d-del2')) $('#d-del2').onclick = async () => { await api('DELETE', `/api/leads/${l.id}`); ui.confirmDel = false; S.leads = S.leads.filter(x => x !== l); renderAll(); toast('Excluído'); };
}

// ---------- Funil ----------
function renderBoard() {
  const active = S.leads.filter(l => l.stage !== 'Novo');
  $('#c-funil').textContent = active.length;
  const won = S.leads.filter(l => l.stage === 'Fechado');
  const open = S.leads.filter(l => ['Contatado', 'Respondeu', 'Proposta'].includes(l.stage));
  const contacted = S.leads.filter(l => l.stage !== 'Novo').length;
  $('#funil-kpis').innerHTML = `
    <div class="kpi"><div class="l">Contatados</div><div class="v">${contacted}</div><div class="d">saíram de "Novo"</div></div>
    <div class="kpi"><div class="l">Em negociação</div><div class="v">${open.length}</div><div class="d">${brl(open.reduce((s, l) => s + (l.value || 0), 0))}</div></div>
    <div class="kpi"><div class="l">Fechados</div><div class="v" style="color:var(--ok)">${won.length}</div><div class="d">${brl(won.reduce((s, l) => s + (l.value || 0), 0))}</div></div>
    <div class="kpi"><div class="l">Taxa de fechamento</div><div class="v">${contacted ? Math.round(won.length / contacted * 100) : 0}%</div><div class="d">fechados ÷ contatados</div></div>`;
  const novo = S.leads.filter(l => l.stage === 'Novo' && l.status === 'ok').sort((a, b) => b.score - a.score);
  $('#board').innerHTML = S.stages.map(st => {
    let items = st === 'Novo' ? novo.slice(0, 30) : S.leads.filter(l => l.stage === st);
    const total = items.reduce((s, l) => s + (l.value || 0), 0);
    return `<div class="col" data-stage="${st}"><h3>${st}<small>${st === 'Novo' ? novo.length : items.length}${total ? ' · ' + brl(total) : ''}</small></h3>
      ${items.map(l => `<div class="card" draggable="true" data-id="${l.id}">
        <div class="top"><span>${esc(l.name)}</span><span class="s" style="color:${col(l.score)}">${l.score}</span></div>
        <div class="v">${esc(l.analysis?.domain || (l.website ? l.website : 'sem site'))}</div>
        ${l.value ? `<div class="v">${brl(l.value)}</div>` : ''}
        ${l.followUp ? `<div class="due ${l.followUp <= today() && !['Fechado', 'Perdido'].includes(l.stage) ? 'late' : ''}">Retorno ${l.followUp.split('-').reverse().join('/')}</div>` : ''}
      </div>`).join('')}
      ${st === 'Novo' && novo.length > 30 ? `<p class="hint">Mostrando os 30 de maior score.</p>` : ''}</div>`;
  }).join('');
}

// ---------- Buscas ----------
const SEARCH_ST = { 'na fila': ['sch', 'Na fila'], buscando: ['run', 'Buscando negócios'], analisando: ['run', 'Analisando sites'], concluida: ['done', 'Concluída'], erro: ['err', 'Erro'] };
function renderSearches() {
  $('#c-buscas').textContent = S.searches.length;
  $('#searches').innerHTML = S.searches.length ? S.searches.map(s => {
    const [cls, lab] = SEARCH_ST[s.status] || ['sch', s.status];
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    return `<tr><td>${esc(s.niche)}</td><td>${esc(s.city)}</td><td>${SOURCE[s.source] || s.source}</td>
      <td><span class="st ${cls}">${lab}</span>${s.error ? `<div class="errline">${esc(s.error)}</div>` : ''}</td>
      <td>${s.total ? `<div class="progress" title="${s.done}/${s.total}"><div style="width:${pct}%"></div></div>` : ''}</td>
      <td class="num">${s.total ?? 0}</td><td class="num">${s.hot ?? 0}</td><td>${fmtDate(s.createdAt)}</td>
      <td><button class="x" data-del-search="${s.id}" title="Remover da lista (os negócios continuam)">×</button></td></tr>`;
  }).join('') : `<tr><td colspan="9" class="hint" style="padding:18px">Nenhuma busca ainda.</td></tr>`;
}
function srcHint() {
  const v = $('#n-source').value;
  $('#csv-field').hidden = v !== 'csv';
  $('#n-niche').closest('.field').style.opacity = v === 'csv' ? .4 : 1;
  $('#n-city').closest('.field').style.opacity = v === 'csv' ? .4 : 1;
  $('#src-hint').innerHTML = v === 'osm' ? 'Grátis e sem cadastro. Encontra menos negócios que o Google, principalmente em cidades menores.'
    : v === 'google' ? (S.settings.googleApiKey ? `Até 60 negócios por busca, gastando até 3 consultas. Usadas neste mês: ${S.usage.google || 0} de ${S.settings.googleMonthlyLimit}.` : 'Precisa da chave do Google. Configure em <a href="#" data-go="config">Configurações</a>.')
    : 'Primeira linha com os nomes das colunas: nome, site, telefone. Separador vírgula ou ponto e vírgula.';
}

// ---------- Config ----------
function renderConfig() {
  const st = S.settings;
  if (document.activeElement?.closest('#f-config')) return;
  $('#s-google').value = st.googleApiKey || ''; $('#s-psi').value = st.pagespeedApiKey || '';
  $('#s-limit').value = st.googleMonthlyLimit; $('#s-usage').value = `${S.usage.google || 0} consultas`;
  $('#s-name').value = st.myName || ''; $('#s-tpl').value = st.whatsappTemplate || '';
}

// ---------- geral ----------
function renderAll() {
  $('#queue').textContent = S.queue ? `Analisando ${S.queue} site(s)…` : '';
  renderFilters(); renderKpis(); renderList(); renderBoard(); renderSearches(); renderConfig(); srcHint();
}
function show(view) {
  ui.view = view; persist();
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.view === view));
  ['ops', 'funil', 'buscas', 'config'].forEach(v => { $('#v-' + v).hidden = v !== view; });
}

let pollT;
async function load() {
  clearTimeout(pollT);
  try {
    S = await api('GET', '/api/state');
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement.closest('#detail');
    if (!typing) renderAll(); else { renderFilters(); renderKpis(); renderSearches(); }
  } catch (e) { toast('Sem conexão com o servidor. Ele está rodando?'); }
  const busy = S.queue || S.searches.some(s => ['na fila', 'buscando', 'analisando'].includes(s.status));
  pollT = setTimeout(load, busy ? 2500 : 15000);
}

document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); show(go.dataset.go); return; }
  const nav = e.target.closest('.nav button'); if (nav) { show(nav.dataset.view); return; }
  const row = e.target.closest('.row'); if (row) { ui.sel = row.dataset.id; ui.confirmDel = false; renderList(); if (innerWidth < 1100) $('#detail').scrollIntoView({ behavior: 'smooth' }); return; }
  const chip = e.target.closest('#filters .chip'); if (chip) { ui.filt = chip.dataset.f; persist(); renderFilters(); renderList(); return; }
  const card = e.target.closest('.card'); if (card) { ui.sel = card.dataset.id; show('ops'); renderList(); return; }
  const ds = e.target.closest('[data-del-search]'); if (ds) { api('DELETE', '/api/searches/' + ds.dataset.delSearch).then(load); }
});
$('#q').oninput = e => { ui.q = e.target.value; renderList(); };
$('#f-search').onchange = e => { ui.search = e.target.value; persist(); renderList(); };
$('#f-stage').onchange = e => { ui.stage = e.target.value; persist(); renderList(); };
$('#f-min').onchange = e => { ui.min = Number(e.target.value); persist(); renderList(); };
$('#sort').onchange = e => { ui.sort = e.target.value; persist(); renderList(); };
$('#n-source').onchange = srcHint;

$('#f-new').onsubmit = async e => {
  e.preventDefault();
  const source = $('#n-source').value;
  const data = { niche: $('#n-niche').value, city: $('#n-city').value, source };
  if (source === 'csv') {
    const f = $('#n-csv').files[0];
    if (!f) return toast('Escolha o arquivo CSV.');
    data.csvText = await f.text();
    data.niche = f.name.replace(/\.\w+$/, '');
  }
  $('#n-go').disabled = true;
  try { await api('POST', '/api/searches', data); toast('Busca iniciada. Os resultados aparecem conforme cada site é analisado.'); load(); }
  catch (err) { toast(err.message); }
  finally { $('#n-go').disabled = false; }
};
$('#f-manual').onsubmit = async e => {
  e.preventDefault();
  try { await api('POST', '/api/leads', { website: $('#m-site').value, name: $('#m-name').value }); $('#m-site').value = ''; $('#m-name').value = ''; toast('Site adicionado. Veja em Oportunidades.'); load(); }
  catch (err) { toast(err.message); }
};
$('#f-config').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('PUT', '/api/settings', { googleApiKey: $('#s-google').value, pagespeedApiKey: $('#s-psi').value, googleMonthlyLimit: $('#s-limit').value, myName: $('#s-name').value, whatsappTemplate: $('#s-tpl').value });
    document.activeElement.blur(); toast('Configurações salvas'); load();
  } catch (err) { toast(err.message); }
};

// arrastar e soltar no funil
let dragId = null;
$('#board').addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (c) { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
$('#board').addEventListener('dragover', e => { const c = e.target.closest('.col'); if (c && dragId) { e.preventDefault(); document.querySelectorAll('.col').forEach(x => x.classList.toggle('drop', x === c)); } });
$('#board').addEventListener('dragleave', e => { if (!e.relatedTarget?.closest?.('.col')) document.querySelectorAll('.col').forEach(x => x.classList.remove('drop')); });
$('#board').addEventListener('drop', async e => {
  e.preventDefault();
  document.querySelectorAll('.col').forEach(x => x.classList.remove('drop'));
  const c = e.target.closest('.col'); const l = S.leads.find(x => x.id === dragId); dragId = null;
  if (!c || !l || c.dataset.stage === l.stage) return;
  try { Object.assign(l, await api('PATCH', `/api/leads/${l.id}`, { stage: c.dataset.stage })); renderAll(); toast(`${l.name} → ${l.stage}`); } catch (err) { toast(err.message); }
});

show(ui.view);
load();
