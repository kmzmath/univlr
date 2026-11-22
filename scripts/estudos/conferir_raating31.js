// Estudo de 22/11/2026 (fora do build): confere um database.json contra o oráculo
// do rAAting 3.1 (oraculo_raating31.js). Sai com 0 quando tudo bate e 1 quando não.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/conferir_raating31.js <oraculo.json> [database.json]
//
// Confere, em cada linha jogador x mapa (chave matchId|puuid):
// - raating_3 contra a nota 3.1 do oráculo (até 1e-9);
// - raating_1 contra o rAAting 1.0 de antes (até 1e-9);
// - as duas listas de linhas são as mesmas;
// e no metadata.raatingContext do banco: a média do grupo (centro, até 1e-12 por
// taxa) e a tabela com spike (mesmas células, n igual, p até 1e-12).

const fs = require("fs");
const path = require("path");

const [arqOraculo, arqBanco] = process.argv.slice(2);
if (!arqOraculo) {
  console.error("uso: node scripts/estudos/conferir_raating31.js <oraculo.json> [database.json]");
  process.exit(2);
}
const ROOT = path.resolve(__dirname, "..", "..");
const codec = require(path.join(ROOT, "db-codec.js"));
const oraculo = JSON.parse(fs.readFileSync(arqOraculo, "utf8"));
const db = codec.decode(JSON.parse(fs.readFileSync(arqBanco || path.join(ROOT, "database.json"), "utf8")));

const falhas = [];
const piores = [];
let maiorNota = 0;
let maiorLegado = 0;
let conferidas = 0;
const vistas = new Set();
for (const match of db.matches || []) {
  for (const player of match.players || []) {
    const chave = `${match.id}|${player.puuid}`;
    vistas.add(chave);
    const esperado = oraculo.linhas[chave];
    if (!esperado) {
      falhas.push(`linha fora do oráculo: ${chave}`);
      continue;
    }
    conferidas += 1;
    const difNota = Math.abs(Number(player.raating_3) - esperado.raating_31);
    const difLegado = Math.abs(Number(player.raating_1) - esperado.raating_1);
    if (!(difNota <= maiorNota)) maiorNota = Number.isFinite(difNota) ? Math.max(maiorNota, difNota) : Infinity;
    if (!(difLegado <= maiorLegado)) maiorLegado = Number.isFinite(difLegado) ? Math.max(maiorLegado, difLegado) : Infinity;
    if (!(difNota <= 1e-9) || !(difLegado <= 1e-9)) piores.push({ chave, nick: player.nick, banco: player.raating_3, esperado: esperado.raating_31, difNota, difLegado });
  }
}
// O MVP do mapa tem de ser o maior rAAting 3.1 do mapa (empate fica com quem vem
// antes). Na revisao final, ele saia escolhido antes da media do grupo existir.
let mvpErrado = 0;
for (const match of db.matches || []) {
  const players = match.players || [];
  if (!players.length) continue;
  let melhor = players[0];
  for (const player of players) if (Number(player.raating_3) > Number(melhor.raating_3)) melhor = player;
  if (!match.mvp || match.mvp.puuid !== melhor.puuid) mvpErrado += 1;
}
if (mvpErrado) falhas.push(`MVP do mapa fora do maior rAAting em ${mvpErrado} mapas`);
const faltando = Object.keys(oraculo.linhas).filter((chave) => !vistas.has(chave));
if (faltando.length) falhas.push(`${faltando.length} linhas do oráculo fora do banco (ex.: ${faltando[0]})`);
if (!(maiorNota <= 1e-9)) falhas.push(`raating_3: maior diferença ${maiorNota}`);
if (!(maiorLegado <= 1e-9)) falhas.push(`raating_1: maior diferença ${maiorLegado}`);

const contexto = db.metadata?.raatingContext || {};
const centro = contexto.centro;
let maiorCentro = 0;
if (!centro) falhas.push("o banco não tem metadata.raatingContext.centro");
else {
  for (const [parte, valor] of Object.entries(oraculo.centro)) {
    const dif = Math.abs(Number(centro[parte]) - valor);
    maiorCentro = Number.isFinite(dif) ? Math.max(maiorCentro, dif) : Infinity;
  }
  if (!(maiorCentro <= 1e-12)) falhas.push(`centro: maior diferença ${maiorCentro}`);
}
const tabela = contexto.spikeTable;
let maiorTabela = 0;
if (!tabela) falhas.push("o banco não tem metadata.raatingContext.spikeTable");
else {
  const chavesO = Object.keys(oraculo.tabelaSpike).sort();
  const chavesB = Object.keys(tabela).sort();
  if (chavesO.join() !== chavesB.join()) falhas.push(`tabela com spike: células diferentes (${chavesB.length} no banco, ${chavesO.length} no oráculo)`);
  for (const chave of chavesO) {
    const b = tabela[chave];
    const o = oraculo.tabelaSpike[chave];
    if (!b || b.n !== o.n) {
      falhas.push(`tabela com spike: n diferente em ${chave}`);
      continue;
    }
    const dif = Math.abs(b.p - o.p);
    maiorTabela = Number.isFinite(dif) ? Math.max(maiorTabela, dif) : Infinity;
  }
  if (!(maiorTabela <= 1e-12)) falhas.push(`tabela com spike: maior diferença de p ${maiorTabela}`);
}

console.log(`linhas conferidas: ${conferidas} (oráculo ${Object.keys(oraculo.linhas).length}, commit ${String(oraculo.commit).slice(0, 7)})`);
console.log(`maior diferença: raating_3 ${maiorNota}, raating_1 ${maiorLegado}, centro ${maiorCentro}, tabela ${maiorTabela}`);
if (piores.length) {
  piores.sort((a, b) => (b.difNota || 0) - (a.difNota || 0));
  console.log(`${piores.length} linhas fora da tolerância; as 5 piores:`);
  for (const p of piores.slice(0, 5)) console.log(`  ${p.chave} ${p.nick}: banco ${p.banco}, esperado ${p.esperado}, legado ${p.difLegado}`);
}
if (falhas.length) {
  console.log("REPROVADO:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("APROVADO");
