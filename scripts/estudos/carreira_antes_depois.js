// Estudo de 21/11/2026 (fora do build): a nota de carreira de cada jogador hoje e
// com tudo o que a especificação 2026-11-21-raating-hltv-design.md decide
// (variante `final` de raating_variantes.js + β com o dano ÷ 1,5).
//
// Uso: node --max-old-space-size=14000 scripts/estudos/carreira_antes_depois.js <variantes.json> <betas_convertidos.json> <saida.json>

const fs = require("fs");
const path = require("path");
const Core = require(path.join(__dirname, "..", "..", "raating-core.js"));
const { centroDoGrupo, notaBeta, taxas } = require("./nota_beta.js");

const [arquivoVariantes, arquivoBetas, saida] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(arquivoVariantes, "utf8"));
const BETAS = JSON.parse(fs.readFileSync(arquivoBetas, "utf8")).vida_todas_time;
const C = d.campos.slice(1);
const linha = (v) => Object.fromEntries(C.map((c, i) => [c, v[i + 1]]));
const P = ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"];

// peso por unidade dos pesos de hoje (peso x 0,28 / IQR) e os ajustes de hoje
const W = Core.RATING_3_WEIGHTS;
const BA = Core.RATING_3_BASELINES;
const U = {
  abate: (W.KillRating * 0.28) / BA.metric_kill.iqr,
  sobrevivencia: (W.SurvivalRating * 0.28) / BA.metric_survival.iqr,
  dano: (W.DamageRating * 0.28) / BA.metric_damage.iqr,
  kast: (W.KASTRating * 0.28) / BA.metric_kast.iqr,
  swing: (W.RoundSwingRating * 0.28) / BA.metric_round_swing.iqr,
  multikill: (W.MultiKillRating * 0.28) / BA.metric_multikill.iqr,
};
const ajustesHoje = (s) => {
  const t = (x) => (s.rounds ? x / s.rounds : 0);
  return U.abate * (0.025 * t(s.firstKills) + 0.015 * t(s.tradeDenials)) + U.sobrevivencia * (0.04 * t(s.tradedDeaths) - 0.04 * t(s.failedTradeDeaths) - 0.03 * t(s.firstDeaths) - 0.02 * t(s.savedLossRounds) + 0.015 * t(s.survivedWinRounds));
};

function carreiras(variante) {
  const g = new Map();
  for (const [k, v] of Object.entries(d.variantes[variante].linhas)) {
    const b = d.referencia[k];
    if (!g.has(b.id)) g.set(b.id, { id: b.id, nick: b.nick, s: Object.fromEntries(C.map((c) => [c, 0])), kills: 0, deaths: 0, damage: 0, mapas: 0 });
    const x = g.get(b.id);
    C.forEach((c, i) => (x.s[c] += v[i + 1]));
    x.kills += b.kills;
    x.deaths += b.deaths;
    x.damage += b.damage;
    x.mapas += 1;
  }
  return g;
}
const hoje = carreiras("atual");
const nova = carreiras("final");
const centroHoje = centroDoGrupo(Object.values(d.variantes.atual.linhas).map(linha));
const centroNovo = centroDoGrupo(Object.values(d.variantes.final.linhas).map(linha));
const notaHojeDoCentro = Core.calculateRaating3(Object.fromEntries(Object.entries({ rounds: 1, eKillPoints: centroHoje.abate, eDeathPoints: 1 - centroHoje.sobrevivencia, eDamageTotal: centroHoje.dano * 100, eKastPoints: centroHoje.kast, adjustedRoundSwingTotalPp: centroHoje.swing, multiKillPoints: centroHoje.multikill }))).raating_3;

const jogadores = [];
for (const [id, h] of hoje) {
  const n = nova.get(id);
  const th = taxas(h.s);
  const tn = taxas(n.s);
  const notaHoje = Core.calculateRaating3(h.s).raating_3;
  const notaNova = notaBeta(n.s, centroNovo, BETAS);
  // de onde vem a diferença: cada parte nova menos a parte de hoje, as duas medidas a partir da média do grupo
  const partes = Object.fromEntries(P.map((p) => [p, BETAS[p] * (tn[p] - centroNovo[p]) - U[p] * (th[p] - centroHoje[p])]));
  jogadores.push({
    id,
    nick: h.nick,
    rounds: h.s.rounds,
    mapas: h.mapas,
    notaHoje,
    notaNova,
    delta: notaNova - notaHoje,
    partes,
    ajustesQueSaem: -ajustesHoje(h.s),
    taxas: { kpr: h.kills / h.s.rounds, dpr: h.deaths / h.s.rounds, adr: h.damage / h.s.rounds, kast: th.kast, mkpr: th.multikill, swingHoje: th.swing, swingNovo: tn.swing, ekprHoje: th.abate, ekprNovo: tn.abate },
  });
}

const ordenar = (lista, campo) => [...lista].sort((a, b) => b[campo] - a[campo] || b.rounds - a.rounds);
function posicoes(lista) {
  const ph = new Map(ordenar(lista, "notaHoje").map((j, i) => [j.id, i + 1]));
  const pn = new Map(ordenar(lista, "notaNova").map((j, i) => [j.id, i + 1]));
  for (const j of lista) {
    j.posHoje = ph.get(j.id);
    j.posNova = pn.get(j.id);
    j.subiu = j.posHoje - j.posNova;
  }
}
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const desvio = (v) => Math.sqrt(media(v.map((x) => (x - media(v)) ** 2)));
const quantil = (v, q) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * q)];
const postos = (v) => {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  o.forEach(([, i], k) => (r[i] = k + 1));
  return r;
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

const resultado = { notaDeHojeNaMediaDoGrupo: notaHojeDoCentro, cortes: {} };
for (const minimo of [50, 500]) {
  const lista = jogadores.filter((j) => j.rounds >= minimo);
  posicoes(lista);
  const deltas = lista.map((j) => j.delta);
  const topHoje = new Set(ordenar(lista, "notaHoje").slice(0, 10).map((j) => j.id));
  const resumoJogador = (j) => j && { nick: j.nick, rounds: j.rounds, notaHoje: j.notaHoje, notaNova: j.notaNova, delta: j.delta, posHoje: j.posHoje, posNova: j.posNova };
  resultado.cortes[minimo] = {
    jogadores: lista.length,
    spearman: pearson(postos(lista.map((j) => j.notaHoje)), postos(lista.map((j) => j.notaNova))),
    top10Mantidos: ordenar(lista, "notaNova").slice(0, 10).filter((j) => topHoje.has(j.id)).length,
    top10Hoje: ordenar(lista, "notaHoje").slice(0, 10).map(resumoJogador),
    top10Novo: ordenar(lista, "notaNova").slice(0, 10).map(resumoJogador),
    maiorHoje: resumoJogador(ordenar(lista, "notaHoje")[0]),
    menorHoje: resumoJogador(ordenar(lista, "notaHoje").at(-1)),
    maiorNova: resumoJogador(ordenar(lista, "notaNova")[0]),
    menorNova: resumoJogador(ordenar(lista, "notaNova").at(-1)),
    desvioHoje: desvio(lista.map((j) => j.notaHoje)),
    desvioNovo: desvio(lista.map((j) => j.notaNova)),
    medianaHoje: quantil(lista.map((j) => j.notaHoje), 0.5),
    medianaNova: quantil(lista.map((j) => j.notaNova), 0.5),
    delta: { mediana: quantil(deltas, 0.5), p10: quantil(deltas, 0.1), p90: quantil(deltas, 0.9), medianaAbs: quantil(deltas.map(Math.abs), 0.5), sobem: deltas.filter((x) => x > 0.005).length, descem: deltas.filter((x) => x < -0.005).length },
    posicao: { medianaAbs: quantil(lista.map((j) => Math.abs(j.subiu)), 0.5), p90Abs: quantil(lista.map((j) => Math.abs(j.subiu)), 0.9) },
    sobem: ordenar(lista, "delta").slice(0, 10),
    descem: ordenar(lista, "delta").slice(-10).reverse(),
    sobemPosicao: [...lista].sort((a, b) => b.subiu - a.subiu).slice(0, 8),
    descemPosicao: [...lista].sort((a, b) => a.subiu - b.subiu).slice(0, 8),
  };
}
// sem corte de amostra (como os Recordes e quem tem 1 mapa)
const todos = jogadores.filter((j) => j.rounds > 0);
const porNova = ordenar(todos, "notaNova");
const porHoje = ordenar(todos, "notaHoje");
resultado.semCorte = {
  jogadores: todos.length,
  maiorHoje: { nick: porHoje[0].nick, rounds: porHoje[0].rounds, nota: porHoje[0].notaHoje },
  menorHoje: { nick: porHoje.at(-1).nick, rounds: porHoje.at(-1).rounds, nota: porHoje.at(-1).notaHoje },
  maiorNova: { nick: porNova[0].nick, rounds: porNova[0].rounds, nota: porNova[0].notaNova },
  menorNova: { nick: porNova.at(-1).nick, rounds: porNova.at(-1).rounds, nota: porNova.at(-1).notaNova },
  maiorMudanca: [...todos].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3).map((j) => ({ nick: j.nick, rounds: j.rounds, notaHoje: j.notaHoje, notaNova: j.notaNova })),
};
// Alternativa: 1,00 na mediana dos mapas (decisão de 16/11) em vez da média do grupo.
// É só somar uma constante; a ordem não muda.
const mapasNovos = Object.values(d.variantes.final.linhas).map((v) => notaBeta(linha(v), centroNovo, BETAS)).sort((a, b) => a - b);
const deslocamento = 1 - mapasNovos[Math.floor(mapasNovos.length / 2)];
const amostra = jogadores.filter((j) => j.rounds >= 50);
const deltasMediana = amostra.map((j) => j.delta + deslocamento);
resultado.mediana = {
  deslocamento,
  medianaDeltaCarreira: quantil(deltasMediana, 0.5),
  sobem: deltasMediana.filter((x) => x > 0.005).length,
  descem: deltasMediana.filter((x) => x < -0.005).length,
  medianaCarreira: quantil(amostra.map((j) => j.notaNova + deslocamento), 0.5),
  maior: Math.max(...amostra.map((j) => j.notaNova + deslocamento)),
  menor: Math.min(...amostra.map((j) => j.notaNova + deslocamento)),
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));
// a lista inteira, para abrir numa planilha
const csv = ["jogador;rounds;mapas;nota_hoje;nota_nova;diferenca;posicao_hoje;posicao_nova"];
posicoes(amostra);
for (const j of ordenar(amostra, "notaNova")) csv.push([j.nick, j.rounds, j.mapas, j.notaHoje.toFixed(3), j.notaNova.toFixed(3), j.delta.toFixed(3), j.posHoje, j.posNova].join(";").replace(/\./g, ","));
fs.writeFileSync(path.join(path.dirname(saida), "carreira_antes_depois.csv"), "﻿" + csv.join("\n"));

const f = (x, n = 2) => x.toFixed(n).replace(".", ",");
const NOMES = { abate: "abate", sobrevivencia: "sobrevivência", dano: "dano", kast: "KAST", swing: "swing", multikill: "multi-kill" };
const motivo = (j) => [...Object.entries(j.partes), ["ajustes de hoje", j.ajustesQueSaem]].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([p, v]) => `${NOMES[p] || p} ${v > 0 ? "+" : ""}${f(v, 3)}`).join(", ");
console.log(`nota de hoje de um jogador igual à média do grupo: ${f(notaHojeDoCentro, 3)} (na nova, 1,000)`);
for (const [minimo, r] of Object.entries(resultado.cortes)) {
  console.log(`\n=== carreira com ${minimo}+ rounds: ${r.jogadores} jogadores; Spearman ${f(r.spearman, 3)}; top 10 mantidos ${r.top10Mantidos}`);
  console.log(`maior: hoje ${r.maiorHoje.nick} ${f(r.maiorHoje.notaHoje)} | novo ${r.maiorNova.nick} ${f(r.maiorNova.notaNova)} (hoje ${f(r.maiorNova.notaHoje)})`);
  console.log(`menor: hoje ${r.menorHoje.nick} ${f(r.menorHoje.notaHoje)} | novo ${r.menorNova.nick} ${f(r.menorNova.notaNova)} (hoje ${f(r.menorNova.notaHoje)})`);
  console.log(`desvio ${f(r.desvioHoje, 3)} -> ${f(r.desvioNovo, 3)}; mediana ${f(r.medianaHoje, 3)} -> ${f(r.medianaNova, 3)}; mudança: mediana ${f(r.delta.mediana, 3)}, 10% ${f(r.delta.p10, 3)}, 90% ${f(r.delta.p90, 3)}, |mediana| ${f(r.delta.medianaAbs, 3)}; sobem ${r.delta.sobem}, descem ${r.delta.descem}; posição |mediana| ${r.posicao.medianaAbs}, 90% ${r.posicao.p90Abs}`);
  console.log("top 10 novo:", r.top10Novo.map((j) => `${j.nick} ${f(j.notaNova)} (${j.posHoje}º hoje, ${f(j.notaHoje)})`).join(" | "));
  for (const [rot, lst, campo] of [["SOBEM (nota)", r.sobem], ["DESCEM (nota)", r.descem], ["SOBEM (posição)", r.sobemPosicao], ["DESCEM (posição)", r.descemPosicao]]) {
    console.log(rot);
    for (const j of lst) console.log(`  ${j.nick.padEnd(16)} ${String(j.rounds).padStart(5)}r ${f(j.notaHoje)} -> ${f(j.notaNova)} (${j.delta > 0 ? "+" : ""}${f(j.delta, 3)}) pos ${j.posHoje} -> ${j.posNova} | KPR ${f(j.taxas.kpr)} ADR ${f(j.taxas.adr, 0)} DPR ${f(j.taxas.dpr)} KAST ${f(100 * j.taxas.kast, 0)}% swing ${f(j.taxas.swingHoje, 1)} -> ${f(j.taxas.swingNovo, 1)} | ${motivo(j)}`);
  }
}
const s = resultado.semCorte;
console.log(`\nsem corte (${s.jogadores}): maior hoje ${s.maiorHoje.nick} ${f(s.maiorHoje.nota)} (${s.maiorHoje.rounds}r), novo ${s.maiorNova.nick} ${f(s.maiorNova.nota)} (${s.maiorNova.rounds}r); menor hoje ${s.menorHoje.nick} ${f(s.menorHoje.nota)} (${s.menorHoje.rounds}r), novo ${s.menorNova.nick} ${f(s.menorNova.nota)} (${s.menorNova.rounds}r)`);
console.log("maior mudança sem corte:", s.maiorMudanca.map((j) => `${j.nick} ${f(j.notaHoje)} -> ${f(j.notaNova)} (${j.rounds}r)`).join(" | "));
const m = resultado.mediana;
console.log(`com 1,00 na mediana dos mapas (soma ${f(m.deslocamento, 3)}): mudança mediana ${f(m.medianaDeltaCarreira, 3)}, sobem ${m.sobem}, descem ${m.descem}; mediana da carreira ${f(m.medianaCarreira, 3)}; maior ${f(m.maior)}, menor ${f(m.menor)}`);
