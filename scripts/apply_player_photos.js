// Leva as fotos de jogador do metadata.json para o database.json e o home.json
// JA COMMITADOS.
//
// Uso: python scripts/build_metadata.py   <- primeiro, indexa os arquivos
//      node scripts/apply_player_photos.js <- depois, este
//
// Por que existe: a foto NAO vem da planilha - nao ha coluna de foto em
// players.xlsx. O vinculo e o nome do arquivo: build_metadata.py indexa
// assets/player-photos/<pasta da equipe>/<arquivo> e casa slug_key(nome do
// arquivo) com slug_key(Jogador). Quem nao casa fica sem foto, em silencio.
//
// O rebuild completo resolveria, mas ele tambem recalcula o ranking, que
// depende de Date.now(): rodar hoje mexeu em points/rankingScore das 98
// equipes e no rank de 29 delas. Foto e ranking sao mudancas diferentes e nao
// devem viajar no mesmo commit. Este script escreve SO o campo `photo` dos
// jogadores, casando por id, e passa o resto do grafo intacto pelo codec.
//
// Mesmo contrato dos outros scripts que mantem artefato commitado: roda duas
// vezes sem mudar um byte e aborta quando a verificacao falha.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const DB = path.join(ROOT, "database.json");
const HOME = path.join(ROOT, "home.json");
const META = path.join(ROOT, "metadata.json");
const codec = require(path.join(ROOT, "db-codec.js"));

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

// O metadata guarda a foto ja como caminho publico. Indexo por id e por nome
// porque o home.json recorta jogador sem id em algumas listas.
function mapaDeFotos() {
  const md = JSON.parse(fs.readFileSync(META, "utf8"));
  const mapa = new Map();
  for (const jogador of md.players || []) {
    const foto = String(jogador.photo || "");
    if (!foto) continue;
    for (const chave of [jogador.id, jogador.name]) {
      if (chave) mapa.set(String(chave), foto);
    }
  }
  return mapa;
}

function aplica(jogadores, mapa) {
  let trocadas = 0;
  let ganharam = 0;
  const perdidas = [];
  for (const jogador of jogadores) {
    const foto = mapa.get(String(jogador.id || "")) || mapa.get(String(jogador.name || ""));
    if (!foto) {
      // Jogador que TINHA foto e nao esta mais no indice e sinal de arquivo
      // renomeado ou apagado sem querer - registro para a verificacao barrar.
      if (jogador.photo) perdidas.push(jogador.name || jogador.id);
      continue;
    }
    if (jogador.photo === foto) continue;
    if (jogador.photo) trocadas += 1;
    else ganharam += 1;
    jogador.photo = foto;
  }
  return { trocadas, ganharam, perdidas };
}

function passaDatabase(mapa) {
  const antes = fs.readFileSync(DB, "utf8");
  const db = codec.decode(JSON.parse(antes));
  const controle = {
    partidas: db.matches.length,
    times: db.teams.length,
    jogadores: db.players.length,
    notaLider: db.ranking.teams[0]?.score,
    rankLider: db.ranking.teams[0]?.id,
    pontos: db.teams.map((t) => `${t.id}:${t.points}`).join("|"),
    cores: db.teams.map((t) => `${t.id}:${(t.colors || []).join(",")}`).join("|"),
  };

  const { trocadas, ganharam, perdidas } = aplica(db.players, mapa);

  const depois = JSON.stringify(codec.encode(db));
  const lido = codec.decode(JSON.parse(depois));
  const checks = [
    ["partidas", lido.matches.length === controle.partidas],
    ["times", lido.teams.length === controle.times],
    ["jogadores", lido.players.length === controle.jogadores],
    ["nota do lider", lido.ranking.teams[0]?.score === controle.notaLider],
    ["lider do ranking", lido.ranking.teams[0]?.id === controle.rankLider],
    ["o ranking NAO mexeu", lido.teams.map((t) => `${t.id}:${t.points}`).join("|") === controle.pontos],
    ["as cores NAO mexeram", lido.teams.map((t) => `${t.id}:${(t.colors || []).join(",")}`).join("|") === controle.cores],
    ["nenhuma foto se perdeu", perdidas.length === 0],
    ["toda foto aponta para arquivo que existe", lido.players.every((j) => !j.photo || fs.existsSync(path.join(ROOT, j.photo)))],
  ];
  return { antes, depois, checks, trocadas, ganharam, perdidas, arquivo: DB };
}

function passaHome(mapa) {
  const antes = fs.readFileSync(HOME, "utf8");
  const home = JSON.parse(antes);
  const jogadores = [];
  const colhe = (valor) => {
    if (!valor || typeof valor !== "object") return;
    if (Array.isArray(valor)) { valor.forEach(colhe); return; }
    if ("photo" in valor && ("name" in valor || "id" in valor)) jogadores.push(valor);
    Object.values(valor).forEach(colhe);
  };
  colhe(home);

  const { trocadas, ganharam, perdidas } = aplica(jogadores, mapa);

  const depois = JSON.stringify(home);
  const lido = JSON.parse(depois);
  const checks = [
    ["a home continua parseando", !!lido && typeof lido === "object"],
    ["nenhuma foto se perdeu", perdidas.length === 0],
    ["toda foto aponta para arquivo que existe", jogadores.every((j) => !j.photo || fs.existsSync(path.join(ROOT, j.photo)))],
  ];
  return { antes, depois, checks, trocadas, ganharam, perdidas, arquivo: HOME };
}

function main() {
  const mapa = mapaDeFotos();
  if (!mapa.size) {
    console.error("ABORTADO - metadata.json nao tem nenhuma foto de jogador. Rodou build_metadata.py?");
    return false;
  }
  console.log(`fotos no metadata: ${new Set(mapa.values()).size} arquivos`);

  // Nada e gravado antes das duas passagens verificarem.
  const passagens = [passaDatabase(mapa), passaHome(mapa)];
  let ok = true;
  for (const p of passagens) {
    console.log(path.basename(p.arquivo));
    console.log(`  fotos novas: ${p.ganharam} | caminhos trocados: ${p.trocadas}`);
    if (p.arquivo === DB) {
      console.log(`  cru : ${mb(p.antes.length)} -> ${mb(p.depois.length)}`);
      console.log(`  gzip: ${mb(zlib.gzipSync(p.antes).length)} -> ${mb(zlib.gzipSync(p.depois).length)}`);
    }
    for (const [nome, passou] of p.checks) {
      console.log(`    ${passou ? "ok" : "XX"} ${nome}`);
      if (!passou) ok = false;
    }
    if (p.perdidas.length) {
      console.error(`    jogadores que perderam a foto: ${p.perdidas.slice(0, 10).join(", ")}`);
    }
  }
  if (!ok) {
    console.error("\nNADA FOI GRAVADO - a verificacao falhou. O repositorio nao mudou.");
    return false;
  }
  const mudou = passagens.filter((p) => p.antes !== p.depois);
  if (!mudou.length) {
    console.log("\nja estava em dia: nenhum byte mudou.");
    return true;
  }
  for (const p of mudou) fs.writeFileSync(p.arquivo, p.depois);
  console.log(`\ngravados: ${mudou.map((p) => path.basename(p.arquivo)).join(", ")}`);
  return true;
}

if (main() === false) process.exitCode = 1;
