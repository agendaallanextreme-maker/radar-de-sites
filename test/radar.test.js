// Testes com sites simulados localmente (sem internet).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.RADAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
const { analyze, parseHtml, registrableDomain } = require('../lib/analyze');
const { score, pitch, whatsappNumber } = require('../lib/score');
const { parseCsv, csv } = require('../lib/discover');

const OLD = `<html><head><title>Clinica Antiga</title><script src="/js/jquery-1.7.2.min.js"></script></head>
<body><table><tr><td><a href="/servicos">Serviços</a> <a href="/convenios">Convênios</a> <a href="https://facebook.com/x">fb</a>
<a href="mailto:a@b.com">mail</a></td></tr></table><p>&copy; 2012 Clínica Antiga</p></body></html>`;
const NEW = `<html><head><title>Clínica Nova</title><meta name="viewport" content="width=device-width"><meta name="description" content="Dentista">
</head><body><h1>Clínica</h1><a href="/sobre">Sobre</a><footer>© 2019 - ${new Date().getFullYear()}</footer><a href="https://instagram.com/clinicanova">ig</a></body></html>`;

let srv, base;
before(async () => {
  srv = http.createServer((req, res) => {
    const host = req.headers.host;
    if (req.url === '/convenios') { res.writeHead(404); return res.end('nao achou'); }
    if (req.url === '/quebrado') { res.writeHead(500); return res.end('erro'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url.startsWith('/novo') || req.url === '/sobre' ? NEW : OLD);
    void host;
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv.close());

test('domínio registrável', () => {
  assert.strictEqual(registrableDomain('www.clinica.com.br'), 'clinica.com.br');
  assert.strictEqual(registrableDomain('blog.exemplo.com'), 'exemplo.com');
  assert.strictEqual(registrableDomain('dra.helena.odo.br'), 'helena.odo.br');
});

test('leitura do HTML de site antigo', () => {
  const p = parseHtml(OLD, 'http://x.com.br/');
  assert.strictEqual(p.copyrightYear, 2012);
  assert.strictEqual(p.jquery, '1.7.2');
  assert.strictEqual(p.hasViewport, false);
  assert.strictEqual(p.description, '');
  assert.deepStrictEqual(p.links, ['http://x.com.br/servicos', 'http://x.com.br/convenios']);
});

test('ano dinâmico no rodapé pega o maior', () => {
  assert.strictEqual(parseHtml(NEW, 'http://x.com/').copyrightYear, new Date().getFullYear());
  assert.strictEqual(parseHtml(NEW, 'http://x.com/').instagram, 'clinicanova');
});

test('análise ponta a ponta: site antigo sem HTTPS e com link quebrado', async () => {
  const a = await analyze(base + '/', { skipPagespeed: true });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.https, false);
  assert.strictEqual(a.offline, false);
  assert.strictEqual(a.copyrightYear, 2012);
  assert.deepStrictEqual(a.brokenLinks.map(b => b.status), [404]);
  const lead = { name: 'Clinica Antiga', website: base, rating: 4.7, reviews: 212, analysis: a };
  Object.assign(lead, score(lead));
  assert.ok(lead.score >= 60, 'score ' + lead.score); // rápido no teste local; na vida real o PageSpeed soma até +30
  for (const i of ['old', 'mobile', 'ssl', 'broken', 'seo']) assert.ok(lead.issues.includes(i), 'falta ' + i);
  const p = pitch(lead);
  assert.match(p, /4,7 com 212/);
  assert.match(p, /2012/);
});

test('análise ponta a ponta: site moderno tem score baixo', async () => {
  const a = await analyze(base + '/novo', { skipPagespeed: true });
  a.https = true; a.httpRedirectsToHttps = true; // servidor local não tem HTTPS
  const lead = { name: 'Nova', website: base, analysis: a };
  Object.assign(lead, score(lead));
  assert.ok(lead.score < 30, 'score ' + lead.score);
  assert.deepStrictEqual(lead.issues, []);
});

test('site fora do ar', async () => {
  const a = await analyze('http://127.0.0.1:1/', { skipPagespeed: true });
  const lead = { name: 'X', website: 'x', analysis: a };
  Object.assign(lead, score(lead));
  assert.deepStrictEqual(lead.issues, ['offline']);
  assert.match(pitch(lead), /fora do ar/);
});

test('sem site e endereço inválido', async () => {
  const lead = { name: 'Padaria', website: '' };
  Object.assign(lead, score(lead));
  assert.deepStrictEqual(lead.issues, ['nosite']);
  assert.strictEqual((await analyze('não é site')).ok, false);
});

test('WhatsApp: número brasileiro', () => {
  assert.strictEqual(whatsappNumber('(31) 99876-5432'), '5531998765432');
  assert.strictEqual(whatsappNumber('+55 31 3333-4444'), '553133334444');
  assert.strictEqual(whatsappNumber(''), '');
});

test('CSV com ; aspas e acentos', () => {
  const rows = csv({ csvText: 'Nome;Site;Telefone\n"Clínica ""Boa""";clinica.com.br;31 9999-0000\nSó nome;;\n' });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Clínica "Boa"');
  assert.strictEqual(rows[0].website, 'clinica.com.br');
  assert.strictEqual(rows[1].website, '');
  assert.deepStrictEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});
