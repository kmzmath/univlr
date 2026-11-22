// Estudo de 20/11/2026 (fora do build), teste A do desenho
// docs/superpowers/specs/2026-11-20-teste-pesos-hltv-design.md: os β da fórmula
// estimada fazem no Valorant o que fazem no CS?
//
// Uso: node --max-old-space-size=12000 scripts/estudos/comparar_hltv.js <hltv_jogadores.csv> <variantes.json> <saida.json>
//
// - hltv_jogadores.csv: um jogador por linha, colhido da página Overview da HLTV
//   (1º/05 a 20/11/2026): id,mapas,rating,swing,kpr,dpr,adr,kast,mk,ekpr,edpr,eadr,ekast,emk
//   (mk = % de rounds com 2+ abates; emk = "MK rating" da versão ajustada pela economia).
// - variantes.json: saída de raating_variantes.js.
// Grava também <pasta da saída>/betas_convertidos.json, lido por comparar_variantes.js.

const fs = require("fs");
const path = require("path");
const { BETA, centroDoGrupo, notaBeta, taxas } = require("./nota_beta.js");

const [arquivoHltv, arquivoVariantes, saida] = process.argv.slice(2);
if (!arquivoHltv || !arquivoVariantes || !saida) {
  console.error("uso: node scripts/estudos/comparar_hltv.js <hltv_jogadores.csv> <variantes.json> <saida.json>");
  process.exit(2);
}

const PARTES = ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"];
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
// Participação: cov(parte, nota) / var(nota). Com a nota igual à soma das partes, soma 1.
function participacao(linhas, betas, nota) {
  const R = linhas.map(nota);
  const mR = media(R);
  const vR = media(R.map((r) => (r - mR) ** 2));
  return Object.fromEntries(
    PARTES.map((p) => {
      const c = linhas.map((x) => betas[p] * x[p]);
      const mc = media(c);
      return [p, media(c.map((v, i) => (v - mc) * (R[i] - mR))) / vR];
    }),
  );
}
// Mínimos quadrados com intercepto (eliminação de Gauss nas equações normais).
function regressao(X, y) {
  const k = X[0].length + 1;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((linha, i) => {
    const v = [1, ...linha];
    for (let r = 0; r < k; r += 1) {
      for (let c = 0; c < k; c += 1) A[r][c] += v[r] * v[c];
      A[r][k] += v[r] * y[i];
    }
  });
  for (let c = 0; c < k; c += 1) {
    let piv = c;
    for (let r = c + 1; r < k; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < k; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= k; j += 1) A[r][j] -= f * A[c][j];
    }
  }
  const coef = A.map((linha, i) => linha[k] / linha[i]);
  const prev = X.map((linha) => coef[0] + linha.reduce((s, x, j) => s + coef[j + 1] * x, 0));
  const res = y.map((v, i) => v - prev[i]);
  return { coef, erroMedio: media(res.map(Math.abs)), r: pearson(prev, y) };
}

// ---------- HLTV ----------
const linhasCsv = fs.readFileSync(arquivoHltv, "utf8").trim().split(/\r?\n/);
const cab = linhasCsv[0].split(",");
const brutos = linhasCsv.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cab[i], ["id", "slug"].includes(cab[i]) ? v : v === "" ? NaN : Number(v)])));
const completos = brutos.filter((j) => ["rating", "swing", "ekpr", "edpr", "eadr", "ekast", "mk", "emk", "kpr", "dpr", "adr", "kast"].every((c) => Number.isFinite(j[c])));
// entradas na unidade da fórmula: frações e pontos percentuais
const cs = (j, eco = true) => ({
  abate: eco ? j.ekpr : j.kpr,
  sobrevivencia: 1 - (eco ? j.edpr : j.dpr),
  dano: (eco ? j.eadr : j.adr) / 100,
  kast: (eco ? j.ekast : j.kast) / 100,
  swing: j.swing,
  multikill: j.mk / 100,
});
const linhasCs = completos.map((j) => ({ ...cs(j), rating: j.rating, mkRating: j.emk }));
const linhasCsTrad = completos.map((j) => ({ ...cs(j, false), rating: j.rating }));
const diferemComAjuste = completos.filter((j) => j.ekpr !== j.kpr || j.eadr !== j.adr).length;

const crua = (x, mk) => 0.1358 + PARTES.reduce((s, p) => s + (p === "multikill" ? 0 : BETA[p] * x[p]), 0) + 0.0241 * mk;
const reproducao = {};
for (const [nome, lin, mkDe] of [
  ["ajustadas, multi-kill como fração", linhasCs, (x) => x.multikill],
  ["ajustadas, multi-kill pela MK rating", linhasCs, (x) => x.mkRating],
  ["ajustadas, sem multi-kill", linhasCs, () => 0],
  ["tradicionais, multi-kill como fração", linhasCsTrad, (x) => x.multikill],
]) {
  const est = lin.map((x) => crua(x, mkDe(x)));
  const dif = est.map((e, i) => e - lin[i].rating);
  reproducao[nome] = { erroMedio: media(dif.map(Math.abs)), viesMedio: media(dif), r: pearson(est, lin.map((x) => x.rating)) };
}
const regr = regressao(
  linhasCs.map((x) => PARTES.map((p) => x[p])),
  linhasCs.map((x) => x.rating),
);
const betasNaAmostra = Object.fromEntries(PARTES.map((p, i) => [p, regr.coef[i + 1]]));

const notaCs = (x) => PARTES.reduce((s, p) => s + BETA[p] * x[p], 0);
const participacaoCs = participacao(linhasCs, BETA, notaCs);
const participacaoCsOficial = participacao(linhasCs, BETA, (x) => x.rating);
const desvioCs = Object.fromEntries(PARTES.map((p) => [p, desvio(linhasCs.map((x) => x[p]))]));

// ---------- univlr ----------
const dados = JSON.parse(fs.readFileSync(arquivoVariantes, "utf8"));
const CAMPOS = dados.campos.slice(1);
const ref = dados.referencia;
function carreiras(variante, minRounds) {
  const g = new Map();
  for (const [chave, v] of Object.entries(dados.variantes[variante].linhas)) {
    const id = ref[chave].id;
    if (!g.has(id)) g.set(id, Object.fromEntries(CAMPOS.map((c) => [c, 0])));
    const s = g.get(id);
    CAMPOS.forEach((c, i) => (s[c] += v[i + 1]));
  }
  return [...g.values()].filter((s) => s.rounds >= minRounds);
}
// Dano por abate (21/11, a partir da observação do dono: no CS a vida é sempre 100;
// no Valorant é 100, 125 ou 150, e há cura). É o dano que custa um abate, com o
// dano limitado à vida como entra na nota (campo damage das linhas, igual ao
// applyEffectiveDamage), dividido pelo do CS (ADR / KPR da HLTV, pesado pelos mapas).
const danoPorAbateVal = (() => {
  let dano = 0;
  let abates = 0;
  for (const b of Object.values(ref)) {
    dano += b.damage;
    abates += b.kills;
  }
  return dano / abates;
})();
const danoPorAbateCs = completos.reduce((s, j) => s + j.adr * j.mapas, 0) / completos.reduce((s, j) => s + j.kpr * j.mapas, 0);
const fatorDano = danoPorAbateVal / danoPorAbateCs;

const univlr = {};
const betasConvertidos = {};
for (const variante of ["atual", "todas_time"]) {
  if (!dados.variantes[variante]) continue;
  const somas = carreiras(variante, 500);
  const linhasVal = somas.map((s) => taxas(s));
  const desvioVal = Object.fromEntries(PARTES.map((p) => [p, desvio(linhasVal.map((x) => x[p]))]));
  const conv = Object.fromEntries(PARTES.map((p) => [p, (BETA[p] * desvioCs[p]) / desvioVal[p]]));
  betasConvertidos[variante] = conv;
  // Achado fora do desenho: só o dano convertido pela vida (100 no CS, 150 com
  // colete pesado no Valorant). Mantém a variação entre jogadores do univlr.
  const vida = { ...BETA, dano: (BETA.dano * 100) / 150 };
  betasConvertidos[`vida_${variante}`] = vida;
  const dpa = { ...BETA, dano: BETA.dano / fatorDano };
  betasConvertidos[`dpa_${variante}`] = dpa;
  // e a conversão pela razão das médias (o swing fica: é ponto percentual nos dois)
  const mediaCs = Object.fromEntries(PARTES.map((p) => [p, media(linhasCs.map((x) => x[p]))]));
  const mediaVal = Object.fromEntries(PARTES.map((p) => [p, media(linhasVal.map((x) => x[p]))]));
  const pelaMedia = Object.fromEntries(PARTES.map((p) => [p, p === "swing" ? BETA[p] : (BETA[p] * mediaCs[p]) / mediaVal[p]]));
  const centro = centroDoGrupo(Object.values(dados.variantes[variante].linhas).map((v) => Object.fromEntries(CAMPOS.map((c, i) => [c, v[i + 1]]))));
  univlr[variante] = {
    jogadores: somas.length,
    desvio: desvioVal,
    razaoDesvioCsSobreValorant: Object.fromEntries(PARTES.map((p) => [p, desvioCs[p] / desvioVal[p]])),
    participacaoComBeta: participacao(linhasVal, BETA, (x) => PARTES.reduce((s, p) => s + BETA[p] * x[p], 0)),
    participacaoComConvertidos: participacao(linhasVal, conv, (x) => PARTES.reduce((s, p) => s + conv[p] * x[p], 0)),
    participacaoDanoPelaVida: participacao(linhasVal, vida, (x) => PARTES.reduce((s, p) => s + vida[p] * x[p], 0)),
    participacaoDanoPorAbate: participacao(linhasVal, dpa, (x) => PARTES.reduce((s, p) => s + dpa[p] * x[p], 0)),
    desvioDaNotaDanoPorAbate: desvio(somas.map((s) => notaBeta(s, centro, dpa))),
    participacaoPelaMedia: participacao(linhasVal, pelaMedia, (x) => PARTES.reduce((s, p) => s + pelaMedia[p] * x[p], 0)),
    media: mediaVal,
    mediaCs,
    betasConvertidos: conv,
    desvioDaNotaVida: desvio(somas.map((s) => notaBeta(s, centro, vida))),
    // controle: com desvios iguais, a conversão devolve os β
    controleConversao: Math.max(...PARTES.map((p) => Math.abs((BETA[p] * desvioVal[p]) / desvioVal[p] - BETA[p]))),
    // escala da nota com os β convertidos, para comparar com a dos β (centro do grupo, escala B)
    desvioDaNotaConvertida: desvio(somas.map((s) => notaBeta(s, centro, conv))),
    desvioDaNotaBeta: desvio(somas.map((s) => notaBeta(s, centro))),
  };
}

const resultado = {
  hltv: {
    lidos: brutos.length,
    completos: completos.length,
    diferemComAjuste,
    reproducao,
    regressaoNaAmostra: { betas: betasNaAmostra, intercepto: regr.coef[0], erroMedio: regr.erroMedio, r: regr.r },
    participacaoComBeta: participacaoCs,
    participacaoContraNotaOficial: participacaoCsOficial,
    desvio: desvioCs,
  },
  univlr,
  danoPorAbate: { valorant: danoPorAbateVal, cs: danoPorAbateCs, fator: fatorDano },
  betas: BETA,
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));
fs.writeFileSync(path.join(path.dirname(saida), "betas_convertidos.json"), JSON.stringify(betasConvertidos, null, 1));

const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`HLTV: ${completos.length} de ${brutos.length} jogadores completos; ${diferemComAjuste} com valores ajustados diferentes dos tradicionais`);
for (const [nome, r] of Object.entries(reproducao)) console.log(`  reprodução (${nome}): erro médio ${r.erroMedio.toFixed(3)}, viés ${r.viesMedio.toFixed(3)}, r ${r.r.toFixed(3)}`);
console.log(`  regressão na amostra: r ${regr.r.toFixed(3)}, erro ${regr.erroMedio.toFixed(3)},`, PARTES.map((p) => `${p} ${betasNaAmostra[p].toFixed(3)} (β ${BETA[p]})`).join(", "));
console.log("participação (CS com β | contra a oficial | univlr hoje com β | univlr 1+2+3 com β | univlr hoje convertidos):");
for (const p of PARTES) {
  console.log(`  ${p.padEnd(14)} ${pct(participacaoCs[p]).padStart(7)} ${pct(participacaoCsOficial[p]).padStart(7)} ${pct(univlr.atual.participacaoComBeta[p]).padStart(7)} ${univlr.todas_time ? pct(univlr.todas_time.participacaoComBeta[p]).padStart(7) : ""} ${pct(univlr.atual.participacaoComConvertidos[p]).padStart(7)}`);
}
console.log("desvio CS / desvio univlr (hoje):", PARTES.map((p) => `${p} ${univlr.atual.razaoDesvioCsSobreValorant[p].toFixed(2)}`).join(", "));
console.log("β convertidos (hoje):", PARTES.map((p) => `${p} ${univlr.atual.betasConvertidos[p].toFixed(4)}`).join(", "));
if (univlr.todas_time) console.log("β convertidos (1+2+3):", PARTES.map((p) => `${p} ${univlr.todas_time.betasConvertidos[p].toFixed(4)}`).join(", "));
console.log(`controle da conversão: ${univlr.atual.controleConversao}; desvio da nota: β ${univlr.atual.desvioDaNotaBeta.toFixed(3)}, convertidos ${univlr.atual.desvioDaNotaConvertida.toFixed(3)}, dano pela vida ${univlr.atual.desvioDaNotaVida.toFixed(3)}`);
console.log("participação no univlr (hoje): dano pela vida |", PARTES.map((p) => `${p} ${pct(univlr.atual.participacaoDanoPelaVida[p])}`).join(", "));
console.log("participação no univlr (hoje): pela média     |", PARTES.map((p) => `${p} ${pct(univlr.atual.participacaoPelaMedia[p])}`).join(", "));
console.log(`dano por abate: univlr ${danoPorAbateVal.toFixed(1)}, CS ${danoPorAbateCs.toFixed(1)}, fator ${fatorDano.toFixed(3)}; desvio da nota ${univlr.atual.desvioDaNotaDanoPorAbate.toFixed(3)}`);
console.log("participação no univlr (hoje): dano por abate  |", PARTES.map((p) => `${p} ${pct(univlr.atual.participacaoDanoPorAbate[p])}`).join(", "));
