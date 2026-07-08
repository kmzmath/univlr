// Gera database.json pré-agregado a partir dos arquivos em campeonatos/.
//
// Uso: node scripts/build_database.js
//
// Rode este script sempre que adicionar/alterar partidas em campeonatos/,
// data-sources.json, metadata.json, team-profiles.json ou ranking-weights.json,
// e commite o database.json atualizado junto.
//
// O script executa o mesmo pipeline que o navegador executava (buildDatabase
// em app.js), depois remove o que só a página de detalhe da partida usa
// (roundResults, restaurado sob demanda via fetch do arquivo bruto) e o que
// nenhuma tela usa (observations do ranking, ranking aninhado dos snapshots).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "database.json");

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

function loadScript(relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  (0, eval)(source);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript("app.js");

const codec = require(path.join(ROOT, "db-codec.js"));

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function readJsonOptional(relPath) {
  try {
    return readJson(relPath);
  } catch (error) {
    return null;
  }
}

function main() {
  const startedAt = Date.now();
  const manifest = readJson("data-sources.json");
  const rawMetadata = readJson("metadata.json");
  const rawTeamProfiles = readJsonOptional("team-profiles.json");
  const rankingWeights = readJsonOptional("ranking-weights.json");

  const loaded = [];
  for (const event of manifest.events || []) {
    for (const filePath of event.files || []) {
      try {
        loaded.push({ eventId: event.id, path: filePath, raw: readJson(filePath) });
      } catch (error) {
        loaded.push({ eventId: event.id, path: filePath, error });
      }
    }
  }

  const metadata = prepareMetadata(rawMetadata);
  const teamProfiles = prepareTeamProfiles(rawTeamProfiles);
  const db = buildDatabase(manifest.events, loaded, metadata, teamProfiles, rankingWeights);

  // Poda: roundResults fica de fora do payload e é restaurado sob demanda na
  // página da partida (detailPending sinaliza o carregamento preguiçoso).
  let strippedMatches = 0;
  for (const match of db.matches) {
    if (match.roundResults && match.roundResults.length) {
      match.roundResults = [];
      match.detailPending = true;
      strippedMatches += 1;
    }
  }
  delete db.ranking.observations;
  for (const snapshot of db.rankingSnapshots || []) {
    delete snapshot.ranking;
  }

  const payload = codec.encode(db);
  const json = JSON.stringify(payload);
  fs.writeFileSync(OUTPUT, json);

  // Round-trip: garante que o que o navegador vai decodificar bate com o build.
  const decoded = codec.decode(JSON.parse(json));
  const checks = [
    ["partidas", decoded.matches.length === db.matches.length],
    ["séries", decoded.matchSeries.length === db.matchSeries.length],
    ["times", decoded.teams.length === db.teams.length],
    ["ranking", decoded.ranking.teams.length === db.ranking.teams.length],
    [
      "nota do líder",
      Number(decoded.ranking.teams[0]?.score ?? NaN) === Number(db.ranking.teams[0]?.score ?? NaN),
    ],
    [
      "identidade team.ranking",
      decoded.teams[0]?.ranking === decoded.ranking.byTeamId?.[decoded.teams[0]?.id],
    ],
  ];
  const failures = checks.filter(([, ok]) => !ok);

  const gzipBytes = zlib.gzipSync(json).length;
  const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
  console.log(`database.json gerado em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`  arquivos lidos: ${loaded.length} (falhas: ${db.failedFiles.length}, duplicados: ${db.duplicateFiles.length})`);
  console.log(`  partidas: ${db.matches.length} (roundResults podados: ${strippedMatches})`);
  console.log(`  times: ${db.teams.length} | jogadores: ${db.players.length} | snapshots de ranking: ${db.rankingSnapshots.length}`);
  console.log(`  tamanho: ${mb(json.length)} bruto | ${mb(gzipBytes)} gzip | nós: ${payload.nodes.length}`);
  if (payload.droppedFunctions > 0) {
    console.warn(`  aviso: ${payload.droppedFunctions} funções descartadas na serialização`);
  }
  if (failures.length) {
    for (const [name] of failures) console.error(`  ERRO: round-trip falhou em "${name}"`);
    process.exitCode = 1;
  } else {
    console.log("  round-trip de decodificação: ok");
  }
}

main();
