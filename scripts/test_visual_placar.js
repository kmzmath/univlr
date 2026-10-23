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
context.document = {
  title: "",
  getElementById: () => stubElement,
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
const linkPlacar = html.indexOf('<link rel="stylesheet" href="placar.css?v=1" />');
assert(linkPlacar > -1, "index.html liga o placar.css");
assert(linkPlacar > linkBase, "o placar.css vem depois do styles.css, para vencer na cascata");
assert(fs.existsSync(path.join(raiz, "placar.css")), "placar.css existe");
assert(/^\/\* Visual "Placar"/.test(ler("placar.css")), "placar.css comeca pelo comentario que explica a camada");

void vp;
console.log("Visual Placar contract tests passed");
