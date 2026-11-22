// Estudo de 21/11/2026 (fora do build): incerteza do teste A com a amostra grande da HLTV.
// Reamostra jogadores (com reposição) nos dois lados e mede, para cada conjunto de pesos,
// a distância entre a participação de cada parte no univlr e no CS (carreira, mesmo
// recorte do teste de 20/11: univlr com 500+ rounds, contagens de hoje).
//
// Uso: node --max-old-space-size=14000 scripts/estudos/bootstrap_participacao.js <hltv_jogadores_grande.csv> <variantes.json> <saida.json> [minMapasCs]

const fs = require("fs");
const { BETA, taxas } = require("./nota_beta.js");

const [arqCs, arqVariantes, saida, minMapasArg] = process.argv.slice(2);
if (!arqCs || !arqVariantes || !saida) {
  console.error("uso: node scripts/estudos/bootstrap_participacao.js <hltv_jogadores_grande.csv> <variantes.json> <saida.json> [minMapasCs]");
  process.exit(2);
}
const minMapas = Number(minMapasArg || 10);
const P = ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"];
const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const desvio = (v) => {
  const m = media(v);
  return Math.sqrt(media(v.map((x) => (x - m) ** 2)));
};
function participacao(linhas, betas) {
  const R = linhas.map((x) => P.reduce((s, p) => s + betas[p] * x[p], 0));
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
// sorteio com semente fixa, para o resultado se repetir
function sorteador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sorteio = sorteador(20261121);
const reamostra = (v) => v.map(() => v[Math.floor(sorteio() * v.length)]);
const quantil = (v, q) => {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(q * o.length))];
};

// CS: jogadores com o mínimo de mapas
const linhasCsv = fs.readFileSync(arqCs, "utf8").trim().split(/\r?\n/);
const cab = linhasCsv[0].split(",");
const cs = linhasCsv
  .slice(1)
  .map((l) => Object.fromEntries(l.split(",").map((v, i) => [cab[i], ["id", "slug"].includes(cab[i]) ? v : Number(v)])))
  .filter((j) => j.mapas >= minMapas)
  .map((j) => ({ abate: j.ekpr, sobrevivencia: 1 - j.edpr, dano: j.eadr / 100, kast: j.ekast / 100, swing: j.swing, multikill: j.mk / 100 }));

// univlr: carreiras com 500+ rounds, contagens de hoje
const dados = JSON.parse(fs.readFileSync(arqVariantes, "utf8"));
const CAMPOS = dados.campos.slice(1);
const g = new Map();
for (const [k, v] of Object.entries(dados.variantes.atual.linhas)) {
  const id = dados.referencia[k].id;
  if (!g.has(id)) g.set(id, Object.fromEntries(CAMPOS.map((c) => [c, 0])));
  const s = g.get(id);
  CAMPOS.forEach((c, i) => (s[c] += v[i + 1]));
}
const val = [...g.values()].filter((s) => s.rounds >= 500).map((s) => taxas(s));

// conjuntos de pesos; os convertidos pelo desvio são refeitos em cada reamostra
const fixos = {
  "β puros": BETA,
  "dano ÷ 1,5": { ...BETA, dano: BETA.dano / 1.5 },
  "dano ÷ 1,428": { ...BETA, dano: BETA.dano / 1.428 },
};
const convertidos = (c, v) => Object.fromEntries(P.map((p) => [p, (BETA[p] * desvio(c.map((x) => x[p]))) / desvio(v.map((x) => x[p]))]));

function medir(c, v) {
  const refCs = participacao(c, BETA);
  const conjuntos = { ...fixos, "convertidos pelo desvio": convertidos(c, v) };
  const out = { cs: refCs };
  for (const [nome, b] of Object.entries(conjuntos)) {
    const pv = participacao(v, b);
    const dist = Object.fromEntries(P.map((p) => [p, pv[p] - refCs[p]]));
    out[nome] = { univlr: pv, dist, maior: Math.max(...P.map((p) => Math.abs(dist[p]))) };
  }
  return out;
}

const base = medir(cs, val);
const N = 1000;
const amostras = [];
for (let i = 0; i < N; i++) amostras.push(medir(reamostra(cs), reamostra(val)));

const resumo = { cs: { jogadores: cs.length, minMapas }, univlr: { carreiras: val.length, minRounds: 500 }, reamostras: N, conjuntos: {} };
for (const nome of Object.keys(base).filter((k) => k !== "cs")) {
  const r = { maior: { valor: base[nome].maior, de: quantil(amostras.map((a) => a[nome].maior), 0.025), ate: quantil(amostras.map((a) => a[nome].maior), 0.975), acimaDe5: amostras.filter((a) => a[nome].maior > 0.05).length / N }, partes: {} };
  for (const p of P) {
    const d = amostras.map((a) => a[nome].dist[p]);
    r.partes[p] = { cs: base.cs[p], univlr: base[nome].univlr[p], dist: base[nome].dist[p], de: quantil(d, 0.025), ate: quantil(d, 0.975) };
  }
  resumo.conjuntos[nome] = r;
}
fs.writeFileSync(saida, JSON.stringify(resumo, null, 1));

const pp = (x) => (100 * x).toFixed(1).padStart(6);
console.log(`CS: ${cs.length} jogadores com ${minMapas}+ mapas; univlr: ${val.length} carreiras com 500+ rounds; ${N} reamostras`);
for (const [nome, r] of Object.entries(resumo.conjuntos)) {
  console.log(`\n${nome}: maior distância ${pp(r.maior.valor)} pontos (95%: ${pp(r.maior.de)} a ${pp(r.maior.ate)}); acima de 5 em ${(100 * r.maior.acimaDe5).toFixed(0)}% das reamostras`);
  for (const p of P) {
    const x = r.partes[p];
    console.log(`  ${p.padEnd(14)} CS ${pp(x.cs)}  univlr ${pp(x.univlr)}  diferença ${pp(x.dist)} (${pp(x.de)} a ${pp(x.ate)})`);
  }
}
