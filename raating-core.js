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
  const SAMPLE_MIN_ROUNDS = 50;
  const ECO_BUCKETS = [
    { label: "$0-$1000", min: 0, max: 1000 },
    { label: "$1000-$1700", min: 1000, max: 1700 },
    { label: "$1700-$2700", min: 1700, max: 2700 },
    { label: "$2700-$3550", min: 2700, max: 3550 },
    { label: "$3550-$4700", min: 3550, max: 4700 },
    { label: "$4700+", min: 4700, max: Infinity },
  ];
  // rAAting 3.1 (especificacao de 21/11/2026): a formula estimada da HLTV
  // (r/GlobalOffensive, "HLTV3 formula reversed with 0.03 error"), com o beta do
  // dano dividido por 1,5 (no CS a vida e 100; no Valorant, 150 com colete
  // pesado; decisao do dono, apoiada no dano por abate medido, 1,43). A nota e
  // 1 + soma de beta * (taxa - media do grupo): 1,00 fica na media, como na HLTV.
  const RATING_31_BETAS = Object.freeze({
    abate: 0.4941,
    sobrevivencia: 0.3795,
    dano: 0.428 / 1.5,
    kast: 0.2602,
    swing: 0.03748,
    multikill: 0.0241,
  });
  const RATING_31_PARTS = Object.freeze(["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"]);
  // A media do grupo: soma das contagens de todas as linhas jogador x mapa do
  // build dividida pela soma dos rounds. O build calcula e grava no banco; o
  // navegador le de la. Sem ela, a nota nao existe (NaN), para nunca sair uma
  // nota com outra media.
  let groupCenterAtual = null;

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

  // As contagens que entram na nota, com as trocas de sempre para linhas que nao
  // tem os campos ajustados pela economia.
  function ratingCounts(row = {}) {
    return {
      rounds: Math.max(0, finiteNumber(row.rounds ?? row.playerRounds)),
      eKillPoints: finiteNumber(row.eKillPoints, finiteNumber(row.kills)),
      eDeathPoints: finiteNumber(row.eDeathPoints, finiteNumber(row.deaths)),
      eDamageTotal: finiteNumber(row.eDamageTotal, finiteNumber(row.damage)),
      eKastPoints: finiteNumber(row.eKastPoints, finiteNumber(row.kastRounds)),
      adjustedRoundSwingTotalPp: finiteNumber(row.adjustedRoundSwingTotalPp, finiteNumber(row.impactTotal)),
      multiKillPoints: finiteNumber(row.multiKillPoints, multiKillPointsFromCounts(row)),
    };
  }

  // As seis taxas por round, na unidade da formula: abate e sobrevivencia por
  // round, dano por round / 100, KAST como fracao, swing em pontos percentuais e
  // os pontos de multi-kill por round. Com 0 rounds, todas valem 0.
  function ratesFromCounts(c) {
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

  function ratingRates(row = {}) {
    return ratesFromCounts(ratingCounts(row));
  }

  // Soma as contagens de todas as linhas (inclusive as de 0 rounds) e divide pela
  // soma dos rounds. Sem rounds, nao ha media.
  function groupCenter(rows = []) {
    const soma = { rounds: 0, eKillPoints: 0, eDeathPoints: 0, eDamageTotal: 0, eKastPoints: 0, adjustedRoundSwingTotalPp: 0, multiKillPoints: 0 };
    for (const row of rows || []) {
      const c = ratingCounts(row);
      for (const campo of Object.keys(soma)) soma[campo] += c[campo];
    }
    return soma.rounds > 0 ? ratesFromCounts(soma) : null;
  }

  function setGroupCenter(center) {
    groupCenterAtual = center ? Object.fromEntries(RATING_31_PARTS.map((parte) => [parte, Number(center[parte])])) : null;
  }

  function getGroupCenter() {
    return groupCenterAtual;
  }

  // Sem limites desde 16/11/2026 (decisao do dono). RATING_MIN e RATING_MAX
  // seguem so para o rAAting 1.0, que e legado. A nota e linear nas contagens:
  // a nota da soma de varias linhas e a media das notas pesada pelos rounds.
  function calculateRaating3(row = {}, center = groupCenterAtual) {
    const c = ratingCounts(row);
    const rounds = c.rounds;
    const x = ratesFromCounts(c);
    const partes = {};
    let nota = 1;
    for (const parte of RATING_31_PARTS) {
      const valor = center ? RATING_31_BETAS[parte] * (x[parte] - Number(center[parte])) : NaN;
      partes[`parte_${parte}`] = valor;
      nota += valor;
    }
    return {
      raating_3: nota,
      rating_version: "raa3.1",
      sample_status: rounds >= SAMPLE_MIN_ROUNDS ? "OK" : "LOW",
      sampleStatus: rounds >= SAMPLE_MIN_ROUNDS ? "OK" : "LOW",
      ekpr: x.abate,
      edpr: rounds ? c.eDeathPoints / rounds : 0,
      eadr: rounds ? c.eDamageTotal / rounds : 0,
      ekast: rounds ? (100 * c.eKastPoints) / rounds : 0,
      mk_per_r: x.multikill,
      adjusted_swing_percent: x.swing,
      ...partes,
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
    RATING_31_BETAS,
    RATING_31_PARTS,
    finiteNumber,
    clamp,
    calculateRaating1,
    calculateRating: calculateRaating1,
    calculateRaating3,
    ratingRates,
    groupCenter,
    setGroupCenter,
    getGroupCenter,
    applyRatingFields,
    multiKillPointsFromCounts,
    multiKillPointsForKills,
    ecoBucket,
    createEcoModel,
    ecoMultiplier,
    reducedEcoMultiplier,
  };
});
