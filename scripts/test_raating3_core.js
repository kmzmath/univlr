const assert = require("node:assert/strict");
const RaaRatingCore = require("../raating-core.js");

function approx(actual, expected, tolerance = 1e-9) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

const empty = RaaRatingCore.calculateRaating3({ rounds: 0 });
assert.equal(empty.sample_status, "LOW", "zero-round players are LOW sample");
assert(Number.isFinite(empty.raating_3), "zero-round rating is finite");

const baseline = RaaRatingCore.calculateRaating3({
  rounds: 100,
  eKillPoints: 69.080751,
  eDeathPoints: 71.4128825,
  eDamageTotal: 10114.9739,
  eKastPoints: 71.465847,
  adjustedRoundSwingTotalPp: -34.82385,
  multiKillPoints: 22.41625,
  survivedWinRounds: 0,
  savedLossRounds: 0,
  tradedDeaths: 0,
  failedTradeDeaths: 0,
  firstKills: 0,
  firstDeaths: 0,
  tradeDenials: 0,
});

assert.equal(baseline.sample_status, "OK", "60+ rounds are OK sample");
approx(baseline.KillRating, 1);
approx(baseline.DamageRating, 1);
approx(baseline.MultiKillRating, 1);
approx(baseline.RoundSwingRating, 1);
approx(baseline.SurvivalRating, 1);
approx(baseline.KASTRating, 1);
approx(baseline.raating_3, 0.991574);

// Sem limites desde 16/11/2026 (decisao do dono): cada componente e
// 1 + 0,28 * z, sem cortar o z em 3 nem o componente em 0,30 a 1,80, e a nota e
// a soma ponderada menos 0,008426, sem corte. A mediana continua dando ~1,00.
const BASES = {
  metric_kill: [0.69080751, 0.1786497375, 0.25],
  metric_damage: [1.01149739, 0.23446389, 0.15],
  metric_multikill: [0.2241625, 0.11087375, 0.04],
  metric_round_swing: [-0.3482385, 4.0305735, 0.33],
  metric_survival: [0.285871175, 0.08546929, 0.15],
  metric_kast: [0.71465847, 0.0765002825, 0.08],
};
const semLimite = (row) => Object.entries(BASES).reduce((soma, [chave, [mediana, iqr, peso]]) => soma + peso * (1 + 0.28 * (row[chave] - mediana) / iqr), -0.008426);

const high = RaaRatingCore.calculateRaating3({
  rounds: 60,
  eKillPoints: 500,
  eDeathPoints: 0,
  eDamageTotal: 40000,
  eKastPoints: 60,
  adjustedRoundSwingTotalPp: 2000,
  multiKillPoints: 300,
});
assert(high.raating_3 > 1.8, "a nota alta passa do antigo teto de 1,79");
assert(high.KillRating > 1.8, "o componente tambem passa de 1,8");
approx(high.raating_3, semLimite(high), 1e-9);
approx(high.rating_3_like, high.raating_3, 1e-12);

const low = RaaRatingCore.calculateRaating3({
  rounds: 60,
  eKillPoints: 0,
  eDeathPoints: 500,
  eDamageTotal: 0,
  eKastPoints: 0,
  adjustedRoundSwingTotalPp: -2000,
  multiKillPoints: 0,
});
assert(low.raating_3 < 0, "sem piso, a nota muito baixa fica negativa");
approx(low.raating_3, semLimite(low), 1e-9);

// Mapa de verdade (adryanzin, 0/13/1 em 13 rounds) e o controle de que mais
// abates sempre sobem a nota, inclusive acima do antigo teto.
const mais = (kills) => RaaRatingCore.calculateRaating3({ rounds: 13, eKillPoints: kills, eDeathPoints: 5, eDamageTotal: kills * 150, eKastPoints: 12, adjustedRoundSwingTotalPp: kills * 4, multiKillPoints: kills / 2 }).raating_3;
assert(mais(30) > mais(26) && mais(26) > mais(22), "mais abates, nota maior, sem empate no topo");

const model = RaaRatingCore.createEcoModel([
  { attackerBucket: "$0-$1000", victimBucket: "$4700+" },
  { attackerBucket: "$4700+", victimBucket: "$0-$1000" },
  { attackerBucket: "$4700+", victimBucket: "$0-$1000" },
  { attackerBucket: "$3550-$4700", victimBucket: "$3550-$4700" },
]);
const observedMean = [
  RaaRatingCore.ecoMultiplier(model, "$0-$1000", "$4700+"),
  RaaRatingCore.ecoMultiplier(model, "$4700+", "$0-$1000"),
  RaaRatingCore.ecoMultiplier(model, "$4700+", "$0-$1000"),
  RaaRatingCore.ecoMultiplier(model, "$3550-$4700", "$3550-$4700"),
].reduce((sum, value) => sum + value, 0) / 4;
approx(observedMean, 1, 1e-12);

console.log("rAAting 3.0 core tests passed");
