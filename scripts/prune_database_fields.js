// Aplica a poda de campos mortos ao database.json JÁ COMMITADO, sem refazer o
// build completo.
//
// Uso: node scripts/prune_database_fields.js
//
// Por que existe: `build_database.js` hoje não reproduz o artefato commitado
// (gera um arquivo maior, com índices de nó deslocados), então rodá-lo só para
// aplicar a poda misturaria a mudança com um diff que ninguém consegue revisar.
// Este script parte do próprio database.json, remove exatamente os campos da
// lista e regrava — o resto do grafo passa intacto pelo codec.
//
// A mesma lista vive em build_database.js, para as gerações futuras.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "database.json");
const codec = require(path.join(ROOT, "db-codec.js"));

// Nenhum destes é lido por app.js, raating-core.js ou ranking-core.js, nem
// aparece em RAATING_AGGREGATE_FIELDS (o único acesso dinâmico por nome).
const DEAD_PLAYER_FIELDS = [
  "ekpr", "edpr", "eadr", "ekast",
  "adjusted_swing_percent", "rating_3_like_unadjusted", "rating_recon_proxy", "rating_3_like",
  "damage_rating", "multi_kill_rating", "kill_rating", "round_swing_rating",
  "survival_rating", "kast_rating", "mk_per_r",
];

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

function main() {
  const antes = fs.readFileSync(FILE, "utf8");
  const db = codec.decode(JSON.parse(antes));

  // Guarda referências para conferir depois que nada mais mudou.
  const controle = {
    partidas: db.matches.length,
    series: db.matchSeries.length,
    times: db.teams.length,
    jogadores: db.players.length,
    notaLider: db.ranking.teams[0]?.score,
    ratingExemplo: db.matches[0]?.players[0]?.rating,
    acsExemplo: db.matches[0]?.players[0]?.acs,
    snapshots: db.rankingSnapshots.length,
  };

  let removidos = 0;
  const podar = (player) => {
    if (!player) return;
    for (const field of DEAD_PLAYER_FIELDS) {
      if (field in player) {
        delete player[field];
        removidos += 1;
      }
    }
  };
  for (const match of db.matches) for (const player of match.players || []) podar(player);
  for (const player of db.players || []) podar(player);

  const depois = JSON.stringify(codec.encode(db));

  // Round-trip: o que o navegador vai decodificar tem de bater com o controle.
  const lido = codec.decode(JSON.parse(depois));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["séries", lido.matchSeries.length === controle.series],
    ["times", lido.teams.length === controle.times],
    ["jogadores", lido.players.length === controle.jogadores],
    ["snapshots", lido.rankingSnapshots.length === controle.snapshots],
    ["nota do líder", lido.ranking.teams[0]?.score === controle.notaLider],
    ["rAAting preservado", lido.matches[0]?.players[0]?.rating === controle.ratingExemplo],
    ["ACS preservado", lido.matches[0]?.players[0]?.acs === controle.acsExemplo],
    ["identidade team.ranking", lido.teams[0]?.ranking === lido.ranking.byTeamId?.[lido.teams[0]?.id]],
    ["campos mortos sumiram", DEAD_PLAYER_FIELDS.every((f) => !(f in (lido.matches[0]?.players[0] || {})))],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(FILE, depois);
  console.log(`campos removidos: ${removidos}`);
  console.log(`cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(
    `gzip: ${mb(zlib.gzipSync(Buffer.from(antes)).length)} -> ${mb(zlib.gzipSync(Buffer.from(depois)).length)}`,
  );
  for (const [nome] of checks) console.log(`  ok ${nome}`);
}

main();
