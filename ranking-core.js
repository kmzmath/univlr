(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RankingCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const EPSILON = 1e-9;

  const DEFAULT_WEIGHTS = {
    minimumMatches: 9,
    finalWeights: {
      competitive: 0.7,
      achievements: 0.15,
      recentForm: 0.1,
      rosterStrength: 0.05,
    },
    competitiveWeights: {
      statisticalModels: 0.6,
      strengthOfSchedule: 0.2,
      dominance: 0.1,
      consistency: 0.05,
      relevance: 0.05,
    },
    modelWeights: {
      mainModelsAverage: 0.85,
      correctedPca: 0.15,
    },
    strengthOfScheduleWeights: {
      general: 0.6,
      wins: 0.4,
    },
    recentFormWeights: {
      adjustedPerformance: 0.5,
      dominance: 0.3,
      recentWinSos: 0.2,
    },
    rosterWeights: {
      individualRating: 0.7,
      coreStability: 0.2,
      depth: 0.1,
    },
    halfLives: {
      matches: 150,
      achievements: 210,
      recentForm: 30,
      playerRating: 90,
    },
    recentWindowDays: 60,
    defaultTournamentWeight: 1,
    defaultPhase: "regular",
    defaultPhaseWeight: 1,
    seriesWeights: {
      MD1: 1,
      MD3: 1.1,
      MD5: 1.15,
    },
    achievements: {
      inferFromEventResults: true,
      antiFarmFullResults: 3,
      additionalResultMultiplier: 0.5,
      placementPoints: {
        "1": 100,
        "2": 70,
        "3": 50,
        "4": 40,
        "5": 28,
        "6": 24,
        "7": 20,
        "8": 16,
        participation: 8,
      },
      sizeWeights: [
        { minTeams: 2, weight: 0.8 },
        { minTeams: 4, weight: 0.9 },
        { minTeams: 8, weight: 1 },
        { minTeams: 16, weight: 1.12 },
        { minTeams: 32, weight: 1.25 },
      ],
      manualResults: [],
    },
    models: {
      eloK: 32,
      trueSkillK: 1.6,
      trueSkillBeta: 4.1667,
      btpIterations: 260,
      btpLearningRate: 0.018,
      pageRankDamping: 0.85,
      pageRankIterations: 90,
    },
    tournaments: {},
  };

  function calculateTeamRankings(input = {}) {
    const teams = Array.isArray(input.teams) ? input.teams : [];
    const teamIds = teams.map((team) => team.id).filter(Boolean);
    const teamIdSet = new Set(teamIds);
    const weights = mergeConfig(DEFAULT_WEIGHTS, input.weights || {});
    const now = finiteNumber(input.now, Date.now());
    const teamsById = new Map(teams.map((team) => [team.id, team]));
    const tournaments = Array.isArray(input.tournaments) ? input.tournaments : [];
    const tournamentsById = new Map(tournaments.map((event) => [event.id, event]));
    const seriesByKey = new Map((input.matchSeries || []).map((series) => [series.seriesKey || series.id, series]));
    const observations = createObservations(input.matches || [], seriesByKey, tournamentsById, weights, now).filter((item) => teamIdSet.has(item.teamAId) && teamIdSet.has(item.teamBId));
    const basicStats = aggregateBasicStats(teamIds, observations);
    const modelBundle = calculateStatisticalModels(teamIds, observations, weights);
    const modelScores = modelBundle.statisticalModels;
    const sosBundle = calculateStrengthOfSchedule(teamIds, observations, modelScores, weights);
    const dominance = calculateDominance(teamIds, observations);
    const consistency = calculateConsistency(teamIds, observations, modelScores);
    const relevance = calculateRelevance(teamIds, observations, modelScores);
    const competitive = weightedBlock(
      teamIds,
      weights.competitiveWeights,
      {
        statisticalModels: modelScores,
        strengthOfSchedule: sosBundle.score,
        dominance,
        consistency,
        relevance,
      },
    );
    const achievements = calculateAchievements(teamIds, input.matchSeries || [], tournaments, weights, now);
    const recentForm = calculateRecentForm(teamIds, observations, modelScores, competitive, weights, now);
    const rosterStrength = calculateRosterStrength(teamIds, teamsById, input.matches || [], modelScores, weights, now);
    const finalScores = weightedBlock(
      teamIds,
      weights.finalWeights,
      {
        competitive,
        achievements,
        recentForm: recentForm.score,
        rosterStrength: rosterStrength.score,
      },
    );

    const rows = teamIds.map((id) => {
      const basic = basicStats.get(id) || emptyBasicStats();
      const blocks = {
        competitive: safeScore(competitive[id]),
        achievements: safeScore(achievements.score[id]),
        recentForm: safeScore(recentForm.score[id]),
        rosterStrength: safeScore(rosterStrength.score[id]),
      };
      const components = {
        statisticalModels: safeScore(modelScores[id]),
        strengthOfSchedule: safeScore(sosBundle.score[id]),
        dominance: safeScore(dominance[id]),
        consistency: safeScore(consistency[id]),
        relevance: safeScore(relevance[id]),
      };
      const provisional = basic.matches < finiteNumber(weights.minimumMatches, 9);
      return {
        id,
        score: safeScore(finalScores[id]),
        blocks,
        components,
        models: modelBundle.byModel[id] || {},
        sos: sosBundle.details[id] || { general: 50, wins: 50 },
        achievements: achievements.details[id] || [],
        recent: recentForm.details[id] || { matches: 0 },
        roster: rosterStrength.details[id] || {},
        matches: basic.matches,
        wins: basic.wins,
        losses: basic.losses,
        roundsWon: basic.roundsWon,
        roundsLost: basic.roundsLost,
        roundDiff: basic.roundDiff,
        provisional,
      };
    });

    rows.sort((a, b) => Number(b.matches > 0) - Number(a.matches > 0) || b.score - a.score || b.wins - a.wins || b.roundDiff - a.roundDiff || a.id.localeCompare(b.id));
    rows.forEach((row, index) => {
      row.overallRank = index + 1;
    });
    rows
      .filter((row) => !row.provisional)
      .forEach((row, index) => {
        row.validRank = index + 1;
        row.canonicalRank = row.validRank;
      });
    rows.forEach((row) => {
      row.validRank = row.validRank || null;
      row.canonicalRank = row.canonicalRank || null;
      row.rank = row.validRank || row.overallRank;
    });

    return {
      teams: rows,
      byTeamId: Object.fromEntries(rows.map((row) => [row.id, row])),
      observations,
      diagnostics: {
        pcaCorrelation: modelBundle.pcaCorrelation,
        pcaInverted: modelBundle.pcaInverted,
        modelNames: modelBundle.modelNames,
        observationCount: observations.length,
      },
    };
  }

  function createObservations(matches, seriesByKey, tournamentsById, weights, now) {
    const rows = [];
    for (const match of matches) {
      const scoreA = finiteNumber(match.teamA?.score, NaN);
      const scoreB = finiteNumber(match.teamB?.score, NaN);
      if (!match.teamA?.id || !match.teamB?.id || !Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA === scoreB) continue;

      const eventId = match.eventId || "";
      const eventConfig = weights.tournaments?.[eventId] || {};
      const series = seriesByKey.get(match.seriesKey || match.id) || {};
      const bestOf = bestOfForSeries(series, match);
      const phase = resolvePhase(match, series, eventConfig, weights);
      const tournamentWeight = positiveNumber(eventConfig.weight, weights.defaultTournamentWeight || 1);
      const phaseWeight = positiveNumber(eventConfig.phases?.[phase], positiveNumber(eventConfig.phaseWeights?.[phase], positiveNumber(weights.defaultPhaseWeight, 1)));
      const seriesWeight = positiveNumber(weights.seriesWeights?.[`MD${bestOf}`], 1);
      const startedAt = finiteNumber(match.startedAt, finiteNumber(series.startedAt, 0));
      const days = startedAt ? Math.max(0, (now - startedAt) / DAY_MS) : 0;
      const timeWeight = decayWeight(days, weights.halfLives?.matches || 150);
      const weight = positiveNumber(timeWeight * tournamentWeight * phaseWeight * seriesWeight, 1);
      const totalRounds = Math.max(1, scoreA + scoreB);
      const winnerId = scoreA > scoreB ? match.teamA.id : match.teamB.id;
      const loserId = scoreA > scoreB ? match.teamB.id : match.teamA.id;

      rows.push({
        id: match.id || `${match.teamA.id}-${match.teamB.id}-${rows.length}`,
        eventId,
        teamAId: match.teamA.id,
        teamBId: match.teamB.id,
        scoreA,
        scoreB,
        winnerId,
        loserId,
        startedAt,
        seriesKey: match.seriesKey || match.id,
        seriesCode: match.seriesCode || series.seriesCode || "",
        mapNumber: match.mapNumber || 1,
        bestOf,
        phase,
        totalRounds,
        roundDiff: scoreA - scoreB,
        timeWeight,
        tournamentWeight,
        phaseWeight,
        seriesWeight,
        weight,
        event: tournamentsById.get(eventId) || null,
      });
    }
    return rows;
  }

  function bestOfForSeries(series, match) {
    const label = String(series?.label || "");
    const labelMatch = label.match(/\d+/);
    if (labelMatch) return clampNumber(Number(labelMatch[0]), 1, 5);
    const maps = Array.isArray(series?.maps) ? series.maps.length : 1;
    const winningMaps = Math.max(finiteNumber(series?.scoreA, 0), finiteNumber(series?.scoreB, 0));
    if (winningMaps >= 3 || maps > 3) return 5;
    if (winningMaps >= 2 || maps > 1 || String(match?.mapNumber || "").toLowerCase() > "1") return 3;
    return 1;
  }

  function resolvePhase(match, series, eventConfig, weights) {
    const explicit = match.phase || series.phase || "";
    if (explicit) return explicit;
    const seriesCode = String(match.seriesCode || series.seriesCode || match.code || "").trim();
    const seriesNumber = Number(seriesCode.match(/\d+/)?.[0] || NaN);
    for (const rule of eventConfig.phaseRules || []) {
      if (rule.seriesCode && String(rule.seriesCode) === seriesCode) return rule.phase;
      if (rule.matchCodeIncludes && String(match.code || "").includes(rule.matchCodeIncludes)) return rule.phase;
      const min = rule.seriesCodeMin === undefined ? -Infinity : Number(rule.seriesCodeMin);
      const max = rule.seriesCodeMax === undefined ? Infinity : Number(rule.seriesCodeMax);
      if (Number.isFinite(seriesNumber) && seriesNumber >= min && seriesNumber <= max) return rule.phase;
    }
    return eventConfig.defaultPhase || weights.defaultPhase || "regular";
  }

  function aggregateBasicStats(teamIds, observations) {
    const stats = new Map(teamIds.map((id) => [id, emptyBasicStats()]));
    for (const obs of observations) {
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst, won) => {
        const row = stats.get(teamId);
        if (!row) return;
        row.matches += 1;
        row.wins += won ? 1 : 0;
        row.losses += won ? 0 : 1;
        row.roundsWon += roundsFor;
        row.roundsLost += roundsAgainst;
        row.roundDiff += roundsFor - roundsAgainst;
        row.opponents.add(opponentId);
      });
    }
    return stats;
  }

  function emptyBasicStats() {
    return {
      matches: 0,
      wins: 0,
      losses: 0,
      roundsWon: 0,
      roundsLost: 0,
      roundDiff: 0,
      opponents: new Set(),
    };
  }

  function calculateStatisticalModels(teamIds, observations, weights) {
    const rawModels = {
      colley: colleyRatings(teamIds, observations),
      massey: masseyRatings(teamIds, observations),
      eloFinal: eloRatings(teamIds, observations, weights, false),
      eloMargin: eloRatings(teamIds, observations, weights, true),
      trueSkill: trueSkillRatings(teamIds, observations, weights),
      pageRankWins: pageRankWins(teamIds, observations, weights),
      bradleyTerryPoisson: bradleyTerryPoisson(teamIds, observations, weights),
    };
    const modelNames = Object.keys(rawModels);
    const normalizedModels = Object.fromEntries(modelNames.map((name) => [name, robustNormalizeMap(rawModels[name], teamIds)]));
    const modelRows = teamIds.map((id) => {
      const row = { id };
      for (const name of modelNames) row[name] = normalizedModels[name][id];
      return row;
    });
    const mainAverage = {};
    for (const id of teamIds) {
      mainAverage[id] = mean(modelNames.map((name) => normalizedModels[name][id]));
    }
    const pca = pcaCorrected(modelRows, modelNames, mainAverage);
    const statisticalModels = {};
    const byModel = {};
    const mainWeight = finiteNumber(weights.modelWeights.mainModelsAverage, 0.85);
    const pcaWeight = finiteNumber(weights.modelWeights.correctedPca, 0.15);
    const modelWeightSum = mainWeight + pcaWeight || 1;
    for (const id of teamIds) {
      statisticalModels[id] = safeScore((mainWeight * mainAverage[id] + pcaWeight * pca.scores[id]) / modelWeightSum);
      byModel[id] = {
        ...Object.fromEntries(modelNames.map((name) => [name, safeScore(normalizedModels[name][id])])),
        pcaCorrigido: safeScore(pca.scores[id]),
      };
    }
    return {
      statisticalModels,
      byModel,
      modelNames,
      pcaCorrelation: pca.correlation,
      pcaInverted: pca.inverted,
    };
  }

  function colleyRatings(teamIds, observations) {
    const n = teamIds.length;
    const index = indexById(teamIds);
    const matrix = identityMatrix(n, 2);
    const vector = Array(n).fill(1);
    if (!observations.length || n === 0) return constantMap(teamIds, 0.5);

    for (const obs of observations) {
      const i = index.get(obs.teamAId);
      const j = index.get(obs.teamBId);
      if (i === undefined || j === undefined) continue;
      const w = obs.weight;
      const aWon = obs.winnerId === obs.teamAId;
      matrix[i][i] += w;
      matrix[j][j] += w;
      matrix[i][j] -= w;
      matrix[j][i] -= w;
      vector[i] += 0.5 * w * (aWon ? 1 : -1);
      vector[j] += 0.5 * w * (aWon ? -1 : 1);
    }
    const solved = solveLinearSystem(matrix, vector);
    return mapFromArray(teamIds, solved);
  }

  function masseyRatings(teamIds, observations) {
    const n = teamIds.length;
    const index = indexById(teamIds);
    if (!observations.length || n === 0) return constantMap(teamIds, 0);
    const matrix = identityMatrix(n, 0);
    const vector = Array(n).fill(0);
    for (const obs of observations) {
      const i = index.get(obs.teamAId);
      const j = index.get(obs.teamBId);
      if (i === undefined || j === undefined) continue;
      const w = obs.weight;
      const diff = obs.scoreA - obs.scoreB;
      matrix[i][i] += w;
      matrix[j][j] += w;
      matrix[i][j] -= w;
      matrix[j][i] -= w;
      vector[i] += w * diff;
      vector[j] -= w * diff;
    }
    if (n > 0) {
      matrix[n - 1] = Array(n).fill(1);
      vector[n - 1] = 0;
    }
    const solved = solveLinearSystem(matrix, vector);
    return mapFromArray(teamIds, solved);
  }

  function eloRatings(teamIds, observations, weights, useMargin) {
    const ratings = constantMap(teamIds, 1500);
    const sorted = observations.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    for (const obs of sorted) {
      const ratingA = ratings[obs.teamAId] ?? 1500;
      const ratingB = ratings[obs.teamBId] ?? 1500;
      const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
      const scoreA = obs.winnerId === obs.teamAId ? 1 : 0;
      const marginFactor = useMargin ? 1 + Math.log(Math.abs(obs.roundDiff) + 1) / 3 : 1;
      const k = finiteNumber(weights.models?.eloK, 32) * Math.sqrt(clampNumber(obs.weight, 0.05, 4)) * marginFactor;
      const delta = k * (scoreA - expectedA);
      ratings[obs.teamAId] = ratingA + delta;
      ratings[obs.teamBId] = ratingB - delta;
    }
    return ratings;
  }

  function trueSkillRatings(teamIds, observations, weights) {
    const state = Object.fromEntries(teamIds.map((id) => [id, { mu: 25, sigma: 25 / 3 }]));
    const sorted = observations.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    const beta = positiveNumber(weights.models?.trueSkillBeta, 4.1667);
    const kBase = positiveNumber(weights.models?.trueSkillK, 1.6);
    for (const obs of sorted) {
      const a = state[obs.teamAId];
      const b = state[obs.teamBId];
      if (!a || !b) continue;
      const denom = Math.sqrt(2 * beta * beta + a.sigma * a.sigma + b.sigma * b.sigma);
      const expectedA = 1 / (1 + Math.exp(-(a.mu - b.mu) / Math.max(1, denom)));
      const scoreA = obs.winnerId === obs.teamAId ? 1 : 0;
      const margin = 1 + Math.log(Math.abs(obs.roundDiff) + 1) / 5;
      const delta = kBase * clampNumber(obs.weight, 0.05, 3) * margin * (scoreA - expectedA);
      a.mu += delta;
      b.mu -= delta;
      const shrink = 1 - 0.015 * clampNumber(obs.weight, 0, 2);
      a.sigma = Math.max(2.5, a.sigma * shrink);
      b.sigma = Math.max(2.5, b.sigma * shrink);
    }
    return Object.fromEntries(teamIds.map((id) => [id, state[id].mu - 3 * state[id].sigma]));
  }

  function pageRankWins(teamIds, observations, weights) {
    const n = teamIds.length;
    if (!n) return {};
    const index = indexById(teamIds);
    const edges = Array.from({ length: n }, () => new Map());
    for (const obs of observations) {
      const loser = index.get(obs.loserId);
      const winner = index.get(obs.winnerId);
      if (loser === undefined || winner === undefined) continue;
      const marginBoost = 1 + Math.abs(obs.roundDiff) / Math.max(1, obs.totalRounds);
      edges[loser].set(winner, (edges[loser].get(winner) || 0) + obs.weight * marginBoost);
    }
    const damping = clampNumber(finiteNumber(weights.models?.pageRankDamping, 0.85), 0.1, 0.95);
    const iterations = Math.max(10, Math.round(finiteNumber(weights.models?.pageRankIterations, 90)));
    let scores = Array(n).fill(1 / n);
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const next = Array(n).fill((1 - damping) / n);
      for (let from = 0; from < n; from += 1) {
        const total = [...edges[from].values()].reduce((sum, value) => sum + value, 0);
        if (total <= EPSILON) {
          const share = (damping * scores[from]) / n;
          for (let to = 0; to < n; to += 1) next[to] += share;
          continue;
        }
        for (const [to, value] of edges[from].entries()) {
          next[to] += damping * scores[from] * (value / total);
        }
      }
      scores = next;
    }
    return mapFromArray(teamIds, scores);
  }

  function bradleyTerryPoisson(teamIds, observations, weights) {
    const n = teamIds.length;
    const index = indexById(teamIds);
    const strength = Array(n).fill(0);
    const iterations = Math.max(40, Math.round(finiteNumber(weights.models?.btpIterations, 260)));
    const learningRate = positiveNumber(weights.models?.btpLearningRate, 0.018);
    if (!observations.length || n === 0) return constantMap(teamIds, 0);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const gradient = Array(n).fill(0);
      for (const obs of observations) {
        const i = index.get(obs.teamAId);
        const j = index.get(obs.teamBId);
        if (i === undefined || j === undefined) continue;
        const expectedA = 1 / (1 + Math.exp(-(strength[i] - strength[j])));
        const resultA = obs.winnerId === obs.teamAId ? 1 : 0;
        const roundShareA = (obs.scoreA + 0.5) / (obs.totalRounds + 1);
        const targetA = 0.65 * resultA + 0.35 * roundShareA;
        const error = clampNumber(targetA - expectedA, -1, 1);
        const w = clampNumber(obs.weight, 0.05, 3);
        gradient[i] += w * error;
        gradient[j] -= w * error;
      }
      for (let i = 0; i < n; i += 1) strength[i] += learningRate * gradient[i];
      const center = mean(strength);
      for (let i = 0; i < n; i += 1) strength[i] -= center;
    }
    return mapFromArray(teamIds, strength);
  }

  function pcaCorrected(rows, keys, mainAverageById = {}) {
    const ids = rows.map((row) => row.id);
    if (!rows.length || !keys.length) {
      return { scores: constantMap(ids, 50), correlation: 0, inverted: false };
    }
    const matrix = rows.map((row) => keys.map((key) => finiteNumber(row[key], NaN)));
    const columns = keys.map((_, columnIndex) => matrix.map((row) => row[columnIndex]).filter(Number.isFinite));
    const means = columns.map((values) => mean(values));
    const deviations = columns.map((values) => standardDeviation(values) || 1);
    const centered = matrix.map((row) => row.map((value, columnIndex) => (Number.isFinite(value) ? (value - means[columnIndex]) / deviations[columnIndex] : 0)));
    const cov = covarianceMatrix(centered, keys.length);
    const vector = firstPrincipalVector(cov);
    let rawScores = {};
    rows.forEach((row, index) => {
      rawScores[row.id] = dot(centered[index], vector);
    });
    const mainValues = ids.map((id) => finiteNumber(mainAverageById[id], 50));
    const initialCorrelation = correlation(ids.map((id) => rawScores[id]), mainValues);
    let inverted = false;
    if (Number.isFinite(initialCorrelation) && initialCorrelation < 0) {
      rawScores = Object.fromEntries(Object.entries(rawScores).map(([id, value]) => [id, -value]));
      inverted = true;
    }
    const scores = robustNormalizeMap(rawScores, ids);
    const finalCorrelation = correlation(ids.map((id) => scores[id]), mainValues);
    return {
      scores,
      correlation: Number.isFinite(finalCorrelation) ? finalCorrelation : 0,
      inverted,
    };
  }

  function calculateStrengthOfSchedule(teamIds, observations, baseStrength, weights) {
    const details = Object.fromEntries(teamIds.map((id) => [id, { general: 50, wins: 50 }]));
    const raw = {};
    const buckets = Object.fromEntries(teamIds.map((id) => [id, { allSum: 0, allWeight: 0, winSum: 0, winWeight: 0, matches: 0 }]));
    for (const obs of observations) {
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst, won) => {
        const bucket = buckets[teamId];
        if (!bucket) return;
        const opponentStrength = safeScore(baseStrength[opponentId]);
        bucket.allSum += opponentStrength * obs.weight;
        bucket.allWeight += obs.weight;
        bucket.matches += 1;
        if (won) {
          bucket.winSum += opponentStrength * obs.weight;
          bucket.winWeight += obs.weight;
        }
      });
    }
    for (const id of teamIds) {
      const bucket = buckets[id];
      const general = bucket.allWeight ? bucket.allSum / bucket.allWeight : 50;
      const wins = bucket.winWeight ? bucket.winSum / bucket.winWeight : bucket.matches ? 25 : 50;
      details[id] = { general: safeScore(general), wins: safeScore(wins) };
      const sosWeightSum = finiteNumber(weights.strengthOfScheduleWeights.general, 0.6) + finiteNumber(weights.strengthOfScheduleWeights.wins, 0.4) || 1;
      raw[id] = (finiteNumber(weights.strengthOfScheduleWeights.general, 0.6) * general + finiteNumber(weights.strengthOfScheduleWeights.wins, 0.4) * wins) / sosWeightSum;
    }
    return {
      score: robustNormalizeMap(raw, teamIds),
      details,
    };
  }

  function calculateDominance(teamIds, observations) {
    const buckets = Object.fromEntries(teamIds.map((id) => [id, { sum: 0, weight: 0 }]));
    for (const obs of observations) {
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst) => {
        const marginRelative = (roundsFor - roundsAgainst) / Math.max(1, roundsFor + roundsAgainst);
        const dominance = clampNumber(marginRelative * 1.5, -1, 1);
        buckets[teamId].sum += dominance * obs.weight;
        buckets[teamId].weight += obs.weight;
      });
    }
    const raw = Object.fromEntries(teamIds.map((id) => [id, buckets[id].weight ? buckets[id].sum / buckets[id].weight : 0]));
    return robustNormalizeMap(raw, teamIds);
  }

  function calculateConsistency(teamIds, observations, baseStrength) {
    const buckets = Object.fromEntries(teamIds.map((id) => [id, { error: 0, favoritePenalty: 0, weight: 0 }]));
    for (const obs of observations) {
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst, won) => {
        const expected = expectedFromStrength(baseStrength[teamId], baseStrength[opponentId]);
        const actual = won ? 1 : 0;
        const favoritePenalty = !won && expected > 0.55 ? (expected - 0.55) / 0.45 : 0;
        buckets[teamId].error += Math.abs(actual - expected) * obs.weight;
        buckets[teamId].favoritePenalty += favoritePenalty * obs.weight;
        buckets[teamId].weight += obs.weight;
      });
    }
    const raw = {};
    for (const id of teamIds) {
      const bucket = buckets[id];
      if (!bucket.weight) {
        raw[id] = 50;
        continue;
      }
      const error = bucket.error / bucket.weight;
      const favoritePenalty = bucket.favoritePenalty / bucket.weight;
      raw[id] = clampNumber(100 * (1 - (0.72 * error + 0.28 * favoritePenalty)), 0, 100);
    }
    return robustNormalizeMap(raw, teamIds);
  }

  function calculateRelevance(teamIds, observations, baseStrength) {
    const buckets = Object.fromEntries(teamIds.map((id) => [id, { sum: 0, weight: 0 }]));
    for (const obs of observations) {
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst, won) => {
        const opponentTerm = (safeScore(baseStrength[opponentId]) - 50) / 50;
        const resultQuality = won ? 0.74 + 0.26 * opponentTerm : 0.23 + 0.16 * opponentTerm;
        const marginRelative = (roundsFor - roundsAgainst) / Math.max(1, roundsFor + roundsAgainst);
        const dominance = (clampNumber(marginRelative * 1.5, -1, 1) + 1) / 2;
        const performance = clampNumber(100 * (0.72 * resultQuality + 0.28 * dominance), 0, 100);
        buckets[teamId].sum += performance * obs.weight;
        buckets[teamId].weight += obs.weight;
      });
    }
    const raw = Object.fromEntries(teamIds.map((id) => [id, buckets[id].weight ? buckets[id].sum / buckets[id].weight : 50]));
    return robustNormalizeMap(raw, teamIds);
  }

  function calculateAchievements(teamIds, matchSeries, tournaments, weights, now) {
    const campaigns = [];
    const manualKeys = new Set();
    const tournamentsById = new Map((tournaments || []).map((event) => [event.id, event]));

    for (const [eventId, eventConfig] of Object.entries(weights.tournaments || {})) {
      if (!achievementEventIsEligible(eventConfig, tournamentsById.get(eventId), now)) continue;
      const configuredPlacements = normalizeAchievementPlacements(eventConfig.placements || [], finiteNumber(eventConfig.teams, 0));
      if (!configuredPlacements.length || !achievementPlacementsAreComplete(configuredPlacements, eventConfig, tournamentsById.get(eventId))) continue;
      for (const result of configuredPlacements) {
        if (!result.teamId || !teamIds.includes(result.teamId)) continue;
        const campaign = createAchievementCampaign(result, eventId, eventConfig, tournamentsById.get(eventId), weights, now, "configured");
        campaigns.push(campaign);
        manualKeys.add(`${result.teamId}|${eventId}`);
      }
    }

    for (const result of weights.achievements?.manualResults || []) {
      if (!result.teamId || !teamIds.includes(result.teamId)) continue;
      const eventConfig = weights.tournaments?.[result.eventId] || {};
      if (!achievementEventIsEligible({ ...eventConfig, ...result }, tournamentsById.get(result.eventId), now)) continue;
      campaigns.push(createAchievementCampaign(result, result.eventId || "manual", eventConfig, tournamentsById.get(result.eventId), weights, now, "manual"));
      manualKeys.add(`${result.teamId}|${result.eventId || "manual"}`);
    }

    if (weights.achievements?.inferFromEventResults !== false) {
      for (const event of tournaments || []) {
        const eventConfig = weights.tournaments?.[event.id] || {};
        if (!achievementEventIsEligible(eventConfig, event, now)) continue;
        if (eventConfig.placements?.length) continue;
        const eventPlacements = normalizeAchievementPlacements(
          (event.placements || []).map((row) => ({ ...row, teamId: row.teamId || row.id })),
          finiteNumber(eventConfig.teams, Array.isArray(event.teams) ? event.teams.length : 0),
        );
        if (!eventPlacements.length || !achievementPlacementsAreComplete(eventPlacements, eventConfig, event)) continue;
        for (const result of eventPlacements) {
          if (!result.teamId || !teamIds.includes(result.teamId)) continue;
          const key = `${result.teamId}|${event.id}`;
          if (manualKeys.has(key)) continue;
          campaigns.push(createAchievementCampaign(result, event.id, eventConfig, event, weights, now, "event"));
          manualKeys.add(key);
        }
      }
    }

    const details = Object.fromEntries(teamIds.map((id) => [id, []]));
    const raw = Object.fromEntries(teamIds.map((id) => [id, 0]));
    for (const id of teamIds) {
      const rows = campaigns.filter((campaign) => campaign.teamId === id).sort((a, b) => b.score - a.score);
      details[id] = rows;
      rows.forEach((campaign, index) => {
        const multiplier = index < finiteNumber(weights.achievements?.antiFarmFullResults, 3) ? 1 : finiteNumber(weights.achievements?.additionalResultMultiplier, 0.5);
        raw[id] += campaign.score * multiplier;
      });
    }

    return {
      score: campaigns.length ? robustNormalizeMap(raw, teamIds) : constantMap(teamIds, 50),
      details,
    };
  }

  function createAchievementCampaign(result, eventId, eventConfig, event, weights, now, source) {
    const date =
      parseTimestamp(result.date || result.endAt || result.endedAt || eventConfig.endAt || eventConfig.endDate || eventConfig.date) ||
      finiteNumber(event?.end, finiteNumber(event?.start, now));
    const size = finiteNumber(result.teams, finiteNumber(result.size, finiteNumber(eventConfig.teams, Array.isArray(event?.teams) ? event.teams.length : 0)));
    const placementRange = achievementPlacementRange(result);
    const score =
      placementRangePoints(placementRange, weights) *
      positiveNumber(eventConfig.weight, weights.defaultTournamentWeight || 1) *
      sizeWeight(size, weights) *
      decayWeight(Math.max(0, (now - date) / DAY_MS), weights.halfLives?.achievements || 210);
    return {
      teamId: result.teamId,
      eventId,
      eventName: result.eventName || eventConfig.name || event?.name || eventId,
      eventLogo: result.eventLogo || eventConfig.logo || event?.logo || "",
      placement: placementRange.start,
      placementStart: placementRange.start,
      placementEnd: placementRange.end,
      placementLabel: result.placementLabel || placementRange.label,
      size,
      date,
      score,
      source,
    };
  }

  function achievementEventIsEligible(eventConfig = {}, event = {}, now = Date.now()) {
    if (eventConfig.achievementEligible === false || eventConfig.ignoreAchievements === true) return false;
    const explicitStatus = String(eventConfig.status || event?.status || "").toLowerCase();
    if (["em andamento", "andamento", "ongoing", "live", "scheduled", "agendado"].some((status) => explicitStatus.includes(status))) return false;
    const end =
      parseTimestamp(eventConfig.endAt || eventConfig.endDate || eventConfig.endedAt || eventConfig.date) ||
      finiteNumber(event?.end, parseTimestamp(event?.endAt || event?.endDate || event?.endedAt || event?.date));
    if (!end || !Number.isFinite(end)) return false;
    return end <= now;
  }

  function normalizeAchievementPlacements(placements, size = 0) {
    const rows = (placements || [])
      .filter((row) => row?.teamId)
      .map((row, index) => ({ ...row, originalIndex: index }));

    const grouped = new Map();
    for (const row of rows) {
      const range = achievementPlacementRange(row);
      const key = `${range.start}-${range.end}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ row, range });
    }

    const output = [];
    for (const group of grouped.values()) {
      const explicit = group[0].range.start !== group[0].range.end || group.some(({ row }) => row.range || row.placementEnd || row.to || row.endPlacement);
      const inferredEnd = explicit ? group[0].range.end : group[0].range.start + group.length - 1;
      for (const { row, range } of group) {
        const end = explicit ? range.end : inferredEnd;
        output.push({
          ...row,
          placement: range.start,
          placementStart: range.start,
          placementEnd: Math.max(range.start, end),
          placementLabel: placementRangeLabel(range.start, Math.max(range.start, end)),
        });
      }
    }

    return output
      .filter((row) => row.placementStart > 0 && (!size || row.placementStart <= size))
      .sort((a, b) => a.placementStart - b.placementStart || a.originalIndex - b.originalIndex);
  }

  function achievementPlacementsAreComplete(placements, eventConfig = {}, event = {}) {
    const expectedSize = finiteNumber(eventConfig.teams, finiteNumber(eventConfig.size, Array.isArray(event?.teams) ? event.teams.length : 0));
    if (!expectedSize) return placements.length > 0;
    const teamIds = new Set(placements.map((row) => row.teamId).filter(Boolean));
    if (teamIds.size < expectedSize) return false;
    const covered = new Set();
    for (const row of placements) {
      const range = achievementPlacementRange(row);
      for (let place = range.start; place <= Math.min(range.end, expectedSize); place += 1) {
        covered.add(place);
      }
    }
    for (let place = 1; place <= expectedSize; place += 1) {
      if (!covered.has(place)) return false;
    }
    return true;
  }

  function achievementPlacementRange(result = {}) {
    const fromRange = parsePlacementRange(result.range || result.placementRange || result.place || "");
    const start = finiteNumber(result.placementStart, finiteNumber(result.from, finiteNumber(result.startPlacement, finiteNumber(result.placement, fromRange.start))));
    const end = finiteNumber(result.placementEnd, finiteNumber(result.to, finiteNumber(result.endPlacement, fromRange.end)));
    const resolvedStart = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
    const resolvedEnd = Number.isFinite(end) && end > 0 ? Math.floor(end) : resolvedStart;
    return {
      start: resolvedStart,
      end: Math.max(resolvedStart, resolvedEnd),
      label: placementRangeLabel(resolvedStart, Math.max(resolvedStart, resolvedEnd)),
    };
  }

  function parsePlacementRange(value) {
    const text = String(value || "").trim();
    const match = text.match(/(\d+)\D+(\d+)/);
    if (match) return { start: Number(match[1]), end: Number(match[2]) };
    const single = text.match(/\d+/);
    if (single) return { start: Number(single[0]), end: Number(single[0]) };
    return { start: NaN, end: NaN };
  }

  function placementRangePoints(range, weights) {
    if (!range?.start) return placementPoints(NaN, weights);
    let total = 0;
    let count = 0;
    for (let placement = range.start; placement <= Math.max(range.start, range.end); placement += 1) {
      total += placementPoints(placement, weights);
      count += 1;
    }
    return count ? total / count : placementPoints(range.start, weights);
  }

  function placementRangeLabel(start, end) {
    if (!start) return "";
    return start === end ? `${start}` : `${start}-${end}`;
  }

  function eventStandings(eventSeries) {
    const rows = new Map();
    const ensure = (team) => {
      if (!rows.has(team.id)) {
        rows.set(team.id, { id: team.id, seriesWins: 0, seriesLosses: 0, mapWins: 0, mapLosses: 0, roundDiff: 0 });
      }
      return rows.get(team.id);
    };
    for (const series of eventSeries) {
      if (!series.teamA?.id || !series.teamB?.id) continue;
      const a = ensure(series.teamA);
      const b = ensure(series.teamB);
      const scoreA = finiteNumber(series.scoreA, series.maps?.filter((match) => match.winnerId === series.teamA.id).length || 0);
      const scoreB = finiteNumber(series.scoreB, series.maps?.filter((match) => match.winnerId === series.teamB.id).length || 0);
      const roundA = finiteNumber(series.roundScoreA, series.maps?.reduce((sum, match) => sum + scoreForTeamInMatch(match, series.teamA.id), 0) || 0);
      const roundB = finiteNumber(series.roundScoreB, series.maps?.reduce((sum, match) => sum + scoreForTeamInMatch(match, series.teamB.id), 0) || 0);
      const aWon = (series.winnerId || (scoreA > scoreB ? series.teamA.id : series.teamB.id)) === series.teamA.id;
      a.seriesWins += aWon ? 1 : 0;
      a.seriesLosses += aWon ? 0 : 1;
      b.seriesWins += aWon ? 0 : 1;
      b.seriesLosses += aWon ? 1 : 0;
      a.mapWins += scoreA;
      a.mapLosses += scoreB;
      b.mapWins += scoreB;
      b.mapLosses += scoreA;
      a.roundDiff += roundA - roundB;
      b.roundDiff += roundB - roundA;
    }
    return [...rows.values()].sort((a, b) => b.seriesWins - a.seriesWins || b.mapWins - a.mapWins || b.roundDiff - a.roundDiff || a.seriesLosses - b.seriesLosses || a.id.localeCompare(b.id));
  }

  function calculateRecentForm(teamIds, observations, baseStrength, competitive, weights, now) {
    const windowDays = finiteNumber(weights.recentWindowDays, 60);
    const cutoff = now - windowDays * DAY_MS;
    const buckets = Object.fromEntries(teamIds.map((id) => [id, { adjusted: 0, dominance: 0, winSos: 0, adjustedWeight: 0, dominanceWeight: 0, winWeight: 0, matches: 0 }]));
    for (const obs of observations) {
      if (!obs.startedAt || obs.startedAt < cutoff) continue;
      const days = Math.max(0, (now - obs.startedAt) / DAY_MS);
      const recentWeight = decayWeight(days, weights.halfLives?.recentForm || 30) * obs.tournamentWeight * obs.phaseWeight * obs.seriesWeight;
      applySide(obs, (teamId, opponentId, roundsFor, roundsAgainst, won) => {
        const opponentStrength = safeScore(baseStrength[opponentId]);
        const marginRelative = (roundsFor - roundsAgainst) / Math.max(1, roundsFor + roundsAgainst);
        const adjusted = clampNumber((won ? 100 : 0) + 0.25 * (opponentStrength - 50) + marginRelative * 20, 0, 100);
        const dominance = clampNumber(((clampNumber(marginRelative * 1.5, -1, 1) + 1) / 2) * 100, 0, 100);
        const bucket = buckets[teamId];
        bucket.adjusted += adjusted * recentWeight;
        bucket.adjustedWeight += recentWeight;
        bucket.dominance += dominance * recentWeight;
        bucket.dominanceWeight += recentWeight;
        bucket.matches += 1;
        if (won) {
          bucket.winSos += opponentStrength * recentWeight;
          bucket.winWeight += recentWeight;
        }
      });
    }

    const raw = {};
    const details = {};
    for (const id of teamIds) {
      const bucket = buckets[id];
      const adjustedPerformance = bucket.adjustedWeight ? bucket.adjusted / bucket.adjustedWeight : safeScore(competitive[id]);
      const dominance = bucket.dominanceWeight ? bucket.dominance / bucket.dominanceWeight : safeScore(competitive[id]);
      const recentWinSos = bucket.winWeight ? bucket.winSos / bucket.winWeight : bucket.matches ? 35 : safeScore(competitive[id]);
      const recentWeightSum =
        finiteNumber(weights.recentFormWeights.adjustedPerformance, 0.5) +
          finiteNumber(weights.recentFormWeights.dominance, 0.3) +
          finiteNumber(weights.recentFormWeights.recentWinSos, 0.2) || 1;
      raw[id] =
        (finiteNumber(weights.recentFormWeights.adjustedPerformance, 0.5) * adjustedPerformance +
          finiteNumber(weights.recentFormWeights.dominance, 0.3) * dominance +
          finiteNumber(weights.recentFormWeights.recentWinSos, 0.2) * recentWinSos) /
        recentWeightSum;
      details[id] = { matches: bucket.matches, adjustedPerformance, dominance, recentWinSos };
    }
    const normalized = observations.some((obs) => obs.startedAt >= cutoff) ? robustNormalizeMap(raw, teamIds) : constantMap(teamIds, 50);
    const score = {};
    for (const id of teamIds) {
      const recentMatches = details[id].matches;
      if (recentMatches >= 5) {
        score[id] = safeScore(normalized[id]);
      } else {
        score[id] = safeScore((normalized[id] * recentMatches + safeScore(competitive[id]) * (5 - recentMatches)) / 5);
      }
    }
    return { score, details };
  }

  function calculateRosterStrength(teamIds, teamsById, matches, baseStrength, weights, now) {
    const playerGames = [];
    for (const match of matches || []) {
      const teamAId = match.teamA?.id;
      const teamBId = match.teamB?.id;
      if (!teamAId || !teamBId) continue;
      for (const player of match.players || []) {
        const teamId = player.teamId || (player.teamColor === match.teamA.color ? teamAId : teamBId);
        if (!teamId || !teamIds.includes(teamId)) continue;
        const opponentId = teamId === teamAId ? teamBId : teamAId;
        const rating = finiteNumber(player.rating, NaN);
        if (!Number.isFinite(rating) || finiteNumber(player.rounds, 0) <= 0) continue;
        playerGames.push({
          teamId,
          playerId: player.id,
          rating,
          opponentStrength: safeScore(baseStrength[opponentId]),
          startedAt: finiteNumber(match.startedAt, now),
          rounds: finiteNumber(player.rounds, 0),
        });
      }
    }
    if (!playerGames.length) {
      const neutral = constantMap(teamIds, 50);
      return { score: neutral, details: Object.fromEntries(teamIds.map((id) => [id, { individualRating: 50, coreStability: 50, depth: 50 }])) };
    }

    const ratingStats = zStats(playerGames.map((game) => game.rating));
    const opponentStats = zStats(teamIds.map((id) => safeScore(baseStrength[id])));
    const individualRaw = {};
    const coreScore = {};
    const depthRaw = {};
    const details = {};
    for (const id of teamIds) {
      const team = teamsById.get(id) || {};
      const games = playerGames.filter((game) => game.teamId === id);
      const currentIds = (team.currentLineup || []).map((slot) => slot.playerId).filter(Boolean);
      const candidateIds = currentIds.length ? new Set(currentIds) : new Set(games.map((game) => game.playerId));
      const playerBuckets = new Map();
      for (const game of games) {
        if (candidateIds.size && !candidateIds.has(game.playerId)) continue;
        const days = Math.max(0, (now - game.startedAt) / DAY_MS);
        const recency = decayWeight(days, weights.halfLives?.playerRating || 90);
        const gameWeight = recency * Math.sqrt(Math.max(1, game.rounds));
        const adjusted = zValue(game.rating, ratingStats) + 0.15 * zValue(game.opponentStrength, opponentStats);
        const bucket = playerBuckets.get(game.playerId) || { sum: 0, weight: 0, matches: 0 };
        bucket.sum += adjusted * gameWeight;
        bucket.weight += gameWeight;
        bucket.matches += 1;
        playerBuckets.set(game.playerId, bucket);
      }
      const playerRatings = [...playerBuckets.values()]
        .filter((bucket) => bucket.weight > 0)
        .map((bucket) => ({ rating: bucket.sum / bucket.weight, matches: bucket.matches }))
        .sort((a, b) => b.rating - a.rating);
      individualRaw[id] = playerRatings.length ? mean(playerRatings.slice(0, 5).map((row) => row.rating)) : NaN;

      const recentGames = games.slice().sort((a, b) => b.startedAt - a.startedAt).slice(0, 50);
      const recentPlayerCounts = countBy(recentGames, (game) => game.playerId);
      if (currentIds.length) {
        const stable = currentIds.filter((playerId) => (recentPlayerCounts.get(playerId) || 0) > 0).length;
        coreScore[id] = clampNumber((stable / Math.max(1, Math.min(5, currentIds.length))) * 100, 0, 100);
      } else {
        const regulars = [...recentPlayerCounts.values()].filter((count) => count >= 2).length;
        coreScore[id] = clampNumber((regulars / 5) * 100, 0, 100);
      }
      const qualifiedDepth = [...countBy(games, (game) => game.playerId).values()].filter((count) => count >= 2).length;
      depthRaw[id] = qualifiedDepth;
      details[id] = {
        observedPlayers: new Set(games.map((game) => game.playerId)).size,
        ratedPlayers: playerRatings.length,
        coreStability: coreScore[id],
        depthRaw: qualifiedDepth,
      };
    }

    const individualRating = robustNormalizeMap(individualRaw, teamIds);
    const depth = robustNormalizeMap(depthRaw, teamIds);
    const score = {};
    for (const id of teamIds) {
      const rosterWeightSum =
        finiteNumber(weights.rosterWeights.individualRating, 0.7) +
          finiteNumber(weights.rosterWeights.coreStability, 0.2) +
          finiteNumber(weights.rosterWeights.depth, 0.1) || 1;
      score[id] = safeScore(
        (finiteNumber(weights.rosterWeights.individualRating, 0.7) * individualRating[id] +
          finiteNumber(weights.rosterWeights.coreStability, 0.2) * coreScore[id] +
          finiteNumber(weights.rosterWeights.depth, 0.1) * depth[id]) /
          rosterWeightSum,
      );
      details[id] = {
        ...details[id],
        individualRating: individualRating[id],
        coreStability: coreScore[id],
        depth: depth[id],
      };
    }
    return { score, details };
  }

  function weightedBlock(teamIds, weights, scoresByKey) {
    const output = {};
    for (const id of teamIds) {
      let value = 0;
      let usedWeight = 0;
      for (const [key, weight] of Object.entries(weights || {})) {
        const score = scoresByKey[key]?.[id];
        if (!Number.isFinite(score)) continue;
        value += finiteNumber(weight, 0) * score;
        usedWeight += finiteNumber(weight, 0);
      }
      output[id] = usedWeight ? safeScore(value / usedWeight) : 50;
    }
    return output;
  }

  function applySide(obs, callback) {
    callback(obs.teamAId, obs.teamBId, obs.scoreA, obs.scoreB, obs.winnerId === obs.teamAId, obs);
    callback(obs.teamBId, obs.teamAId, obs.scoreB, obs.scoreA, obs.winnerId === obs.teamBId, obs);
  }

  function scoreForTeamInMatch(match, teamId) {
    if (match.teamA?.id === teamId) return finiteNumber(match.teamA.score, 0);
    if (match.teamB?.id === teamId) return finiteNumber(match.teamB.score, 0);
    return 0;
  }

  function placementPoints(placement, weights) {
    const points = weights.achievements?.placementPoints || {};
    const direct = points[String(placement)];
    if (direct !== undefined) return finiteNumber(direct, 0);
    return finiteNumber(points.participation, 8);
  }

  function sizeWeight(size, weights) {
    const rows = (weights.achievements?.sizeWeights || []).slice().sort((a, b) => finiteNumber(a.minTeams, 0) - finiteNumber(b.minTeams, 0));
    let resolved = 1;
    for (const row of rows) {
      if (size >= finiteNumber(row.minTeams, 0)) resolved = positiveNumber(row.weight, resolved);
    }
    return resolved;
  }

  function normalize0to100(values) {
    const finite = values.map((value) => finiteNumber(value, NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!finite.length) return values.map(() => 50);
    const p5 = percentile(finite, 0.05);
    const p95 = percentile(finite, 0.95);
    if (!Number.isFinite(p5) || !Number.isFinite(p95) || Math.abs(p95 - p5) <= EPSILON) return values.map(() => 50);
    return values.map((value) => {
      const finiteValue = finiteNumber(value, NaN);
      if (!Number.isFinite(finiteValue)) return 50;
      return safeScore((100 * (finiteValue - p5)) / (p95 - p5));
    });
  }

  function robustNormalizeMap(map, ids) {
    const normalized = normalize0to100(ids.map((id) => map?.[id]));
    return Object.fromEntries(ids.map((id, index) => [id, normalized[index]]));
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return NaN;
    const index = (sortedValues.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function decayWeight(days, halfLife) {
    const resolvedHalfLife = positiveNumber(halfLife, 1);
    return Math.pow(0.5, Math.max(0, finiteNumber(days, 0)) / resolvedHalfLife);
  }

  function expectedFromStrength(a, b) {
    return 1 / (1 + Math.exp(-(safeScore(a) - safeScore(b)) / 14));
  }

  function solveLinearSystem(matrix, vector) {
    const n = matrix.length;
    if (!n) return [];
    const a = matrix.map((row, i) => row.map((value) => finiteNumber(value, 0)).concat(finiteNumber(vector[i], 0)));
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < n; row += 1) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      if (Math.abs(a[pivot][col]) <= EPSILON) a[pivot][col] = EPSILON;
      if (pivot !== col) [a[pivot], a[col]] = [a[col], a[pivot]];
      const divisor = a[col][col] || EPSILON;
      for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = a[row][col];
        for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
      }
    }
    return a.map((row) => finiteNumber(row[n], 0));
  }

  function identityMatrix(size, diagonal = 1) {
    return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => (row === col ? diagonal : 0)));
  }

  function covarianceMatrix(centered, width) {
    const matrix = identityMatrix(width, 0);
    if (!centered.length) return matrix;
    for (let i = 0; i < width; i += 1) {
      for (let j = 0; j < width; j += 1) {
        matrix[i][j] = centered.reduce((sum, row) => sum + row[i] * row[j], 0) / Math.max(1, centered.length - 1);
      }
    }
    return matrix;
  }

  function firstPrincipalVector(cov) {
    const n = cov.length;
    if (!n) return [];
    let vector = Array(n).fill(1 / Math.sqrt(n));
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const next = Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) next[i] += cov[i][j] * vector[j];
      }
      const length = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1;
      vector = next.map((value) => value / length);
    }
    return vector;
  }

  function zStats(values) {
    const finite = values.map((value) => finiteNumber(value, NaN)).filter(Number.isFinite);
    return { mean: mean(finite), sd: standardDeviation(finite) || 1 };
  }

  function zValue(value, stats) {
    return (finiteNumber(value, stats.mean) - stats.mean) / (stats.sd || 1);
  }

  function correlation(a, b) {
    const rows = a.map((value, index) => [finiteNumber(value, NaN), finiteNumber(b[index], NaN)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (rows.length < 2) return 0;
    const xs = rows.map(([x]) => x);
    const ys = rows.map(([, y]) => y);
    const mx = mean(xs);
    const my = mean(ys);
    const numerator = rows.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
    const dx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
    const dy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
    return dx && dy ? numerator / (dx * dy) : 0;
  }

  function dot(a, b) {
    return a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
  }

  function standardDeviation(values) {
    const finite = values.filter(Number.isFinite);
    if (finite.length < 2) return 0;
    const avg = mean(finite);
    return Math.sqrt(finite.reduce((sum, value) => sum + (value - avg) ** 2, 0) / finite.length);
  }

  function mean(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
  }

  function countBy(rows, keyFn) {
    const counts = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function groupBy(rows, keyFn) {
    const groups = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return groups;
  }

  function indexById(ids) {
    return new Map(ids.map((id, index) => [id, index]));
  }

  function mapFromArray(ids, values) {
    return Object.fromEntries(ids.map((id, index) => [id, finiteNumber(values[index], 0)]));
  }

  function constantMap(ids, value) {
    return Object.fromEntries(ids.map((id) => [id, value]));
  }

  function safeScore(value) {
    return clampNumber(finiteNumber(value, 50), 0, 100);
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, finiteNumber(value, min)));
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback = 1) {
    const number = finiteNumber(value, NaN);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function parseTimestamp(value) {
    if (!value) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function mergeConfig(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
    if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
    const output = { ...base };
    for (const [key, value] of Object.entries(override)) {
      output[key] = mergeConfig(base[key], value);
    }
    return output;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  return {
    DEFAULT_WEIGHTS,
    calculateTeamRankings,
    normalize0to100,
    pcaCorrected,
    decayWeight,
  };
});
