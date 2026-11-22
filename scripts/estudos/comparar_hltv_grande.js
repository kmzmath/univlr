// Estudo de 21/11/2026 (fora do build): o teste A refeito com a amostra grande da
// HLTV, coletada na era do Rating 3.0 (20/08/2025 a 20/11/2026):
// - jogadores: todos com 20+ mapas no período (página Overview de cada um);
// - mapas: 56 páginas sorteadas da lista de partidas (semente 20261121), com as
//   linhas jogador x mapa de cada partida.
//
// Uso: node --max-old-space-size=14000 scripts/estudos/comparar_hltv_grande.js <hltv_jogadores_grande.csv> <hltv_mapas.csv> <variantes.json> <saida.json>
//
// Formatos (com ou sem cabeçalho):
// - jogadores: id,slug,mapasLista,roundsLista,notaLista,mapas,rating,swing,kpr,dpr,adr,kast,mk,ekpr,edpr,eadr,ekast,emk
// - mapas: mapa,data,nomeDoMapa,rounds,equipe,jogador,rating,swing,k,ek,d,ed,adr,eadr,kast,ekast,mks
//
// Mede, como no teste de 20/11, mas com a amostra do tamanho da do univlr:
// 1. se a fórmula estimada reproduz a nota oficial (por jogador e por mapa);
// 2. quanto cada parte decide a ordem no CS e no univlr, por carreira e por mapa,
//    com o mesmo corte de rounds dos dois lados;
// 3. o desvio de cada entrada nos dois jogos;
// 4. o dano por abate do CS, que apoia o fator do dano (1,5).

const fs = require("fs");
const path = require("path");
const { BETA, taxas } = require("./nota_beta.js");

const [arqJog, arqMapas, arqVariantes, saida] = process.argv.slice(2);
if (!arqJog || !arqMapas || !arqVariantes || !saida) {
  console.error("uso: node scripts/estudos/comparar_hltv_grande.js <jogadores.csv> <mapas.csv> <variantes.json> <saida.json>");
  process.exit(2);
}
const P = ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"];
const BETA_15 = { ...BETA, dano: BETA.dano / 1.5 };
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const desvio = (v) => {
  const m = media(v);
  return Math.sqrt(media(v.map((x) => (x - m) ** 2)));
};
const pearson = (a, b) => {
  const ma = media(a);
  const mb = media(b);
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
};
function participacao(linhas, betas, nota = (x) => P.reduce((s, p) => s + betas[p] * x[p], 0)) {
  const R = linhas.map(nota);
  const mR = media(R);
  const vR = media(R.map((r) => (r - mR) ** 2));
  return Object.fromEntries(
    P.map((p) => {
      const c = linhas.map((x) => betas[p] * x[p]);
      const mc = media(c);
      return [p, media(c.map((v, i) => (v - mc) * (R[i] - mR))) / vR];
    }),
  );
}
const crua = (x, comMk = true) => 0.1358 + P.reduce((s, p) => s + (p === "multikill" && !comMk ? 0 : BETA[p] * x[p]), 0);
function reproducao(linhas, comMk) {
  const est = linhas.map((x) => crua(x, comMk));
  const dif = est.map((e, i) => e - linhas[i].rating);
  return { n: linhas.length, erroMedio: media(dif.map(Math.abs)), vies: media(dif), r: pearson(est, linhas.map((x) => x.rating)) };
}
// aceita os CSV com ou sem cabeçalho (o separar_coleta_hltv.js põe cabeçalho)
const lerCsv = (arq) => fs.readFileSync(arq, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => l.split(",")).filter((c) => /^\d+$/.test(c[0]));
const ok = (o, campos) => campos.every((c) => Number.isFinite(o[c]));

// ---------- HLTV: jogadores ----------
const jog = lerCsv(arqJog)
  .map((c) => ({ id: c[0], rounds: +c[3], notaLista: +c[4], mapas: +c[5], rating: +c[6], swing: +c[7], kpr: +c[8], dpr: +c[9], adr: +c[10], kast: +c[11], mk: +c[12], ekpr: +c[13], edpr: +c[14], eadr: +c[15], ekast: +c[16], emk: +c[17] }))
  .filter((j) => ok(j, ["rating", "swing", "ekpr", "edpr", "eadr", "ekast", "mk", "rounds"]));
const csJog = jog.map((j) => ({ abate: j.ekpr, sobrevivencia: 1 - j.edpr, dano: j.eadr / 100, kast: j.ekast / 100, swing: j.swing, multikill: j.mk / 100, rating: j.rating, rounds: j.rounds }));

// ---------- HLTV: mapas ----------
const mapas = lerCsv(arqMapas)
  .map((c) => ({ mapa: c[0], rounds: +c[3], jogador: c[5], rating: +c[6], swing: +c[7], k: +c[8], ek: +c[9], d: +c[10], ed: +c[11], adr: +c[12], eadr: +c[13], kast: +c[14], ekast: +c[15], mks: +c[16] }))
  .filter((m) => m.rounds > 0 && ok(m, ["rating", "swing", "ek", "ed", "eadr", "ekast", "mks"]));
const csMapa = mapas.map((m) => ({ abate: m.ek / m.rounds, sobrevivencia: 1 - m.ed / m.rounds, dano: m.eadr / 100, kast: m.ekast / 100, swing: m.swing, multikill: m.mks / m.rounds, rating: m.rating, rounds: m.rounds }));
const mapasDistintos = new Set(mapas.map((m) => m.mapa)).size;
const danoPorAbateCs = jog.reduce((s, j) => s + j.adr * j.rounds, 0) / jog.reduce((s, j) => s + j.kpr * j.rounds, 0);
const danoPorAbateCsMapas = mapas.reduce((s, m) => s + m.adr * m.rounds, 0) / mapas.reduce((s, m) => s + m.k, 0);

// ---------- univlr ----------
const dados = JSON.parse(fs.readFileSync(arqVariantes, "utf8"));
const CAMPOS = dados.campos.slice(1);
const linhaDe = (v) => Object.fromEntries(CAMPOS.map((c, i) => [c, v[i + 1]]));
const baseVal = dados.variantes.final ? "final" : "todas_time";
function carreirasVal(variante) {
  const g = new Map();
  for (const [k, v] of Object.entries(dados.variantes[variante].linhas)) {
    const id = dados.referencia[k].id;
    if (!g.has(id)) g.set(id, Object.fromEntries(CAMPOS.map((c) => [c, 0])));
    const s = g.get(id);
    CAMPOS.forEach((c, i) => (s[c] += v[i + 1]));
  }
  return [...g.values()];
}
const valCarreiras = carreirasVal(baseVal).map((s) => ({ ...taxas(s), rounds: s.rounds }));
const valMapas = Object.values(dados.variantes[baseVal].linhas).map((v) => ({ ...taxas(linhaDe(v)), rounds: v[1] }));

// ---------- comparações com o mesmo corte de rounds ----------
const resumo = (lin) => ({ n: lin.length, desvio: Object.fromEntries(P.map((p) => [p, desvio(lin.map((x) => x[p]))])), media: Object.fromEntries(P.map((p) => [p, media(lin.map((x) => x[p]))])), comBeta: participacao(lin, BETA), comDano15: participacao(lin, BETA_15) });
const cortes = {};
for (const minimo of [440, 1000, 2000]) {
  cortes[`carreira ${minimo}+ rounds`] = { cs: resumo(csJog.filter((x) => x.rounds >= minimo)), univlr: resumo(valCarreiras.filter((x) => x.rounds >= minimo)), csContraOficial: participacao(csJog.filter((x) => x.rounds >= minimo), BETA, (x) => x.rating) };
}
cortes["por mapa"] = { cs: resumo(csMapa), univlr: resumo(valMapas), csContraOficial: participacao(csMapa, BETA, (x) => x.rating) };

const resultado = {
  amostra: { jogadores: jog.length, linhasJogadorMapa: mapas.length, mapas: mapasDistintos, univlrCarreiras: valCarreiras.length, univlrLinhas: valMapas.length, univlrBase: baseVal },
  reproducao: { jogadoresComMk: reproducao(csJog, true), jogadoresSemMk: reproducao(csJog, false), mapasComMk: reproducao(csMapa, true), mapasSemMk: reproducao(csMapa, false), listaIgualPagina: jog.filter((j) => j.rating === j.notaLista).length },
  danoPorAbate: { csJogadores: danoPorAbateCs, csMapas: danoPorAbateCsMapas },
  cortes,
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

const pct = (x) => `${(100 * x).toFixed(1)}%`.padStart(7);
console.log(`HLTV: ${jog.length} jogadores, ${mapas.length} linhas de ${mapasDistintos} mapas; univlr: ${valCarreiras.length} carreiras, ${valMapas.length} linhas (${baseVal})`);
for (const [n, r] of Object.entries(resultado.reproducao)) if (r && r.n) console.log(`  reprodução ${n}: erro ${r.erroMedio.toFixed(3)}, viés ${r.vies.toFixed(3)}, r ${r.r.toFixed(3)} (${r.n})`);
console.log(`  nota da lista igual à da página: ${resultado.reproducao.listaIgualPagina} de ${jog.length}`);
console.log(`  dano por abate no CS: ${danoPorAbateCs.toFixed(1)} (jogadores), ${danoPorAbateCsMapas.toFixed(1)} (mapas)`);
for (const [corte, c] of Object.entries(cortes)) {
  console.log(`\n${corte}: CS ${c.cs.n}, univlr ${c.univlr.n}`);
  console.log("  parte            CS β  CS oficial  univlr β  univlr ÷1,5 | desvio CS/univlr");
  for (const p of P) console.log(`  ${p.padEnd(14)} ${pct(c.cs.comBeta[p])} ${pct(c.csContraOficial[p])}    ${pct(c.univlr.comBeta[p])}    ${pct(c.univlr.comDano15[p])}  | ${(c.cs.desvio[p] / c.univlr.desvio[p]).toFixed(2)}`);
  const dist = Math.max(...P.map((p) => Math.abs(c.univlr.comDano15[p] - c.cs.comBeta[p])));
  console.log(`  maior distância (univlr ÷1,5 contra CS β): ${(100 * dist).toFixed(1)} pontos`);
}
