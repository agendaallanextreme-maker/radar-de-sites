// Descoberta de negócios: Google Maps (Places API), OpenStreetMap (grátis) e CSV.
const db = require('./db');

const UA = 'RadarDeSites/1.0 (prospeccao local)';

// ---------- Google Places (New) Text Search ----------
// Site e telefone só vêm no SKU Enterprise: 1.000 consultas grátis/mês, depois US$ 35/1.000.
const GOOGLE_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.rating',
  'places.userRatingCount', 'places.googleMapsUri', 'places.businessStatus', 'nextPageToken',
].join(',');

async function google({ niche, city, maxPages = 3 }) {
  const { googleApiKey, googleMonthlyLimit } = db.state.settings;
  if (!googleApiKey) throw new Error('Chave do Google não configurada. Abra Configurações ou use OpenStreetMap.');
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    if (db.usage('google') >= Number(googleMonthlyLimit || 0)) {
      if (!out.length) throw new Error(`Limite mensal de consultas ao Google atingido (${googleMonthlyLimit}). Ajuste em Configurações.`);
      break;
    }
    const body = { textQuery: `${niche} em ${city}`, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleApiKey, 'X-Goog-FieldMask': GOOGLE_FIELDS },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    db.addUsage('google');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google respondeu ${res.status}: ${json.error?.message || 'erro desconhecido'}`);
    for (const p of json.places || []) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      out.push({
        name: p.displayName?.text || 'Sem nome',
        address: p.formattedAddress || '',
        website: p.websiteUri || '',
        phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? null,
        mapsUrl: p.googleMapsUri || '',
        sourceId: 'g:' + p.id,
      });
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
    await new Promise(r => setTimeout(r, 1500)); // o token da próxima página demora a valer
  }
  return out;
}

// ---------- OpenStreetMap (Overpass) ----------
// Grátis e sem chave. Cobertura de pequenos negócios no Brasil é menor que a do Google.
const OSM_TAGS = [
  [/dent|odonto/, ['amenity=dentist']],
  [/advoga|advocacia|jurid/, ['office=lawyer']],
  [/imobili/, ['office=estate_agent']],
  [/oficina|mec[aâ]nic|auto ?center/, ['shop=car_repair']],
  [/restaurante|lanchonete/, ['amenity=restaurant', 'amenity=fast_food']],
  [/academia|fitness|crossfit/, ['leisure=fitness_centre']],
  [/cl[ií]nica|consult[oó]rio|m[eé]dic/, ['amenity=clinic', 'amenity=doctors']],
  [/sal[aã]o|cabele|barbear/, ['shop=hairdresser', 'shop=beauty']],
  [/est[eé]tica|beleza/, ['shop=beauty']],
  [/veterin/, ['amenity=veterinary']],
  [/pet ?shop|pet/, ['shop=pet']],
  [/contab|contador/, ['office=accountant']],
  [/hotel|pousada/, ['tourism=hotel', 'tourism=guest_house']],
  [/padaria/, ['shop=bakery']],
  [/farm[aá]cia|drogaria/, ['amenity=pharmacy']],
  [/[oó]tica/, ['shop=optician']],
  [/escola|col[eé]gio/, ['amenity=school']],
  [/pizz/, ['amenity=restaurant']],
  [/m[oó]veis|moveis/, ['shop=furniture']],
  [/construtora|engenharia/, ['office=company', 'craft=builder']],
  [/fisioterap/, ['healthcare=physiotherapist']],
  [/psic[oó]log/, ['healthcare=psychotherapist']],
];

function osmFilters(niche) {
  const n = niche.toLowerCase();
  const hit = OSM_TAGS.find(([re]) => re.test(n));
  if (hit) return hit[1].map(t => { const [k, v] = t.split('='); return `["${k}"="${v}"]`; });
  const safe = niche.replace(/["\\]/g, '');
  return [`["name"~"${safe}",i]`];
}

async function osm({ niche, city }) {
  const cityName = city.split(',')[0].trim().replace(/["\\]/g, '');
  const parts = osmFilters(niche).map(f => `nwr(area.a)${f};`).join('');
  const q = `[out:json][timeout:60];area["name"="${cityName}"]["boundary"="administrative"]["admin_level"~"^(7|8)$"]->.a;(${parts});out center tags 400;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`OpenStreetMap respondeu ${res.status}. Tente de novo em alguns minutos.`);
  const json = await res.json();
  return (json.elements || []).filter(e => e.tags?.name).map(e => {
    const t = e.tags;
    const addr = [t['addr:street'], t['addr:housenumber'], t['addr:suburb']].filter(Boolean).join(', ');
    return {
      name: t.name,
      address: addr,
      website: t.website || t['contact:website'] || t.url || '',
      phone: t.phone || t['contact:phone'] || t['contact:mobile'] || '',
      instagram: t['contact:instagram'] || '',
      rating: null, reviews: null,
      mapsUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      sourceId: `o:${e.type}${e.id}`,
    };
  });
}

// ---------- CSV ----------
function parseCsv(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

function csv({ csvText }) {
  const rows = parseCsv(csvText || '');
  if (!rows.length) throw new Error('CSV vazio.');
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const head = rows[0].map(norm);
  const col = names => head.findIndex(h => names.includes(h));
  let iName = col(['nome', 'name', 'empresa']), iSite = col(['site', 'website', 'url']),
    iPhone = col(['telefone', 'phone', 'whatsapp', 'fone']), iAddr = col(['endereco', 'address', 'cidade']);
  let data = rows.slice(1);
  if (iName < 0 && iSite < 0) { iName = 0; iSite = 1; iPhone = 2; data = rows; } // sem cabeçalho
  return data.map((r, n) => ({
    name: (r[iName] || r[iSite] || '').trim() || `Linha ${n + 1}`,
    website: (r[iSite] || '').trim(),
    phone: iPhone >= 0 ? (r[iPhone] || '').trim() : '',
    address: iAddr >= 0 ? (r[iAddr] || '').trim() : '',
    rating: null, reviews: null, mapsUrl: '',
    sourceId: '',
  }));
}

module.exports = { google, osm, csv, parseCsv, osmFilters };
