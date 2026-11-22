// Estudo de 20/11/2026 (fora do build): a nota pela fórmula estimada da HLTV
// (fonte 5 da especificação do Hub CS2), na escala que o Hub CS2 escolheu (opção B):
//
//   nota = 1 + Σ βᵢ · (xᵢ − x̄ᵢ)
//
// x̄ é a média por round do grupo: a soma das contagens de todas as linhas
// dividida pela soma dos rounds. O 0,1358 da fórmula some com a nota centrada.
// A ordem e as diferenças entre jogadores são as mesmas da fórmula crua
// (rating_recon_proxy do raating-core.js); só muda onde fica o 1,00.

const path = require("path");
const Core = require(path.join(__dirname, "..", "..", "raating-core.js"));
const { finiteNumber } = Core;

const BETA = { abate: 0.4941, sobrevivencia: 0.3795, dano: 0.428, kast: 0.2602, swing: 0.03748, multikill: 0.0241 };

// Mesmos campos e mesmas trocas de calculateRaating3, para a nota valer em
// qualquer linha que o app.js monta (mapa, campeonato, carreira, equipe).
function contagens(row = {}) {
  return {
    rounds: Math.max(0, finiteNumber(row.rounds ?? row.playerRounds)),
    eKillPoints: finiteNumber(row.eKillPoints, finiteNumber(row.kills)),
    eDeathPoints: finiteNumber(row.eDeathPoints, finiteNumber(row.deaths)),
    eDamageTotal: finiteNumber(row.eDamageTotal, finiteNumber(row.damage)),
    eKastPoints: finiteNumber(row.eKastPoints, finiteNumber(row.kastRounds)),
    adjustedRoundSwingTotalPp: finiteNumber(row.adjustedRoundSwingTotalPp, finiteNumber(row.impactTotal)),
    multiKillPoints: finiteNumber(row.multiKillPoints, Core.multiKillPointsFromCounts(row)),
  };
}

function taxas(row) {
  const c = contagens(row);
  const r = c.rounds;
  return {
    abate: r ? c.eKillPoints / r : 0,
    sobrevivencia: r ? 1 - c.eDeathPoints / r : 0,
    dano: r ? c.eDamageTotal / r / 100 : 0,
    kast: r ? c.eKastPoints / r : 0,
    swing: r ? c.adjustedRoundSwingTotalPp / r : 0,
    multikill: r ? c.multiKillPoints / r : 0,
  };
}

function centroDoGrupo(rows) {
  const soma = { rounds: 0, eKillPoints: 0, eDeathPoints: 0, eDamageTotal: 0, eKastPoints: 0, adjustedRoundSwingTotalPp: 0, multiKillPoints: 0 };
  for (const row of rows) {
    const c = contagens(row);
    for (const campo of Object.keys(soma)) soma[campo] += c[campo];
  }
  return taxas(soma);
}

// `betas` troca os pesos (os "β convertidos" do teste de 20/11); sem ele, os β da estimativa.
function notaBeta(row, centro, betas = BETA) {
  const x = taxas(row);
  let nota = 1;
  for (const [parte, beta] of Object.entries(betas)) nota += beta * (x[parte] - centro[parte]);
  return nota;
}

module.exports = { BETA, taxas, centroDoGrupo, notaBeta };
