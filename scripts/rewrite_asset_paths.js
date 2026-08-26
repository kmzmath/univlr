// Reescreve caminhos de asset dentro do database.json JÁ COMMITADO.
//
// Uso: node scripts/rewrite_asset_paths.js
//
// Por que existe: os caminhos de logo vêm de metadata.json e ficam assados no
// database.json. Trocar a extensão de um logo (ex.: .png por .webp otimizado)
// exigiria refazer o build inteiro — que hoje não reproduz o artefato
// commitado. Este script troca só as strings da tabela, no lugar.
//
// A tabela é intencionalmente explícita: cada linha é uma troca conferida à
// mão, não um padrão que possa pegar caminho parecido por acidente.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "database.json");
const codec = require(path.join(ROOT, "db-codec.js"));

const TROCAS = [
  ["assets/team-logos/made_cefet.png", "assets/team-logos/made_cefet.webp"],
  ["assets/team-logos/caap_malditos.png", "assets/team-logos/caap_malditos.webp"],
  ["assets/team-logos/ufrj_canis.png", "assets/team-logos/ufrj_canis.webp"],
  ["assets/team-logos/liga_vulkanica.png", "assets/team-logos/liga_vulkanica.webp"],
  ["assets/team-logos/ufscar_fire.png", "assets/team-logos/ufscar_fire.webp"],
  ["assets/team-logos/baroes_uff.png", "assets/team-logos/baroes_uff.webp"],
  ["assets/team-logos/maua_blue.png", "assets/team-logos/maua_blue.webp"],
  ["assets/organizers-logos/logo_ferjee.png", "assets/organizers-logos/logo_ferjee.webp"],
];

const mapa = new Map(TROCAS);

function main() {
  const antes = fs.readFileSync(FILE, "utf8");
  const db = codec.decode(JSON.parse(antes));

  const controle = { partidas: db.matches.length, times: db.teams.length, notaLider: db.ranking.teams[0]?.score };

  let trocados = 0;
  const anda = (obj, visto = new Set()) => {
    if (!obj || typeof obj !== "object" || visto.has(obj)) return;
    visto.add(obj);
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") {
        const novo = mapa.get(v);
        if (novo) { obj[k] = novo; trocados += 1; }
      } else if (v && typeof v === "object") {
        anda(v, visto);
      }
    }
  };
  anda(db);

  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));

  const faltando = TROCAS.filter(([, novo]) => !fs.existsSync(path.join(ROOT, novo)));
  const sobrou = TROCAS.filter(([velho]) => depois.includes(`"${velho}"`));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["times", lido.teams.length === controle.times],
    ["nota do líder", lido.ranking.teams[0]?.score === controle.notaLider],
    ["identidade team.ranking", lido.teams[0]?.ranking === lido.ranking.byTeamId?.[lido.teams[0]?.id]],
    ["arquivos novos existem no disco", faltando.length === 0],
    ["nenhum caminho velho sobrou", sobrou.length === 0],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    for (const [, novo] of faltando) console.error(`    ausente: ${novo}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(FILE, depois);
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`strings trocadas: ${trocados}`);
  console.log(`cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(`gzip: ${mb(zlib.gzipSync(Buffer.from(antes)).length)} -> ${mb(zlib.gzipSync(Buffer.from(depois)).length)}`);
  for (const [nome] of checks) console.log(`  ok ${nome}`);
}

main();
