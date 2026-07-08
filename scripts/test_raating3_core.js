const assert = require("node:assert/strict");
const RaaRatingCore = require("../raating-core.js");

function approx(actual, expected, tolerance = 1e-9) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

const empty = RaaRatingCore.calculateRaating3({ rounds: 0 });
assert.equal(empty.sample_status, "LOW", "zero-round players are LOW sample");
assert(Number.isFinite(empty.raating_3), "zero-round rating is finite");
assert(empty.raating_3 >= 0.3 && empty.raating_3 <= 1.8, "zero-round rating is clamped");

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

const high = RaaRatingCore.calculateRaating3({
  rounds: 60,
  eKillPoints: 500,
  eDeathPoints: 0,
  eDamageTotal: 40000,
  eKastPoints: 60,
  adjustedRoundSwingTotalPp: 2000,
  multiKillPoints: 300,
});
assert(high.raating_3 <= 1.8, "extreme high rating stays inside the visual clamp");
approx(high.raating_3, 1.791574);

const low = RaaRatingCore.calculateRaating3({
  rounds: 60,
  eKillPoints: 0,
  eDeathPoints: 500,
  eDamageTotal: 0,
  eKastPoints: 0,
  adjustedRoundSwingTotalPp: -2000,
  multiKillPoints: 0,
});
assert.equal(low.raating_3, 0.3, "extreme low rating is visually clamped");

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
