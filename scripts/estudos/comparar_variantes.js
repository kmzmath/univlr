// Estudo de 20/11/2026 (fora do build): compara cada variante de
// raating_variantes.js com o rAAting 3.0 de hoje, por campeonato, por carreira
// e por mapa. Lê database.json só para conferir e para os nomes e o status dos
// campeonatos; não grava nada no site.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/comparar_variantes.js <variantes.json> <saida.json>

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const Core = require(path.join(ROOT, "raating-core.js"));
const codec = require(path.join(ROOT, "db-codec.js"));
const { BETA, centroDoGrupo, notaBeta } = require("./nota_beta.js");

// Variantes com a nota pelos β da HLTV (nota_beta.js): usam as linhas da
// variante base, porque os pesos não mudam nenhuma contagem.
// Os "β convertidos" (teste de 20/11, comparar_hltv.js) entram se o terceiro
// argumento apontar para o betas_convertidos.json.
const DERIVADAS = {
  pesos: "atual",
  pesos_dano: "v1_dano",
  pesos_spike: "v2_spike",
  pesos_dano_spike: "v12",
  pesos_todas: "todas",
  pesos_todas_time: "todas_time",
  convertidos: { base: "atual", betasDe: "atual" },
  convertidos_todas_time: { base: "todas_time", betasDe: "todas_time" },
  vida: { base: "atual", betasDe: "vida_atual" },
  vida_todas_time: { base: "todas_time", betasDe: "vida_todas_time" },
  vida_final: { base: "final", betasDe: "vida_todas_time" },
  dpa: { base: "atual", betasDe: "dpa_atual" },
  dpa_todas_time: { base: "todas_time", betasDe: "dpa_todas_time" },
};
const ARQUIVO_BETAS = process.argv[4];
const BETAS_CONVERTIDOS = ARQUIVO_BETAS && fs.existsSync(ARQUIVO_BETAS) ? JSON.parse(fs.readFileSync(ARQUIVO_BETAS, "utf8")) : null;

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error("uso: node scripts/estudos/comparar_variantes.js <variantes.json> <saida.json>");
  process.exit(2);
}
const MIN = Core.SAMPLE_MIN_ROUNDS;
const dados = JSON.parse(fs.readFileSync(entrada, "utf8"));
const CAMPOS = dados.campos.slice(1);
const ref = dados.referencia;

// ---------- Controle contra o banco publicado ----------
const db = codec.decode(JSON.parse(fs.readFileSync(path.join(ROOT, "database.json"), "utf8")));
let comparadas = 0;
let maiorPublicado = 0;
let faltando = 0;
for (const match of db.matches) {
  for (const player of match.players || []) {
    const linha = ref[`${match.id}|${player.puuid}`];
    if (!linha) {
      faltando += 1;
      continue;
    }
    comparadas += 1;
    maiorPublicado = Math.max(maiorPublicado, Math.abs(Number(player.raating_3) - linha.raating_3));
  }
}
const eventos = new Map(db.tournaments.map((t) => [t.id, { id: t.id, nome: t.name, status: t.status, tier: t.tier, fim: t.endAt }]));
// nota publicada por campeonato (player.eventStats), para conferir a agregação pela soma
const publicadoPorCampeonato = new Map();
for (const p of db.players || []) {
  for (const e of p.eventStats || []) {
    const nota = Number(e.raating_3 ?? e.rating);
    if (Number.isFinite(nota)) publicadoPorCampeonato.set(`${e.eventId}|${p.id}`, { nota });
  }
}

// ---------- Utilidades ----------
const soma = (xs) => xs.reduce((s, x) => s + x, 0);
const media = (xs) => (xs.length ? soma(xs) / xs.length : NaN);
const mediana = (xs) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const quantil = (xs, q) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  const pos = (o.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return o[lo] + (o[hi] - o[lo]) * (pos - lo);
};
const desvio = (xs) => {
  const m = media(xs);
  return Math.sqrt(media(xs.map((x) => (x - m) ** 2)));
};
function postos(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const p = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[idx[k][1]] = p;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const ma = media(a);
  const mb = media(b);
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < a.length; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbb += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * dbb);
}
const spearman = (a, b) => pearson(postos(a), postos(b));

function agregar(linhas, chaveDe, calc = Core.calculateRaating3) {
  const grupos = new Map();
  for (const [chave, valores] of Object.entries(linhas)) {
    const base = ref[chave];
    const g = chaveDe(base);
    if (!g) continue;
    if (!grupos.has(g)) grupos.set(g, { soma: Object.fromEntries(CAMPOS.map((c) => [c, 0])), id: base.id, nick: base.nick, eventId: base.eventId, mapas: 0, extra: { kills: 0, deaths: 0, damage: 0, kastRounds: 0 }, chaves: [] });
    const grupo = grupos.get(g);
    CAMPOS.forEach((campo, i) => {
      grupo.soma[campo] += valores[i + 1];
    });
    grupo.mapas += 1;
    grupo.extra.kills += base.kills;
    grupo.extra.deaths += base.deaths;
    grupo.extra.damage += base.damage;
    grupo.extra.kastRounds += base.kastRounds;
    grupo.chaves.push(chave);
  }
  for (const grupo of grupos.values()) grupo.nota = calc(grupo.soma);
  return grupos;
}

const linhaDe = (valores) => Object.fromEntries(CAMPOS.map((campo, i) => [campo, valores[i + 1]]));

// Ordena como o site: nota decrescente, desempate por rounds.
function ordenar(itens, notaDe) {
  return [...itens].sort((a, b) => notaDe(b) - notaDe(a) || b.rounds - a.rounds);
}

function compararGrupo(atual, variante, ids) {
  const itens = ids.map((id) => ({ id, rounds: atual.get(id).soma.rounds, a: atual.get(id).nota.raating_3, v: variante.get(id).nota.raating_3 }));
  const ordA = ordenar(itens, (x) => x.a);
  const ordV = ordenar(itens, (x) => x.v);
  const posA = new Map(ordA.map((x, i) => [x.id, i + 1]));
  const posV = new Map(ordV.map((x, i) => [x.id, i + 1]));
  const k = Math.min(10, itens.length);
  const topA = new Set(ordA.slice(0, k).map((x) => x.id));
  const mantidos = ordV.slice(0, k).filter((x) => topA.has(x.id)).length;
  const k3 = Math.min(3, itens.length);
  const podioA = new Set(ordA.slice(0, k3).map((x) => x.id));
  return {
    n: itens.length,
    spearman: spearman(itens.map((x) => x.a), itens.map((x) => x.v)),
    topK: k,
    top10Mantidos: mantidos,
    podioMantidos: ordV.slice(0, k3).filter((x) => podioA.has(x.id)).length,
    primeiroMudou: ordA[0].id !== ordV[0].id,
    primeiroAtual: ordA[0].id,
    primeiroVariante: ordV[0].id,
    deltasPos: itens.map((x) => Math.abs(posV.get(x.id) - posA.get(x.id))),
    posA,
    posV,
    desvioA: desvio(itens.map((x) => x.a)),
    desvioV: desvio(itens.map((x) => x.v)),
    medianaA: mediana(itens.map((x) => x.a)),
    medianaV: mediana(itens.map((x) => x.v)),
    deltas: itens.map((x) => x.v - x.a),
  };
}

const PESOS = Core.RATING_3_WEIGHTS;
const PARTES = [
  ["KillRating", "abate"],
  ["DamageRating", "dano"],
  ["MultiKillRating", "multi-kill"],
  ["RoundSwingRating", "swing"],
  ["SurvivalRating", "sobrevivência"],
  ["KASTRating", "KAST"],
];
function partes(notaA, notaV) {
  if (!notaA.KillRating || !notaV.KillRating) return null;
  return Object.fromEntries(PARTES.map(([campo, nome]) => [nome, PESOS[campo] * (notaV[campo] - notaA[campo])]));
}

// Contribuição de cada parte à nota, nas duas fórmulas. As duas são lineares
// nas taxas por round, então nota = constante + soma das contribuições.
// Peso por unidade da nota de hoje: peso x 0,28 / IQR da régua.
const BASE = Core.RATING_3_BASELINES;
const UNIDADE_HOJE = {
  abate: (PESOS.KillRating * 0.28) / BASE.metric_kill.iqr,
  dano: (PESOS.DamageRating * 0.28) / BASE.metric_damage.iqr,
  multikill: (PESOS.MultiKillRating * 0.28) / BASE.metric_multikill.iqr,
  swing: (PESOS.RoundSwingRating * 0.28) / BASE.metric_round_swing.iqr,
  sobrevivencia: (PESOS.SurvivalRating * 0.28) / BASE.metric_survival.iqr,
  kast: (PESOS.KASTRating * 0.28) / BASE.metric_kast.iqr,
};
const NOMES_PARTES = ["abate", "aberturaETroca", "dano", "multikill", "swing", "sobrevivencia", "ajustesDaSobrevivencia", "kast"];
function contribuicoes(s, beta) {
  const r = s.rounds;
  const t = (x) => (r ? x / r : 0);
  const x = {
    abate: t(s.eKillPoints),
    sobrevivencia: 1 - t(s.eDeathPoints),
    dano: t(s.eDamageTotal) / 100,
    kast: t(s.eKastPoints),
    swing: t(s.adjustedRoundSwingTotalPp),
    multikill: t(s.multiKillPoints),
  };
  if (beta) {
    const B = beta === true ? BETA : beta;
    return { abate: B.abate * x.abate, aberturaETroca: 0, dano: B.dano * x.dano, multikill: B.multikill * x.multikill, swing: B.swing * x.swing, sobrevivencia: B.sobrevivencia * x.sobrevivencia, ajustesDaSobrevivencia: 0, kast: B.kast * x.kast };
  }
  return {
    abate: UNIDADE_HOJE.abate * x.abate,
    aberturaETroca: UNIDADE_HOJE.abate * (0.025 * t(s.firstKills) + 0.015 * t(s.tradeDenials)),
    dano: UNIDADE_HOJE.dano * x.dano,
    multikill: UNIDADE_HOJE.multikill * x.multikill,
    swing: UNIDADE_HOJE.swing * x.swing,
    sobrevivencia: UNIDADE_HOJE.sobrevivencia * x.sobrevivencia,
    ajustesDaSobrevivencia:
      UNIDADE_HOJE.sobrevivencia *
      (0.04 * t(s.tradedDeaths) - 0.04 * t(s.failedTradeDeaths) - 0.03 * t(s.firstDeaths) - 0.02 * t(s.savedLossRounds) + 0.015 * t(s.survivedWinRounds)),
    kast: UNIDADE_HOJE.kast * x.kast,
  };
}

// Num campeonato: nota e partes em desvios do campeonato (centradas na média dos
// jogadores com amostra, divididas pelo desvio da nota). As partes somam a nota.
function emDesvios(grupos, ids, beta) {
  const notas = ids.map((id) => grupos.get(id).nota.raating_3);
  const m = media(notas);
  const sd = desvio(notas);
  const partes = ids.map((id) => contribuicoes(grupos.get(id).soma, beta));
  const medias = Object.fromEntries(NOMES_PARTES.map((p) => [p, media(partes.map((c) => c[p]))]));
  const saida = new Map();
  ids.forEach((id, i) => {
    saida.set(id, {
      z: (notas[i] - m) / sd,
      partes: Object.fromEntries(NOMES_PARTES.map((p) => [p, (partes[i][p] - medias[p]) / sd])),
    });
  });
  return saida;
}

// Quanto cada parte decide a ordem dentro do campeonato: cov(parte, nota) / var(nota),
// com tudo centrado por campeonato e somado sobre os campeonatos. Soma 1.
function participacao(grupos, beta) {
  const num = Object.fromEntries(NOMES_PARTES.map((p) => [p, 0]));
  let den = 0;
  for (const eventId of eventosComparados) {
    const ids = idsPorEvento.get(eventId);
    const notas = ids.map((id) => grupos.get(id).nota.raating_3);
    const m = media(notas);
    const partes = ids.map((id) => contribuicoes(grupos.get(id).soma, beta));
    for (const p of NOMES_PARTES) {
      const mp = media(partes.map((c) => c[p]));
      partes.forEach((c, i) => {
        num[p] += (c[p] - mp) * (notas[i] - m);
      });
    }
    den += soma(notas.map((n) => (n - m) ** 2));
  }
  return Object.fromEntries(NOMES_PARTES.map((p) => [p, num[p] / den]));
}

// ---------- Por variante ----------
const CATEGORIAS = [
  "abAtaSem", "abAtaCom", "abDefSem", "abDefCom", "moAtaSem", "moAtaCom", "moDefSem", "moDefCom",
  "recebido", "cedido", "aliado", "plantio", "plantioCobrado", "residuo", "correcao",
  "nAbAtaSem", "nAbAtaCom", "nAbDefSem", "nAbDefCom", "nPlantios",
];
const CATEGORIAS_DE_SWING = CATEGORIAS.filter((cat) => !cat.startsWith("n") && cat !== "cedido");
const diagHoje = dados.variantes.controle.porJogador;
const atualLinhas = dados.variantes.atual.linhas;
// controle da decomposição: as categorias de hoje somam o swing de cada linha
let maiorDecomposicao = 0;
const iSwing = dados.campos.indexOf("adjustedRoundSwingTotalPp");
for (const [chave, linha] of Object.entries(atualLinhas)) {
  const p0 = diagHoje[chave] || {};
  const somaCat = CATEGORIAS_DE_SWING.reduce((s, cat) => s + (p0[cat] || 0), 0);
  maiorDecomposicao = Math.max(maiorDecomposicao, Math.abs(somaCat - linha[iSwing]));
}
const atualCamp = agregar(atualLinhas, (b) => `${b.eventId}|${b.id}`);
const atualCarreira = agregar(atualLinhas, (b) => b.id);

// controle da agregação: soma x tournament.players publicado
let campConferidos = 0;
let maiorCamp = 0;
for (const [chave, g] of atualCamp) {
  const pub = publicadoPorCampeonato.get(chave);
  if (!pub) continue;
  campConferidos += 1;
  maiorCamp = Math.max(maiorCamp, Math.abs(pub.nota - g.nota.raating_3));
}

const relatorio = {
  controles: {
    linhasComparadasComPublicado: comparadas,
    linhasPublicadasSemRecalculo: faltando,
    maiorDiferencaMapaPublicado: maiorPublicado,
    notasDeCampeonatoConferidas: campConferidos,
    maiorDiferencaCampeonatoPublicado: maiorCamp,
    maiorDiferencaDecomposicaoDoSwing: maiorDecomposicao,
    ...dados.controles,
  },
  variantes: {},
};

const idsPorEvento = new Map();
for (const [chave, g] of atualCamp) {
  if (g.soma.rounds < MIN) continue;
  if (!idsPorEvento.has(g.eventId)) idsPorEvento.set(g.eventId, []);
  idsPorEvento.get(g.eventId).push(chave);
}
// Campeonatos com 10 ou mais jogadores na amostra (os mesmos 59 da comparação dos pesos de 20/11).
const MIN_JOGADORES = 10;
const eventosComparados = [...idsPorEvento.entries()].filter(([, ids]) => ids.length >= MIN_JOGADORES).map(([id]) => id);

// controle das partes: nota menos a soma das partes tem de ser constante
const sobra = (grupos, beta) => {
  const r = [...grupos.values()].map((g) => g.nota.raating_3 - soma(Object.values(contribuicoes(g.soma, beta))));
  return Math.max(...r) - Math.min(...r);
};
relatorio.controles.partesSomamANotaHoje = sobra(atualCamp, false);
const participacaoHoje = participacao(atualCamp, false);

const LISTA = [
  ...Object.entries(dados.variantes).filter(([nome]) => nome !== "atual").map(([nome, variante]) => ({ nome, variante, beta: false })),
  ...Object.entries(DERIVADAS)
    .map(([nome, d]) => ({ nome, ...(typeof d === "string" ? { base: d } : d) }))
    .filter((d) => dados.variantes[d.base] && (!d.betasDe || BETAS_CONVERTIDOS?.[d.betasDe]))
    .map((d) => ({ nome: d.nome, variante: dados.variantes[d.base], beta: d.betasDe ? BETAS_CONVERTIDOS[d.betasDe] : true, base: d.base })),
];

for (const { nome, variante, beta, base } of LISTA) {
  let calc = Core.calculateRaating3;
  let notaMapa = (valores) => valores[0];
  let centro = null;
  if (beta) {
    const betas = beta === true ? undefined : beta;
    centro = centroDoGrupo(Object.values(variante.linhas).map(linhaDe));
    calc = (s) => ({ raating_3: notaBeta(s, centro, betas) });
    notaMapa = (valores) => notaBeta(linhaDe(valores), centro, betas);
  }
  const camp = agregar(variante.linhas, (b) => `${b.eventId}|${b.id}`, calc);
  const carreira = agregar(variante.linhas, (b) => b.id, calc);
  if (beta) relatorio.controles[`partesSomamANota_${nome}`] = sobra(camp, beta);

  // mapa a mapa
  const notasMapaA = [];
  const notasMapaV = [];
  const notaMapaV = {};
  let mapasMudaram = 0;
  let maiorMapa = 0;
  for (const [chave, valores] of Object.entries(variante.linhas)) {
    const a = atualLinhas[chave][0];
    const v = notaMapa(valores);
    notaMapaV[chave] = v;
    notasMapaA.push(a);
    notasMapaV.push(v);
    if (Math.round(a * 100) !== Math.round(v * 100)) mapasMudaram += 1;
    maiorMapa = Math.max(maiorMapa, Math.abs(v - a));
  }
  // recordes: 10 melhores mapas (todas as linhas, como a aba Recordes)
  const chavesMapa = Object.keys(variante.linhas);
  const topMapaA = new Set([...chavesMapa].sort((x, y) => atualLinhas[y][0] - atualLinhas[x][0]).slice(0, 10));
  const topMapaV = [...chavesMapa].sort((x, y) => notaMapaV[y] - notaMapaV[x]).slice(0, 10);

  // por campeonato
  const porEvento = [];
  const todosDeltasPos = [];
  const todosDeltas = [];
  for (const eventId of eventosComparados) {
    const c = compararGrupo(atualCamp, camp, idsPorEvento.get(eventId));
    todosDeltasPos.push(...c.deltasPos);
    todosDeltas.push(...c.deltas);
    const nomeDe = (chave) => atualCamp.get(chave).nick;
    porEvento.push({
      eventId,
      nome: eventos.get(eventId)?.nome || eventId,
      status: eventos.get(eventId)?.status || "",
      n: c.n,
      spearman: c.spearman,
      topK: c.topK,
      top10Mantidos: c.top10Mantidos,
      podioMantidos: c.podioMantidos,
      primeiroMudou: c.primeiroMudou,
      primeiroAtual: `${nomeDe(c.primeiroAtual)} ${atualCamp.get(c.primeiroAtual).nota.raating_3.toFixed(2)}`,
      primeiroVariante: `${nomeDe(c.primeiroVariante)} ${camp.get(c.primeiroVariante).nota.raating_3.toFixed(2)}`,
      medianaDeltaPos: mediana(c.deltasPos),
      maiorDeltaPos: Math.max(...c.deltasPos),
      razaoDesvio: c.desvioV / c.desvioA,
      medianaA: c.medianaA,
      medianaV: c.medianaV,
    });
  }

  // notas publicadas de campeonato que mudam (todas, com e sem amostra), em 2 casas
  let notasCamp = 0;
  let notasCampMudam = 0;
  let notasCampMudamEncerrados = 0;
  let notasCampEncerrados = 0;
  for (const [chave, g] of atualCamp) {
    const v = camp.get(chave).nota.raating_3;
    const mudou = Math.round(g.nota.raating_3 * 100) !== Math.round(v * 100);
    notasCamp += 1;
    if (mudou) notasCampMudam += 1;
    if (/finalizado/i.test(eventos.get(g.eventId)?.status || "")) {
      notasCampEncerrados += 1;
      if (mudou) notasCampMudamEncerrados += 1;
    }
  }

  // carreira (>= MIN rounds no total)
  const idsCarreira = [...atualCarreira.keys()].filter((id) => atualCarreira.get(id).soma.rounds >= MIN);
  const cc = compararGrupo(atualCarreira, carreira, idsCarreira);
  const top10Carreira = (grupos) => ordenar(idsCarreira.map((id) => ({ id, rounds: grupos.get(id).soma.rounds, nota: grupos.get(id).nota.raating_3 })), (x) => x.nota).slice(0, 10).map((x) => `${grupos.get(x.id).nick} ${x.nota.toFixed(2)}`);

  // quem mais sobe e mais desce (jogador x campeonato com amostra)
  const movimentos = [];
  for (const eventId of eventosComparados) {
    const ids = idsPorEvento.get(eventId);
    const c = compararGrupo(atualCamp, camp, ids);
    const zA = emDesvios(atualCamp, ids, false);
    const zV = emDesvios(camp, ids, beta);
    for (const chave of ids) {
      const ga = atualCamp.get(chave);
      const gv = camp.get(chave);
      const r = ga.soma.rounds;
      // swing por tipo de evento: variante, hoje e a diferença, por round
      const d = Object.fromEntries(CATEGORIAS.map((cat) => [cat, 0]));
      const d0 = Object.fromEntries(CATEGORIAS.map((cat) => [cat, 0]));
      const temDecomposicao = Boolean(variante.cfg.reescrito);
      for (const k of ga.chaves) {
        const pj = variante.porJogador?.[k];
        const p0 = diagHoje[k];
        if (pj) for (const cat of CATEGORIAS) d[cat] += pj[cat] || 0;
        if (p0) for (const cat of CATEGORIAS) d0[cat] += p0[cat] || 0;
      }
      const swingPorTipo = temDecomposicao ? Object.fromEntries(CATEGORIAS.map((cat) => [cat, { hoje: d0[cat] / r, nova: d[cat] / r, delta: (d[cat] - d0[cat]) / r }])) : null;
      movimentos.push({
        jogador: ga.nick,
        campeonato: eventos.get(eventId)?.nome || eventId,
        rounds: r,
        mapas: ga.mapas,
        notaAtual: ga.nota.raating_3,
        notaNova: gv.nota.raating_3,
        delta: gv.nota.raating_3 - ga.nota.raating_3,
        posAtual: c.posA.get(chave),
        posNova: c.posV.get(chave),
        n: c.n,
        partes: partes(ga.nota, gv.nota),
        deltaZ: zV.get(chave).z - zA.get(chave).z,
        partesEmDesvios: Object.fromEntries(NOMES_PARTES.map((p) => [p, { hoje: zA.get(chave).partes[p], nova: zV.get(chave).partes[p], delta: zV.get(chave).partes[p] - zA.get(chave).partes[p] }])),
        taxas: {
          mkpr: ga.soma.multiKillPoints / r,
          aberturas: ga.soma.firstKills / r,
          primeirasMortes: ga.soma.firstDeaths / r,
          negacoesDeTroca: ga.soma.tradeDenials / r,
        },
        porRound: {
          swingAtual: ga.soma.adjustedRoundSwingTotalPp / r,
          swingNovo: gv.soma.adjustedRoundSwingTotalPp / r,
          ekprAtual: ga.soma.eKillPoints / r,
          ekprNovo: gv.soma.eKillPoints / r,
          edprAtual: ga.soma.eDeathPoints / r,
          edprNovo: gv.soma.eDeathPoints / r,
          eadrAtual: ga.soma.eDamageTotal / r,
          eadrNovo: gv.soma.eDamageTotal / r,
          ekastAtual: ga.soma.eKastPoints / r,
          ekastNovo: gv.soma.eKastPoints / r,
          kpr: ga.extra.kills / r,
          dpr: ga.extra.deaths / r,
          adr: ga.extra.damage / r,
        },
        swingPorTipo,
      });
    }
  }
  movimentos.sort((a, b) => b.delta - a.delta);
  const porZ = [...movimentos].sort((a, b) => b.deltaZ - a.deltaZ);

  const encerrados = porEvento.filter((e) => /finalizado/i.test(e.status));
  relatorio.variantes[nome] = {
    cfg: variante.cfg,
    base: base || nome,
    pesosHltv: beta,
    centro,
    diag: variante.diag,
    ecoMeanRaw: variante.eco.meanRaw,
    participacaoHoje,
    participacao: participacao(camp, beta),
    resumo: {
      campeonatos: porEvento.length,
      jogadoresComAmostra: todosDeltasPos.length,
      spearmanMediana: mediana(porEvento.map((e) => e.spearman)),
      spearmanMinimo: Math.min(...porEvento.map((e) => e.spearman)),
      spearmanMinimoEm: porEvento.reduce((a, b) => (b.spearman < a.spearman ? b : a)).nome,
      top10MantidosPct: soma(porEvento.map((e) => e.top10Mantidos)) / soma(porEvento.map((e) => e.topK)),
      podioMantidosPct: soma(porEvento.map((e) => e.podioMantidos)) / soma(porEvento.map((e) => Math.min(3, e.n))),
      primeiroMudou: porEvento.filter((e) => e.primeiroMudou).length,
      primeiroMudouEncerrados: encerrados.filter((e) => e.primeiroMudou).length,
      encerrados: encerrados.length,
      medianaDeltaPos: mediana(todosDeltasPos),
      p90DeltaPos: quantil(todosDeltasPos, 0.9),
      maiorDeltaPos: Math.max(...todosDeltasPos),
      parados: todosDeltasPos.filter((x) => x === 0).length / todosDeltasPos.length,
      medianaAbsDelta: mediana(todosDeltas.map(Math.abs)),
      p90AbsDelta: quantil(todosDeltas.map(Math.abs), 0.9),
      maiorAbsDelta: Math.max(...todosDeltas.map(Math.abs)),
      razaoDesvioMediana: mediana(porEvento.map((e) => e.razaoDesvio)),
      medianaNotaCampAtual: mediana(porEvento.map((e) => e.medianaA)),
      medianaNotaCampNova: mediana(porEvento.map((e) => e.medianaV)),
      mapas: notasMapaA.length,
      mapaPearson: pearson(notasMapaA, notasMapaV),
      mapaSpearman: spearman(notasMapaA, notasMapaV),
      mapasMudaramEm2Casas: mapasMudaram,
      maiorDeltaMapa: maiorMapa,
      medianaMapaAtual: mediana(notasMapaA),
      medianaMapaNova: mediana(notasMapaV),
      desvioMapaAtual: desvio(notasMapaA),
      desvioMapaNovo: desvio(notasMapaV),
      recordesTop10Mantidos: topMapaV.filter((k) => topMapaA.has(k)).length,
      notasCampeonato: notasCamp,
      notasCampeonatoMudamEm2Casas: notasCampMudam,
      notasCampeonatoEncerrados: notasCampEncerrados,
      notasCampeonatoEncerradosMudam: notasCampMudamEncerrados,
      carreira: {
        n: cc.n,
        spearman: cc.spearman,
        top10Mantidos: cc.top10Mantidos,
        primeiroMudou: cc.primeiroMudou,
        medianaDeltaPos: mediana(cc.deltasPos),
        p90DeltaPos: quantil(cc.deltasPos, 0.9),
        razaoDesvio: cc.desvioV / cc.desvioA,
        top10Atual: top10Carreira(atualCarreira),
        top10Novo: top10Carreira(carreira),
      },
    },
    porEvento,
    sobem: movimentos.slice(0, 12),
    descem: movimentos.slice(-12).reverse(),
    sobemEmDesvios: porZ.slice(0, 12),
    descemEmDesvios: porZ.slice(-12).reverse(),
  };
}

fs.writeFileSync(saida, JSON.stringify(relatorio, null, 1));
console.log("controles:", JSON.stringify(relatorio.controles));
console.log("campeonatos comparados:", eventosComparados.length);
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");
console.log("variante | rho med | rho min | top10 | 1º muda | |dpos| med | p90 | desvio | mediana camp | mapas: rho, med, mudam");
for (const [nome, v] of Object.entries(relatorio.variantes)) {
  const r = v.resumo;
  console.log(
    nome.padEnd(17),
    f(r.spearmanMediana),
    f(r.spearmanMinimo),
    `${(100 * r.top10MantidosPct).toFixed(0)}%`,
    `${r.primeiroMudou}/${r.campeonatos}`,
    f(r.medianaDeltaPos, 1),
    f(r.p90DeltaPos, 1),
    f(r.razaoDesvioMediana, 2),
    `${f(r.medianaNotaCampAtual)}->${f(r.medianaNotaCampNova)}`,
    f(r.mapaSpearman),
    `${f(r.medianaMapaAtual)}->${f(r.medianaMapaNova)}`,
    `${r.mapasMudaramEm2Casas}/${r.mapas}`,
  );
}
