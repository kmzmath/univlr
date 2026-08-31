// Reescreve o campo `bracket` dos campeonatos no database.json JA COMMITADO a
// partir do TOURNAMENT_OVERRIDES do app.js, sem refazer o build completo.
//
// Uso: node scripts/apply_tournament_brackets.js [id-do-evento ...]
//      (sem argumento, sincroniza todo evento cujo override define bracket)
//
// Por que existe: o chaveamento e dado curado que mora no app.js, mas
// `aggregateEvents()` o congela dentro do database.json no build. Como
// `build_database.js` nao reproduz o artefato commitado (ver
// scripts/prune_database_fields.js), roda-lo so para corrigir uma chave
// misturaria a mudanca com um diff que ninguem consegue revisar. Este script
// parte do proprio database.json e troca so o `bracket` dos eventos pedidos -
// o resto do grafo passa intacto pelo codec.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "database.json");
const codec = require(path.join(ROOT, "db-codec.js"));

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

// app.js e script de navegador: roda num contexto com o DOM esboçado, mesmo
// padrao dos testes em scripts/test_*.js.
function readOverrides() {
  const noop = () => {};
  const stub = {
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
    console, Date, Intl, JSON, Map, Math, Number, Promise, Set, String,
    clearInterval: noop, clearTimeout: noop, setInterval: () => 0, setTimeout: () => 0,
  };
  context.globalThis = context;
  context.window = context;
  context.document = {
    title: "",
    getElementById: () => stub,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ ...stub }),
    addEventListener: noop,
    removeEventListener: noop,
    body: stub,
    documentElement: stub,
  };
  context.location = { hash: "" };
  context.history = { pushState: noop, replaceState: noop };
  context.requestAnimationFrame = () => 0;
  context.fetch = () => new Promise(noop);
  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(path.join(ROOT, "app.js"), "utf8")}\n;globalThis.__overrides = TOURNAMENT_OVERRIDES;`,
    context,
  );
  return context.__overrides;
}

function contarPartidas(bracket) {
  return (bracket?.regions || []).reduce(
    (total, region) => total + (region.columns || []).reduce((soma, column) => soma + (column.matches || []).length, 0),
    0,
  );
}

function main() {
  const pedidos = process.argv.slice(2);
  const overrides = readOverrides();
  const antes = fs.readFileSync(FILE, "utf8");
  const db = codec.decode(JSON.parse(antes));

  const controle = {
    partidas: db.matches.length,
    series: db.matchSeries.length,
    times: db.teams.length,
    jogadores: db.players.length,
    campeonatos: db.tournaments.length,
    notaLider: db.ranking.teams[0]?.score,
    ratingExemplo: db.matches[0]?.players[0]?.rating,
    snapshots: db.rankingSnapshots.length,
  };

  const alvos = db.tournaments.filter((tournament) => {
    if (pedidos.length && !pedidos.includes(tournament.id)) return false;
    return Boolean(overrides[tournament.id]?.bracket);
  });
  const faltando = pedidos.filter((id) => !alvos.some((tournament) => tournament.id === id));
  if (faltando.length) {
    console.error(`ABORTADO - sem bracket no override (ou evento inexistente): ${faltando.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const trocados = [];
  for (const tournament of alvos) {
    const novo = structuredClone(overrides[tournament.id].bracket);
    const igual = JSON.stringify(tournament.bracket) === JSON.stringify(novo);
    if (igual) continue;
    trocados.push({
      id: tournament.id,
      de: contarPartidas(tournament.bracket),
      para: contarPartidas(novo),
      regioesDe: (tournament.bracket?.regions || []).length,
      regioesPara: (novo.regions || []).length,
    });
    tournament.bracket = novo;
  }

  if (!trocados.length) {
    console.log("nada a fazer: os brackets do artefato ja batem com o override");
    return;
  }

  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));

  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["series", lido.matchSeries.length === controle.series],
    ["times", lido.teams.length === controle.times],
    ["jogadores", lido.players.length === controle.jogadores],
    ["campeonatos", lido.tournaments.length === controle.campeonatos],
    ["snapshots", lido.rankingSnapshots.length === controle.snapshots],
    ["nota do lider", lido.ranking.teams[0]?.score === controle.notaLider],
    ["rAAting preservado", lido.matches[0]?.players[0]?.rating === controle.ratingExemplo],
    ["identidade team.ranking", lido.teams[0]?.ranking === lido.ranking.byTeamId?.[lido.teams[0]?.id]],
    ["bracket bate com o override", trocados.every(({ id }) => {
      const tournament = lido.tournaments.find((item) => item.id === id);
      return JSON.stringify(tournament.bracket) === JSON.stringify(overrides[id].bracket);
    })],
    ["nenhum outro campeonato mexeu", lido.tournaments.every((tournament) => {
      if (trocados.some(({ id }) => id === tournament.id)) return true;
      const original = db.tournaments.find((item) => item.id === tournament.id);
      return JSON.stringify(tournament) === JSON.stringify(original);
    })],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO - verificacao falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(FILE, depois);
  for (const { id, de, para, regioesDe, regioesPara } of trocados) {
    console.log(`${id}: ${regioesDe} -> ${regioesPara} regioes, ${de} -> ${para} partidas`);
  }
  console.log(`cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(
    `gzip: ${mb(zlib.gzipSync(Buffer.from(antes)).length)} -> ${mb(zlib.gzipSync(Buffer.from(depois)).length)}`,
  );
  for (const [nome] of checks) console.log(`  ok ${nome}`);
}

main();
