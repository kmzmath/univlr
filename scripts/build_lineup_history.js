const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_SOURCES = path.join(ROOT, "data-sources.json");
const METADATA = path.join(ROOT, "metadata.json");
const TEAM_PROFILES = path.join(ROOT, "team-profiles.json");

const FILENAME_TEAM_ALIASES = {
  azr: "azure_bears",
  caap: "caap_hellhounds",
  fei: "fei_darkowls",
  mackred: "macklogic_red",
  pucc: "pucc_cardinals",
  tritons: "unicamp_tritons_red",
  uspstars: "usp_stars",
  axissupernova: "axis_anteaters",
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeNameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseFileName(sourcePath) {
  const filename = sourcePath.split(/[\\/]/).pop();
  const stem = filename.replace(/(?:\.json)+$/i, "");
  const tokens = stem.split("_").filter(Boolean);
  const scoreIndex = tokens.findIndex((token, index) => /^\d+$/.test(token) && tokens[index + 1]?.toLowerCase() === "x" && /^\d+$/.test(tokens[index + 2] || ""));
  if (scoreIndex < 2 || scoreIndex + 4 > tokens.length) return parseCompactRivalsFile(stem);

  const beforeScore = tokens.slice(0, scoreIndex);
  const codeIndex = beforeScore.findIndex((token) => /^\d+[a-z]?$/i.test(token));
  let teamAStart = codeIndex >= 0 ? codeIndex + 1 : 1;
  if (/^\d{2}-\d{2}-\d{2,4}$/.test(beforeScore[teamAStart] || "") || /^\d{4}-\d{2}-\d{2}$/.test(beforeScore[teamAStart] || "")) teamAStart += 1;

  const teamAId = beforeScore.slice(teamAStart).join("_");
  const teamBId = tokens.slice(scoreIndex + 3, -1).join("_");
  if (!teamAId || !teamBId) return null;
  return {
    teamAId,
    teamBId,
    scoreA: Number(tokens[scoreIndex]),
    scoreB: Number(tokens[scoreIndex + 2]),
  };
}

function parseCompactRivalsFile(stem) {
  const match = stem.match(/^Rivals_(?<series>\d+)_(?<suffix>[a-z])_(?<pair>.+)$/i);
  if (!match?.groups) return null;
  const pair = splitCompactTeamPair(match.groups.pair);
  if (!pair) return null;
  return {
    teamAId: FILENAME_TEAM_ALIASES[pair[0]] || pair[0],
    teamBId: FILENAME_TEAM_ALIASES[pair[1]] || pair[1],
    inferTeamsFromPlayers: true,
  };
}

function splitCompactTeamPair(pair) {
  const compact = normalizeNameKey(pair);
  const aliases = Object.keys(FILENAME_TEAM_ALIASES).sort((a, b) => b.length - a.length);
  for (const left of aliases) {
    for (const right of aliases) {
      if (compact === `${left}x${right}`) return [left, right];
    }
  }
  return null;
}

function buildPlayerLookups(metadata) {
  const byPuuid = new Map();
  const byName = new Map();
  for (const player of metadata.players || []) {
    if (player.puuid) byPuuid.set(player.puuid, player);
    for (const name of [player.name, ...(player.nickHistory || [])]) {
      const key = normalizeNameKey(name);
      if (key && !byName.has(key)) byName.set(key, player);
    }
  }
  return { byPuuid, byName };
}

function registeredPlayerForRaw(rawPlayer, lookups) {
  const handle = rawPlayer.tagLine ? `${rawPlayer.gameName}#${rawPlayer.tagLine}` : rawPlayer.gameName;
  return (
    lookups.byPuuid.get(rawPlayer.puuid) ||
    lookups.byName.get(normalizeNameKey(handle)) ||
    lookups.byName.get(normalizeNameKey(rawPlayer.gameName))
  );
}

function playerTeamConfidence(registered, teamId) {
  if (!registered || !teamId) return 0;
  const teamHistory = new Set((registered.teamHistory || []).filter(Boolean));
  let score = 0;
  if (teamHistory.has(teamId)) score += 2;
  if (registered.currentTeam === teamId) score += 2;
  if (score > 0) return score;
  if (registered.currentTeam && registered.currentTeam !== teamId) return -1;
  return 0;
}

function resolvePlayer(rawPlayer, lookups, teamId) {
  const registered = registeredPlayerForRaw(rawPlayer, lookups);
  const profileConfidence = Math.max(0, playerTeamConfidence(registered, teamId));
  const id = registered?.puuid || rawPlayer.puuid || normalizeNameKey(rawPlayer.gameName);
  const name = registered?.name || rawPlayer.gameName || id;
  const handle = rawPlayer.tagLine ? `${rawPlayer.gameName}#${rawPlayer.tagLine}` : rawPlayer.gameName || name;
  return {
    id,
    name,
    handle,
    rounds: Number(rawPlayer.stats?.roundsPlayed || 0),
    profileConfidence,
    profileLinked: profileConfidence > 0,
    currentTeam: registered?.currentTeam || "",
    teamHistory: registered?.teamHistory || [],
  };
}

function inferColorsFromPlayers(players, meta, lookups) {
  const scores = {
    [meta.teamAId]: { Red: 0, Blue: 0 },
    [meta.teamBId]: { Red: 0, Blue: 0 },
  };
  for (const player of players || []) {
    const registered = registeredPlayerForRaw(player, lookups);
    for (const teamId of [meta.teamAId, meta.teamBId]) {
      const confidence = Math.max(0, playerTeamConfidence(registered, teamId));
      if (confidence > 0 && scores[teamId][player.teamId] !== undefined) scores[teamId][player.teamId] += confidence;
    }
  }
  const aColor = scores[meta.teamAId].Red >= scores[meta.teamAId].Blue ? "Red" : "Blue";
  const bColor = aColor === "Red" ? "Blue" : "Red";
  return { [aColor]: meta.teamAId, [bColor]: meta.teamBId };
}

function colorTeamMap(raw, meta, lookups) {
  if (meta.inferTeamsFromPlayers) return inferColorsFromPlayers(raw.players || [], meta, lookups);
  const red = (raw.teams || []).find((team) => team.teamId === "Red");
  const blue = (raw.teams || []).find((team) => team.teamId === "Blue");
  if (!red || !blue) return null;
  const colorForA =
    meta.scoreA === red.roundsWon && meta.scoreB === blue.roundsWon
      ? "Red"
      : meta.scoreA === blue.roundsWon && meta.scoreB === red.roundsWon
        ? "Blue"
        : red.roundsWon >= blue.roundsWon
          ? "Red"
          : "Blue";
  const colorForB = colorForA === "Red" ? "Blue" : "Red";
  return {
    [colorForA]: meta.teamAId,
    [colorForB]: meta.teamBId,
  };
}

function collectTeamAppearances(dataSources, metadata) {
  const lookups = buildPlayerLookups(metadata);
  const appearances = new Map();
  const failures = [];

  for (const event of dataSources.events || []) {
    for (const sourcePath of event.files || []) {
      const absolute = path.join(ROOT, sourcePath);
      let raw;
      try {
        raw = readJson(absolute);
      } catch (error) {
        failures.push({ sourcePath, reason: "read" });
        continue;
      }
      const meta = parseFileName(sourcePath);
      if (!meta) {
        failures.push({ sourcePath, reason: "filename" });
        continue;
      }
      const byColor = colorTeamMap(raw, meta, lookups);
      if (!byColor) {
        failures.push({ sourcePath, reason: "teams" });
        continue;
      }
      const startedAt = Number(raw.matchInfo?.gameStartMillis || 0);
      if (!startedAt) continue;
      const perTeam = new Map();
      for (const rawPlayer of raw.players || []) {
        if (rawPlayer.isObserver) continue;
        const teamId = byColor[rawPlayer.teamId];
        if (!teamId) continue;
        if (!perTeam.has(teamId)) perTeam.set(teamId, []);
        perTeam.get(teamId).push(resolvePlayer(rawPlayer, lookups, teamId));
      }
      for (const [teamId, players] of perTeam) {
        if (!appearances.has(teamId)) appearances.set(teamId, []);
        appearances.get(teamId).push({
          eventId: event.id,
          sourcePath,
          startedAt,
          players,
        });
      }
    }
  }

  return { appearances, failures };
}

function playerSet(players) {
  return new Set(players.map((player) => player.id).filter(Boolean));
}

function setOverlap(a, b) {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count;
}

function compareSegmentPlayers(a, b) {
  return (
    b.matches - a.matches ||
    b.profileMatches - a.profileMatches ||
    b.profileConfidence - a.profileConfidence ||
    b.rounds - a.rounds ||
    b.lastSeenAt - a.lastSeenAt ||
    a.name.localeCompare(b.name)
  );
}

function addAppearanceToSegment(segment, appearance) {
  segment.lastSeenAt = Math.max(segment.lastSeenAt, appearance.startedAt);
  segment.matches += 1;
  segment.sources.push(appearance.sourcePath);
  segment.profileConfidence += appearance.players.reduce((sum, player) => sum + (player.profileConfidence || 0), 0);
  for (const player of appearance.players) {
    const bucket = segment.players.get(player.id) || {
      playerId: player.id,
      name: player.name,
      handle: player.handle,
      firstSeenAt: appearance.startedAt,
      lastSeenAt: 0,
      matches: 0,
      rounds: 0,
      profileMatches: 0,
      profileConfidence: 0,
      currentTeam: "",
      teamHistory: [],
    };
    bucket.name = player.name || bucket.name;
    bucket.handle = player.handle || bucket.handle;
    bucket.firstSeenAt = Math.min(bucket.firstSeenAt, appearance.startedAt);
    bucket.lastSeenAt = Math.max(bucket.lastSeenAt, appearance.startedAt);
    bucket.matches += 1;
    bucket.rounds += player.rounds || 0;
    bucket.profileConfidence += player.profileConfidence || 0;
    if (player.profileLinked) bucket.profileMatches += 1;
    if (player.currentTeam) bucket.currentTeam = player.currentTeam;
    if (player.teamHistory?.length) bucket.teamHistory = [...new Set([...bucket.teamHistory, ...player.teamHistory])];
    segment.players.set(player.id, bucket);
  }
  segment.core = new Set(
    [...segment.players.values()]
      .sort(compareSegmentPlayers)
      .slice(0, 5)
      .map((player) => player.playerId),
  );
}

function buildLineupSegments(appearances) {
  const ordered = appearances.slice().sort((a, b) => a.startedAt - b.startedAt);
  const segments = [];
  let current = null;
  for (const appearance of ordered) {
    const ids = playerSet(appearance.players);
    if (!ids.size) continue;
    const overlap = current ? setOverlap(current.core, ids) : 0;
    const trustedOverlap = current
      ? appearance.players.filter((player) => current.core.has(player.id) && (player.profileConfidence || 0) > 0).length
      : 0;
    const shouldContinue = current && (overlap >= 3 || (overlap >= 2 && trustedOverlap >= 2));
    if (!shouldContinue) {
      current = {
        firstSeenAt: appearance.startedAt,
        lastSeenAt: appearance.startedAt,
        matches: 0,
        sources: [],
        players: new Map(),
        core: new Set(),
        profileConfidence: 0,
      };
      segments.push(current);
    }
    addAppearanceToSegment(current, appearance);
  }
  return segments.map(serializeSegment);
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function serializeSegment(segment) {
  const players = [...segment.players.values()]
    .sort(compareSegmentPlayers)
    .slice(0, 8)
    .map((player, index) => {
      const row = {
        slot: index + 1,
        playerId: player.playerId,
        name: player.name,
        handle: player.handle,
        firstSeenAt: isoDate(player.firstSeenAt),
        lastSeenAt: isoDate(player.lastSeenAt),
        matches: player.matches,
        rounds: player.rounds,
        profileMatches: player.profileMatches,
        profileConfidence: Number(player.profileConfidence.toFixed(1)),
      };
      if (player.currentTeam) row.currentTeam = player.currentTeam;
      if (player.teamHistory.length) row.teamHistory = player.teamHistory;
      return row;
    });
  return {
    from: isoDate(segment.firstSeenAt),
    to: isoDate(segment.lastSeenAt),
    firstSeenAt: segment.firstSeenAt,
    lastSeenAt: segment.lastSeenAt,
    matches: segment.matches,
    source: "auto-json+players-history",
    profileConfidence: Number(segment.profileConfidence.toFixed(1)),
    players,
  };
}

function updateTeamProfiles(histories, metadata) {
  const profiles = fs.existsSync(TEAM_PROFILES)
    ? readJson(TEAM_PROFILES)
    : { assetFolders: {}, defaults: {}, teams: {} };
  profiles.defaults = profiles.defaults || {};
  if (!Array.isArray(profiles.defaults.lineupHistory)) profiles.defaults.lineupHistory = [];
  profiles.teams = profiles.teams || {};

  const teamIds = new Set([...(metadata.teams || []).map((team) => team.id), ...histories.keys()]);
  for (const teamId of [...teamIds].sort()) {
    const history = histories.get(teamId) || [];
    if (!history.length && !profiles.teams[teamId]) continue;
    profiles.teams[teamId] = profiles.teams[teamId] || {};
    profiles.teams[teamId].lineupHistory = history;
  }

  writeJson(TEAM_PROFILES, profiles);
}

function main() {
  const dataSources = readJson(DATA_SOURCES);
  const metadata = readJson(METADATA);
  const { appearances, failures } = collectTeamAppearances(dataSources, metadata);
  const histories = new Map();
  for (const [teamId, rows] of appearances) {
    const history = buildLineupSegments(rows);
    if (history.length) histories.set(teamId, history);
  }
  updateTeamProfiles(histories, metadata);
  console.log(
    JSON.stringify(
      {
        output: path.relative(ROOT, TEAM_PROFILES),
        teamsWithHistory: histories.size,
        lineupSegments: [...histories.values()].reduce((sum, rows) => sum + rows.length, 0),
        parseFailures: failures.length,
      },
      null,
      2,
    ),
  );
  if (failures.length) {
    console.warn(`Lineup history warnings: ${failures.length} files were skipped.`);
  }
}

main();
