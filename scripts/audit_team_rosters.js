// Auditoria de elencos: somente leitura. Gera evidencias para revisao humana.
const fs = require("node:fs");
const path = require("node:path");
const { decode } = require("../db-codec.js");

const ROOT = path.resolve(__dirname, "..");
const DAY = 86400000;
const RULES = Object.freeze({
  recentTeamDays: 60,
  strongAbsenceSeries: 5,
  strongAbsenceDays: 30,
  watchAbsenceSeries: 3,
  watchAbsenceDays: 14,
  minimumDistinctDates: 2,
  noDebutTeamSeries: 5,
  otherTeamSeries: 2,
});

function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function day(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function distinctDays(rows) {
  return new Set(rows.map((row) => day(row.at))).size;
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
}

function parseArgs(argv) {
  const opts = { asOf: day(Date.now()), out: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--as-of") opts.asOf = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) throw new Error("--as-of deve ser AAAA-MM-DD");
  return opts;
}

function registeredPlayers(metadata) {
  const byName = new Map();
  const byId = new Map();
  const ambiguities = new Set();
  for (const player of metadata.players || []) {
    byId.set(player.id, player);
    for (const text of [player.name, ...(player.nickHistory || [])]) {
      const key = norm(text);
      if (!key) continue;
      if (byName.has(key) && byName.get(key)?.id !== player.id) ambiguities.add(key);
      else if (!byName.has(key)) byName.set(key, player);
    }
  }
  return { byName, byId, ambiguities };
}

function readObservers(dataSources, metadata) {
  const accountToId = new Map();
  for (const player of metadata.players || []) {
    for (const id of [player.puuid, ...(player.accounts || [])].filter(Boolean)) accountToId.set(id, player.id);
  }
  const observers = new Map();
  for (const event of dataSources.events || []) {
    for (const relative of event.files || []) {
      const file = path.join(ROOT, relative);
      let raw;
      try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
      const at = Number(raw.matchInfo?.gameStartMillis || 0);
      for (const player of raw.players || []) {
        if (!player.isObserver) continue;
        const id = accountToId.get(player.puuid);
        if (!id) continue;
        const row = observers.get(id) || { maps: 0, lastAt: 0 };
        row.maps++;
        row.lastAt = Math.max(row.lastAt, at);
        observers.set(id, row);
      }
    }
  }
  return observers;
}

function observedSeries(db) {
  const byTeam = new Map();
  const byPlayer = new Map();
  const mapCounts = new Map();
  for (const series of db.matchSeries || []) {
    const at = Number(series.startedAt || series.sortAt || 0);
    const teamIds = [series.teamA?.id, series.teamB?.id].filter(Boolean);
    const players = new Map(teamIds.map((id) => [id, new Set()]));
    for (const match of series.maps || []) {
      for (const player of match.players || []) {
        const teamId = player.teamId;
        if (!players.has(teamId) || !player.id) continue;
        players.get(teamId).add(player.id);
        const key = `${teamId}|${player.id}`;
        mapCounts.set(key, (mapCounts.get(key) || 0) + 1);
      }
    }
    for (const teamId of teamIds) {
      const row = {
        id: series.seriesKey || series.id,
        at,
        opponent: teamIds.find((id) => id !== teamId) || "",
        mapCount: (series.maps || []).length,
        players: players.get(teamId),
      };
      if (!byTeam.has(teamId)) byTeam.set(teamId, []);
      byTeam.get(teamId).push(row);
      for (const playerId of row.players) {
        if (!byPlayer.has(playerId)) byPlayer.set(playerId, []);
        byPlayer.get(playerId).push({ teamId, at, id: row.id });
      }
    }
  }
  for (const rows of byTeam.values()) rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (const rows of byPlayer.values()) rows.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { byTeam, byPlayer, mapCounts };
}

function lastFiveNames(series, playerById) {
  const counts = new Map();
  const recent = series.slice(-5);
  for (const row of recent) for (const id of row.players) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(playerById.get(a[0])?.name || a[0]).localeCompare(String(playerById.get(b[0])?.name || b[0]), "pt-BR"))
    .slice(0, 8).map(([id, count]) => `${playerById.get(id)?.name || id} (${count}/${recent.length})`).join(", ");
}

function audit(opts) {
  const metadata = readJson("metadata.json");
  const sources = readJson("data-sources.json");
  const db = decode(readJson("database.json"));
  const registered = registeredPlayers(metadata);
  const observers = readObservers(sources, metadata);
  const observed = observedSeries(db);
  const asOfAt = Date.parse(`${opts.asOf}T12:00:00-03:00`);
  const teams = new Map((metadata.teams || []).map((team) => [team.id, team]));
  const memberships = new Map();
  const unresolved = [];
  for (const team of teams.values()) {
    for (const entry of team.lineup || []) {
      const key = norm(entry.name);
      const player = registered.byName.get(key);
      if (!player || registered.ambiguities.has(key)) unresolved.push({ team: team.id, name: entry.name, reason: player ? "nome ambiguo" : "nome sem perfil" });
      const id = player && !registered.ambiguities.has(key) ? player.id : `name:${key}`;
      const rowKey = `${team.id}|${id}`;
      const row = memberships.get(rowKey) || { teamId: team.id, playerId: player?.id || "", name: entry.name, inTeams: false, inPlayers: false, registeredTeam: player?.currentTeam || "" };
      row.inTeams = true;
      row.slot = entry.slot;
      memberships.set(rowKey, row);
    }
  }
  for (const player of metadata.players || []) {
    if (!teams.has(player.currentTeam)) continue;
    const rowKey = `${player.currentTeam}|${player.id}`;
    const row = memberships.get(rowKey) || { teamId: player.currentTeam, playerId: player.id, name: player.name, inTeams: false, inPlayers: false, registeredTeam: player.currentTeam };
    row.inPlayers = true;
    memberships.set(rowKey, row);
  }

  const records = [];
  for (const row of memberships.values()) {
    const team = teams.get(row.teamId);
    const series = observed.byTeam.get(row.teamId) || [];
    const playerSeries = row.playerId ? observed.byPlayer.get(row.playerId) || [] : [];
    const own = playerSeries.filter((item) => item.teamId === row.teamId);
    const lastOwn = own.at(-1)?.at || 0;
    const lastOwnIndex = row.playerId ? series.findLastIndex((item) => item.players.has(row.playerId)) : -1;
    const missed = lastOwnIndex < 0 ? series : series.slice(lastOwnIndex + 1);
    const other = playerSeries.filter((item) => item.teamId !== row.teamId && (!lastOwn || item.at > lastOwn));
    const lastOther = other.at(-1);
    const lastTeam = series.at(-1)?.at || 0;
    const teamRecent = !!lastTeam && asOfAt - lastTeam <= RULES.recentTeamDays * DAY;
    const daysSinceOwn = lastOwn ? Math.max(0, Math.floor((asOfAt - lastOwn) / DAY)) : null;
    const ownMaps = row.playerId ? observed.mapCounts.get(`${row.teamId}|${row.playerId}`) || 0 : 0;
    const observer = observers.get(row.playerId) || { maps: 0, lastAt: 0 };
    const signals = [];
    if (!row.playerId) signals.push("Nome sem perfil único");
    if (row.inTeams && !row.inPlayers) signals.push(row.registeredTeam ? `Elenco x current_team (${row.registeredTeam})` : "Elenco x current_team vazio");
    if (!row.inTeams && row.inPlayers) signals.push("current_team fora do elenco");
    const strongAbsence = row.inTeams && own.length > 0 && teamRecent && missed.length >= RULES.strongAbsenceSeries && distinctDays(missed) >= RULES.minimumDistinctDates && daysSinceOwn >= RULES.strongAbsenceDays;
    const watchAbsence = row.inTeams && own.length > 0 && teamRecent && !strongAbsence && missed.length >= RULES.watchAbsenceSeries && distinctDays(missed) >= RULES.minimumDistinctDates && daysSinceOwn >= RULES.watchAbsenceDays;
    if (strongAbsence) signals.push("Ausência persistente");
    else if (watchAbsence) signals.push("Ausência em observação");
    const noDebut = row.inTeams && own.length === 0;
    if (noDebut) signals.push(playerSeries.length ? "Sem estreia nesta equipe" : "Sem estreia registrada");
    const elsewhere = row.inTeams && other.length >= RULES.otherTeamSeries && distinctDays(other) >= RULES.minimumDistinctDates;
    if (elsewhere) signals.push("Atuou por outra equipe depois");
    const priority = signals.some((item) => item === "Ausência persistente" || (teamRecent && item.startsWith("Elenco x")) || (teamRecent && item === "Atuou por outra equipe depois")) ? "Alta"
      : (noDebut && teamRecent && series.length >= RULES.noDebutTeamSeries) || signals.some((item) => item === "current_team fora do elenco" || item === "Nome sem perfil único") ? "Média"
        : signals.length ? "Baixa" : "Sem sinal";
    records.push({
      teamId: row.teamId, teamName: team?.displayName || row.teamId, player: row.name, playerId: row.playerId,
      inTeams: row.inTeams, inPlayers: row.inPlayers, registeredTeam: row.registeredTeam,
      teamSeries: series.length, teamLast: day(lastTeam), teamRecent, teamLastFive: lastFiveNames(series, registered.byId),
      ownSeries: own.length, ownMaps, ownLast: day(lastOwn), daysSinceOwn,
      missedSeries: missed.length, missedDates: distinctDays(missed),
      lastFivePlayed: series.slice(-5).filter((item) => row.playerId && item.players.has(row.playerId)).length,
      otherSeriesAfter: other.length, otherLast: day(lastOther?.at), otherTeam: lastOther?.teamId || "",
      observerMaps: observer.maps, observerLast: day(observer.lastAt),
      signals, priority,
    });
  }
  const rank = { Alta: 0, Média: 1, Baixa: 2, "Sem sinal": 3 };
  records.sort((a, b) => rank[a.priority] - rank[b.priority] || a.teamName.localeCompare(b.teamName, "pt-BR") || a.player.localeCompare(b.player, "pt-BR"));
  const cases = records.filter((row) => row.signals.length);
  const teamRows = [...teams.values()].map((team) => {
    const series = observed.byTeam.get(team.id) || [];
    const rows = records.filter((row) => row.teamId === team.id);
    return {
      id: team.id, name: team.displayName || team.id, registeredRoster: (team.lineup || []).length,
      currentTeamPlayers: rows.filter((row) => row.inPlayers).length, observedSeries: series.length,
      lastSeries: day(series.at(-1)?.at), recent: !!series.length && asOfAt - series.at(-1).at <= RULES.recentTeamDays * DAY,
      cases: rows.filter((row) => row.signals.length).length, high: rows.filter((row) => row.priority === "Alta").length,
      noDebut: rows.filter((row) => row.signals.some((item) => item.startsWith("Sem estreia"))).length,
    };
  }).sort((a, b) => b.high - a.high || b.cases - a.cases || a.name.localeCompare(b.name, "pt-BR"));
  return {
    asOf: opts.asOf, rules: RULES,
    coverage: { teams: teams.size, players: metadata.players.length, registeredSlots: [...teams.values()].reduce((sum, team) => sum + (team.lineup || []).length, 0), maps: db.matches.length, series: db.matchSeries.length, latestMap: day(Math.max(0, ...(db.matches || []).map((match) => Number(match.startedAt || 0)))), sourceFiles: db.sourceFileCount, duplicateFiles: db.duplicateFiles?.length || 0, failedFiles: db.failedFiles?.length || 0, unresolved },
    summary: { cases: cases.length, high: cases.filter((row) => row.priority === "Alta").length, medium: cases.filter((row) => row.priority === "Média").length, low: cases.filter((row) => row.priority === "Baixa").length, teamsWithCases: teamRows.filter((row) => row.cases).length, teamCount: teamRows.length },
    teams: teamRows, cases, all: records,
  };
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const result = audit(opts);
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify({ asOf: result.asOf, coverage: result.coverage, summary: result.summary }, null, 2));
}

module.exports = { RULES, audit };
