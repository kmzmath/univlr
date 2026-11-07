// Threads livres num navegador de verdade (Chromium do Playwright), com o
// Supabase trocado por scripts/fake_supabase.js: nada chega ao banco.
//
// Na raiz do repositorio:
//
//   node scripts/test_threads_navegador.cjs [pasta-para-capturas]
//
// Se o Playwright instalado pedir um Chromium de outra versao, aponte o que ja
// existe na maquina: CHROMIUM=<caminho do executavel> node scripts/...
//
// Cobre o que so aparece com a pagina rodando: painel da home no trilho da
// esquerda, aba no menu, convite de login sem conta, formulario (erro sem perder
// o texto), aviso "Comentaram na sua thread" levando ao comentario, ordem por
// ultima atividade, paginacao, perfil com o titulo da thread, thread apagada e
// celular sem rolagem lateral.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const raiz = path.join(__dirname, "..");
const capturas = process.argv[2] || null;
const fakeSdk = fs.readFileSync(path.join(__dirname, "fake_supabase.js"), "utf8");

const ALICE = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const LONGO = "Qual a melhor composição para a Ascent hoje em dia, pensando no cenário universitário e não no profissional, que joga bem diferente";
const topico = (i, title, autor, minutosAtras, extra = {}) => ({ id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`, title, autor, minutosAtras, body: "", ...extra });
const usuarios = [
  { id: ALICE, email: "alice@teste.univlr", senha: "senha-da-alice", username: "alice_teste" },
  { id: BRUNO, email: "bruno@teste.univlr", senha: "senha-do-bruno", username: "bruno_teste" },
];
const dadosIniciais = {
  atraso: [5, 40],
  usuarios,
  topicos: [
    topico(1, "Quem leva a Univavá esse ano?", BRUNO, 30, { body: "Fechou a fase de grupos." }),
    topico(2, "Procurando 5º para a Copa LUCE", BRUNO, 90),
    topico(3, "Tier list de times universitários 2026", null, 600),
    topico(4, LONGO.slice(0, 120), BRUNO, 1500),
    topico(5, "Sugestões para o site", BRUNO, 3000),
    topico(6, "Bolão da Rush Series 4", BRUNO, 5000),
    topico(7, "Thread que foi apagada", BRUNO, 6000, { apagado: true }),
  ],
};
const muitas = { atraso: [0, 5], usuarios, topicos: Array.from({ length: 60 }, (_, i) => topico(100 + i, `Thread número ${i + 1}`, BRUNO, 10 + i)) };

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

async function novaPagina(navegador, { largura = 1440, altura = 900, fake = dadosIniciais } = {}) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura } });
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (erro) => erros.push(String(erro)));
  pagina.on("dialog", (d) => d.accept());
  await pagina.addInitScript((dados) => {
    window.__FAKE_SUPABASE__ = dados;
    // O convite de conta aparece sozinho depois de um tempo e cobriria a tela.
    try { localStorage.setItem("univlr-convite-conta", JSON.stringify({ visto: Date.now(), dispensas: 9 })); } catch (e) {}
  }, fake);
  await pagina.route("**/*", (rota) => {
    const url = new URL(rota.request().url());
    if (url.hostname !== "127.0.0.1") return rota.abort();
    if (url.pathname === "/supabase-js.js") return rota.fulfill({ contentType: "application/javascript", body: fakeSdk });
    return rota.continue();
  });
  return { contexto, pagina, erros };
}

// Espera o slide de 220ms acabar antes de medir: no meio dele a pagina inteira
// esta deslocada e qualquer medida de borda mente.
const assenta = (pagina) => pagina.waitForTimeout(400);

async function semEstouro(pagina, nome) {
  await assenta(pagina);
  const fora = await pagina.evaluate(() =>
    [...document.querySelectorAll(".th-pagina *, .th-painel *")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width && b.right > window.innerWidth + 1 && !e.closest(".nome-rolante");
      })
      .map((e) => e.className)
  );
  const { largura, documento } = await pagina.evaluate(() => ({ largura: window.innerWidth, documento: document.documentElement.scrollWidth }));
  assert(documento <= largura, `${nome}: a pagina rola na horizontal (${documento} > ${largura})`);
  assert.deepStrictEqual(fora, [], `${nome}: blocos passam da borda`);
}

async function captura(pagina, nome) {
  if (!capturas) return;
  fs.mkdirSync(capturas, { recursive: true });
  await assenta(pagina);
  await pagina.screenshot({ path: path.join(capturas, `${nome}.png`), fullPage: true });
}

const vai = (pagina, hash) => pagina.evaluate((h) => { window.location.hash = h; }, hash);
// Depois de trocar de conta o auth.js conta os avisos e so entao redesenha a
// pagina inteira. Sem esperar esse redesenho, ele cai em cima do passo seguinte
// (apagando o destaque de um comentario, por exemplo).
async function comoUsuario(pagina, email, senha) {
  await pagina.evaluate(async ([e, s]) => {
    if (window.Community.logado()) await window.Community.sair();
    await window.Community.entrar({ email: e, password: s });
  }, [email, senha]);
  await pagina.waitForSelector(".conta-avatar-botao");
  await pagina.waitForTimeout(300);
}

async function testePrincipal(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador);
  await pagina.goto(`${base}/#/home`);
  // A home desenha primeiro pelo resumo e de novo quando o banco inteiro chega.
  await pagina.waitForLoadState("networkidle");
  await pagina.waitForSelector(".vp-trilho-esq .th-painel .th-linha");

  // Painel na home: trilho da esquerda, depois do ranking, 5 linhas.
  const painel = await pagina.evaluate(() => {
    const esq = document.querySelector(".vp-trilho-esq");
    const filhos = [...esq.children];
    const linhas = [...document.querySelectorAll(".th-painel .th-linha")];
    const longo = linhas.map((l) => l.querySelector(".th-titulo")).find((t) => t.scrollWidth > t.clientWidth);
    return {
      noTrilho: Boolean(esq.querySelector(".th-painel")),
      depoisDoRanking: filhos.findIndex((f) => f.classList.contains("th-painel")) > filhos.findIndex((f) => f.classList.contains("vp-s-ranking")),
      linhas: linhas.length,
      apagada: linhas.some((l) => l.textContent.includes("conta apagada")),
      longoCortadoComDica: Boolean(longo && longo.getAttribute("title") && longo.getAttribute("title").length > 60),
      soVivas: !linhas.some((l) => l.textContent.includes("Thread que foi apagada")),
    };
  });
  assert.deepStrictEqual(painel, { noTrilho: true, depoisDoRanking: true, linhas: 5, apagada: true, longoCortadoComDica: true, soVivas: true });
  await semEstouro(pagina, "home 1440");
  await captura(pagina, "home-1440");

  // Menu: Threads entre Ranking e Cartinhas, ativo na pagina.
  const menu = await pagina.$$eval(".nav-link", (l) => l.map((a) => a.textContent.trim()));
  assert.deepStrictEqual(menu.slice(menu.indexOf("Ranking"), menu.indexOf("Ranking") + 3), ["Ranking", "Threads", "Cartinhas"]);
  assert.strictEqual(new Set(await pagina.$$eval(".nav-link", (l) => l.map((a) => Math.round(a.getBoundingClientRect().top)))).size, 1, "o menu cabe numa linha a 1440px");

  // Sem conta, "+ Nova thread" abre o convite e nao navega.
  await pagina.click(".th-painel [data-th-nova]");
  await pagina.waitForSelector(".auth-janela");
  assert.strictEqual(await pagina.evaluate(() => location.hash), "#/home");
  await pagina.click(".auth-janela [data-fechar]");

  // Alice abre uma thread: erro sem perder o texto, depois publica.
  await comoUsuario(pagina, "alice@teste.univlr", "senha-da-alice");
  await vai(pagina, "#/threads/nova");
  await pagina.waitForSelector("[data-th-form]");
  await pagina.fill("#th-titulo", "   abcd  ");
  await pagina.fill("#th-texto", "texto que precisa sobreviver");
  await pagina.click("[data-th-form] button[type=submit]");
  await pagina.waitForSelector(".th-erro:not([hidden])");
  assert.strictEqual(await pagina.textContent(".th-erro"), "O título precisa ter entre 5 e 120 caracteres.");
  assert.strictEqual(await pagina.inputValue("#th-texto"), "texto que precisa sobreviver");
  await captura(pagina, "nova-erro-1440");
  await pagina.fill("#th-titulo", "Quem vai na final presencial?");
  await pagina.click("[data-th-form] button[type=submit]");
  await pagina.waitForSelector(".th-cartao h1");
  const idNova = (await pagina.evaluate(() => location.hash)).split("/")[2];
  assert.strictEqual(await pagina.textContent(".th-cartao h1"), "Quem vai na final presencial?");
  assert.deepStrictEqual(await pagina.$$eval(".th-acao", (b) => b.map((x) => x.textContent)), ["Editar", "Apagar"]);

  // Bruno comenta.
  await comoUsuario(pagina, "bruno@teste.univlr", "senha-do-bruno");
  await vai(pagina, "#/threads");
  await vai(pagina, `#/threads/${idNova}`);
  await pagina.waitForSelector("[data-comentarios] textarea[name=corpo]");
  await pagina.fill("[data-comentarios] textarea[name=corpo]", "eu vou!");
  await pagina.click("[data-comentarios] button.cmt-enviar[type=submit]");
  await pagina.waitForSelector("[data-comentarios] .cmt-corpo");
  assert.deepStrictEqual(await pagina.$$eval(".th-acao", (b) => b.length), 0, "Bruno nao edita nem apaga a thread da Alice");

  // A comentada vai para o topo da lista.
  await vai(pagina, "#/threads");
  await pagina.waitForSelector(".th-tabela tbody tr");
  assert.strictEqual(await pagina.textContent(".th-tabela tbody tr:first-child .th-c-tit a"), "Quem vai na final presencial?");
  assert.strictEqual(await pagina.textContent(".th-tabela tbody tr:first-child .th-c-num"), "1");
  await captura(pagina, "lista-1440");

  // O perfil do Bruno mostra o comentario com o titulo da thread.
  await vai(pagina, "#/u/bruno_teste");
  await pagina.waitForSelector(".perfil-item");
  assert.ok((await pagina.textContent(".perfil-item")).includes("Quem vai na final presencial?"));
  assert.ok((await pagina.getAttribute(".perfil-item header a", "href")).startsWith(`#/threads/${idNova}?c=`));

  // Alice recebe o aviso e cai no comentario destacado.
  await comoUsuario(pagina, "alice@teste.univlr", "senha-da-alice");
  await pagina.evaluate(() => window.Auth.abrir("avisos"));
  await pagina.waitForSelector(".auth-avisos a");
  assert.strictEqual((await pagina.textContent(".auth-avisos a")).trim(), "Comentaram na sua thread");
  await pagina.click(".auth-avisos a");
  await pagina.waitForSelector("[data-comentarios] .cmt.destacado");
  assert.ok((await pagina.evaluate(() => location.hash)).startsWith(`#/threads/${idNova}?c=`));

  // Alice apaga: sai da lista e do painel; o link antigo diz que foi apagada.
  await pagina.click("[data-th-apagar]");
  await pagina.waitForFunction(() => location.hash === "#/threads");
  await pagina.waitForSelector(".th-tabela tbody tr");
  assert.ok(!(await pagina.textContent(".th-tabela")).includes("Quem vai na final presencial?"));
  await vai(pagina, "#/home");
  await pagina.waitForSelector(".th-painel");
  assert.ok(!(await pagina.textContent(".th-painel")).includes("Quem vai na final presencial?"));
  await vai(pagina, `#/threads/${idNova}`);
  await pagina.waitForSelector(".th-aviso h1");
  assert.strictEqual(await pagina.textContent(".th-aviso h1"), "Thread apagada");
  assert.strictEqual(await pagina.$("[data-comentarios]"), null, "thread apagada nao mostra conversa");

  assert.deepStrictEqual(erros, [], "sem erro de pagina");
  await contexto.close();
}

async function testePaginacao(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador, { fake: muitas });
  await pagina.goto(`${base}/#/threads`);
  await pagina.waitForSelector(".th-tabela tbody tr");
  assert.strictEqual(await pagina.$$eval(".th-tabela tbody tr", (l) => l.length), 50);
  assert.match(await pagina.textContent(".th-pagina .lista-contagem"), /60 threads/);
  await vai(pagina, "#/threads?pagina=2");
  await pagina.waitForFunction(() => document.querySelectorAll(".th-tabela tbody tr").length === 10);
  assert.deepStrictEqual(erros, []);
  await contexto.close();
}

async function testeCelular(navegador, base) {
  const { contexto, pagina, erros } = await novaPagina(navegador, { largura: 375, altura: 800 });
  await pagina.goto(`${base}/#/home`);
  // A home desenha primeiro pelo resumo e de novo quando o banco inteiro chega.
  await pagina.waitForLoadState("networkidle");
  await pagina.waitForSelector(".vp-trilho-esq .th-painel .th-linha");
  const ordem = await pagina.evaluate(() => {
    const y = (s) => document.querySelector(s).getBoundingClientRect().top;
    return y(".vp-s-ranking") < y(".th-painel") && y(".th-painel") < y(".vp-noticias, .vp-s-campeonatos");
  });
  assert.ok(ordem, "no celular o painel vem logo depois do ranking");
  await semEstouro(pagina, "home 375");
  await captura(pagina, "home-375");
  await vai(pagina, "#/threads");
  await pagina.waitForSelector(".th-compactas .th-linha");
  await semEstouro(pagina, "lista 375");
  await captura(pagina, "lista-375");
  await vai(pagina, "#/threads/aaaaaaaa-0000-4000-8000-000000000004");
  await pagina.waitForSelector(".th-cartao h1");
  await semEstouro(pagina, "thread 375");
  await captura(pagina, "thread-375");
  assert.deepStrictEqual(erros, []);
  await contexto.close();
}

(async () => {
  const { url, processo } = await servidor();
  const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    await testePrincipal(navegador, url);
    await testePaginacao(navegador, url);
    await testeCelular(navegador, url);
    console.log("test_threads_navegador: ok");
  } finally {
    await navegador.close();
    processo.kill();
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
