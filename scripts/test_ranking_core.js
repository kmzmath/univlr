const assert = require("node:assert/strict");
const RankingCore = require("../ranking-core.js");

const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-06-19T12:00:00Z");

function team(id) {
  return { id, name: id, currentLineup: [] };
}

function match(id, daysAgo, teamAId, scoreA, teamBId, scoreB, eventId = "cup") {
  return {
    id,
    eventId,
    seriesKey: id,
    seriesCode: id.replace(/\D/g, "") || id,
    startedAt: now - daysAgo * day,
    teamA: { id: teamAId, score: scoreA, color: "Red" },
    teamB: { id: teamBId, score: scoreB, color: "Blue" },
    winnerId: scoreA > scoreB ? teamAId : teamBId,
    loserId: scoreA > scoreB ? teamBId : teamAId,
    players: [],
  };
}

function seriesFromMatch(row) {
  return {
    id: row.id,
    eventId: row.eventId,
    seriesKey: row.seriesKey,
    seriesCode: row.seriesCode,
    startedAt: row.startedAt,
    sortAt: row.startedAt,
    teamA: row.teamA,
    teamB: row.teamB,
    scoreA: row.winnerId === row.teamA.id ? 1 : 0,
    scoreB: row.winnerId === row.teamB.id ? 1 : 0,
    roundScoreA: row.teamA.score,
    roundScoreB: row.teamB.score,
    winnerId: row.winnerId,
    maps: [row],
    label: "MD1",
  };
}

const teams = [team("alpha"), team("beta"), team("gamma"), team("delta")];
const matches = [
  match("m1", 5, "alpha", 13, "beta", 7),
  match("m2", 8, "alpha", 13, "gamma", 11),
  match("m3", 12, "beta", 13, "gamma", 8),
  match("m4", 18, "alpha", 13, "beta", 10),
  match("m5", 25, "gamma", 13, "beta", 9),
  match("m6", 40, "alpha", 13, "gamma", 6),
];

const result = RankingCore.calculateTeamRankings({
  teams,
  matches,
  matchSeries: matches.map(seriesFromMatch),
  tournaments: [],
  players: [],
  weights: {
    achievements: { inferFromEventResults: false, manualResults: [] },
  },
  now,
});

for (const row of result.teams) {
  assert(Number.isFinite(row.score), `${row.id} final score is finite`);
  assert(row.score >= 0 && row.score <= 100, `${row.id} final score is 0-100`);
  for (const [key, value] of Object.entries(row.blocks)) {
    assert(Number.isFinite(value), `${row.id} block ${key} is finite`);
    assert(value >= 0 && value <= 100, `${row.id} block ${key} is 0-100`);
  }
  for (const [key, value] of Object.entries(row.components)) {
    assert(Number.isFinite(value), `${row.id} component ${key} is finite`);
    assert(value >= 0 && value <= 100, `${row.id} component ${key} is 0-100`);
  }
}

// Consistencia e relevancia sairam em 22/09/2026: a primeira premiava quem perdia
// sempre, a segunda repetia modelos e dominancia. Sobrou a proporcao 6:2:1.
for (const row of result.teams) {
  assert.deepEqual(Object.keys(row.components).sort(), ["dominance", "statisticalModels", "strengthOfSchedule"], "the performance block has three components");
  const expected = (0.6 * row.components.statisticalModels + 0.2 * row.components.strengthOfSchedule + 0.1 * row.components.dominance) / 0.9;
  assert(Math.abs(row.blocks.competitive - expected) < 1e-9, `${row.id} performance is the weighted mean of models, schedule and dominance`);
}

assert.equal(result.byTeamId.alpha.blocks.achievements, 50, "no achievements data uses neutral fallback");
assert.equal(result.byTeamId.alpha.blocks.rosterStrength, 50, "no player stats uses neutral roster fallback");
assert.equal(result.byTeamId.alpha.provisional, true, "default minimum for valid ranking is 9 matches");
assert.equal(result.byTeamId.alpha.validRank, null, "provisional teams do not receive canonical valid rank");
assert(Number.isFinite(result.byTeamId.alpha.overallRank), "all teams receive an overall rank for the Todos view");
assert.equal(result.byTeamId.delta.provisional, true, "team with few matches is provisional");
assert(result.byTeamId.alpha.score > result.byTeamId.gamma.score, "collective wins and dominance drive ranking order");

const noInventedAchievements = RankingCore.calculateTeamRankings({
  teams,
  matches,
  matchSeries: matches.map(seriesFromMatch),
  tournaments: [{ id: "cup", name: "Cup", teams: teams.map((row) => row.id), end: now }],
  players: [],
  weights: {},
  now,
});

assert.equal(noInventedAchievements.byTeamId.alpha.achievements.length, 0, "finished events without explicit placements do not invent achievement positions");

const validRankResult = RankingCore.calculateTeamRankings({
  teams,
  matches,
  matchSeries: matches.map(seriesFromMatch),
  tournaments: [],
  players: [],
  weights: {
    minimumMatches: 3,
    achievements: { inferFromEventResults: false, manualResults: [] },
  },
  now,
});

assert.equal(validRankResult.byTeamId.alpha.provisional, false, "teams over the minimum become valid");
assert.equal(validRankResult.byTeamId.alpha.validRank, 1, "canonical rank is assigned inside the valid-only ranking");
assert.equal(validRankResult.byTeamId.alpha.rank, validRankResult.byTeamId.alpha.validRank, "rank points to canonical rank for valid teams");
assert.equal(validRankResult.byTeamId.delta.validRank, null, "teams below the minimum stay outside the canonical ranking");
assert.equal(validRankResult.byTeamId.alpha.inactive, false, "teams without roster data are not marked inactive");
assert.equal(validRankResult.byTeamId.alpha.rosterSize, null, "roster size stays unknown when activeRoster is not provided");

const roster = (size) => Array.from({ length: size }, (_, index) => ({ slot: index + 1, name: `p${index + 1}` }));
const incompleteRosterResult = RankingCore.calculateTeamRankings({
  teams: teams.map((row) => ({ ...row, activeRoster: row.id === "alpha" ? roster(2) : roster(5) })),
  matches,
  matchSeries: matches.map(seriesFromMatch),
  tournaments: [],
  players: [],
  weights: {
    minimumMatches: 3,
    achievements: { inferFromEventResults: false, manualResults: [] },
  },
  now,
});

assert.equal(incompleteRosterResult.byTeamId.alpha.inactive, true, "teams with fewer than five current players are inactive");
assert.equal(incompleteRosterResult.byTeamId.alpha.rosterSize, 2, "row carries the current roster size");
assert.equal(incompleteRosterResult.byTeamId.alpha.validRank, null, "inactive teams stay outside the canonical ranking");
assert(Number.isFinite(incompleteRosterResult.byTeamId.alpha.overallRank), "inactive teams keep an overall rank for the Todos view");
assert.equal(incompleteRosterResult.byTeamId.beta.inactive, false, "complete rosters stay active");
assert.equal(incompleteRosterResult.byTeamId.beta.validRank, 1, "canonical ranking skips inactive teams");

const achievementResult = RankingCore.calculateTeamRankings({
  teams,
  matches: [],
  matchSeries: [],
  tournaments: [],
  players: [],
  weights: {
    achievements: {
      inferFromEventResults: false,
      placementPoints: { "1": 100, "2": 70, "3": 50, "4": 40, participation: 8 },
      sizeWeights: [{ minTeams: 1, weight: 1 }],
    },
    tournaments: {
      "done-cup": {
        weight: 1,
        teams: 4,
        endAt: new Date(now).toISOString(),
        placements: [
          { teamId: "alpha", placement: 1 },
          { teamId: "beta", placement: 2 },
          { teamId: "gamma", placement: 3 },
          { teamId: "delta", placement: 3 },
        ],
      },
      "ongoing-cup": {
        weight: 1,
        teams: 4,
        endAt: new Date(now + day).toISOString(),
        placements: [
          { teamId: "alpha", placement: 1 },
          { teamId: "beta", placement: 2 },
          { teamId: "gamma", placement: 3 },
          { teamId: "delta", placement: 4 },
        ],
      },
      "incomplete-cup": {
        weight: 1,
        teams: 4,
        endAt: new Date(now).toISOString(),
        placements: [
          { teamId: "alpha", placement: 1 },
          { teamId: "beta", placement: 2 },
          { teamId: "gamma", placement: 3 },
        ],
      },
    },
  },
  now,
});

assert.equal(achievementResult.byTeamId.alpha.achievements.length, 1, "only completed events with full placements count as achievements");
assert.equal(achievementResult.byTeamId.gamma.achievements[0].placementLabel, "3-4", "duplicated placements are treated as a placement range");
assert.equal(achievementResult.byTeamId.gamma.achievements[0].score, 45, "placement ranges use the average points of all covered positions");

// Ate 22/09/2026 a nota final recebia o objeto de conquistas em vez da nota, o
// bloco era descartado e os outros tres dividiam os 15% dele.
const finalWeights = RankingCore.DEFAULT_WEIGHTS.finalWeights;
for (const row of achievementResult.teams) {
  const expected = Object.entries(finalWeights).reduce((sum, [key, weight]) => sum + weight * row.blocks[key], 0);
  assert(Math.abs(row.score - expected) < 1e-9, `${row.id} final score is the weighted sum of the four blocks, achievements included`);
}
assert(achievementResult.byTeamId.alpha.score > achievementResult.byTeamId.beta.score, "a title moves the final score when everything else is equal");

const qualifierEvent = {
  id: "qual-cup",
  name: "Qual Cup",
  teams: teams.map((row) => row.id),
  end: now,
  placements: [
    { id: "alpha", range: "Classificado" },
    { id: "beta", range: "Classificado" },
    { id: "gamma", range: "3" },
    { id: "delta", range: "4" },
  ],
};
const qualifierWeights = {
  achievements: {
    placementPoints: { "1": 100, "2": 70, "3": 50, "4": 40, participation: 8 },
    sizeWeights: [{ minTeams: 1, weight: 1 }],
  },
};
const qualifierResult = RankingCore.calculateTeamRankings({ teams, matches: [], matchSeries: [], tournaments: [qualifierEvent], players: [], weights: qualifierWeights, now });
const qualified = qualifierResult.byTeamId.alpha.achievements[0];
assert(qualified, "an event whose qualified teams are labelled Classificado still counts");
assert.equal(qualified.placementStart, 1, "Classificado takes the first positions the numbered ranges leave free");
assert.equal(qualified.placementEnd, 2, "Classificado covers one position per qualified team");
assert.equal(qualified.placementLabel, "Classificado", "the label shown on the site is preserved");
assert.equal(qualified.score, 85, "Classificado scores the average of the positions it covers");

const tableResult = RankingCore.calculateTeamRankings({
  teams,
  matches: [],
  matchSeries: [],
  tournaments: [qualifierEvent],
  players: [],
  weights: {
    ...qualifierWeights,
    tournaments: { "qual-cup": { weight: 2, placementPoints: { Classificado: 90, "3": 30, "4": 10 } } },
  },
  now,
});
assert.equal(tableResult.byTeamId.alpha.achievements[0].score, 90, "a per-event table sets the value by the label on the site");
assert.equal(tableResult.byTeamId.gamma.achievements[0].score, 30, "a per-event table value is not multiplied by the event weight or size");
assert.equal(tableResult.byTeamId.delta.achievements[0].score, 10, "every label in the table is honoured");

// Regra de 22/09/2026: pontos se acumulam, a maior soma vale 100 e as demais a
// proporcao dela, e cada ponto cai em linha reta ate zerar em 304 dias.
function cupEvent(id, order, daysAgo = 0) {
  return {
    id,
    name: id,
    teams: teams.map((row) => row.id),
    end: now - daysAgo * day,
    placements: order.map((teamId, index) => ({ id: teamId, range: String(index + 1) })),
  };
}
const smallCups = ["c1", "c2", "c3", "c4"].map((id) => cupEvent(id, ["alpha", "beta", "gamma", "delta"]));
const bigCup = cupEvent("big", ["beta", "delta", "alpha", "gamma"]);
const table = (first, second = 0) => ({ placementPoints: { "1": first, "2": second, "3": 0, "4": 0 } });
const accumulated = RankingCore.calculateTeamRankings({
  teams,
  matches: [],
  matchSeries: [],
  tournaments: [...smallCups, bigCup, cupEvent("half-life", ["alpha", "beta", "gamma", "delta"], 152), cupEvent("expired", ["gamma", "alpha", "beta", "delta"], 320), cupEvent("ignored", ["gamma", "alpha", "beta", "delta"])],
  players: [],
  weights: {
    tournaments: {
      c1: table(10),
      c2: table(10),
      c3: table(10),
      c4: table(10),
      big: table(40, 10),
      "half-life": table(0),
      expired: table(50),
      ignored: { ...table(50), ignoreAchievements: true },
    },
  },
  now,
});
const block = (id) => accumulated.byTeamId[id].blocks.achievements;
assert.equal(block("alpha"), 100, "four small titles add up in full (40 points) and tie the top");
assert.equal(block("beta"), 100, "the team with the most points gets 100");
assert.equal(block("delta"), 25, "other teams get their share of the top total (10 of 40)");
assert.equal(block("gamma"), 0, "a team with no live points gets 0, not a neutral 50");
const expired = accumulated.byTeamId.gamma.achievements.find((row) => row.eventId === "expired");
assert.equal(expired.score, 0, "a result older than 10 months is worth nothing");
assert(!accumulated.byTeamId.gamma.achievements.some((row) => row.eventId === "ignored"), "an event marked ignoreAchievements gives no achievement");

const decayCheck = RankingCore.calculateTeamRankings({
  teams,
  matches: [],
  matchSeries: [],
  tournaments: [cupEvent("half-life", ["alpha", "beta", "gamma", "delta"], 152)],
  players: [],
  weights: { tournaments: { "half-life": table(20) } },
  now,
});
assert.equal(decayCheck.byTeamId.alpha.achievements[0].score, 10, "points fall in a straight line: half of the value at 152 of 304 days");
assert.equal(decayCheck.byTeamId.alpha.achievements[0].basePoints, 20, "the campaign keeps the table value before decay");

// Regra de 22/09/2026: o peso do mapa sai da tabela de pontos do campeonato, e o
// da fase, dos pontos que a fase decide. Nada mais e escrito a mao.
const weightedMatches = [
  { ...match("w1", 2, "alpha", 13, "beta", 7, "big-cup"), phase: "final" },
  match("w2", 3, "alpha", 13, "gamma", 7, "big-cup"),
  match("w3", 4, "alpha", 13, "beta", 7, "small-cup"),
  match("w4", 5, "alpha", 13, "beta", 7, "quali-cup"),
  match("w5", 6, "alpha", 13, "beta", 7, "no-table-cup"),
];
const weightedResult = RankingCore.calculateTeamRankings({
  teams,
  matches: weightedMatches,
  matchSeries: weightedMatches.map(seriesFromMatch),
  tournaments: [],
  players: [],
  weights: {
    achievements: { inferFromEventResults: false },
    tournaments: {
      // media por equipe 25; final decide 1 e 2, media 50, o dobro da media.
      "big-cup": { teams: 4, placementPoints: { "1": 100, "2": 0, "3-4": 0 } },
      "small-cup": { teams: 4, placementPoints: { "1": 25, "2": 0, "3-4": 0 } },
      "quali-cup": { teams: 4, qualifiesTo: "big-cup", placementPoints: { Classificado: 0, "3-4": 0 } },
      "no-table-cup": { weight: 1.2 },
    },
  },
  now,
});
const obs = Object.fromEntries(weightedResult.observations.map((row) => [row.id, row]));
assert.equal(obs.w2.tournamentWeight, 1, "the reference table (100 points to the champion) weighs 1");
assert.equal(obs.w3.tournamentWeight, 0.5, "a table paying a quarter of the reference weighs the square root of it");
assert.equal(obs.w4.tournamentWeight, 1, "a qualifier paying 0 at the top inherits the points of the event it qualifies to");
assert.equal(obs.w5.tournamentWeight, 1.2, "an event without a points table keeps the weight written by hand");
assert.equal(obs.w2.phaseWeight, 1, "a regular map sits at the average of the event");
assert.equal(obs.w1.phaseWeight, Math.pow(2, 0.25), "the final is worth what it decides: the average of first and second over the event average");
assert(obs.w1.weight > obs.w2.weight, "the final of an event weighs more than its regular map");

// Serie com codigo de letra (UB2, LB4, FINAL) so casa pela regra de codigo exato.
// Sem limites numericos, a regra nao pode valer para todas as series do evento.
const letterMatches = [
  { ...match("l1", 2, "alpha", 13, "beta", 7, "letter-cup"), seriesCode: "FINAL" },
  { ...match("l2", 3, "alpha", 13, "beta", 7, "letter-cup"), seriesCode: "UB2" },
];
const letterResult = RankingCore.calculateTeamRankings({
  teams,
  matches: letterMatches,
  matchSeries: letterMatches.map(seriesFromMatch),
  tournaments: [],
  players: [],
  weights: {
    achievements: { inferFromEventResults: false },
    tournaments: {
      "letter-cup": {
        teams: 4,
        defaultPhase: "regular",
        phaseRules: [{ phase: "final", seriesCode: "FINAL" }],
        placementPoints: { "1": 100, "2": 0, "3-4": 0 },
      },
    },
  },
  now,
});
const letters = Object.fromEntries(letterResult.observations.map((row) => [row.id, row]));
assert.equal(letters.l1.phase, "final", "the series named FINAL is the final");
assert.equal(letters.l2.phase, "regular", "a rule with no numeric range does not catch every other series");

const pca = RankingCore.pcaCorrected(
  [
    { id: "a", inverted: 0 },
    { id: "b", inverted: 50 },
    { id: "c", inverted: 100 },
  ],
  ["inverted"],
  { a: 100, b: 50, c: 0 },
);

assert.equal(pca.inverted, true, "PCA signal is inverted when correlation is negative");
assert(pca.scores.a > pca.scores.c, "corrected PCA agrees with model average direction");
assert(pca.correlation >= 0, "corrected PCA correlation is non-negative");

const normalized = RankingCore.normalize0to100([5, 5, Number.NaN, Infinity]);
assert.deepEqual(normalized, [50, 50, 50, 50], "flat or invalid normalization returns neutral scores");

console.log("ranking-core tests passed");
