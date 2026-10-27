# Radar de Sites

Encontra negócios com site lento, antigo, sem HTTPS, sem versão para celular ou quebrado, dá um score de oportunidade (0 a 100) e organiza os contatos num funil de vendas.

## Como rodar

1. Instale o **Node.js 18 ou mais novo**: https://nodejs.org (botão "LTS").
2. Abra a pasta e dê dois cliques em:
   - Windows: `iniciar-windows.bat`
   - Mac: `iniciar-mac.command` (na primeira vez: botão direito → Abrir)
   - Ou no terminal: `npm start`
3. O navegador abre em http://localhost:3333.

Não precisa instalar mais nada (`npm install` não é necessário). Os dados ficam em `data/db.json`: copie esse arquivo para fazer backup.

## Primeiros passos

1. **Configurações** → cole a chave do Google (veja abaixo) e seu nome.
2. **Buscas** → segmento + cidade + fonte → "Buscar e analisar".
3. **Oportunidades** → filtre por problema, abra um negócio, clique em "Chamar no WhatsApp". Ele vai para "Contatado" sozinho.
4. **Funil de vendas** → arraste os cards entre Novo, Contatado, Respondeu, Proposta, Fechado e Perdido. Anote valor, data de retorno e histórico em cada negócio.

## Fontes e custos

| Para quê | Serviço | Custo |
|---|---|---|
| Achar negócios | OpenStreetMap | Grátis, sem cadastro. Encontra menos negócios. |
| Achar negócios | Google Maps (Places API, SKU Text Search Enterprise) | 1.000 consultas grátis/mês (até 20 negócios cada). Depois, US$ 35 por mil. O sistema trava no limite definido em Configurações (padrão 900). |
| Achar negócios | Sua lista em CSV (`nome, site, telefone`) | Grátis |
| Velocidade | PageSpeed Insights API | Grátis, até 25.000/dia com chave. Sem chave, a cota compartilhada costuma estar esgotada. |
| Idade do domínio | RDAP (Registro.br e rdap.org) | Grátis |
| HTTPS, celular, rodapé, plataforma, links | O próprio sistema | Grátis |

### Como criar a chave do Google

1. Entre em https://console.cloud.google.com e crie um projeto.
2. Em "APIs e serviços → Biblioteca", ative **Places API (New)** e **PageSpeed Insights API**.
3. Em "Credenciais", crie uma **chave de API**. Restrinja a chave a essas duas APIs.
4. O Google pede um cartão para ativar o faturamento. Abaixo da cota gratuita não há cobrança. Crie também um alerta de orçamento em "Faturamento → Orçamentos e alertas".

## Como o score é calculado

| Parte | Peso | O que mede |
|---|---|---|
| Velocidade | 30% | Nota do PageSpeed no celular (ou tempo de carregamento, se não houver medição) |
| Tecnologia antiga | 25% | Ano do rodapé, jQuery/WordPress/Joomla antigos, Flash, layout em tabelas, domínio com 10+ anos |
| Celular | 15% | Falta da tag de viewport |
| Segurança | 15% | Sem HTTPS, ou HTTP sem redirecionar |
| SEO básico | 15% | Falta de título, descrição e H1 |

Links quebrados somam até +15. Sem site = 75. Fora do ar = 92. Certificado inválido = 88.

## Testes

```
npm test
```
