// Contrato do visual "Placar" (docs/superpowers/specs/2026-10-23-identidade-placar-design.md).
// Carrega o app.js num contexto vm com o DOM em stub, do mesmo jeito que o
// test_qualifier_bracket.js, e testa o HTML que as funcoes de desenho devolvem.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), "utf8");

const noop = () => {};
const stubElement = {
  innerHTML: "",
  value: "",
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {},
  dataset: {},
  setAttribute: noop,
  appendChild: noop,
  focus: noop,
};
const context = {
  console,
  Date,
  Intl,
  JSON,
  Map,
  Math,
  Number,
  Promise,
  Set,
  String,
  clearInterval: noop,
  clearTimeout: noop,
  setInterval: () => 0,
  setTimeout: () => 0,
};
context.globalThis = context;
context.window = context;
// O #app tem elemento proprio: com um so stub para tudo, a busca (que tambem
// pega o seu elemento por id) apagava o HTML que o Shell acabou de escrever.
const appElement = { ...stubElement };
context.document = {
  title: "",
  getElementById: (id) => (id === "app" ? appElement : stubElement),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...stubElement }),
  addEventListener: noop,
  removeEventListener: noop,
  body: stubElement,
  documentElement: stubElement,
};
context.location = { hash: "" };
context.history = { pushState: noop, replaceState: noop };
context.requestAnimationFrame = () => 0;
context.fetch = () => new Promise(noop);

vm.createContext(context);
vm.runInContext(`${ler("app.js")}\n;globalThis.__vp = {};`, context);
const vp = context.__vp;

// ---------------------------------------------------------------- Tarefa 1
const html = ler("index.html");
const linkBase = html.indexOf('href="styles.css?v=300"');
// Qualquer versao: o ?v= sobe a cada mudanca para furar o cache do navegador.
const linkPlacar = html.search(/<link rel="stylesheet" href="placar\.css\?v=\d+" \/>/);
assert(linkPlacar > -1, "index.html liga o placar.css");
assert(linkPlacar > linkBase, "o placar.css vem depois do styles.css, para vencer na cascata");
assert(fs.existsSync(path.join(raiz, "placar.css")), "placar.css existe");
assert(/^\/\* Visual "Placar"/.test(ler("placar.css")), "placar.css comeca pelo comentario que explica a camada");

// ---------------------------------------------------------------- Tarefa 2
// Titulo de secao: Condensed grande, sem traco vermelho, contexto e link na
// mesma linha. As duas funcoes de titulo devolvem a mesma peca.
const titulo = context.sectionHead("Elenco atual", "Texto", "teams/x/roster", "Ver reservas");
assert(titulo.includes('class="vp-sec"'), "sectionHead devolve vp-sec");
assert(titulo.includes("<h2>Elenco atual</h2>"), "sectionHead mantem o h2");
assert(titulo.includes('class="vp-sec-aside">Texto<'), "a descricao vira o contexto curto ao lado");
assert(titulo.includes('href="#/teams/x/roster"') && titulo.includes('class="vp-sec-more"'), "o link vai na ponta direita");
assert(!context.sectionHead("Elenco atual").includes("vp-sec-aside"), "sem descricao, sem contexto vazio");
assert(context.panelTitle("Ranking").includes('class="vp-sec"'), "panelTitle devolve a mesma peca");
assert(context.panelTitle("Ranking", "ranking", "Ver tudo").includes('href="#/ranking"'), "panelTitle mantem o link");

// Rodape numa linha so, com a frase e os quatro links.
context.Shell("<p>conteudo</p>");
assert(appElement.innerHTML.includes("Estatísticas do cenário universitário brasileiro de VALORANT."), "rodape tem a frase");
assert(/class="vp-rodape-links"[\s\S]*#\/matches[\s\S]*#\/events[\s\S]*#\/ranking[\s\S]*#\/news/.test(appElement.innerHTML), "rodape tem os quatro links");

void vp;
console.log("Visual Placar contract tests passed");
