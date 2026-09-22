// Executa, para uma pasta de JSONs, exatamente o mesmo pipeline de partidas
// usado pelo site. O analiseMatches.py consome a saida JSON deste helper para
// nao manter uma segunda implementacao de identidade, KAST e rAAting.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

const noop = () => {};
const stubElement = {
  innerHTML: "",
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {},
  dataset: {},
  setAttribute: noop,
  appendChild: noop,
  focus: noop,
};

globalThis.window = globalThis;
globalThis.document = {
  title: "",
  getElementById: () => stubElement,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...stubElement }),
  addEventListener: noop,
  removeEventListener: noop,
  body: stubElement,
  documentElement: stubElement,
};
globalThis.location = { hash: "" };
globalThis.history = { pushState: noop, replaceState: noop };
globalThis.requestAnimationFrame = () => 0;
// O init automatico de app.js para na primeira espera, sem efeitos colaterais.
globalThis.fetch = () => new Promise(noop);

function loadScript(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  (0, eval)(source);
}

function collectJsonFiles(directory, recursive) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...collectJsonFiles(fullPath, true));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      found.push(fullPath);
    }
  }
  return found.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function eventIdsBySitePath() {
  const result = new Map();
  const manifestPath = path.join(ROOT, "data-sources.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const event of manifest.events || []) {
    for (const filePath of event.files || []) {
      result.set(path.basename(filePath).toLocaleLowerCase("pt-BR"), event.id);
    }
  }
  return result;
}

function canonicalSiteMatchFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data-sources.json"), "utf8"));
  const unique = new Map();
  for (const event of manifest.events || []) {
    for (const relativePath of event.files || []) {
      const fullPath = path.join(ROOT, relativePath);
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const matchId = raw.matchInfo?.matchId || relativePath;
      if (!unique.has(matchId)) unique.set(matchId, { eventId: event.id, path: relativePath, raw });
    }
  }
  return [...unique.values()];
}

function clutchesByPuuid(raw) {
  const sideByPuuid = new Map(
    (raw.players || [])
      .filter((player) => !player.isObserver && ["Blue", "Red"].includes(player.teamId) && player.puuid)
      .map((player) => [String(player.puuid), player.teamId]),
  );
  const rosters = {
    Blue: new Set([...sideByPuuid].filter(([, side]) => side === "Blue").map(([puuid]) => puuid)),
    Red: new Set([...sideByPuuid].filter(([, side]) => side === "Red").map(([puuid]) => puuid)),
  };
  const totals = new Map();

  for (const round of raw.roundResults || []) {
    const events = [];
    const seen = new Set();
    for (const row of round.playerStats || []) {
      for (const kill of row.kills || []) {
        const time = kill.timeSinceRoundStartMillis;
        const victim = String(kill.victim || "");
        let killer = String(kill.killer || "");
        if (time === null || time === undefined || !sideByPuuid.has(victim)) continue;
        if (!sideByPuuid.has(killer)) killer = "";
        const key = `${Number(time)}|${killer}|${victim}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({ time: Number(time), victim });
      }
    }
    events.sort((a, b) => a.time - b.time);

    const alive = { Blue: new Set(rosters.Blue), Red: new Set(rosters.Red) };
    const candidate = { Blue: "", Red: "" };
    const victims = new Set();
    for (const event of events) {
      const side = sideByPuuid.get(event.victim);
      if (!side || !alive[side].has(event.victim)) continue;
      victims.add(event.victim);
      alive[side].delete(event.victim);
      const enemy = side === "Blue" ? "Red" : "Blue";
      if (!candidate[side] && alive[side].size === 1 && alive[enemy].size > 1) {
        candidate[side] = [...alive[side]][0];
      }
    }
    const winner = round.winningTeam;
    const clutchPlayer = candidate[winner];
    if (clutchPlayer && !victims.has(clutchPlayer)) {
      totals.set(clutchPlayer, (totals.get(clutchPlayer) || 0) + 1);
    }
  }
  return totals;
}

function limitedPlayer(player) {
  const fields = [
    "id", "puuid", "nick", "apiNick", "tagLine", "handle", "registered",
    "currentTeam", "teamHistory", "teamColor", "teamId", "teamTag",
    "agentId", "agentSlug", "agent", "agentClass", "rounds", "roundWins",
    "roundLosses", "kills", "deaths", "assists", "score", "damage", "adr",
    "acs", "kd", "kpr", "dpr", "apr", "kast", "kastFrac", "kastRounds",
    "kastLegacy", "kastLegacyFrac", "kastLegacyRounds", "impactTotal",
    "impactRound", "impactTotalLegacy", "impactRoundLegacy",
    "adjustedRoundSwingTotalPp", "eKillPoints", "eDeathPoints", "eDamageTotal",
    "eKastPoints", "tradedDeaths", "failedTradeDeaths", "tradeKills",
    "tradeDenials", "savedLossRounds", "survivedWinRounds", "multiKillPoints",
    "firstKills", "firstDeaths", "oneKills", "twoKills", "threeKills",
    "fourKills", "fiveKills", "clutches", "raating_1", "raating_3", "rating",
    "rating_version", "sample_status",
  ];
  return Object.fromEntries(fields.map((field) => [field, player[field]]));
}

function main() {
  const inputDir = path.resolve(process.argv[2] || "");
  const recursive = process.argv[3] !== "false";
  if (!inputDir || !fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error(`Pasta de entrada invalida: ${inputDir}`);
  }

  loadScript("raating-core.js");
  loadScript("ranking-core.js");
  loadScript("app.js");

  const rawMetadata = JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json"), "utf8"));
  const metadata = prepareMetadata(rawMetadata);
  const eventByName = eventIdsBySitePath();
  const uniqueMatches = new Map();
  const invalidFiles = [];
  const duplicateFiles = [];

  for (const fullPath of collectJsonFiles(inputDir, recursive)) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      invalidFiles.push({ path: fullPath, error: error.message });
      continue;
    }
    if (!raw || !raw.matchInfo || !Array.isArray(raw.players) || !Array.isArray(raw.roundResults)) {
      invalidFiles.push({ path: fullPath, error: "JSON nao possui a estrutura de uma partida" });
      continue;
    }
    const matchId = raw.matchInfo.matchId || fullPath;
    if (uniqueMatches.has(matchId)) {
      duplicateFiles.push(fullPath);
      continue;
    }
    const relativePath = path.relative(inputDir, fullPath).split(path.sep).join("/");
    uniqueMatches.set(matchId, {
      eventId: eventByName.get(path.basename(fullPath).toLocaleLowerCase("pt-BR")) || "analise-local",
      path: relativePath,
      raw,
    });
  }

  const matchFiles = [...uniqueMatches.values()];
  // O modelo economico faz parte do contexto global do site. Recalcula-lo so
  // com uma pasta/campeonato alteraria o mesmo jogador conforme o recorte.
  const raatingContext = buildRaatingContext(canonicalSiteMatchFiles());
  const ratingMetadata = { ...metadata, raatingContext };
  const matches = [];
  for (const file of matchFiles) {
    let match;
    try {
      match = parseMatchFile(file, ratingMetadata);
    } catch (error) {
      invalidFiles.push({ path: file.path, error: error.message });
      continue;
    }
    if (!match) {
      invalidFiles.push({ path: file.path, error: "Nome do arquivo ou placar nao reconhecido pelo site" });
      continue;
    }
    const clutches = clutchesByPuuid(file.raw);
    for (const player of match.players || []) player.clutches = clutches.get(player.puuid) || 0;
    matches.push(match);
  }

  const result = {
    jsonFileCount: collectJsonFiles(inputDir, recursive).length,
    uniqueMatchCount: matches.length,
    invalidFiles,
    duplicateFiles,
    ecoObservedKills: raatingContext.ecoObservedKills,
    teamOrder: (metadata.teams || []).map((team) => team.id).filter(Boolean),
    matches: matches.map((match) => ({
      id: match.id,
      sourcePath: match.sourcePath,
      fileName: match.fileName,
      mapName: match.mapName,
      teamA: match.teamA,
      teamB: match.teamB,
      winnerId: match.winnerId,
      players: (match.players || []).map(limitedPlayer),
    })),
  };
  process.stdout.write(JSON.stringify(result));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
}
