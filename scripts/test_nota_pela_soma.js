// Nota de um jogador num campeonato = a da SOMA (16/11/2026, pedido do dono).
// Sem os limites do rAAting (ver raating-core.js), a formula e linear nas taxas
// por round, entao a media das notas de cada mapa pesada pelos rounds e a nota
// da soma de todos os campos sao a MESMA conta. O perfil (eventStats), o elenco
// do campeonato e o bloco de elenco das noticias fazem a media por round e, por
// isso, ja dao a nota da soma. Este teste trava isso: se um corte voltar ao
// rAAting, as duas convencoes se separam de novo (kzr no JUBS presencial dava
// 1,42 pela soma e 1,29 pela media) e ele falha.
// Uso: node scripts/test_nota_pela_soma.js [caminho do raating-core.js]
const assert = require("assert");
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
const context = {
  console, Date, Intl, JSON, Map, Math, Number, Promise, Set, String, URLSearchParams,
  clearInterval: noop, clearTimeout: noop, setInterval: () => 0, setTimeout: () => 0,
};
context.globalThis = context;
context.window = context;
context.document = {
  title: "", body: stub, documentElement: stub,
  getElementById: () => ({ ...stub }), querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ ...stub }),
  addEventListener: noop, removeEventListener: noop,
};
context.location = { hash: "" };
context.history = { pushState: noop, replaceState: noop };
context.requestAnimationFrame = () => 0;
context.fetch = () => new Promise(noop);
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[2] || path.join(raiz, "raating-core.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(raiz, "app.js"), "utf8"), context);
const Core = context.RaaRatingCore;
const perto = (a, b, rotulo) => assert(Math.abs(a - b) < 1e-9, `${rotulo}: ${a} != ${b}`);

// rAAting 3.1: a nota mede a distancia ate a media do grupo, que o build grava no
// banco. Aqui, uma media qualquer de duas linhas tipicas; a linearidade nao depende dela.
Core.setGroupCenter(Core.groupCenter([
  { rounds: 20, eKillPoints: 15, eDeathPoints: 14, eDamageTotal: 2200, eKastPoints: 14, adjustedRoundSwingTotalPp: 0, multiKillPoints: 4 },
  { rounds: 22, eKillPoints: 14, eDeathPoints: 16, eDamageTotal: 2300, eKastPoints: 15, adjustedRoundSwingTotalPp: -10, multiKillPoints: 5 },
]));
// Um mapa de jogador com os campos que o banco guarda; a nota do mapa e a do nucleo.
const mapa = (id, kills, deaths, rounds, extra = {}) => {
  const linha = {
    id: "p1", nick: "Um", teamId: "t1", teamColor: "Blue", agent: "Jett", agentSlug: "jett", agentClass: "Duelist",
    rounds, kills, deaths, assists: 3, score: kills * 230 + rounds * 20, damage: kills * 140,
    firstKills: Math.round(kills / 6), firstDeaths: Math.round(deaths / 6), kastRounds: Math.round(rounds * 0.7), impactTotal: (kills - deaths) * 3,
    eKillPoints: kills, eDeathPoints: deaths, eDamageTotal: kills * 140, eKastPoints: Math.round(rounds * 0.7),
    adjustedRoundSwingTotalPp: (kills - deaths) * 3, multiKillPoints: kills / 4,
    headshots: kills, bodyshots: kills * 3, legshots: 1, ...extra,
  };
  const nota = Core.calculateRaating3(linha).raating_3;
  return { ...linha, mapId: id, raating_3: nota, rating: nota, acs: linha.score / rounds };
};
// Dois mapas bem diferentes, um deles muito acima da mediana.
const forte = mapa("m1", 30, 8, 16);
const fraco = mapa("m2", 9, 19, 24);
const somaDosCampos = Object.fromEntries(Object.keys(forte).filter((k) => typeof forte[k] === "number").map((k) => [k, forte[k] + fraco[k]]));
const daSoma = Core.calculateRaating3(somaDosCampos).raating_3;
const media = (forte.raating_3 * forte.rounds + fraco.raating_3 * fraco.rounds) / (forte.rounds + fraco.rounds);
perto(media, daSoma, "media das notas pesada pelos rounds = nota da soma");

// Perfil: a nota por campeonato (eventStats) que o build grava.
const partida = (id, eventId, jogador) => ({ id, eventId, mapName: "Bind", teamA: { id: "t1", color: "Blue" }, teamB: { id: "t2", color: "Red" }, players: [jogador] });
const [jogador] = context.aggregatePlayers([partida("m1", "e1", forte), partida("m2", "e1", fraco), partida("m3", "e2", forte)], [], { players: [] });
const e1 = jogador.eventStats.find((linha) => linha.eventId === "e1");
perto(e1.rating, daSoma, "eventStats e a nota da soma");
assert.strictEqual(e1.matches, 2, "eventStats conta os mapas");
perto(e1.acs, (forte.score + fraco.score) / (forte.rounds + fraco.rounds), "eventStats ACS pelos rounds somados");

// Elenco da equipe na pagina do campeonato.
const [doElenco] = context.tournamentLineupRows("t1", [{ maps: [{ players: [forte] }, { players: [fraco] }] }]);
perto(doElenco.rating, daSoma, "elenco do campeonato e a nota da soma");

console.log("Nota por campeonato = nota da soma: testes passaram");
