// Adaptador opcional para o navegador com CDP já configurado pelo usuário.
// Não inicia navegador, muda configurações ou copia credenciais.
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { Collector } = require('./coletor.cjs');

async function main(args) {
  if (!args.length || args.includes('--help')) {
    console.log('Uso: node coletor-cdp.cjs PASTA [--limit 100] [--cdp-url http://127.0.0.1:9222] [--playwright-path CAMINHO]');
    return;
  }
  const folder = args[0], options = {};
  for (let i = 1; i < args.length; i += 2) {
    if (!['--limit', '--cdp-url', '--playwright-path'].includes(args[i]) || !args[i + 1]) throw new Error('Opção inválida ou sem valor: ' + args[i]);
    options[args[i]] = args[i + 1];
  }
  const limit = Number(options['--limit'] || 100);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit deve ser um inteiro positivo.');
  const endpoint = new URL(options['--cdp-url'] || 'http://127.0.0.1:9222');
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Use o endpoint CDP local do seu navegador.');
  let playwright;
  try { playwright = require(options['--playwright-path'] ? path.resolve(options['--playwright-path']) : 'playwright'); }
  catch { throw new Error('Playwright não encontrado. Informe --playwright-path com a instalação existente.'); }
  const collector = new Collector(folder);
  const first = collector.next();
  if (first.done || first.stopped) { console.log(JSON.stringify(first, null, 2)); return; }
  const browser = await playwright.chromium.connectOverCDP(endpoint.toString(), { timeout: 10000 });
  let page;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error('O navegador conectado não disponibilizou o contexto padrão.');
    page = await context.newPage();
    for (let count = 0; count < limit; count++) {
      const task = collector.next();
      if (task.done || task.stopped) { console.log(JSON.stringify(task)); break; }
      while (collector.waitMs() > 0) await sleep(Math.min(collector.waitMs() + 10, 30000));
      collector.begin(task);
      try {
        const response = await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (!response) throw new Error('Navegação sem resposta HTTP.');
        const raw = await response.text();
        let doc;
        try { doc = JSON.parse(raw); } catch { /* página de acesso/verificação */ }
        const noData = doc?.errors?.length && doc.errors.every(e => e.code === 'StandardApiV2::NoData');
        if (response.ok() || noData) {
          if (doc) collector.ingest(task, raw);
          else collector.fail(task, { status: 403, message: 'Resposta não JSON. Confira a aba de acesso do Tracker.' });
        } else {
          const header = response.headers()['retry-after'];
          const retryAfterMs = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now())) : 0;
          collector.fail(task, { status: response.status(), message: doc ? JSON.stringify(doc) : 'Resposta de acesso não JSON do Tracker.', retryAfterMs });
        }
      } catch (error) { collector.fail(task, { message: error.message }); }
      console.log(JSON.stringify({ request: count + 1, kind: task.kind, handle: task.handle, page: task.page, matchId: task.matchId, ...collector.report().stats }));
      if (collector.state.stop) break;
    }
  } finally {
    // Em verificações de acesso, conserva a própria aba para inspeção humana.
    if (page && collector.state.stop?.reason !== 'verificacao_ou_acesso_bloqueado') await page.close().catch(() => {});
    // Uma conexão CDP é desconectada; o navegador existente não foi lançado aqui.
    await browser.close();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
