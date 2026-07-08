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
