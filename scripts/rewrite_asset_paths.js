// Reescreve caminhos de asset dentro do database.json e do metadata.json
// JÁ COMMITADOS.
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
//
// O segundo bloco da tabela troca hotlink por arquivo local: as 27 bandeiras
// de estado vinham do Wikimedia Commons a cada visita. Os .webp são gerados
// por scripts/fetch_state_flags.py e a origem (dados_excel/estados.xlsx via
// scripts/build_metadata.py) já prefere o arquivo local — esta tabela existe
// só para o artefato commitado, que hoje não reproduz.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "database.json");
const META = path.join(ROOT, "metadata.json");
const HOME = path.join(ROOT, "home.json");
const codec = require(path.join(ROOT, "db-codec.js"));

const TROCAS = [
  // Estas sete foram na direcao contraria ate 26/08/2026: o commit ddafb8c
  // trocou .png por .webp otimizado. Nesse dia os sete .webp sairam do disco e
  // sete .png novos entraram no lugar (arte nova, feita fora daqui) - o banco
  // continuou pedindo o .webp e sete escudos passaram a dar 404. A tabela
  // aponta para o arquivo que existe, entao inverteu.
  ["assets/team-logos/made_cefet.webp", "assets/team-logos/made_cefet.png"],
  ["assets/team-logos/caap_malditos.webp", "assets/team-logos/caap_malditos.png"],
  ["assets/team-logos/ufrj_canis.webp", "assets/team-logos/ufrj_canis.png"],
  ["assets/team-logos/liga_vulkanica.webp", "assets/team-logos/liga_vulkanica.png"],
  ["assets/team-logos/ufscar_fire.webp", "assets/team-logos/ufscar_fire.png"],
  ["assets/team-logos/baroes_uff.webp", "assets/team-logos/baroes_uff.png"],
  ["assets/team-logos/maua_blue.webp", "assets/team-logos/maua_blue.png"],

  // Renomeados na planilha e ja refletidos no metadata.json rebuildado; o
  // database.json nao reproduz, entao a troca vem por aqui. Sem isto as duas
  // equipes ficariam com o escudo antigo na tela e o novo no metadata.
  ["assets/team-logos/pucc_cardinals.png", "assets/team-logos/puccCanaries.png"],
  ["assets/team-logos/pucgo_sistematica.png", "assets/team-logos/pucgo_sistematica_academy.png"],

  // Nao e caminho de asset, mas e o mesmo problema: a planilha corrigiu o
  // instagram do UFS Bugados, o metadata rebuildado ja tem o novo e o
  // database.json nao reproduz. Trocar a string aqui e a mesma operacao.
  ["https://www.instagram.com/ufswarriowls/", "https://www.instagram.com/atleticabugados/"],

  // Esta continua valendo: o .webp do FERJEE esta no disco.
  ["assets/organizers-logos/logo_ferjee.png", "assets/organizers-logos/logo_ferjee.webp"],

  // Bandeiras de estado: hotlink do Wikimedia Commons -> assets/state-flags/
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Acre.svg", "assets/state-flags/ac.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Alagoas.svg", "assets/state-flags/al.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Amap%C3%A1.svg", "assets/state-flags/ap.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Amazonas.svg", "assets/state-flags/am.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_da_Bahia.svg", "assets/state-flags/ba.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Cear%C3%A1.svg", "assets/state-flags/ce.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Distrito_Federal_%28Brasil%29.svg", "assets/state-flags/df.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Esp%C3%ADrito_Santo.svg", "assets/state-flags/es.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Goi%C3%A1s.svg", "assets/state-flags/go.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Maranh%C3%A3o.svg", "assets/state-flags/ma.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Mato_Grosso.svg", "assets/state-flags/mt.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Mato_Grosso_do_Sul.svg", "assets/state-flags/ms.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Minas_Gerais.svg", "assets/state-flags/mg.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Par%C3%A1.svg", "assets/state-flags/pa.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_da_Para%C3%ADba.svg", "assets/state-flags/pb.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Paran%C3%A1.svg", "assets/state-flags/pr.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Pernambuco.svg", "assets/state-flags/pe.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Piau%C3%AD.svg", "assets/state-flags/pi.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_estado_do_Rio_de_Janeiro.svg", "assets/state-flags/rj.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Rio_Grande_do_Norte.svg", "assets/state-flags/rn.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Rio_Grande_do_Sul.svg", "assets/state-flags/rs.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Rond%C3%B4nia.svg", "assets/state-flags/ro.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Roraima.svg", "assets/state-flags/rr.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Santa_Catarina.svg", "assets/state-flags/sc.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_estado_de_S%C3%A3o_Paulo.svg", "assets/state-flags/sp.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_de_Sergipe.svg", "assets/state-flags/se.webp"],
  ["https://commons.wikimedia.org/wiki/Special:FilePath/Bandeira_do_Tocantins.svg", "assets/state-flags/to.webp"],
];

const mapa = new Map(TROCAS);
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

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

  // So exige arquivo no disco para alvo que E arquivo: a tabela tambem carrega
  // troca de string pura (o instagram corrigido na planilha), e cobrar
  // existencia dela abortava o script inteiro.
  const faltando = TROCAS.filter(([, novo]) => novo.startsWith("assets/") && !fs.existsSync(path.join(ROOT, novo)));
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
    return false;
  }

  fs.writeFileSync(FILE, depois);
  console.log("database.json");
  console.log(`  strings trocadas: ${trocados}`);
  console.log(`  cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  console.log(`  gzip: ${mb(zlib.gzipSync(Buffer.from(antes)).length)} -> ${mb(zlib.gzipSync(Buffer.from(depois)).length)}`);
  for (const [nome] of checks) console.log(`    ok ${nome}`);
  return true;
}

// metadata.json é JSON simples (sem db-codec) e é a fonte de onde o build assa
// os caminhos no database.json. Deixá-lo para trás faria o próximo build
// ressuscitar o hotlink.
function metadataPass() {
  const antes = fs.readFileSync(META, "utf8");
  const md = JSON.parse(antes);
  const controle = { times: md.teams.length, estados: md.states.length, jogadores: md.players.length };

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
  anda(md);

  // indent 2 + newline final: o mesmo formato que scripts/build_metadata.py
  // grava. Minificar aqui trocaria 13 mil linhas revisáveis por uma só.
  const depois = JSON.stringify(md, null, 2) + "\n";
  const lido = JSON.parse(depois);
  const sobrou = TROCAS.filter(([velho]) => depois.includes(`"${velho}"`));
  const semBandeira = lido.states.filter((s) => !String(s.icon || "").startsWith("assets/state-flags/"));
  const checks = [
    ["times", lido.teams.length === controle.times],
    ["estados", lido.states.length === controle.estados],
    ["jogadores", lido.players.length === controle.jogadores],
    ["nenhum caminho velho sobrou", sobrou.length === 0],
    ["as 27 bandeiras apontam para assets/state-flags/", semBandeira.length === 0],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do metadata.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    for (const s of semBandeira) console.error(`    sem bandeira local: ${s.sigla} -> ${s.icon}`);
    return false;
  }

  fs.writeFileSync(META, depois);
  console.log("metadata.json");
  console.log(`  strings trocadas: ${trocados}`);
  console.log(`  cru : ${mb(antes.length)} -> ${mb(depois.length)}`);
  for (const [nome] of checks) console.log(`    ok ${nome}`);
  return true;
}

// home.json ficou de fora ate 26/08/2026 e o preco apareceu: quando as sete
// trocas de escudo inverteram (.webp de volta para .png), dois caminhos
// continuaram apontando para arquivo deletado e a home servia dois escudos
// quebrados. Todo artefato commitado que carrega caminho de asset passa aqui.
function homePass() {
  if (!fs.existsSync(HOME)) {
    console.log("home.json nao existe - pulando");
    return true;
  }
  const antes = fs.readFileSync(HOME, "utf8");
  const home = JSON.parse(antes);
  const controle = { equipes: (home.teams || []).length, series: (home.series || []).length, eventos: (home.events || []).length };

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
  anda(home);

  // home.json e gerado minificado por scripts/build_home.js - manter assim.
  const depois = JSON.stringify(home);
  const lido = JSON.parse(depois);
  const sobrou = TROCAS.filter(([velho]) => depois.includes(`"${velho}"`));
  const quebrados = [];
  const confere = (obj, visto = new Set()) => {
    if (!obj || typeof obj !== "object" || visto.has(obj)) return;
    visto.add(obj);
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string" && /^assets\/.+\.(png|jpe?g|webp|svg)$/i.test(v)) {
        if (!fs.existsSync(path.join(ROOT, v))) quebrados.push(v);
      } else if (v && typeof v === "object") {
        confere(v, visto);
      }
    }
  };
  confere(lido);

  const checks = [
    ["equipes", (lido.teams || []).length === controle.equipes],
    ["series", (lido.series || []).length === controle.series],
    ["eventos", (lido.events || []).length === controle.eventos],
    ["nenhum caminho velho sobrou", sobrou.length === 0],
    ["todo asset citado existe no disco", quebrados.length === 0],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO — verificação do home.json falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    for (const q of [...new Set(quebrados)]) console.error(`    ausente: ${q}`);
    return false;
  }

  fs.writeFileSync(HOME, depois);
  console.log("home.json");
  console.log(`  strings trocadas: ${trocados}`);
  console.log(`  cru : ${antes.length} B -> ${depois.length} B`);
  for (const [nome] of checks) console.log(`    ok ${nome}`);
  return true;
}

if (main() === false) process.exitCode = 1;
else if (metadataPass() === false) process.exitCode = 1;
else if (homePass() === false) process.exitCode = 1;
