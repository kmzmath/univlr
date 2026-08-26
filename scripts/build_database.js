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

  // Poda 2: campos que o raating-core produz e ninguém consome. Seis deles são
  // o mesmo número em duas convenções de nome (damage_rating/DamageRating), e
  // o resto são intermediários do cálculo que já virou `rating`. Conferido um
  // a um contra app.js, raating-core.js e ranking-core.js, inclusive contra o
  // acesso dinâmico por RAATING_AGGREGATE_FIELDS — nenhum aparece lá.
  // São ~100 mil instâncias: 3,2 MB crus, 0,7 MB no gzip.
  const DEAD_PLAYER_FIELDS = [
    "ekpr", "edpr", "eadr", "ekast",
    "adjusted_swing_percent", "rating_3_like_unadjusted", "rating_recon_proxy", "rating_3_like",
    "damage_rating", "multi_kill_rating", "kill_rating", "round_swing_rating",
    "survival_rating", "kast_rating", "mk_per_r",
  ];
  let strippedFields = 0;
  const stripDead = (player) => {
    if (!player) return;
    for (const field of DEAD_PLAYER_FIELDS) {
      if (field in player) {
        delete player[field];
        strippedFields += 1;
      }
    }
  };
  for (const match of db.matches) for (const player of match.players || []) stripDead(player);
  for (const player of db.players || []) stripDead(player);

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
      "snapshot semanal atual",
      Number(decoded.rankingSnapshots[0]?.cutoffAt ?? NaN) === Number(rankingTuesdayStartOnOrBefore(Date.now())),
    ],
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
  console.log(`  campos mortos removidos: ${strippedFields}`);
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
