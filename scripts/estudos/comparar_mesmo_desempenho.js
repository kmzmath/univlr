// Estudo de 21/11/2026 (fora do build): o rAAting 3.1 dá nota maior que a HLTV 3.0
// para o mesmo desempenho? Compara mapas do univlr (variante `final` com os β e o
// dano ÷ 1,5, que é o rAAting 3.1) com mapas da HLTV (nota oficial) que tiveram a
// mesma linha tradicional: abates, mortes, dano e KAST por round.
//
// Uso: node --max-old-space-size=14000 scripts/estudos/comparar_mesmo_desempenho.js <hltv_mapas.csv> <variantes.json> <saida.json>
//
// - O dano do Valorant entra dividido por 1,5 (a conversão decidida em 21/11).
// - O pareamento é por célula: KPR e DPR de 0,05 em 0,05, dano de 5 em 5 e KAST de
//   5 em 5 pontos. A diferença é a média das células, pesada pelos mapas do univlr.
// - Cada nota é aberta nas seis partes, β·(x − x̄), com x̄ do próprio jogo. Na HLTV,
//   o que a fórmula estimada não explica da nota oficial fica como "resto".

const fs = require("fs");
const { BETA, taxas, centroDoGrupo } = require("./nota_beta.js");

const [arqMapas, arqVariantes, saida] = process.argv.slice(2);
if (!arqMapas || !arqVariantes || !saida) {
  console.error("uso: node scripts/estudos/comparar_mesmo_desempenho.js <hltv_mapas.csv> <variantes.json> <saida.json>");
  process.exit(2);
}
const P = ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"];
const B31 = { ...BETA, dano: BETA.dano / 1.5 };
const media = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
const MIN_ROUNDS = 13;

// ---------- HLTV ----------
const cs = fs
  .readFileSync(arqMapas, "utf8")
  .trim()
  .split(/\r?\n/)
  .map((l) => l.split(","))
  .filter((c) => /^\d+$/.test(c[0]))
  .map((c) => ({ R: +c[3], rating: +c[6], swing: +c[7], k: +c[8], ek: +c[9], d: +c[10], ed: +c[11], adr: +c[12], eadr: +c[13], kast: +c[14], ekast: +c[15], mks: +c[16] }))
  .filter((m) => m.R >= MIN_ROUNDS)
  .map((m) => ({
    trad: { kpr: m.k / m.R, dpr: m.d / m.R, adr: m.adr, kast: m.kast / 100 },
    x: { abate: m.ek / m.R, sobrevivencia: 1 - m.ed / m.R, dano: m.eadr / 100, kast: m.ekast / 100, swing: m.swing, multikill: m.mks / m.R },
    R: m.R,
    nota: m.rating,
  }));
const somaR = cs.reduce((s, m) => s + m.R, 0);
const centroCs = Object.fromEntries(P.map((p) => [p, cs.reduce((s, m) => s + m.x[p] * m.R, 0) / somaR]));
for (const m of cs) {
  m.partes = Object.fromEntries(P.map((p) => [p, BETA[p] * (m.x[p] - centroCs[p])]));
  m.resto = m.nota - 1 - P.reduce((s, p) => s + m.partes[p], 0);
}

// ---------- univlr (rAAting 3.1 = variante final com os β e o dano ÷ 1,5) ----------
const dados = JSON.parse(fs.readFileSync(arqVariantes, "utf8"));
const CAMPOS = dados.campos.slice(1);
const linhas = Object.entries(dados.variantes.final.linhas).map(([k, v]) => ({ ref: dados.referencia[k], c: Object.fromEntries(CAMPOS.map((n, i) => [n, v[i + 1]])) }));
const centroVal = centroDoGrupo(linhas.map((l) => l.c));
const val = linhas
  .filter((l) => l.c.rounds >= MIN_ROUNDS)
  .map((l) => {
    const R = l.c.rounds;
    const x = taxas(l.c);
    const partes = Object.fromEntries(P.map((p) => [p, B31[p] * (x[p] - centroVal[p])]));
    return {
      trad: { kpr: l.ref.kills / R, dpr: l.ref.deaths / R, adr: l.ref.damage / R / 1.5, kast: l.ref.kastRounds / R },
      x,
      R,
      partes,
      resto: 0,
      nota: 1 + P.reduce((s, p) => s + partes[p], 0),
      hoje: l.ref.raating_3,
    };
  });

// ---------- pareamento por célula ----------
const celula = (t) => [Math.floor(t.kpr / 0.05), Math.floor(t.dpr / 0.05), Math.floor(t.adr / 5), Math.floor(t.kast / 0.05)].join("|");
const grupos = new Map();
for (const [jogo, lista] of [["val", val], ["cs", cs]]) {
  for (const m of lista) {
    const k = celula(m.trad);
    if (!grupos.has(k)) grupos.set(k, { val: [], cs: [] });
    grupos.get(k)[jogo].push(m);
  }
}
const pares = [...grupos.values()].filter((g) => g.val.length && g.cs.length);
const pesoTotal = pares.reduce((s, g) => s + g.val.length, 0);
const mediaPesada = (f) => pares.reduce((s, g) => s + g.val.length * f(g), 0) / pesoTotal;
const dif = {
  nota: mediaPesada((g) => media(g.val.map((m) => m.nota)) - media(g.cs.map((m) => m.nota))),
  hoje: mediaPesada((g) => media(g.val.map((m) => m.hoje)) - media(g.cs.map((m) => m.nota))),
  partes: Object.fromEntries(P.map((p) => [p, mediaPesada((g) => media(g.val.map((m) => m.partes[p])) - media(g.cs.map((m) => m.partes[p])))])),
  resto: mediaPesada((g) => -media(g.cs.map((m) => m.resto))),
};
// por faixa de desempenho (pela nota da HLTV na célula)
const faixas = [
  ["abaixo de 0,8", -Infinity, 0.8],
  ["0,8 a 1,0", 0.8, 1.0],
  ["1,0 a 1,2", 1.0, 1.2],
  ["1,2 a 1,4", 1.2, 1.4],
  ["1,4 a 1,6", 1.4, 1.6],
  ["1,6 ou mais", 1.6, Infinity],
];
const porFaixa = faixas.map(([nome, de, ate]) => {
  const gs = pares.filter((g) => {
    const n = media(g.cs.map((m) => m.nota));
    return n >= de && n < ate;
  });
  const w = gs.reduce((s, g) => s + g.val.length, 0);
  const mp = (f) => gs.reduce((s, g) => s + g.val.length * f(g), 0) / w;
  return {
    faixa: nome,
    mapasUnivlr: w,
    hltv: mp((g) => media(g.cs.map((m) => m.nota))),
    r31: mp((g) => media(g.val.map((m) => m.nota))),
    hoje: mp((g) => media(g.val.map((m) => m.hoje))),
    swingHltv: mp((g) => media(g.cs.map((m) => m.x.swing))),
    swingUnivlr: mp((g) => media(g.val.map((m) => m.x.swing))),
    partes: Object.fromEntries(P.map((p) => [p, mp((g) => media(g.val.map((m) => m.partes[p])) - media(g.cs.map((m) => m.partes[p])))])),
  };
});
// controle: as entradas ajustadas e o swing de cada jogo nas células pareadas
const entradas = Object.fromEntries(P.map((p) => [p, { univlr: mediaPesada((g) => media(g.val.map((m) => m.x[p]))), hltv: mediaPesada((g) => media(g.cs.map((m) => m.x[p]))) }]));

const resultado = {
  mapas: { hltv: cs.length, univlr: val.length, celulasPareadas: pares.length, mapasUnivlrPareados: pesoTotal },
  centro: { hltv: centroCs, univlr: centroVal },
  mediaDaNota: { hltvOficial: media(cs.map((m) => m.nota)), hltvPelaFormula: media(cs.map((m) => 1 + P.reduce((s, p) => s + m.partes[p], 0))), univlr31: media(val.map((m) => m.nota)), univlrHoje: media(val.map((m) => m.hoje)) },
  diferencaNoMesmoDesempenho: dif,
  entradasNasCelulasPareadas: entradas,
  porFaixa,
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

const f3 = (x) => (x >= 0 ? "+" : "") + x.toFixed(3);
console.log(`mapas com ${MIN_ROUNDS}+ rounds: HLTV ${cs.length}, univlr ${val.length}; ${pares.length} células com os dois jogos, ${pesoTotal} mapas do univlr pareados`);
console.log("média da nota: HLTV oficial", resultado.mediaDaNota.hltvOficial.toFixed(3), "| HLTV pela fórmula", resultado.mediaDaNota.hltvPelaFormula.toFixed(3), "| univlr 3.1", resultado.mediaDaNota.univlr31.toFixed(3), "| univlr hoje", resultado.mediaDaNota.univlrHoje.toFixed(3));
console.log("centro (x̄):", P.map((p) => `${p} CS ${centroCs[p].toFixed(3)} univlr ${centroVal[p].toFixed(3)}`).join("; "));
console.log(`\nmesmo desempenho: 3.1 − HLTV = ${f3(dif.nota)} (rAAting de hoje − HLTV = ${f3(dif.hoje)})`);
console.log("  por parte:", P.map((p) => `${p} ${f3(dif.partes[p])}`).join(", "), `, resto da HLTV ${f3(dif.resto)}`);
console.log("  entradas nas células (univlr | HLTV):", P.map((p) => `${p} ${entradas[p].univlr.toFixed(3)} | ${entradas[p].hltv.toFixed(3)}`).join("; "));
console.log("\nfaixa (nota HLTV)   mapas   HLTV    3.1   hoje | swing HLTV univlr | diferença por parte");
for (const f of porFaixa) console.log(`  ${f.faixa.padEnd(15)} ${String(f.mapasUnivlr).padStart(6)}  ${f.hltv.toFixed(2)}  ${f.r31.toFixed(2)}  ${f.hoje.toFixed(2)} | ${f.swingHltv.toFixed(2).padStart(6)} ${f.swingUnivlr.toFixed(2).padStart(6)} | ${P.map((p) => `${p.slice(0, 5)} ${f3(f.partes[p])}`).join(" ")}`);
