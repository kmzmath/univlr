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

// ---------- tabela de chance com spike, medida nas partidas ----------
const kill = (killer, victim, t) => ({ killer, victim, timeSinceRoundStartMillis: t });
const jogadores = [{ puuid: "a1", teamId: "Blue" }, { puuid: "a2", teamId: "Blue" }, { puuid: "d1", teamId: "Red" }, { puuid: "d2", teamId: "Red" }];
const semAbates = (...ids) => ids.map((puuid) => ({ puuid, kills: [] }));
{
  const partida = {
    matchInfo: { matchId: "teste-spike" },
    players: jogadores,
    roundResults: [
      // Blue ataca e vence: plantio de a1 em 20000; a1 mata d1 em 25000 e d2 em 30000
      { winningTeam: "Blue", winningTeamRole: "Attacker", roundResult: "Eliminated", bombPlanter: "a1", plantRoundTime: 20000,
        playerStats: [{ puuid: "a1", kills: [kill("a1", "d1", 25000), kill("a1", "d2", 30000)] }, ...semAbates("a2", "d1", "d2")] },
      // Red vence na defesa, sem plantio: d1 mata a1 em 10000 e a2 em 12000
      { winningTeam: "Red", winningTeamRole: "Defender", roundResult: "Eliminated",
        playerStats: [{ puuid: "d1", kills: [kill("d1", "a1", 10000), kill("d1", "a2", 12000)] }, ...semAbates("a1", "a2", "d2")] },
    ],
  };
  const t = JSON.parse(JSON.stringify(ctx.measureSpikeTable([{ raw: partida }])));
  assert.deepEqual(t, { "1v2": { n: 1, p: 0 }, "2v1b": { n: 1, p: 1 }, "2v2": { n: 2, p: 0.5 }, "2v2b": { n: 1, p: 1 } });
  assert.deepEqual(Object.keys(t), ["1v2", "2v1b", "2v2", "2v2b"], "celulas em ordem alfabetica");
  const contexto = ctx.buildRaatingContext([{ raw: partida }]);
  assert.equal(contexto.ratingVersion, "raa3.1");
  assert.deepEqual(JSON.parse(JSON.stringify(contexto.spikeTable)), t, "o contexto leva a tabela");
  assert.equal(contexto.centro, null, "a media do grupo vem depois, no buildDatabase");
}
{
  const meta = { stateWinratesByKey: new Map([["1v1", 0.5]]), raatingContext: { spikeTable: { "1v1b": { n: 500, p: 0.6 } } } };
  assert.equal(ctx.attackWinChance(meta, 1, 1, true), 0.6, "celula com spike");
  assert.equal(ctx.attackWinChance(meta, 1, 1, false), 0.5, "celula ausente cai na tabela simetrica");
  assert.equal(ctx.attackWinChance(meta, 0, 1, false), 0, "ataque sem vivos e sem spike perde");
  assert.equal(ctx.attackWinChance(meta, 2, 0, true), 1, "defesa sem vivos perde");
}

// ---------- swing do rAAting 3.1 ----------
// Blue = a1, a2 (ataque quando Blue e Attacker); Red = d1, d2. Valores em pontos percentuais.
const SPIKE = {
  "2v2": { n: 1, p: 0.5 }, "2v1": { n: 1, p: 0.8 }, "1v2": { n: 1, p: 0.2 }, "1v1": { n: 1, p: 0.5 },
  "2v2b": { n: 1, p: 0.7 }, "2v1b": { n: 1, p: 0.9 }, "1v2b": { n: 1, p: 0.5 }, "1v1b": { n: 1, p: 0.6 }, "0v2b": { n: 1, p: 0.3 }, "0v1b": { n: 1, p: 0.4 },
};
const SIMETRICA = new Map([["2v2", 0.5], ["2v1", 0.75], ["1v2", 0.25], ["1v1", 0.5]]);
function rodada({ round, eventos, dano = {}, spike = SPIKE }) {
  const meta = { stateWinratesByKey: SIMETRICA, raatingContext: { spikeTable: spike } };
  const ids = ["a1", "a2", "d1", "d2"];
  const stats = statsDe(...ids);
  const lados = new Map([["a1", "Blue"], ["a2", "Blue"], ["d1", "Red"], ["d2", "Red"]]);
  const danoPorVitima = new Map(Object.entries(dano).map(([vitima, porAtacante]) => [vitima, new Map(Object.entries(porAtacante))]));
  const events = eventos.map(([time, killer, victim]) => ({ time, killer, victim, assistants: [] }));
  ctx.applyRoundSwingStats(events, new Set(ids), round, stats, lados, { Blue: new Set(["a1", "a2"]), Red: new Set(["d1", "d2"]) }, meta, danoPorVitima);
  const campo = (nome) => Object.fromEntries(ids.map((id) => [id, stats.get(id)[nome]]));
  return { swing: campo("adjustedRoundSwingTotalPp"), impacto: campo("impactTotal"), legado: campo("impactTotalLegacy") };
}
const confere = (obtido, esperado, rotulo) => {
  for (const [id, valor] of Object.entries(esperado)) approx(obtido[id], valor, 1e-9, `${rotulo}: ${id}`);
};
const confereSwing = (r, esperado, rotulo) => {
  confere(r.swing, esperado, rotulo);
  confere(r.impacto, r.swing, `${rotulo} (impactTotal = swing)`);
  for (const valor of Object.values(r.swing)) assert(Number.isFinite(valor), `${rotulo}: swing finito`);
  approx(Object.values(r.swing).reduce((soma, valor) => soma + valor, 0), 0, 1e-9, `${rotulo}: o round soma zero`);
};
const ataqueVence = { winningTeam: "Blue", winningTeamRole: "Attacker", roundResult: "Round timer expired" };
const defesaVence = { winningTeam: "Red", winningTeamRole: "Defender", roundResult: "Round timer expired" };
const plantioA1 = { bombPlanter: "a1", plantRoundTime: 20000 };

confereSwing(rodada({ round: ataqueVence, eventos: [[10000, "a1", "d1"]], dano: { d1: { a1: 60, a2: 40 } } }), { a1: 28, a2: 22, d1: -30, d2: -20 }, "dano 60/40");
confereSwing(rodada({ round: ataqueVence, eventos: [[10000, "a1", "d1"]] }), { a1: 40, a2: 10, d1: -30, d2: -20 }, "sem dano");
confereSwing(rodada({ round: ataqueVence, eventos: [[10000, "a1", "d1"]], dano: { d1: { a2: 100 } } }), { a1: 10, a2: 40, d1: -30, d2: -20 }, "so outro deu dano");
{
  const r = rodada({ round: { ...ataqueVence, roundResult: "Bomb detonated", ...plantioA1 }, eventos: [[25000, "a1", "d1"], [65000, "d2", "d2"]], dano: { d1: { a1: 100 } } });
  confereSwing(r, { a1: 35, a2: 15, d1: -30, d2: -20 }, "plantio e explosao");
  confere(r.legado, { a1: 25, a2: 0, d1: -25, d2: 0 }, "plantio e explosao, legado");
}
{
  const r = rodada({ round: { ...defesaVence, roundResult: "Bomb defused", ...plantioA1, bombDefuser: "d2", defuseRoundTime: 40000 }, eventos: [[30000, "d1", "a1"], [41000, "d2", "a2"]], dano: { a1: { d1: 100 } } });
  confereSwing(r, { a1: -10, a2: -40, d1: 35, d2: 15 }, "desarme");
  confere(r.legado, { a1: -25, a2: -25, d1: 25, d2: 25 }, "desarme, legado conta o abate depois do desarme");
}
confereSwing(rodada({ round: { ...ataqueVence, roundResult: "Eliminated" }, eventos: [[10000, "a1", "d1"], [12000, "a1", "d2"], [13000, "", "a2"]], dano: { d1: { a1: 100 }, d2: { a1: 100 } } }), { a1: 50, a2: 0, d1: -30, d2: -20 }, "eliminacao");
confereSwing(rodada({ round: { ...defesaVence, roundResult: "Bomb defused", ...plantioA1, bombDefuser: "d2", defuseRoundTime: 40000 }, eventos: [[25000, "d1", "a1"], [26000, "d1", "a2"]], dano: { a1: { d1: 100 }, a2: { d1: 100 } } }), { a1: -25, a2: -25, d1: 45, d2: 5 }, "ataque morto com spike");
confereSwing(rodada({ round: defesaVence, eventos: [[10000, "a2", "a1"]] }), { a1: 0, a2: -50, d1: 25, d2: 25 }, "abate em aliado");
confereSwing(rodada({ round: defesaVence, eventos: [[10000, "a1", "a1"]] }), { a1: -30, a2: -20, d1: 25, d2: 25 }, "suicidio");
{
  const semCelula = { ...SPIKE };
  delete semCelula["2v1"];
  confereSwing(rodada({ round: ataqueVence, eventos: [[10000, "a1", "d1"]], dano: { d1: { a1: 60, a2: 40 } }, spike: semCelula }), { a1: 27.5, a2: 22.5, d1: -25, d2: -25 }, "celula ausente");
}
confereSwing(rodada({ round: { winningTeam: "Blue", roundResult: "Round timer expired" }, eventos: [[10000, "a1", "d1"]], dano: { d1: { a1: 60, a2: 40 } } }), { a1: 27.5, a2: 22.5, d1: -25, d2: -25 }, "lado desconhecido");

console.log("rAAting 3.1 no round: testes passaram");
