(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RaaRatingCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RATING_MIN = 0.3;
  const RATING_MAX = 1.8;
  const SAMPLE_MIN_ROUNDS = 60;
  const ECO_BUCKETS = [
    { label: "$0-$1000", min: 0, max: 1000 },
    { label: "$1000-$1700", min: 1000, max: 1700 },
    { label: "$1700-$2700", min: 1700, max: 2700 },
    { label: "$2700-$3550", min: 2700, max: 3550 },
    { label: "$3550-$4700", min: 3550, max: 4700 },
    { label: "$4700+", min: 4700, max: Infinity },
  ];
  const RATING_3_WEIGHTS = {
    KillRating: 0.25,
    DamageRating: 0.15,
    MultiKillRating: 0.04,
    RoundSwingRating: 0.33,
    SurvivalRating: 0.15,
    KASTRating: 0.08,
  };
  const RATING_3_BASELINES = {
    metric_kill: { median: 0.69080751, iqr: 0.1786497375 },
    metric_damage: { median: 1.01149739, iqr: 0.23446389 },
    metric_multikill: { median: 0.2241625, iqr: 0.11087375 },
    metric_round_swing: { median: -0.3482385, iqr: 4.0305735 },
    metric_survival: { median: 0.285871175, iqr: 0.08546929 },
    metric_kast: { median: 0.71465847, iqr: 0.0765002825 },
  };

  function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, finiteNumber(value, min)));
  }

  function calculateRaating1({ kpr = 0, dpr = 0, apr = 0, adr = 0, kastFrac = 0, impactRound = 0 } = {}) {
    const zKpr = clamp((finiteNumber(kpr) - 0.6941176471) / 0.1941309654, -3, 3);
    const zAdr = clamp((finiteNumber(adr) - 104.4644808743) / 28.3082643335, -3, 3);
    const zKast = clamp((finiteNumber(kastFrac) - 0.6923076923) / 0.080238395, -3, 3);
    const zImpact = clamp((finiteNumber(impactRound) + 0.4159106155) / 4.4510585893, -3, 3);
    const zDprInv = -clamp((finiteNumber(dpr) - 0.7136563877) / 0.0969349482, -3, 3);
    const zApr = clamp((finiteNumber(apr) - 0.2588235294) / 0.120352289, -3, 3);
    const score =
      0.22 * zKpr +
      0.18 * zAdr +
      0.18 * zKast +
      0.17 * zImpact +
      0.15 * zDprInv +
      0.1 * zApr;
    return clamp(1 + 0.2883448104 * (score - 0.0853107262), RATING_MIN, RATING_MAX);
  }

  function multiKillPointsFromCounts(row = {}) {
    return (
      1.0 * finiteNumber(row.twoKills) +
      2.0 * finiteNumber(row.threeKills) +
      3.5 * finiteNumber(row.fourKills) +
      5.0 * finiteNumber(row.fiveKills)
    );
  }

  function multiKillPointsForKills(kills) {
    const count = finiteNumber(kills);
    if (count === 2) return 1;
    if (count === 3) return 2;
    if (count === 4) return 3.5;
    if (count >= 5) return 5;
    return 0;
  }

  function subRating(metric, baseline) {
    const iqr = Math.abs(finiteNumber(baseline.iqr, 0));
    const z = iqr ? clamp((finiteNumber(metric) - finiteNumber(baseline.median)) / iqr, -3, 3) : 0;
    return clamp(1 + 0.28 * z, RATING_MIN, RATING_MAX);
  }

  function calculateRaating3(row = {}) {
    const rounds = Math.max(0, finiteNumber(row.rounds ?? row.playerRounds));
    const eKillPoints = finiteNumber(row.eKillPoints, finiteNumber(row.kills));
    const eDeathPoints = finiteNumber(row.eDeathPoints, finiteNumber(row.deaths));
    const eDamageTotal = finiteNumber(row.eDamageTotal, finiteNumber(row.damage));
    const eKastPoints = finiteNumber(row.eKastPoints, finiteNumber(row.kastRounds));
    const adjustedRoundSwingTotalPp = finiteNumber(row.adjustedRoundSwingTotalPp, finiteNumber(row.impactTotal));
    const mkWeightedPoints = finiteNumber(row.multiKillPoints, multiKillPointsFromCounts(row));
    const ekpr = rounds ? eKillPoints / rounds : 0;
    const edpr = rounds ? eDeathPoints / rounds : 0;
    const eadr = rounds ? eDamageTotal / rounds : 0;
    const ekast = rounds ? (100 * eKastPoints) / rounds : 0;
    const mkPerR = rounds ? mkWeightedPoints / rounds : 0;
    const adjustedSwingPercent = rounds ? adjustedRoundSwingTotalPp / rounds : 0;
    const openingKillsPerRound = rounds ? finiteNumber(row.firstKills ?? row.openingKills) / rounds : 0;
    const openingDeathsPerRound = rounds ? finiteNumber(row.firstDeaths ?? row.openingDeaths) / rounds : 0;
    const tradeDenialsPerRound = rounds ? finiteNumber(row.tradeDenials) / rounds : 0;
    const tradedDeathsPerRound = rounds ? finiteNumber(row.tradedDeaths) / rounds : 0;
    const failedTradeDeathsPerRound = rounds ? finiteNumber(row.failedTradeDeaths) / rounds : 0;
    const savedLossRoundsPerRound = rounds ? finiteNumber(row.savedLossRounds) / rounds : 0;
    const survivedWinRoundsPerRound = rounds ? finiteNumber(row.survivedWinRounds) / rounds : 0;

    const metricKill = ekpr + 0.025 * openingKillsPerRound + 0.015 * tradeDenialsPerRound;
    const metricDamage = eadr / 100;
    const metricMultikill = mkPerR;
    const metricRoundSwing = adjustedSwingPercent;
    const metricSurvival =
      (1 - edpr) +
      0.04 * tradedDeathsPerRound -
      0.04 * failedTradeDeathsPerRound -
      0.03 * openingDeathsPerRound -
      0.02 * savedLossRoundsPerRound +
      0.015 * survivedWinRoundsPerRound;
    const metricKast = ekast / 100;

    const KillRating = subRating(metricKill, RATING_3_BASELINES.metric_kill);
    const DamageRating = subRating(metricDamage, RATING_3_BASELINES.metric_damage);
    const MultiKillRating = subRating(metricMultikill, RATING_3_BASELINES.metric_multikill);
    const RoundSwingRating = subRating(metricRoundSwing, RATING_3_BASELINES.metric_round_swing);
    const SurvivalRating = subRating(metricSurvival, RATING_3_BASELINES.metric_survival);
    const KASTRating = subRating(metricKast, RATING_3_BASELINES.metric_kast);
    const unadjusted =
      RATING_3_WEIGHTS.KillRating * KillRating +
      RATING_3_WEIGHTS.DamageRating * DamageRating +
      RATING_3_WEIGHTS.MultiKillRating * MultiKillRating +
      RATING_3_WEIGHTS.RoundSwingRating * RoundSwingRating +
      RATING_3_WEIGHTS.SurvivalRating * SurvivalRating +
      RATING_3_WEIGHTS.KASTRating * KASTRating -
      0.008426;
    const ratingReconProxy =
      0.1358 +
      0.4941 * ekpr +
      0.3795 * (1 - edpr) +
      0.428 * (eadr / 100) +
      0.2602 * (ekast / 100) +
      0.03748 * adjustedSwingPercent +
      0.0241 * mkPerR;

    return {
      raating_3: clamp(unadjusted, RATING_MIN, RATING_MAX),
      rating_3_like: clamp(unadjusted, RATING_MIN, RATING_MAX),
      rating_3_like_unadjusted: unadjusted,
      rating_recon_proxy: ratingReconProxy,
      rating_version: "raa3",
      sample_status: rounds >= SAMPLE_MIN_ROUNDS ? "OK" : "LOW",
      sampleStatus: rounds >= SAMPLE_MIN_ROUNDS ? "OK" : "LOW",
      ekpr,
      edpr,
      eadr,
      ekast,
      mk_per_r: mkPerR,
      adjusted_swing_percent: adjustedSwingPercent,
      metric_kill: metricKill,
      metric_damage: metricDamage,
      metric_multikill: metricMultikill,
      metric_round_swing: metricRoundSwing,
      metric_survival: metricSurvival,
      metric_kast: metricKast,
      kill_rating: KillRating,
      damage_rating: DamageRating,
      multi_kill_rating: MultiKillRating,
      round_swing_rating: RoundSwingRating,
      survival_rating: SurvivalRating,
      kast_rating: KASTRating,
      KillRating,
      DamageRating,
      MultiKillRating,
      RoundSwingRating,
      SurvivalRating,
      KASTRating,
    };
  }

  function applyRatingFields(row = {}) {
    const legacyImpact = finiteNumber(row.impactRoundLegacy, finiteNumber(row.impactRound));
    const legacyKast = finiteNumber(row.kastLegacyFrac, finiteNumber(row.kastFrac));
    row.raating_1 = calculateRaating1({ ...row, kastFrac: legacyKast, impactRound: legacyImpact });
    Object.assign(row, calculateRaating3(row));
    row.rating = row.raating_3;
    return row;
  }

  function ecoBucket(loadoutValue) {
    const value = Math.max(0, finiteNumber(loadoutValue, 0));
    return ECO_BUCKETS.find((bucket) => value >= bucket.min && value < bucket.max)?.label || ECO_BUCKETS[0].label;
  }

  function ecoPairKey(attackerBucket, victimBucket) {
    return `${attackerBucket || ""}|${victimBucket || ""}`;
  }

  function rawEcoMultiplier(pDuel) {
    return clamp(2.095 - 2.074 * finiteNumber(pDuel, 0.5), 0.35, 1.75);
  }

  function createEcoModel(killRows = []) {
    const counts = new Map();
    const observed = [];
    for (const row of killRows || []) {
      const attackerBucket = row.attackerBucket || row.killerBucket;
      const victimBucket = row.victimBucket;
      if (!attackerBucket || !victimBucket) continue;
      const key = ecoPairKey(attackerBucket, victimBucket);
      counts.set(key, (counts.get(key) || 0) + 1);
      observed.push({ attackerBucket, victimBucket });
    }
    if (!observed.length) return { counts, multipliers: new Map(), meanRaw: 1, hasObservedEco: false };

    const rawByKey = new Map();
    for (const attacker of ECO_BUCKETS.map((bucket) => bucket.label)) {
      for (const victim of ECO_BUCKETS.map((bucket) => bucket.label)) {
        const key = ecoPairKey(attacker, victim);
        const reverseKey = ecoPairKey(victim, attacker);
        const forward = counts.get(key) || 0;
        const reverse = counts.get(reverseKey) || 0;
        const pDuel = forward + reverse ? forward / (forward + reverse) : 0.5;
        rawByKey.set(key, rawEcoMultiplier(pDuel));
      }
    }

    const meanRaw =
      observed.reduce((sum, row) => sum + finiteNumber(rawByKey.get(ecoPairKey(row.attackerBucket, row.victimBucket)), 1), 0) /
      observed.length;
    const normalizer = meanRaw > 0 ? meanRaw : 1;
    const multipliers = new Map([...rawByKey.entries()].map(([key, value]) => [key, value / normalizer]));
    return { counts, multipliers, meanRaw: normalizer, hasObservedEco: true };
  }

  function ecoMultiplier(model, attackerBucket, victimBucket) {
    if (!model?.hasObservedEco || !attackerBucket || !victimBucket) return 1;
    return finiteNumber(model.multipliers?.get(ecoPairKey(attackerBucket, victimBucket)), 1);
  }

  function reducedEcoMultiplier(multiplier, strength) {
    return 1 + finiteNumber(strength, 1) * (finiteNumber(multiplier, 1) - 1);
  }

  return {
    RATING_MIN,
    RATING_MAX,
    SAMPLE_MIN_ROUNDS,
    ECO_BUCKETS,
    RATING_3_WEIGHTS,
    RATING_3_BASELINES,
    finiteNumber,
    clamp,
    calculateRaating1,
    calculateRating: calculateRaating1,
    calculateRaating3,
    applyRatingFields,
    multiKillPointsFromCounts,
    multiKillPointsForKills,
    ecoBucket,
    createEcoModel,
    ecoMultiplier,
    reducedEcoMultiplier,
  };
});
