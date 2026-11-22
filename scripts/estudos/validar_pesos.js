// Estudo de 20/11/2026 (fora do build), teste B do desenho
// docs/superpowers/specs/2026-11-20-teste-pesos-hltv-design.md: qual conjunto de
// pesos mede melhor nas partidas do univlr?
//
// Uso: node --max-old-space-size=12000 scripts/estudos/validar_pesos.js <variantes.json> <betas_convertidos.json> <saida.json>
//
// - Estabilidade: jogadores com 200+ rounds, mapas em ordem de data alternados em
//   duas metades; correlação entre as notas das metades (e a correção de
//   Spearman-Brown para a amostra inteira).
// - Previsão: antes de cada mapa, a nota de cada jogador só com os mapas
//   anteriores (100+ rounds); média da equipe; a diferença prevê o vencedor?
//   Nunca usa o próprio mapa, porque o swing já carrega o resultado do round.
// - Controles: nota sorteada (tem de dar perto de zero e de 50%) e KPR puro.
// - Intervalos por reamostragem (1.000 vezes, semente fixa) para a diferença
//   entre cada peso e o de hoje.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const Core = require(path.join(ROOT, "raating-core.js"));
const codec = require(path.join(ROOT, "db-codec.js"));
const { centroDoGrupo, notaBeta } = require("./nota_beta.js");

const [arquivoVariantes, arquivoBetas, saida] = process.argv.slice(2);
if (!arquivoVariantes || !arquivoBetas || !saida) {
  console.error("uso: node scripts/estudos/validar_pesos.js <variantes.json> <betas_convertidos.json> <saida.json>");
  process.exit(2);
}
const dados = JSON.parse(fs.readFileSync(arquivoVariantes, "utf8"));
const betasConvertidos = JSON.parse(fs.readFileSync(arquivoBetas, "utf8"));
const CAMPOS = dados.campos.slice(1);
const ref = dados.referencia;

// placar de cada mapa
const db = codec.decode(JSON.parse(fs.readFileSync(path.join(ROOT, "database.json"), "utf8")));
const placar = new Map(db.matches.map((m) => [m.id, { [m.teamA.id]: m.teamA.score, [m.teamB.id]: m.teamB.score }]));

// pseudoaleatório com semente
function gerador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const pearson = (a, b) => {
  const ma = media(a);
  const mb = media(b);
  let n = 0;
  let da = 0;
  let db2 = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db2 += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db2);
};
const postos = (v) => {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < o.length; ) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) r[o[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
};
const spearman = (a, b) => pearson(postos(a), postos(b));
const quantil = (v, q) => {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor((o.length - 1) * q)];
};

function analisar(variante) {
  const linhas = dados.variantes[variante].linhas;
  const centro = centroDoGrupo(Object.values(linhas).map((v) => Object.fromEntries(CAMPOS.map((c, i) => [c, v[i + 1]]))));
  const conv = betasConvertidos[variante] ?? betasConvertidos.todas_time;
  const vida = betasConvertidos[`vida_${variante}`] ?? betasConvertidos.vida_todas_time;
  const dpa = betasConvertidos[`dpa_${variante}`] ?? betasConvertidos.dpa_todas_time;
  const sorteio = gerador(20261120);
  const ruido = new Map(); // ruído por linha, fixo
  const SISTEMAS = {
    hoje: (s) => Core.calculateRaating3(s).raating_3,
    beta: (s) => notaBeta(s, centro),
    convertidos: conv ? (s) => notaBeta(s, centro, conv) : null,
    danoPelaVida: vida ? (s) => notaBeta(s, centro, vida) : null,
    danoPorAbate: dpa ? (s) => notaBeta(s, centro, dpa) : null,
    kpr: (s) => (s.rounds ? s.eKillPoints / s.rounds : 0),
    sorteada: (s) => (s.rounds ? s.ruido / s.rounds : 0),
  };
  for (const k of Object.keys(SISTEMAS)) if (!SISTEMAS[k]) delete SISTEMAS[k];
  const nomes = Object.keys(SISTEMAS);
  const vazio = () => Object.fromEntries([...CAMPOS, "ruido"].map((c) => [c, 0]));
  const somar = (s, chave) => {
    const v = linhas[chave];
    CAMPOS.forEach((c, i) => (s[c] += v[i + 1]));
    if (!ruido.has(chave)) ruido.set(chave, sorteio());
    s.ruido += ruido.get(chave) * v[1];
  };

  // ---------- estabilidade ----------
  const porPessoa = new Map();
  for (const chave of Object.keys(linhas)) {
    const b = ref[chave];
    if (!porPessoa.has(b.id)) porPessoa.set(b.id, []);
    porPessoa.get(b.id).push(chave);
  }
  const metades = [];
  for (const chaves of porPessoa.values()) {
    const rounds = chaves.reduce((s, k) => s + ref[k].rounds, 0);
    if (rounds < 200 || chaves.length < 4) continue;
    chaves.sort((a, b) => ref[a].startedAt - ref[b].startedAt);
    const a = vazio();
    const b = vazio();
    chaves.forEach((k, i) => somar(i % 2 ? b : a, k));
    metades.push(Object.fromEntries(nomes.map((n) => [n, [SISTEMAS[n](a), SISTEMAS[n](b)]])));
  }
  const estabilidade = {};
  for (const n of nomes) {
    const r = pearson(metades.map((m) => m[n][0]), metades.map((m) => m[n][1]));
    estabilidade[n] = { r, spearman: spearman(metades.map((m) => m[n][0]), metades.map((m) => m[n][1])), inteira: (2 * r) / (1 + r) };
  }
  // reamostragem de jogadores: diferença de r contra hoje
  const boot = gerador(7);
  const difEst = Object.fromEntries(nomes.filter((n) => n !== "hoje").map((n) => [n, []]));
  for (let rep = 0; rep < 1000; rep += 1) {
    const amostra = metades.map(() => metades[Math.floor(boot() * metades.length)]);
    const rh = pearson(amostra.map((m) => m.hoje[0]), amostra.map((m) => m.hoje[1]));
    for (const n of Object.keys(difEst)) difEst[n].push(pearson(amostra.map((m) => m[n][0]), amostra.map((m) => m[n][1])) - rh);
  }
  for (const n of Object.keys(difEst)) estabilidade[n].diferencaContraHoje = { media: media(difEst[n]), de: quantil(difEst[n], 0.025), ate: quantil(difEst[n], 0.975) };

  // ---------- previsão ----------
  const porMapa = new Map();
  for (const chave of Object.keys(linhas)) {
    const b = ref[chave];
    if (!porMapa.has(b.matchId)) porMapa.set(b.matchId, { startedAt: b.startedAt, chaves: [] });
    porMapa.get(b.matchId).chaves.push(chave);
  }
  const mapas = [...porMapa.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
  const anterior = new Map(); // pessoa -> somas dos mapas anteriores
  const previsoes = [];
  for (const [matchId, { chaves }] of mapas) {
    const p = placar.get(matchId);
    const equipes = new Map();
    for (const k of chaves) {
      const b = ref[k];
      if (!equipes.has(b.teamId)) equipes.set(b.teamId, []);
      const s = anterior.get(b.id);
      if (s && s.rounds >= 100) equipes.get(b.teamId).push(s);
    }
    const ids = [...equipes.keys()];
    if (p && ids.length === 2 && ids.every((t) => equipes.get(t).length >= 3 && Number.isFinite(p[t]))) {
      const saldo = p[ids[0]] - p[ids[1]];
      if (saldo !== 0) {
        const diff = Object.fromEntries(nomes.map((n) => [n, media(equipes.get(ids[0]).map(SISTEMAS[n])) - media(equipes.get(ids[1]).map(SISTEMAS[n]))]));
        previsoes.push({ saldo, diff });
      }
    }
    for (const k of chaves) {
      const id = ref[k].id;
      if (!anterior.has(id)) anterior.set(id, vazio());
      somar(anterior.get(id), k);
    }
  }
  const acerto = (lista, n) => lista.filter((x) => Math.sign(x.diff[n]) === Math.sign(x.saldo)).length / lista.length;
  const previsao = {};
  for (const n of nomes) previsao[n] = { acerto: acerto(previsoes, n), spearman: spearman(previsoes.map((x) => x.diff[n]), previsoes.map((x) => x.saldo)) };
  const difPrev = Object.fromEntries(nomes.filter((n) => n !== "hoje").map((n) => [n, []]));
  for (let rep = 0; rep < 1000; rep += 1) {
    const amostra = previsoes.map(() => previsoes[Math.floor(boot() * previsoes.length)]);
    const ah = acerto(amostra, "hoje");
    for (const n of Object.keys(difPrev)) difPrev[n].push(acerto(amostra, n) - ah);
  }
  for (const n of Object.keys(difPrev)) previsao[n].diferencaContraHoje = { media: media(difPrev[n]), de: quantil(difPrev[n], 0.025), ate: quantil(difPrev[n], 0.975) };

  return { jogadoresNaEstabilidade: metades.length, mapasPrevistos: previsoes.length, estabilidade, previsao };
}

const resultado = {};
for (const variante of ["atual", "todas_time", "final"]) if (dados.variantes[variante]) resultado[variante] = analisar(variante);
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

const f = (x, d = 3) => x.toFixed(d);
for (const [variante, r] of Object.entries(resultado)) {
  console.log(`\n${variante}: ${r.jogadoresNaEstabilidade} jogadores na estabilidade, ${r.mapasPrevistos} mapas previstos`);
  console.log("sistema       estab. r  inteira  dif. contra hoje (95%)         | acerto  spearman  dif. contra hoje (95%)");
  for (const [n, e] of Object.entries(r.estabilidade)) {
    const p = r.previsao[n];
    const de = e.diferencaContraHoje ? `${f(e.diferencaContraHoje.media)} (${f(e.diferencaContraHoje.de)} a ${f(e.diferencaContraHoje.ate)})` : "-";
    const dp = p.diferencaContraHoje ? `${f(100 * p.diferencaContraHoje.media, 1)} (${f(100 * p.diferencaContraHoje.de, 1)} a ${f(100 * p.diferencaContraHoje.ate, 1)}) pontos` : "-";
    console.log(`${n.padEnd(12)} ${f(e.r).padStart(8)} ${f(e.inteira).padStart(8)}  ${de.padEnd(30)} | ${(100 * p.acerto).toFixed(1).padStart(5)}%  ${f(p.spearman).padStart(7)}  ${dp}`);
  }
}
