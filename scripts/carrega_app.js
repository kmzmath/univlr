// Carrega raating-core.js, ranking-core.js e app.js no global do Node, como o
// navegador faz, para os scripts do build usarem as mesmas funcoes do site
// (parseFileName, buildDatabase...) em vez de manter copias que divergem.
//
// Uso: require("./carrega_app.js"); depois as funcoes do app.js estao no global.
// So as declaracoes `function` ficam visiveis; os `const` do app.js nao.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// --- Stubs de navegador: app.js referencia DOM/fetch no topo do arquivo ---
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
globalThis.window = globalThis;
globalThis.document = {
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
globalThis.location = { hash: "" };
globalThis.history = { pushState: noop, replaceState: noop };
globalThis.requestAnimationFrame = () => 0;
// init() do app.js dispara sozinho; com fetch pendente para sempre ele para
// na primeira await sem efeitos colaterais, e o build chama o pipeline direto.
globalThis.fetch = () => new Promise(noop);

for (const arquivo of ["raating-core.js", "ranking-core.js", "app.js"]) {
  (0, eval)(fs.readFileSync(path.join(ROOT, arquivo), "utf8"));
}
