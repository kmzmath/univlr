// Leva plants, retakes, sites e pistol por lado para o `teamStats` de cada mapa
// do database.json JA COMMITADO.
//
// Uso: node scripts/apply_plant_stats.js
//
// Por que existe: o banco nao carrega roundResults (a poda do build tira), entao
// o cartao de mapa de #/matches precisa desses totais prontos para reagir aos
// filtros sem baixar um arquivo por mapa. O rebuild completo tambem os gera, mas
// recalcula o ranking, que depende de Date.now(). Este script mexe SO nos campos
// novos do teamStats e passa o resto do grafo intacto pelo codec.
//
// A conta e a do proprio site: chama calculateMatchTeamStats do app.js sobre o
// arquivo bruto. E usa isso de controle: os campos antigos recalculados precisam
// bater com o que esta no banco, senao aborta sem gravar nada.
//
// Mesmo contrato dos outros scripts que mantem artefato commitado: roda duas
// vezes sem mudar um byte e aborta quando a verificacao falha.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const CAMPOS_NOVOS = ["plants", "plantWins", "plantsAgainst", "retakes", "plantA", "plantB", "plantC", "pistolAttackWins", "pistolAttackRounds"];
const CAMPOS_DE_CONTROLE = ["roundWins", "attackWins", "attackRounds", "defenseWins", "defenseRounds", "pistolWins", "pistolRounds"];

// app.js referencia DOM e fetch no topo do arquivo: mesmos stubs do build.
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
globalThis.fetch = () => new Promise(noop);

for (const arquivo of ["raating-core.js", "ranking-core.js", "app.js"]) {
  (0, eval)(fs.readFileSync(path.join(ROOT, arquivo), "utf8"));
}

const codec = require(path.join(ROOT, "db-codec.js"));
const { writeFileWithRetry } = require("./write_with_retry.js");

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

function aplica(db) {
  const totais = { mapas: 0, plants: 0, retakes: 0, divergentes: [], semArquivo: [] };
  const vistos = new Set();
  const trata = (match) => {
    if (vistos.has(match)) return;
    vistos.add(match);
    const arquivo = path.join(ROOT, match.sourcePath || "");
    if (!match.sourcePath || !fs.existsSync(arquivo)) {
      totais.semArquivo.push(match.id);
      return;
    }
    const raw = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const donos = new Map((match.players || []).map((player) => [player.puuid, player.teamId]));
    const rounds = typeof officialRoundResults === "function" ? officialRoundResults(raw) : raw.roundResults || [];
    const novo = calculateMatchTeamStats(rounds, match.teamA, match.teamB, donos);
    for (const [teamId, linha] of Object.entries(novo)) {
      const atual = match.teamStats?.[teamId];
      if (!atual || CAMPOS_DE_CONTROLE.some((campo) => atual[campo] !== linha[campo])) {
        totais.divergentes.push(`${match.id} ${teamId}`);
        continue;
      }
      for (const campo of CAMPOS_NOVOS) atual[campo] = linha[campo];
      totais.plants += linha.plants;
      totais.retakes += linha.retakes;
    }
    totais.mapas += 1;
  };
  db.matches.forEach(trata);
  // A serie guarda os mesmos mapas; quem nao vier como referencia compartilhada
  // tambem precisa dos campos.
  (db.matchSeries || []).forEach((series) => (series.maps || []).forEach(trata));
  return totais;
}

function main() {
  const antes = fs.readFileSync(DB, "utf8");
  const db = codec.decode(JSON.parse(antes));
  const controle = {
    partidas: db.matches.length,
    series: (db.matchSeries || []).length,
    pontos: db.teams.map((t) => `${t.id}:${t.points}`).join("|"),
    lider: db.ranking.teams[0]?.id,
  };
  const totais = aplica(db);
  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));
  const todosComCampo = lido.matches.every((m) => Object.values(m.teamStats || {}).every((t) => CAMPOS_NOVOS.every((c) => Number.isFinite(t[c]))));
  const seriesComCampo = (lido.matchSeries || []).every((s) => (s.maps || []).every((m) => Object.values(m.teamStats || {}).every((t) => Number.isFinite(t.plants))));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["series", (lido.matchSeries || []).length === controle.series],
    ["o ranking NAO mexeu", lido.teams.map((t) => `${t.id}:${t.points}`).join("|") === controle.pontos],
    ["lider do ranking", lido.ranking.teams[0]?.id === controle.lider],
    ["campos antigos batem com o banco", totais.divergentes.length === 0],
    ["todo mapa tem arquivo", totais.semArquivo.length === 0],
    ["todo mapa tem os campos novos", todosComCampo],
    ["as series tambem tem", seriesComCampo],
  ];
  console.log(`mapas: ${totais.mapas} | plants: ${totais.plants} | retakes: ${totais.retakes}`);
  console.log(`cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(`gzip: ${mb(zlib.gzipSync(antes).length)} -> ${mb(zlib.gzipSync(depois).length)}`);
  let ok = true;
  for (const [nome, passou] of checks) {
    console.log(`  ${passou ? "ok" : "XX"} ${nome}`);
    if (!passou) ok = false;
  }
  if (totais.divergentes.length) console.error(`divergentes: ${totais.divergentes.slice(0, 10).join(", ")}`);
  if (!ok) {
    console.error("ABORTADO - nada foi gravado.");
    process.exitCode = 1;
    return;
  }
  if (depois === antes) {
    console.log("nada a gravar: o banco ja estava assim.");
  } else {
    writeFileWithRetry(DB, depois);
    console.log("database.json gravado.");
  }
  // init() do app.js deixa o fetch pendente para sempre; sem isto o Node nao sai.
  process.exit(0);
}

main();
