// Teste da pagina /cartas/ num navegador de verdade (Chromium do Playwright),
// com o Supabase trocado por scripts/fake_supabase.js: nada chega ao banco.
//
// Precisa do Playwright com o Chromium instalado (o ambiente do Claude Code na
// nuvem ja tem). Na raiz do repositorio:
//
//   node scripts/test_cartinhas_navegador.cjs [pasta-para-capturas]
//
// Cobre o que so aparece com a pagina rodando: texto, relogio das 21:30,
// liberacao da edicao na hora certa, numeracao invertida, forca de adversario,
// selo de comentarios, varias conversas abertas ao mesmo tempo (login, envio,
// resposta, voto, rascunho preservado), links que voltam ao site, celular e a
// pagina de jogador do site, que usa o mesmo comments.js.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const raiz = path.join(__dirname, "..");
const capturas = process.argv[2] || null;
const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, "cartas/manifest.json"), "utf8"));
// O teste simula a passagem de 23 para 24/10. A publicacao real cresce a cada
// dia; manter so o primeiro lote evita duplicar a edicao simulada abaixo.
manifesto.publishedThrough = "2026-10-23";
manifesto.days.forEach((day, i) => {
  if (i > 0) delete day.cards;
});
const fakeSdk = fs.readFileSync(path.join(__dirname, "fake_supabase.js"), "utf8");
const reveladas = manifesto.days.flatMap((day) => day.cards || []);
const cartaA = reveladas.find((card) => card.rank === 216);
const cartaB = reveladas.find((card) => card.rank === 212);
const TEXTO = `É revelado um lote de cartinhas por dia, em ordem do menor para o maior overall. No total são 216 cartinhas, de jogadores com pelo menos 200 rounds e 12 mapas jogados no ano. Última revelação em 24 de novembro.`;

const ALICE = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const dadosIniciais = {
  atraso: [5, 60],
  usuarios: [
    { id: ALICE, email: "alice@teste.univlr", senha: "senha-da-alice", username: "alice_teste" },
    { id: BRUNO, email: "bruno@teste.univlr", senha: "senha-do-bruno", username: "bruno_teste" },
  ],
  threads: [
    { id: "t-colecao", kind: "card", subject: "2026" },
    { id: "t-carta-a", kind: "card", subject: cartaA.thread },
  ],
  comentarios: [
    { id: "c-1", thread: "t-colecao", autor: BRUNO, body: "Quando sai o top 20?", minutosAtras: 30 },
    { id: "c-2", thread: "t-colecao", autor: ALICE, body: "Depois da final do Univavá.", parent: "c-1", minutosAtras: 20 },
    { id: "c-3", thread: "t-carta-a", autor: BRUNO, body: "Overall justo.", minutosAtras: 40 },
    { id: "c-4", thread: "t-carta-a", autor: ALICE, body: "[b]Concordo[/b], @bruno_teste", minutosAtras: 35 },
    { id: "c-5", thread: "t-carta-a", autor: BRUNO, body: "Veja [url=#/players/mile]o perfil[/url].", minutosAtras: 10 },
  ],
};

// Edicao de teste do dia 24/10, so na memoria: copias das cartinhas reveladas
// com outras posicoes e nomes. Nenhum dado de cartinha futura existe aqui.
function manifestoComDia24() {
  const copia = JSON.parse(JSON.stringify(manifesto));
  const dia = copia.days.find((day) => day.date === "2026-10-24");
  dia.cards = reveladas.map((card, i) => ({ ...card, rank: 206 - i, name: `Teste ${206 - i}`, thread: `2026:teste${i}` }));
  copia.publishedThrough = "2026-10-24";
  return copia;
}

function servidor() {
  const porta = 8700 + Math.floor(Math.random() * 200);
  const processo = spawn(process.execPath, ["local-static-server.cjs"], { cwd: raiz, env: { ...process.env, PORT: String(porta) } });
  return new Promise((ok, falha) => {
    processo.stdout.on("data", (dado) => {
      if (String(dado).includes("local server")) ok({ url: `http://127.0.0.1:${porta}`, processo });
    });
    processo.on("exit", (codigo) => falha(new Error(`servidor saiu com ${codigo}`)));
  });
}

async function novaPagina(navegador, { largura = 1440, altura = 900, fake = dadosIniciais, manifestoServido = () => manifesto } = {}) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura } });
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (erro) => erros.push(String(erro)));
  // Recurso de fora (o contador de audiencia, por exemplo) e bloqueado pelo
  // proprio teste; a falha dele nao e erro da pagina.
  pagina.on("console", (msg) => {
    const origem = msg.location()?.url || "";
    const externo = /^Failed to load resource/.test(msg.text()) && origem && !origem.startsWith("http://127.0.0.1");
    if (msg.type() === "error" && !externo) erros.push(msg.text());
  });
  await pagina.addInitScript((dados) => {
    window.__FAKE_SUPABASE__ = dados;
  }, fake);
  await pagina.route("**/*", (rota) => {
    const url = new URL(rota.request().url());
    if (url.hostname !== "127.0.0.1") return rota.abort();
    if (url.pathname === "/supabase-js.js") return rota.fulfill({ contentType: "application/javascript", body: fakeSdk });
    if (url.pathname === "/cartas/manifest.json" && manifestoServido) {
      return rota.fulfill({ contentType: "application/json", body: JSON.stringify(manifestoServido()) });
    }
    return rota.continue();
  });
  return { contexto, pagina, erros };
}

const linhas = (pagina) => pagina.locator("#dias .linha");
const conversa = (pagina, rank) => pagina.locator(`#carta-${rank} .cmt-carta`);

async function semEstouro(pagina, nome) {
  const { largura, documento } = await pagina.evaluate(() => ({ largura: window.innerWidth, documento: document.documentElement.scrollWidth }));
  assert(documento <= largura, `${nome}: a pagina rola na horizontal (${documento} > ${largura})`);
}

async function captura(pagina, nome, opcoes = {}) {
  if (!capturas) return;
  fs.mkdirSync(capturas, { recursive: true });
  await pagina.screenshot({ path: path.join(capturas, `${nome}.png`), ...opcoes });
}

async function entrar(pagina, email, senha) {
  await pagina.click(".conta-entrar");
  await pagina.fill('.auth-janela input[name="email"]', email);
  await pagina.fill('.auth-janela input[name="senha"]', senha);
  await pagina.click(".auth-janela button[type=submit]");
  await pagina.waitForSelector(".conta-avatar-botao");
}

async function testePrincipal(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador);
  await pagina.clock.install({ time: new Date("2026-10-24T20:00:00-03:00") });
  await pagina.goto(`${base}/cartas/`);
  await linhas(pagina).first().waitFor();

  // Texto unico do topo, relogio e numeracao invertida.
  assert.strictEqual((await pagina.textContent("#regra")).trim(), TEXTO);
  assert.strictEqual(await linhas(pagina).count(), 10);
  assert.match(await pagina.textContent(".contagem-numero"), /10\s*de 216 reveladas/);
  assert.match(await pagina.textContent("#relogio"), /^em 1h (29|30)min \d\ds$/);
  assert.match(await pagina.textContent(".contagem-proxima"), /24 de outubro, às 21:30 de Brasília, 10 cartinhas \(#206 a #197\)/);
  const posicoes = await pagina.locator("#dias .r-pos").allTextContents();
  assert.deepStrictEqual(posicoes, ["#207", "#208", "#209", "#210", "#211", "#212", "#213", "#214", "#215", "#216"]);
  assert.match(await pagina.textContent("#dia-2026-10-23 .sec-aparte"), /10 reveladas, #216 a #207/);

  // Selo so na cartinha com comentario, a esquerda do overall, contando so os
  // comentarios vivos. O atalho da colecao mostra o total dela.
  await pagina.waitForFunction((rank) => document.querySelector(`#carta-${rank} .r-cmt`)?.textContent.trim() === "3", cartaA.rank);
  const selos = await pagina.locator("#dias .r-cmt").evaluateAll((els) => els.filter((el) => el.textContent.trim()).length);
  assert.strictEqual(selos, 1, "so a cartinha com comentario tem selo");
  const caixaSelo = await pagina.locator(`#carta-${cartaA.rank} .r-cmt`).boundingBox();
  const caixaOvr = await pagina.locator(`#carta-${cartaA.rank} .r-ovr b`).boundingBox();
  assert(caixaSelo.x + caixaSelo.width <= caixaOvr.x, "o selo fica a esquerda do overall");
  await pagina.waitForFunction(() => document.getElementById("conversa-total").textContent === "2 comentários");
  await pagina.waitForFunction(() => /2 comentários/.test(document.querySelector("#comentarios .section-head")?.textContent || ""));
  assert.match(await pagina.textContent("#comentarios"), /Entre na sua conta para comentar/);
  await semEstouro(pagina, "desktop");
  await captura(pagina, "desktop-topo");

  // Perfil: forca de adversario no lugar do "Ajustado", conversa da cartinha.
  await pagina.click(`#carta-${cartaA.rank} .resumo`);
  const perfilA = pagina.locator(`#perfil-${cartaA.rank}`);
  assert.match(await perfilA.textContent(), /Força média de adversário/);
  assert.doesNotMatch(await perfilA.textContent(), /Ajustado/);
  const forca = await perfilA.locator(".numero", { hasText: "Força média de adversário" }).locator("b").textContent();
  const esperado = cartaA.opponentStrength.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.strictEqual(forca, (cartaA.opponentStrength > 0 ? "+" : "") + esperado);
  await conversa(pagina, cartaA.rank).locator(".cmt").first().waitFor();
  assert.strictEqual(await conversa(pagina, cartaA.rank).locator(".cmt").count(), 3);
  assert.strictEqual(await conversa(pagina, cartaA.rank).locator(".cmt-mencao").getAttribute("href"), "/#/u/bruno_teste");
  assert.strictEqual(await conversa(pagina, cartaA.rank).locator(".cmt-url").getAttribute("href"), "/#/players/mile");
  assert.strictEqual(await conversa(pagina, cartaA.rank).locator(".cmt-autor").first().getAttribute("href"), "/#/u/bruno_teste");

  await pagina.click(`#carta-${cartaB.rank} .resumo`);
  await pagina.waitForFunction((rank) => /Ninguém comentou ainda/.test(document.querySelector(`#carta-${rank} .cmt-carta`)?.textContent || ""), cartaB.rank);
  await captura(pagina, "desktop-perfil", { fullPage: true });

  // Login: as tres conversas abertas trocam o convite pelo formulario.
  await entrar(pagina, "alice@teste.univlr", "senha-da-alice");
  await pagina.waitForFunction(() => document.querySelectorAll('.cmt-form[data-form="novo"]').length === 3);
  await conversa(pagina, cartaA.rank).scrollIntoViewIfNeeded();
  await captura(pagina, "desktop-logado");

  // Rascunho em B nao pode sumir quando A publica, nem quando a colecao vota.
  const campoB = conversa(pagina, cartaB.rank).locator('.cmt-form[data-form="novo"] textarea');
  await campoB.fill("rascunho em B");
  const formA = conversa(pagina, cartaA.rank).locator('.cmt-form[data-form="novo"]');
  await formA.locator("textarea").fill("Comentário novo em A");
  await formA.locator(".cmt-enviar").click();
  await pagina.waitForFunction((rank) => document.querySelectorAll(`#carta-${rank} .cmt-carta .cmt`).length === 4, cartaA.rank);
  await pagina.waitForFunction((rank) => document.querySelector(`#carta-${rank} .r-cmt`)?.textContent.trim() === "4", cartaA.rank);
  assert.strictEqual(await campoB.inputValue(), "rascunho em B");
  assert.strictEqual(await pagina.locator("#comentarios .cmt").count(), 2);
  assert.strictEqual(await pagina.locator(`#carta-${cartaB.rank} .r-cmt`).textContent(), "");

  // Voto na colecao mexe so no comentario dela.
  const primeiroDaColecao = pagina.locator('#comentarios .cmt[data-cmt="c-1"]');
  await primeiroDaColecao.locator('.cmt-voto-seta[data-sinal="1"]').first().click();
  await pagina.waitForFunction(() => document.querySelector('#comentarios .cmt[data-cmt="c-1"] .cmt-score')?.textContent.trim() === "+1");
  assert.strictEqual(await campoB.inputValue(), "rascunho em B");
  const scoresA = await conversa(pagina, cartaA.rank).locator(".cmt-score").allTextContents();
  assert(scoresA.every((s) => s.trim() === "0"), "o voto na colecao nao toca a cartinha");

  // Resposta dentro da cartinha A, em paralelo com um envio na colecao.
  await conversa(pagina, cartaA.rank).locator('.cmt[data-cmt="c-3"] [data-responder="c-3"]').first().click();
  const resposta = conversa(pagina, cartaA.rank).locator('.cmt-form[data-form="responder"]');
  await resposta.locator("textarea").fill("Resposta em A");
  const formColecao = pagina.locator('#comentarios .cmt-form[data-form="novo"]');
  await formColecao.locator("textarea").fill("Oi @bruno_teste, olha a coleção");
  // Os dois envios saem no mesmo instante. Dois cliques em paralelo nao
  // serviriam: o Playwright rola a pagina para cada um, e um clique cai fora
  // do lugar.
  await pagina.evaluate((rank) => {
    document.querySelector(`#carta-${rank} .cmt-form[data-form="responder"]`).requestSubmit();
    document.querySelector('#comentarios .cmt-form[data-form="novo"]').requestSubmit();
  }, cartaA.rank);
  await pagina.waitForFunction((rank) => document.querySelectorAll(`#carta-${rank} .cmt-carta .cmt`).length === 5, cartaA.rank);
  await pagina.waitForFunction(() => document.querySelectorAll("#comentarios .cmt").length === 3);
  assert.strictEqual(await conversa(pagina, cartaA.rank).locator('.cmt[data-cmt="c-3"] .cmt-filhos .cmt-corpo').textContent(), "Resposta em A");
  await pagina.waitForFunction(() => document.getElementById("conversa-total").textContent === "3 comentários");
  assert.strictEqual(await campoB.inputValue(), "rascunho em B");

  // Renovacao do token avisa sem a conta mudar: nada pode ser refeito.
  await pagina.evaluate(() => window.__FAKE_SUPABASE_CLIENTE__?.auth.__renova());
  await pagina.waitForTimeout(300);
  assert.strictEqual(await campoB.inputValue(), "rascunho em B");

  // Sair volta as tres conversas para o convite.
  await pagina.click(".conta-avatar-botao");
  await pagina.click(".auth-janela [data-sair]");
  await pagina.waitForFunction(() => document.querySelectorAll(".cmt-convite").length === 3);
  assert.strictEqual(await pagina.locator('.cmt-form[data-form="novo"]').count(), 0);
  await captura(pagina, "desktop-conversas", { fullPage: true });

  assert.deepStrictEqual(erros, [], "erros no console da pagina das cartinhas");
  await contexto.close();
}

async function testeLiberacao(navegador, base) {
  // A edicao chegou antes das 21:30: fica escondida e entra quando o relogio zera.
  {
    const { contexto, pagina, erros } = await novaPagina(navegador, { manifestoServido: manifestoComDia24 });
    await pagina.clock.install({ time: new Date("2026-10-24T21:29:50-03:00") });
    await pagina.goto(`${base}/cartas/`);
    await linhas(pagina).first().waitFor();
    assert.strictEqual(await linhas(pagina).count(), 10, "antes das 21:30 a edicao nova nao aparece");
    assert.strictEqual(await pagina.locator("#busca-jogador").evaluate((el) => el.value), "");
    await pagina.fill("#busca-jogador", "Teste");
    assert.match(await pagina.textContent("#busca-resultados"), /Nenhum jogador revelado/);
    await pagina.fill("#busca-jogador", "");
    await pagina.clock.fastForward(12000);
    await pagina.waitForFunction(() => document.querySelectorAll("#dias .linha").length === 20);
    assert.match(await pagina.textContent(".contagem-numero"), /20\s*de 216 reveladas/);
    assert.match(await pagina.textContent(".contagem-proxima"), /25 de outubro, às 21:30 de Brasília, 10 cartinhas \(#196 a #187\)/);
    assert.strictEqual(await pagina.locator("#dias .dia").first().getAttribute("id"), "dia-2026-10-24");
    assert.deepStrictEqual(erros, []);
    await contexto.close();
  }
  // A edicao atrasou: depois das 21:30 a pagina busca de novo e se refaz.
  {
    let publicado = false;
    const { contexto, pagina, erros } = await novaPagina(navegador, { manifestoServido: () => (publicado ? manifestoComDia24() : manifesto) });
    await pagina.clock.install({ time: new Date("2026-10-24T21:29:55-03:00") });
    await pagina.goto(`${base}/cartas/`);
    await linhas(pagina).first().waitFor();
    await pagina.clock.fastForward(7000);
    await pagina.waitForFunction(() => /chegando/.test(document.getElementById("relogio")?.textContent || ""));
    publicado = true;
    await pagina.clock.fastForward(31000);
    await pagina.waitForFunction(() => document.querySelectorAll("#dias .linha").length === 20);
    assert.deepStrictEqual(erros, []);
    await contexto.close();
  }
}

async function testeEndereco(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador);
  const puuid = cartaA.thread.split(":")[1];
  await pagina.goto(`${base}/cartas/#jogador-${puuid}`);
  await pagina.waitForSelector(`#carta-${cartaA.rank}.aberta`);
  await conversa(pagina, cartaA.rank).locator(".cmt").first().waitFor();
  await pagina.goto(`${base}/cartas/#carta-${cartaB.rank}`);
  await pagina.waitForSelector(`#carta-${cartaB.rank}.aberta`);
  assert.deepStrictEqual(erros, []);
  await contexto.close();
}

async function testeCelular(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador, { largura: 390, altura: 844 });
  await pagina.clock.install({ time: new Date("2026-10-24T20:00:00-03:00") });
  await pagina.goto(`${base}/cartas/`);
  await linhas(pagina).first().waitFor();
  await pagina.waitForFunction((rank) => document.querySelector(`#carta-${rank} .r-cmt`)?.textContent.trim() === "3", cartaA.rank);
  await semEstouro(pagina, "celular");
  await captura(pagina, "celular-topo");
  await pagina.click(`#carta-${cartaA.rank} .resumo`);
  await conversa(pagina, cartaA.rank).locator(".cmt").first().waitFor();
  await semEstouro(pagina, "celular com perfil aberto");
  const caixa = await conversa(pagina, cartaA.rank).boundingBox();
  assert(caixa.width > 330, `a conversa da cartinha ocupa a largura no celular (${caixa.width})`);
  await entrar(pagina, "alice@teste.univlr", "senha-da-alice");
  await pagina.waitForFunction(() => document.querySelectorAll('.cmt-form[data-form="novo"]').length === 2);
  await semEstouro(pagina, "celular logado");
  await captura(pagina, "celular-perfil", { fullPage: true });
  assert.deepStrictEqual(erros, []);
  await contexto.close();
}

// A migracao 0007 ainda nao aplicada: publicar falha com a mensagem do banco,
// no proprio formulario, sem quebrar o resto.
async function testeSemMigracao(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador, { fake: { ...dadosIniciais, recusaKinds: ["card"] } });
  await pagina.goto(`${base}/cartas/`);
  await linhas(pagina).first().waitFor();
  await entrar(pagina, "alice@teste.univlr", "senha-da-alice");
  const form = pagina.locator('#comentarios .cmt-form[data-form="novo"]');
  await form.locator("textarea").fill("teste");
  await form.locator(".cmt-enviar").click();
  await pagina.waitForFunction(() => !document.querySelector("#comentarios .cmt-erro")?.hidden);
  assert.match(await pagina.textContent("#comentarios .cmt-erro"), /threads_subject_kind_check/);
  assert.deepStrictEqual(erros, []);
  await contexto.close();
}

// O site usa o mesmo comments.js, com uma conversa so por pagina.
async function testeSite(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador);
  // Sem a tela de pre-carga de imagens (como numa segunda visita): ela adia o
  // ultimo render da carga, que refaria a pagina no meio do teste.
  await pagina.addInitScript(() => {
    try {
      localStorage.setItem("univlr-image-warm-v1", String(Date.now()));
    } catch (_erro) {}
  });
  await pagina.goto(`${base}/#/players/mile`);
  await pagina.waitForFunction(
    () => typeof state !== "undefined" && state.ready && document.querySelector(".conta-entrar") && /Ninguém comentou ainda|comentário/.test(document.querySelector("[data-comentarios]")?.textContent || ""),
    null,
    { timeout: 60000 },
  );
  await entrar(pagina, "alice@teste.univlr", "senha-da-alice");
  await pagina.waitForSelector('[data-comentarios] .cmt-form[data-form="novo"]');
  // Escrever e enviar na mesma tarefa: o site refaz a pagina inteira em varios
  // momentos, e um render entre o fill e o clique enviaria a caixa nova, vazia.
  await pagina.evaluate(() => {
    const form = document.querySelector('[data-comentarios] .cmt-form[data-form="novo"]');
    form.querySelector("textarea").value = "Comentário no perfil, com @bruno_teste";
    form.requestSubmit();
  });
  await pagina.waitForSelector("[data-comentarios] .cmt");
  assert.strictEqual(await pagina.locator("[data-comentarios] .cmt-mencao").getAttribute("href"), "#/u/bruno_teste");
  await pagina.goto(`${base}/#/home`);
  await pagina.waitForSelector(`.atv-linha[href="/cartas/#jogador-${cartaA.thread.split(":")[1]}"]`, { timeout: 60000 });
  await pagina.waitForSelector('.atv-linha[href="/cartas/#comentarios"]');
  assert.deepStrictEqual(erros, [], "erros no console do site");
  await contexto.close();
}

(async () => {
  const { url, processo } = await servidor();
  const navegador = await chromium.launch();
  try {
    await testePrincipal(navegador, url);
    console.log("ok - topo, relogio, numeracao, selo, forca de adversario e conversas simultaneas");
    await testeLiberacao(navegador, url);
    console.log("ok - edicao liberada as 21:30, adiantada ou atrasada");
    await testeEndereco(navegador, url);
    console.log("ok - #jogador-<puuid> e #carta-N abrem o perfil");
    await testeCelular(navegador, url);
    console.log("ok - celular de 390px sem rolagem lateral");
    await testeSemMigracao(navegador, url);
    console.log("ok - sem a 0007, o erro aparece no formulario");
    await testeSite(navegador, url);
    console.log("ok - perfil de jogador e atividade recente no site");
  } finally {
    await navegador.close();
    processo.kill();
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
