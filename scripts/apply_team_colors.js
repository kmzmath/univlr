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

// Equipe que nao tem linha na planilha fica com o par gerado por colorPair()
// (hash do id). Ate 26/08/2026 esse par era assado em hsl(), e hexToRgb() no
// app.js so aceita #rrggbb: teamWashFor() abortava na primeira linha e servia
// tinta clara sobre a cor crua, sem o passeio de 4,5:1 - a Sixa Eaters, unica
// nesse caso, saia em 2,93:1 - e teamPatternFor() caia no "tecido".
//
// Aqui e conversao de NOTACAO, nao regeracao: a cor emitida e a mesma, so
// passa a ser legivel pelas guardas. Regerar com colorPair() duplicaria o
// gerador neste script e abriria espaco para deriva.
function hslParaHex(valor) {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(String(valor).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const min = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((canal) => Math.round((canal + min) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function mapaDeCores() {
  const md = JSON.parse(fs.readFileSync(META, "utf8"));
  const mapa = new Map();
  for (const equipe of md.teams || []) {
    const par = equipe.colors;
    if (!Array.isArray(par) || par.length !== 2) continue;
    if (!par.every((c) => HEX.test(String(c)))) continue;
    const campos = { colors: par.slice(), logo: String(equipe.logo || "") };
    for (const chave of [equipe.id, equipe.slug]) {
      if (chave) mapa.set(String(chave), campos);
    }
  }
  return mapa;
}

function pinta(equipes, mapa) {
  let pintadas = 0;
  let logos = 0;
  let normalizadas = 0;
  const semCor = [];
  for (const equipe of equipes) {
    const campos = mapa.get(String(equipe.id || equipe.slug || ""));
    if (!campos) {
      semCor.push(equipe.id);
      // Sem linha na planilha a cor continua sendo a gerada - mas em hex, para
      // as guardas de contraste e de trama conseguirem ler. Rodar de novo nao
      // muda nada: hslParaHex devolve null para quem ja e hex.
      if (Array.isArray(equipe.colors)) {
        equipe.colors = equipe.colors.map((cor) => {
          const hex = hslParaHex(cor);
          if (hex) normalizadas += 1;
          return hex || cor;
        });
      }
      continue;
    }
    equipe.colors = campos.colors.slice();
    pintadas += 1;
    // Logo POR EQUIPE, casando por id. A tabela de rewrite_asset_paths.js nao
    // serve para isto: ela troca string e e cega, e quando pucc_cardinals e
    // pucc_canaries partilhavam o mesmo caminho antes do rename, o Cardinals
    // saiu com o escudo do Canaries.
    if (campos.logo) {
      if (equipe.logo && equipe.logo !== campos.logo) { equipe.logo = campos.logo; logos += 1; }
      if (equipe.profile && equipe.profile.logo && equipe.profile.logo !== campos.logo) {
        equipe.profile.logo = campos.logo;
        logos += 1;
      }
    }
  }
  return { pintadas, semCor, logos, normalizadas };
}

function passaDatabase(mapa) {
  const antes = fs.readFileSync(DB, "utf8");
  const db = codec.decode(JSON.parse(antes));
  const controle = { partidas: db.matches.length, times: db.teams.length, notaLider: db.ranking.teams[0]?.score };

  const { pintadas, semCor, logos, normalizadas } = pinta(db.teams, mapa);

  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["times", lido.teams.length === controle.times],
    ["nota do líder", lido.ranking.teams[0]?.score === controle.notaLider],
    ["identidade team.ranking", lido.teams[0]?.ranking === lido.ranking.byTeamId?.[lido.teams[0]?.id]],
    ["todo par pintado e #rrggbb", lido.teams.every((t) => !mapa.has(String(t.id)) || (t.colors.length === 2 && t.colors.every((c) => HEX.test(c))))],
    // Universal, nao so as da planilha: cor que nao e #rrggbb passa batido por
    // hexToRgb() e derruba a garantia de 4,5:1 sem avisar.
    ["TODA equipe tem cor #rrggbb", lido.teams.every((t) => !Array.isArray(t.colors) || t.colors.every((c) => HEX.test(String(c))))],
    ["logo de cada equipe bate com o metadata", lido.teams.every((t) => { const c = mapa.get(String(t.id)); return !c || !c.logo || (t.profile?.logo || t.logo) === c.logo; })],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do database.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    return false;
  }

  fs.writeFileSync(DB, depois);
  console.log("database.json");
  console.log(`  equipes pintadas: ${pintadas}/${db.teams.length} | logos sincronizados: ${logos} | cores hsl->hex: ${normalizadas}`);
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

  const { pintadas, semCor, logos, normalizadas } = pinta(home.teams || [], mapa);

  // home.json e gerado minificado por scripts/build_home.js - manter assim.
  const depois = JSON.stringify(home);
  const lido = JSON.parse(depois);
  const checks = [
    ["equipes", (lido.teams || []).length === controle.equipes],
    ["series", (lido.series || []).length === controle.series],
    ["lideres", (lido.leaders || []).length === controle.lideres],
    ["todo par pintado e #rrggbb", (lido.teams || []).every((t) => !mapa.has(String(t.id)) || (t.colors.length === 2 && t.colors.every((c) => HEX.test(c))))],
    ["TODA equipe tem cor #rrggbb", (lido.teams || []).every((t) => !Array.isArray(t.colors) || t.colors.every((c) => HEX.test(String(c))))],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do home.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    return false;
  }

  fs.writeFileSync(HOME, depois);
  console.log("home.json");
  console.log(`  equipes pintadas: ${pintadas}/${controle.equipes} | logos sincronizados: ${logos} | cores hsl->hex: ${normalizadas}`);
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
  console.log(`mapa: ${new Set([...mapa.values()].map((c) => c.colors.join())).size} pares distintos para ${mapa.size} chaves\n`);
  if (!passaDatabase(mapa) || !passaHome(mapa)) process.exitCode = 1;
}

main();
