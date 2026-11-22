// Estudo de 20/11/2026 (fora do build): compara o ranking de equipes de cada
// variante (ranking_variantes.js) com o de hoje, na semana atual e nas 153 semanas.
//
// Uso: node scripts/estudos/comparar_ranking.js <ranking_atual.json> <ranking_variante.json> [...]

const fs = require("fs");
const [base, ...outros] = process.argv.slice(2);
if (!base || !outros.length) {
  console.error("uso: node scripts/estudos/comparar_ranking.js <ranking_atual.json> <ranking_variante.json> [...]");
  process.exit(2);
}
const ler = (arquivo) => JSON.parse(fs.readFileSync(arquivo, "utf8"));
const A = ler(base);

// posição oficial: validRank quando existe (equipe com amostra e ativa)
const posicoes = (teams) => new Map(teams.filter((t) => t.validRank).map((t) => [t.id, t.validRank]));

function comparar(listaA, listaB) {
  const pa = posicoes(listaA);
  const pb = posicoes(listaB);
  let trocas = 0;
  let maior = 0;
  for (const [id, pos] of pa) {
    if (!pb.has(id)) continue;
    const d = Math.abs(pb.get(id) - pos);
    if (d) trocas += 1;
    maior = Math.max(maior, d);
  }
  const top = (p, k) => new Set([...p].filter(([, pos]) => pos <= k).map(([id]) => id));
  const t10a = top(pa, 10);
  const t10b = top(pb, 10);
  const lider = (p) => [...p].find(([, pos]) => pos === 1)?.[0];
  let maiorNota = 0;
  const notaB = new Map(listaB.map((t) => [t.id, t.score]));
  for (const t of listaA) if (notaB.has(t.id)) maiorNota = Math.max(maiorNota, Math.abs(notaB.get(t.id) - t.score));
  return {
    equipes: pa.size,
    trocas,
    maior,
    top10Iguais: [...t10a].filter((id) => t10b.has(id)).length,
    top10Ordem: [...pa].filter(([, pos]) => pos <= 10).every(([id, pos]) => pb.get(id) === pos),
    liderIgual: lider(pa) === lider(pb),
    maiorNota,
  };
}

for (const arquivo of outros) {
  const B = ler(arquivo);
  const agora = comparar(A.atual, B.atual);
  const semanasB = new Map(B.semanas.map((s) => [s.cutoffAt, s]));
  let semanasComTroca = 0;
  let trocasTotal = 0;
  let maiorSemanal = 0;
  let liderMudou = 0;
  let top10Mudou = 0;
  let top10OrdemMudou = 0;
  let maiorNota = 0;
  const exemplos = [];
  for (const s of A.semanas) {
    const sb = semanasB.get(s.cutoffAt);
    if (!sb) continue;
    const c = comparar(s.teams, sb.teams);
    if (c.trocas) semanasComTroca += 1;
    trocasTotal += c.trocas;
    maiorSemanal = Math.max(maiorSemanal, c.maior);
    maiorNota = Math.max(maiorNota, c.maiorNota);
    if (!c.liderIgual) {
      liderMudou += 1;
      exemplos.push(s.label);
    }
    if (c.top10Iguais < 10) top10Mudou += 1;
    if (!c.top10Ordem) top10OrdemMudou += 1;
  }
  console.log(
    JSON.stringify({
      variante: B.variante,
      semanaAtual: agora,
      semanas: A.semanas.length,
      semanasComTroca,
      trocasTotal,
      maiorTrocaSemanal: maiorSemanal,
      maiorDiferencaDeNota: Number(maiorNota.toFixed(3)),
      liderMudouEmSemanas: liderMudou,
      exemplosLider: exemplos.slice(0, 5),
      top10ComposicaoMudouEmSemanas: top10Mudou,
      top10OrdemMudouEmSemanas: top10OrdemMudou,
    }),
  );
}
