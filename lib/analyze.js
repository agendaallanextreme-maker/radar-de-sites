// Análise de um site: acesso, HTTPS, celular, tecnologia, rodapé, links, velocidade e idade do domínio.
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const YEAR = () => new Date().getFullYear();

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    return u;
  } catch { return null; }
}

// Domínio registrável: "www.clinica.com.br" -> "clinica.com.br"; "blog.x.com" -> "x.com"
function registrableDomain(host) {
  const p = host.toLowerCase().replace(/^www\./, '').split('.');
  if (p[p.length - 1] === 'br' && p.length >= 3) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

async function get(url, { method = 'GET', timeout = 15000, redirect = 'follow' } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { method, redirect, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(timeout) });
  return { res, ms: Date.now() - t0 };
}

async function fetchPage(u) {
  const host = u.host; // inclui porta, se houver
  const out = { https: false, httpRedirectsToHttps: null, status: null, finalUrl: null, loadMs: null, html: '', error: null };
  // 1) HTTPS
  try {
    const t0 = Date.now();
    const { res } = await get(`https://${host}${u.pathname}`);
    out.https = true; out.status = res.status; out.finalUrl = res.url;
    out.html = (await res.text()).slice(0, 1_500_000);
    out.loadMs = Date.now() - t0; // HTML completo, sem imagens/scripts
  } catch (e) {
    out.error = e.cause?.code || e.name || 'erro';
  }
  // 2) HTTP (vale para quem não tem HTTPS, e para saber se redireciona)
  try {
    const { res, ms } = await get(`http://${host}${u.pathname}`, { redirect: 'manual', timeout: 10000 });
    const loc = res.headers.get('location') || '';
    out.httpRedirectsToHttps = res.status >= 300 && res.status < 400 && /^https:/i.test(loc);
    if (!out.https) {
      const r2 = await get(`http://${host}${u.pathname}`);
      out.status = r2.res.status; out.finalUrl = r2.res.url; out.loadMs = ms + r2.ms;
      out.https = /^https:/i.test(r2.res.url);
      out.html = (await r2.res.text()).slice(0, 1_500_000);
      out.error = null;
    }
  } catch (e) {
    if (!out.https && !out.html) out.error = out.error || e.cause?.code || e.name;
  }
  return out;
}

function parseHtml(html, baseUrl) {
  const h = html || '';
  const low = h.toLowerCase();
  const meta = name => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
    const tag = h.match(re)?.[0] || '';
    return tag.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || '';
  };
  const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();

  // Ano mais recente do rodapé (© 2014, Copyright 2012-2016, &copy; 2019)
  const years = [...h.matchAll(/(?:©|&copy;|&#169;|copyright)\s*(?:<[^>]+>\s*)*(\d{4})(?:\s*[-–—]\s*(\d{4}))?/gi)]
    .flatMap(m => [m[1], m[2]]).filter(Boolean).map(Number).filter(y => y >= 1995 && y <= YEAR() + 1);
  // Rodapé com ano dinâmico (JS) não mostra o ano no HTML: tratamos como "desconhecido".
  const copyrightYear = years.length ? Math.max(...years) : null;

  const tech = [];
  const gen = meta('generator');
  if (gen) tech.push(gen);
  if (/wp-content|wp-includes/.test(low) && !/wordpress/i.test(gen)) tech.push('WordPress');
  if (/wix\.com|wixstatic/.test(low)) tech.push('Wix');
  if (/joomla/.test(low) && !/joomla/i.test(gen)) tech.push('Joomla');
  if (/drupal/.test(low) && !/drupal/i.test(gen)) tech.push('Drupal');
  if (/squarespace/.test(low)) tech.push('Squarespace');
  if (/shopify/.test(low)) tech.push('Shopify');
  if (/__next|_next\/static/.test(low)) tech.push('Next.js');
  if (/\.swf\b|shockwave-flash/.test(low)) tech.push('Flash');
  if (/<frameset/.test(low)) tech.push('Frames');

  let jquery = null;
  const jq = h.match(/jquery[.-]?(\d+\.\d+(?:\.\d+)?)(?:\.min|\.slim)?\.js/i) || h.match(/jquery(?:\.min)?\.js\?ver=(\d+\.\d+(?:\.\d+)?)/i);
  if (jq) jquery = jq[1];

  const wpVer = (gen.match(/wordpress\s*([\d.]+)/i) || [])[1] || null;
  const joomlaVer = (gen.match(/joomla!?\s*-?\s*(?:open source content management\s*-?\s*version\s*)?([\d.]+)/i) || [])[1] || null;

  // Links internos para checar se estão quebrados
  const links = new Set();
  let base;
  try { base = new URL(baseUrl); } catch { base = null; }
  if (base) {
    for (const m of h.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
      const href = m[1].trim();
      if (/^(mailto|tel|javascript|whatsapp|sms):/i.test(href)) continue;
      try {
        const u = new URL(href, base);
        if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
        if (/\.(jpg|jpeg|png|gif|pdf|zip|webp|svg)$/i.test(u.pathname)) continue;
        u.hash = '';
        if (u.href !== base.href) links.add(u.href);
      } catch { /* href inválido */ }
    }
  }

  return {
    title,
    description: meta('description'),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(h),
    hasH1: /<h1[\s>]/i.test(h),
    copyrightYear,
    tech: [...new Set(tech)],
    jquery,
    wpVer,
    joomlaVer,
    tableLayout: (low.match(/<table/g) || []).length >= 6,
    instagram: (h.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i) || [])[1] || null,
    whatsappLink: /wa\.me\/|api\.whatsapp\.com/i.test(h),
    links: [...links].slice(0, 15),
    htmlKb: Math.round(h.length / 1024),
  };
}

async function checkLinks(urls, concurrency = 5) {
  const broken = [];
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        let { res } = await get(url, { method: 'HEAD', timeout: 10000 });
        if (res.status === 405 || res.status === 403) ({ res } = await get(url, { timeout: 10000 }));
        if (res.status >= 400) broken.push({ url, status: res.status });
      } catch (e) {
        broken.push({ url, status: e.cause?.code || 'falhou' });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return broken;
}

async function pagespeed(url, key) {
  const qs = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' });
  if (key) qs.set('key', key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`PageSpeed ${res.status}${j.error?.message ? ': ' + j.error.message.slice(0, 120) : ''}`);
  }
  const j = await res.json();
  const lh = j.lighthouseResult || {};
  const a = lh.audits || {};
  return {
    performance: Math.round((lh.categories?.performance?.score ?? 0) * 100),
    lcpMs: a['largest-contentful-paint']?.numericValue ?? null,
    fcpMs: a['first-contentful-paint']?.numericValue ?? null,
    cls: a['cumulative-layout-shift']?.numericValue ?? null,
    weightKb: a['total-byte-weight']?.numericValue ? Math.round(a['total-byte-weight'].numericValue / 1024) : null,
  };
}

async function domainAge(domain) {
  const url = domain.endsWith('.br') ? `https://rdap.registro.br/domain/${domain}` : `https://rdap.org/domain/${domain}`;
  const res = await fetch(url, { headers: { Accept: 'application/rdap+json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RDAP ${res.status}`);
  const j = await res.json();
  const reg = (j.events || []).find(e => e.eventAction === 'registration');
  return reg ? reg.eventDate.slice(0, 10) : null;
}

async function analyze(rawUrl, { pagespeedKey = '', skipPagespeed = false } = {}) {
  const u = normalizeUrl(rawUrl);
  if (!u) return { ok: false, error: 'Endereço de site inválido' };
  const domain = registrableDomain(u.hostname);
  const page = await fetchPage(u);
  const result = {
    ok: true, url: u.href, domain, analyzedAt: new Date().toISOString(),
    https: page.https, httpRedirectsToHttps: page.httpRedirectsToHttps,
    status: page.status, finalUrl: page.finalUrl, loadMs: page.loadMs,
    offline: !page.html && !page.status, offlineReason: page.error,
    errors: [],
  };
  if (page.html || page.status) Object.assign(result, parseHtml(page.html, page.finalUrl || u.href));

  const tasks = [];
  if (result.links?.length) tasks.push(checkLinks(result.links).then(b => { result.brokenLinks = b; }));
  if (!result.offline && !skipPagespeed)
    tasks.push(pagespeed(page.finalUrl || u.href, pagespeedKey).then(p => { result.psi = p; }).catch(e => result.errors.push(e.message)));
  tasks.push(domainAge(domain).then(d => { result.registeredAt = d; }).catch(e => result.errors.push('Idade do domínio: ' + e.message)));
  await Promise.all(tasks);
  delete result.links;
  return result;
}

module.exports = { analyze, parseHtml, normalizeUrl, registrableDomain };
