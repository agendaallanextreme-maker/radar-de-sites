// Score de oportunidade (0 a 100): quanto maior, pior o site e maior a chance de venda.
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(v)));

const WEIGHTS = { perf: 30, tech: 25, mobile: 15, security: 15, seo: 15 };

const ISSUE_LABEL = {
  nosite: 'Sem site', offline: 'Fora do ar', cert: 'Certificado inválido', slow: 'Lento', old: 'Antigo',
  mobile: 'Não mobile', ssl: 'Sem HTTPS', broken: 'Links quebrados', seo: 'SEO fraco',
};

function versionLt(v, ref) {
  const a = String(v).split('.').map(Number), b = ref.split('.').map(Number);
  for (let i = 0; i < b.length; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i]; }
  return false;
}

function score(lead) {
  const a = lead.analysis;
  const year = new Date().getFullYear();
  if (!lead.website) return { score: 75, issues: ['nosite'], parts: null };
  if (!a || !a.ok) return { score: 0, issues: [], parts: null };

  const certProblem = a.offline && /CERT|SSL|TLS|ERR_TLS|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(a.offlineReason || '');
  if (a.offline || (a.status && a.status >= 500)) {
    return { score: certProblem ? 88 : 92, issues: [certProblem ? 'cert' : 'offline'], parts: null };
  }

  // Performance: PageSpeed quando disponível, senão tempo de carregamento do HTML
  let perf;
  if (a.psi) perf = 100 - a.psi.performance;
  else if (a.loadMs != null) perf = clamp((a.loadMs - 800) / 40);
  else perf = 0;

  // Tecnologia/idade
  let tech = 0;
  const copyAge = a.copyrightYear ? year - a.copyrightYear : null;
  if (copyAge != null) tech += clamp(copyAge * 12, 0, 70);
  if (a.jquery && versionLt(a.jquery, '1.12')) tech += 30;
  else if (a.jquery && versionLt(a.jquery, '3.0')) tech += 15;
  if (a.wpVer && versionLt(a.wpVer, '6.0')) tech += 25;
  if (a.joomlaVer && versionLt(a.joomlaVer, '4.0')) tech += 30;
  if ((a.tech || []).some(t => /flash|frames/i.test(t))) tech += 50;
  if (a.tableLayout) tech += 15;
  if (a.registeredAt && year - Number(a.registeredAt.slice(0, 4)) >= 10) tech += 10;
  tech = clamp(tech);

  const mobile = a.hasViewport ? 0 : 100;
  const security = !a.https ? 100 : a.httpRedirectsToHttps === false ? 35 : 0;
  const seo = clamp((a.title ? 0 : 40) + (a.description ? 0 : 35) + (a.hasH1 ? 0 : 25));

  const parts = { perf: clamp(perf), tech, mobile, security, seo };
  let total = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + parts[k] * w / 100, 0);
  const broken = (a.brokenLinks || []).length;
  total += Math.min(15, broken * 4);
  if (a.status >= 400) total += 20;

  const issues = [];
  if ((a.psi && a.psi.performance < 50) || (!a.psi && a.loadMs > 4000)) issues.push('slow');
  if ((copyAge != null && copyAge >= 4) || tech >= 40) issues.push('old');
  if (!a.hasViewport) issues.push('mobile');
  if (!a.https) issues.push('ssl');
  if (broken || a.status >= 400) issues.push('broken');
  if (seo >= 60) issues.push('seo');

  return { score: clamp(total), issues, parts };
}

const fmtS = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

// Argumento de venda montado a partir dos problemas encontrados (sem custo de IA).
function pitch(lead) {
  const a = lead.analysis || {};
  const lines = [];
  const rep = lead.rating && lead.reviews ? `A ${lead.name} tem nota ${String(lead.rating).replace('.', ',')} com ${lead.reviews} avaliações no Google, mas o site não acompanha essa reputação.` : '';
  if (!lead.website) return `A ${lead.name} não tem site. Quem pesquisa no Google encontra só o perfil do Maps e vai para o concorrente que tem página própria, com fotos, serviços e botão de WhatsApp.`;
  if (lead.issues.includes('offline')) return `O site ${a.domain} está fora do ar. Quem clica no link do Google cai num erro e procura outro lugar. Proposta: colocar no ar um site novo e estável.`;
  if (lead.issues.includes('cert')) return `O site ${a.domain} abre com o aviso "Sua conexão não é particular" no navegador, por causa do certificado de segurança inválido. A maioria das pessoas fecha a página nesse momento.`;
  if (rep) lines.push(rep);
  if (lead.issues.includes('slow')) lines.push(a.psi?.lcpMs ? `No celular, o conteúdo principal leva ${fmtS(a.psi.lcpMs)} para aparecer (nota ${a.psi.performance}/100 no teste do Google). Acima de 3 s, boa parte das pessoas desiste.` : `A página leva ${fmtS(a.loadMs)} só para carregar o HTML.`);
  if (lead.issues.includes('ssl')) lines.push('Não tem HTTPS: o Chrome mostra "Não seguro" ao lado do endereço.');
  if (lead.issues.includes('mobile')) lines.push('Não tem versão para celular: o texto fica minúsculo e é preciso dar zoom para ler.');
  if (lead.issues.includes('old')) lines.push(a.copyrightYear ? `O rodapé ainda diz ${a.copyrightYear}, o que passa a impressão de empresa parada.` : 'Usa tecnologia desatualizada, com risco de segurança e visual antigo.');
  if (lead.issues.includes('broken')) lines.push(`${(a.brokenLinks || []).length || 'Alguns'} links do site levam a páginas com erro.`);
  if (lead.issues.includes('seo')) lines.push('Faltam título e descrição para o Google, o que derruba o site nas buscas.');
  if (lines.length <= (rep ? 1 : 0)) return 'Site em boas condições. Oportunidade menor: manutenção, SEO local ou páginas por serviço.';
  lines.push('Proposta: site novo, rápido no celular, seguro e com botão de WhatsApp.');
  return lines.join(' ');
}

const MSG_LABEL = {
  nosite: 'não aparece um site próprio no Google', offline: 'o site está fora do ar', cert: 'o navegador mostra alerta de segurança',
  slow: 'o site demora para abrir no celular', old: 'o visual e a tecnologia estão desatualizados', mobile: 'o site não se adapta ao celular',
  ssl: 'o Chrome mostra "Não seguro"', broken: 'há links levando a páginas com erro', seo: 'faltam informações básicas para o Google',
};

function whatsappMessage(lead, settings) {
  const tpl = settings.whatsappTemplate || ((settings.myName ? 'Olá! Tudo bem? Sou {meu_nome}. ' : 'Olá! Tudo bem? ') + 'Analisei o site da {empresa} e encontrei alguns pontos que podem estar fazendo vocês perderem clientes: {problemas}. Posso te mandar o diagnóstico completo, sem custo?');
  const probs = (lead.issues || []).map(i => MSG_LABEL[i]).filter(Boolean).join(', ') || 'oportunidades de melhoria';
  return tpl.replace(/\{empresa\}/g, lead.name).replace(/\{meu_nome\}/g, settings.myName || '').replace(/\{problemas\}/g, probs).replace(/\{site\}/g, lead.analysis?.domain || lead.website || '');
}

function whatsappNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

module.exports = { score, pitch, whatsappMessage, whatsappNumber, ISSUE_LABEL, WEIGHTS };
