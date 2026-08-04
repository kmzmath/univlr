const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
vm.runInContext(`${appSource}\n;globalThis.__bracketTestApi = {
  overrides: TOURNAMENT_OVERRIDES,
  classifiedCards: tournamentClassifiedPlacementCards,
  columns: tournamentCuratedBracketColumns,
  regionHtml: tournamentCuratedBracketRegion,
};`, context);

const api = context.__bracketTestApi;

function bracketRegion(event, kind) {
  return event.bracket.regions.find((region) => String(region.className).includes(kind));
}

function classifiedIds(event, kind) {
  return Array.from(api.classifiedCards(event, bracketRegion(event, kind)), (card) => card.id);
}

const c1 = api.overrides["univava-classificatoria-1"];
const c2 = api.overrides["univava-classificatoria-2"];
assert.deepStrictEqual(classifiedIds(c1, "upper-bracket"), ["azure_bears_golden", "ceub_octopus"]);
assert.deepStrictEqual(classifiedIds(c1, "lower-bracket"), ["macklogic_red", "wolf_gaming"]);
assert.deepStrictEqual(classifiedIds(c2, "upper-bracket"), ["caap_hellhounds", "ufu_saints"]);
assert.deepStrictEqual(classifiedIds(c2, "lower-bracket"), ["ufmt_turuna", "axis_anteaters"]);

for (const event of [c1, c2]) {
  for (const kind of ["upper-bracket", "lower-bracket"]) {
    const html = api.regionHtml(event, bracketRegion(event, kind));
    const cards = html.match(/<article class="[^"]*qualified-card[\s\S]*?<\/article>/g) || [];
    assert.strictEqual(cards.length, 2);
    for (const card of cards) {
      assert(card.includes("Classificado"));
      assert(!/Partida|Vaga confirmada|✓/.test(card));
    }
  }
}

const futureEvent = {
  placements: [
    { range: "Classificado", id: "alpha", bracket: "upper" },
    { range: "Classificada", id: "beta", note: "Classificada pela chave superior" },
    { range: "Classificado", id: "swiss", note: "7-0" },
    { range: "Classificado", id: "ambiguous", note: "Chave superior e chave inferior" },
  ],
};
const futureUpper = {
  name: "Chave superior",
  columns: [{ title: "Últimos jogos", matches: [{ winner: "beta" }, { winner: "alpha" }] }],
};
assert.deepStrictEqual(Array.from(api.classifiedCards(futureEvent, futureUpper), (card) => card.id), ["beta", "alpha"]);

const withTerminal = Array.from(api.columns(futureEvent, futureUpper));
assert.strictEqual(withTerminal.at(-1).title, "Classificados");
assert.deepStrictEqual(Array.from(withTerminal.at(-1).terminalCards, (card) => card.id), ["beta", "alpha"]);

const explicit = api.columns(futureEvent, { ...futureUpper, terminalColumn: { cards: [{ id: "manual" }] } });
assert.deepStrictEqual(Array.from(explicit.at(-1).terminalCards, (card) => card.id), ["manual"]);
assert.strictEqual(api.columns(futureEvent, { ...futureUpper, terminalColumn: false }).length, 1);

console.log("Qualifier bracket tests passed");
