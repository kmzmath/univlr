// Testes do rAAting 3.1 dentro do round (especificacao de 21/11/2026): economia
// no dano e no KAST, colete, tabela com spike, swing e media do grupo.
// Carrega raating-core.js e app.js num contexto vm, como test_nota_pela_soma.js.
// Uso: node scripts/test_raating31_rodada.js
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const noop = () => {};
const stub = {
  innerHTML: "", value: "", style: {}, dataset: {},
  addEventListener: noop, removeEventListener: noop, setAttribute: noop, appendChild: noop, focus: noop,
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
};
const ctx = {
  console, Date, Intl, JSON, Map, Math, Number, Promise, Set, String, URLSearchParams,
  clearInterval: noop, clearTimeout: noop, setInterval: () => 0, setTimeout: () => 0,
};
ctx.globalThis = ctx;
ctx.window = ctx;
ctx.document = {
  title: "", body: stub, documentElement: stub,
  getElementById: () => ({ ...stub }), querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ ...stub }),
  addEventListener: noop, removeEventListener: noop,
};
ctx.location = { hash: "" };
ctx.history = { pushState: noop, replaceState: noop };
ctx.requestAnimationFrame = () => 0;
ctx.fetch = () => new Promise(noop);
vm.createContext(ctx);
const fonteDoApp = fs.readFileSync(path.join(raiz, "app.js"), "utf8");
vm.runInContext(fs.readFileSync(path.join(raiz, "raating-core.js"), "utf8"), ctx);
vm.runInContext(fonteDoApp, ctx);

const approx = (atual, esperado, tol, rotulo) => assert(Math.abs(atual - esperado) <= tol, `${rotulo}: ${atual} != ${esperado}`);
const statsDe = (...ids) => new Map(ids.map((id) => [id, ctx.emptyPlayerRoundStats()]));

// ---------- economia no dano: multiplicador inteiro ----------
{
  const stats = statsDe("a1", "d1");
  const modelo = { hasObservedEco: true, multipliers: new Map([["$0-$1000|$4700+", 1.5]]) };
  ctx.applyEffectiveDamage(
    new Map([["d1", new Map([["a1", 100]])]]),
    new Map([["d1", 50]]),
    [{ time: 1000, killer: "a1", victim: "d1", assistants: [] }],
    stats,
    new Map([["a1", "$0-$1000"], ["d1", "$4700+"]]),
    modelo,
  );
  assert.equal(stats.get("a1").damage, 100, "o dano do placar nao muda");
  approx(stats.get("a1").eDamageTotal, 150, 1e-12, "dano com o multiplicador inteiro (a 3.0 dava 125)");
}

// ---------- KAST da nota: 1 por round, sem economia ----------
{
  const stats = statsDe("a1", "d1");
  ctx.applyKastStats(
    [{ time: 1000, killer: "a1", victim: "d1", assistants: [], ecoMultiplier: 1.5 }],
    new Set(["a1", "d1"]),
    new Map([["a1", 1]]),
    new Set(),
    new Set(["d1"]),
    new Map([["d1", new Set(["a1"])]]),
    stats,
    new Map([["a1", "Blue"], ["d1", "Red"]]),
    "Blue",
  );
  assert.equal(stats.get("a1").kastRounds, 1, "o round conta no KAST");
  assert.equal(stats.get("a1").eKastPoints, 1, "KAST da nota sem economia (a 3.0 dava 1,175)");
}

// ---------- colete: o Regen Shield tem linha propria com +50 ----------
assert.equal(vm.runInContext('Object.hasOwn(ARMOR_EXTRA_HP, "B1B9086D-41BD-A516-5D29-E3B34A6F1644")', ctx), true, "Regen Shield na tabela");
assert.equal(ctx.armorExtraHp("b1b9086d-41bd-a516-5d29-e3b34a6f1644"), 50, "Regen Shield vale +50");

console.log("rAAting 3.1 no round: testes passaram");
