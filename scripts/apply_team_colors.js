// Leva as cores de equipe do metadata.json para o database.json e o home.json
// JÁ COMMITADOS.
//
// Uso: python scripts/apply_team_colors.py   <- primeiro, le a planilha
//      node scripts/apply_team_colors.js     <- depois, este
//
// Por que existe: a planilha e a fonte (cor1/cor2 em teams_infos.xlsx), o
// scripts/build_metadata.py ja sabe le-las, mas o database.json nao reproduz e
// o home.json sai dele. Este script so escreve o campo `colors` das equipes,
// pelo id, sem tocar em mais nada do artefato.
//
// O que ele substitui: ate aqui `colors` vinha de teamColors()/colorPair() em
// app.js - uma tabela de seis excecoes escritas a mao e, para o resto, um par
// derivado do hash do id (dai os `hsl(258 64% 38%)` que aparecem no banco). Era
// cor decorativa e estavel, nao a cor da equipe.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const HOME = path.join(ROOT, "home.json");
const META = path.join(ROOT, "metadata.json");
const codec = require(path.join(ROOT, "db-codec.js"));

const HEX = /^#[0-9a-f]{6}$/;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

function mapaDeCores() {
  const md = JSON.parse(fs.readFileSync(META, "utf8"));
  const mapa = new Map();
  for (const equipe of md.teams || []) {
    const par = equipe.colors;
    if (!Array.isArray(par) || par.length !== 2) continue;
    if (!par.every((c) => HEX.test(String(c)))) continue;
    for (const chave of [equipe.id, equipe.slug]) {
      if (chave) mapa.set(String(chave), par.slice());
    }
  }
  return mapa;
}

function pinta(equipes, mapa) {
  let pintadas = 0;
  const semCor = [];
  for (const equipe of equipes) {
    const par = mapa.get(String(equipe.id || equipe.slug || ""));
    if (!par) {
      semCor.push(equipe.id);
      continue;
    }
    equipe.colors = par.slice();
    pintadas += 1;
  }
  return { pintadas, semCor };
}

function passaDatabase(mapa) {
  const antes = fs.readFileSync(DB, "utf8");
  const db = codec.decode(JSON.parse(antes));
  const controle = { partidas: db.matches.length, times: db.teams.length, notaLider: db.ranking.teams[0]?.score };

  const { pintadas, semCor } = pinta(db.teams, mapa);

  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["times", lido.teams.length === controle.times],
    ["nota do líder", lido.ranking.teams[0]?.score === controle.notaLider],
    ["identidade team.ranking", lido.teams[0]?.ranking === lido.ranking.byTeamId?.[lido.teams[0]?.id]],
    ["todo par pintado e #rrggbb", lido.teams.every((t) => !mapa.has(String(t.id)) || (t.colors.length === 2 && t.colors.every((c) => HEX.test(c))))],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do database.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    return false;
  }

  fs.writeFileSync(DB, depois);
  console.log("database.json");
  console.log(`  equipes pintadas: ${pintadas}/${db.teams.length}`);
  if (semCor.length) console.log(`  sem linha na planilha: ${semCor.join(", ")}`);
  console.log(`  cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(`  gzip: ${mb(zlib.gzipSync(Buffer.from(antes)).length)} -> ${mb(zlib.gzipSync(Buffer.from(depois)).length)}`);
  for (const [nome] of checks) console.log(`    ok ${nome}`);
  return true;
}

function passaHome(mapa) {
  if (!fs.existsSync(HOME)) {
    console.log("home.json nao existe - pulando");
    return true;
  }
  const antes = fs.readFileSync(HOME, "utf8");
  const home = JSON.parse(antes);
  const controle = { equipes: (home.teams || []).length, series: (home.series || []).length, lideres: (home.leaders || []).length };

  const { pintadas, semCor } = pinta(home.teams || [], mapa);

  // home.json e gerado minificado por scripts/build_home.js - manter assim.
  const depois = JSON.stringify(home);
  const lido = JSON.parse(depois);
  const checks = [
    ["equipes", (lido.teams || []).length === controle.equipes],
    ["series", (lido.series || []).length === controle.series],
    ["lideres", (lido.leaders || []).length === controle.lideres],
    ["todo par pintado e #rrggbb", (lido.teams || []).every((t) => !mapa.has(String(t.id)) || (t.colors.length === 2 && t.colors.every((c) => HEX.test(c))))],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do home.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    return false;
  }

  fs.writeFileSync(HOME, depois);
  console.log("home.json");
  console.log(`  equipes pintadas: ${pintadas}/${controle.equipes}`);
  if (semCor.length) console.log(`  sem linha na planilha: ${semCor.join(", ")}`);
  console.log(`  cru : ${antes.length} B -> ${depois.length} B`);
  for (const [nome] of checks) console.log(`    ok ${nome}`);
  return true;
}

function main() {
  const mapa = mapaDeCores();
  if (!mapa.size) {
    console.error("ABORTADO — metadata.json nao tem teams[].colors. Rode antes: python scripts/apply_team_colors.py");
    process.exitCode = 1;
    return;
  }
  console.log(`mapa: ${new Set([...mapa.values()].map((p) => p.join())).size} pares distintos para ${mapa.size} chaves\n`);
  if (!passaDatabase(mapa) || !passaHome(mapa)) process.exitCode = 1;
}

main();
