// Gera uma proposta reproduzivel de funcoes do elenco a partir da auditoria.
// Uso: node scripts/plan_roster_roles.js [arquivo-de-saida.json]
const fs = require("node:fs");
const path = require("node:path");
const { decode } = require("../db-codec.js");

const ROOT = path.resolve(__dirname, "..");
const AS_OF = "2026-10-21";
const AUDIT = path.join(ROOT, "outputs", `auditoria-elencos-${AS_OF}`, "audit.json");
const OUTPUT = process.argv[2] || path.join(ROOT, "outputs", `aplicacao-elencos-${AS_OF}.json`);
const DAY = 86400000;
const at = Date.parse(`${AS_OF}T12:00:00-03:00`);
const cutoff = at - 60 * DAY;
const audit = JSON.parse(fs.readFileSync(AUDIT, "utf8"));
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json"), "utf8"));
const db = decode(JSON.parse(fs.readFileSync(path.join(ROOT, "database.json"), "utf8")));
if (audit.asOf !== AS_OF || audit.coverage.unresolved.length) throw new Error("Auditoria desatualizada ou com nomes nao resolvidos");

const recentCount = new Map();
for (const series of db.matchSeries || []) {
  const startedAt = Number(series.startedAt || series.sortAt || 0);
  if (startedAt < cutoff || startedAt > at) continue;
  for (const teamId of [series.teamA?.id, series.teamB?.id].filter(Boolean)) {
    recentCount.set(teamId, (recentCount.get(teamId) || 0) + 1);
  }
}
const evidence = new Map(audit.all.map((row) => [`${row.teamId}|${row.playerId}`, row]));
const teams = [];
for (const team of metadata.teams || []) {
  const eligible = (recentCount.get(team.id) || 0) >= 3;
  const players = (team.lineup || []).map((entry) => {
    const matches = audit.all.filter((row) => row.teamId === team.id && row.player === entry.name);
    if (matches.length !== 1 || !matches[0].playerId) throw new Error(`Nome ambiguo: ${team.id}/${entry.name}`);
    return { slot: entry.slot, ...matches[0] };
  });
  const ranked = [...players].sort((a, b) => b.lastFivePlayed - a.lastFivePlayed || b.ownMaps - a.ownMaps || a.slot - b.slot);
  const topFive = new Set(ranked.slice(0, 5).map((row) => row.playerId));
  const decisions = players.map((row) => {
    let decision = "Ignorar";
    let reason = `Equipe com ${recentCount.get(team.id) || 0} serie(s) nos ultimos 60 dias`;
    if (eligible) {
      const departed = row.ownSeries > 0 && row.missedSeries >= 5 && row.missedDates >= 2 &&
        (row.daysSinceOwn >= 60 || (row.daysSinceOwn >= 30 && row.otherSeriesAfter >= 1));
      if (row.ownSeries === 0) {
        decision = "Remover";
        reason = "Sem estreia registrada pela equipe";
      } else if (departed) {
        decision = "Remover";
        reason = row.daysSinceOwn >= 60 ? "Ausencia de 60+ dias, 5+ series e 2+ datas perdidas" : "Ausencia de 30+ dias, atuacao em outra equipe, 5+ series e 2+ datas perdidas";
      } else if (topFive.has(row.playerId) && row.lastFivePlayed >= 2) {
        decision = "Titular";
        reason = `Entre os cinco mais frequentes; jogou ${row.lastFivePlayed}/5 series recentes`;
      } else {
        decision = "Reserva";
        reason = topFive.has(row.playerId)
          ? `Entre os cinco mais frequentes; jogou ${row.lastFivePlayed}/5 series recentes`
          : row.lastFivePlayed ? `Jogou ${row.lastFivePlayed}/5 series recentes, fora dos cinco mais frequentes` : "Ja jogou pela equipe, sem sinal forte de saida";
      }
    }
    return {
      teamId: team.id, teamName: team.displayName, slot: row.slot, player: row.player, playerId: row.playerId,
      decision, reason, topFive: topFive.has(row.playerId),
      lastFivePlayed: row.lastFivePlayed, ownSeries: row.ownSeries, ownMaps: row.ownMaps,
      ownLast: row.ownLast, daysSinceOwn: row.daysSinceOwn, missedSeries: row.missedSeries,
      missedDates: row.missedDates, otherSeriesAfter: row.otherSeriesAfter, otherTeam: row.otherTeam,
      currentTeam: row.registeredTeam,
    };
  });
  teams.push({ id: team.id, name: team.displayName, recentSeries60: recentCount.get(team.id) || 0, eligible, decisions });
}
const all = teams.flatMap((team) => team.decisions);
const summary = Object.fromEntries(["Titular", "Reserva", "Remover", "Ignorar"].map((key) => [key, all.filter((row) => row.decision === key).length]));
const plan = { asOf: AS_OF, recentDays: 60, minimumRecentSeries: 3, teams, summary };
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(plan, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: OUTPUT, eligibleTeams: teams.filter((team) => team.eligible).length, ...summary }, null, 2));
