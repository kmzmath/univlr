// Calendario de inatividade e elencos, incluindo recuperacao de snapshots antigos.
// Uso: node scripts/test_ranking_activity.js
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const noop = () => {};
const element = { innerHTML: "", addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: {}, dataset: {}, setAttribute: noop, appendChild: noop, focus: noop };
globalThis.window = globalThis;
globalThis.document = { title: "", getElementById: () => element, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ ...element }), addEventListener: noop, removeEventListener: noop, body: element, documentElement: element };
globalThis.location = { hash: "" };
globalThis.history = { pushState: noop, replaceState: noop };
globalThis.requestAnimationFrame = () => 0;
globalThis.fetch = () => new Promise(noop);
for (const file of ["raating-core.js", "ranking-core.js", "app.js"]) (0, eval)(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"));

const DAY = 86400000;
const date = (s) => Date.parse(`${s}T03:00:00Z`); // Meia-noite de Brasilia.
const roster = (n) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i}`, role: i === 4 ? "reserva" : "titular" }));
const activeScene = (start, end) => Array.from({ length: Math.floor((end - start) / DAY) + 1 }, (_, i) => start + i * DAY);
const counted = (start, end) => {
  const data = new Map([["scene", activeScene(start, end)]]);
  return rankingDiasSemJogar(start, end, rankingParadasDeInatividade(data, end));
};

assert.deepEqual(rankingUnirParadas([[10, 20], [5, 12], [20, 25], [2, 2], [NaN, 8], [30, 29]]), [[5, 25]]);
assert.equal(rankingDiasSemJogar(0, 30 * DAY, [[0, 20 * DAY], [10 * DAY, 25 * DAY]]), 5, "sobreposicoes descontadas uma vez");
assert.equal(rankingDiasSemJogar(20, 10, []), 0, "contador nunca negativo");
assert.equal(counted(date("2023-11-30"), date("2024-05-02")), 2, "inclui fevereiro bissexto no recesso");
assert.equal(counted(date("2024-12-01"), date("2025-05-01")), 0);
assert.equal(counted(date("2025-04-30"), date("2025-05-02")), 1);
assert.equal(counted(date("2025-11-30"), date("2025-12-02")), 1);
const midnight = date("2025-12-01");
const midnightData = new Map([["scene", [midnight - DAY, midnight + DAY]]]);
const midnightPauses = rankingParadasDeInatividade(midnightData, midnight + DAY);
assert.equal(rankingDiasSemJogar(midnight - 1, midnight + 1, midnightPauses), 1 / DAY, "fronteira do recesso usa Brasilia");

const start = date("2025-05-01");
const scenePaused = new Map([["a", [start]]]);
assert.deepEqual(rankingParadasDoCenario(scenePaused, start + 29 * DAY), []);
assert.deepEqual(rankingParadasDoCenario(scenePaused, start + 30 * DAY), [[start, start + 30 * DAY]], "parada aberta ja conhecida entra sem partida futura");
const laterKnown = new Map([["a", [start, start + 100 * DAY]]]);
assert.deepEqual(rankingParadasDeInatividade(scenePaused, start + 45 * DAY), rankingParadasDeInatividade(laterKnown, start + 45 * DAY), "partida futura nao vaza para o passado");
const winterGap = new Map([["a", [date("2024-11-03"), date("2025-05-06")]]]);
assert.equal(rankingDiasSemJogar(date("2024-10-20"), date("2025-05-07"), rankingParadasDeInatividade(winterGap, date("2025-05-07"))), 15, "parada geral e recesso unidos");

function activity({ elapsed, size = 5, team, last = start, weights = {}, rows } = {}) {
  const cutoff = last + elapsed * DAY;
  const datas = new Map([["a", [last]], ["scene", activeScene(last, cutoff)]]);
  const ranking = { teams: rows || [{ id: "a", matches: 12, overallRank: 1, validRank: null, inactive: true, rosterSize: size, score: 73 }], byTeamId: {} };
  ranking.byTeamId = Object.fromEntries(ranking.teams.map((r) => [r.id, { ...r }]));
  return rankingAplicaInatividade(ranking, datas, cutoff, 150, null, { teams: team ? [team] : [], weights, currentWeek: Boolean(team) });
}
assert.equal(activity({ elapsed: 60, size: 4 }).byTeamId.a.inactive, false, "60 exatos ainda permitidos");
assert.equal(activity({ elapsed: 60 + 1 / DAY, size: 4 }).byTeamId.a.inactiveReason, "incomplete-roster");
assert.equal(activity({ elapsed: 61, size: 5 }).byTeamId.a.inactive, false);
assert.equal(activity({ elapsed: 150 }).byTeamId.a.inactive, false, "150 exatos ainda permitidos");
assert.equal(activity({ elapsed: 150 + 1 / DAY }).byTeamId.a.inactiveReason, "inactivity");
assert.equal(activity({ elapsed: 61, size: null }).byTeamId.a.inactive, false, "elenco desconhecido nao e incompleto");
assert.equal(activity({ elapsed: 151, size: null }).byTeamId.a.inactiveReason, "inactivity");
assert.equal(activity({ elapsed: 61, size: 4, weights: { incompleteRosterInactivityDays: 90 } }).byTeamId.a.inactive, false, "prazo configuravel");

const emptyKnown = { id: "a", rosterKnown: true, currentLineup: [] };
const grace = activity({ elapsed: 60, team: emptyKnown });
assert.equal(grace.byTeamId.a.rosterSize, 0);
assert.equal(grace.byTeamId.a.validRank, 1);
assert.equal(rankingRowExistsInSnapshot(grace.byTeamId.a), true, "elenco vazio permanece visivel durante o prazo");
assert.equal(activity({ elapsed: 61, team: emptyKnown }).byTeamId.a.inactiveReason, "incomplete-roster");
assert.equal(activity({ elapsed: 61, team: { id: "a", currentLineup: [] } }).byTeamId.a.rosterSize, null);
const reserves = { id: "a", currentLineup: [...roster(5), { name: "Tecnico", role: "comissao" }] };
assert.equal(activity({ elapsed: 61, team: reserves }).byTeamId.a.rosterSize, 5, "reserva conta, comissao nao conta");
assert.equal(activity({ elapsed: 61, team: reserves }).byTeamId.a.inactive, false);

// O recesso suspende o contador, sem zerar o tempo acumulado antes dele.
assert.equal(activity({ elapsed: 245, last: date("2024-06-01") }).byTeamId.a.inactive, true);
assert.equal(activity({ elapsed: 245, last: date("2024-06-01") }).byTeamId.a.inactiveReason, "inactivity");
const returnCutoff = date("2025-05-03");
const returned = { teams: [{ id: "a", matches: 12, overallRank: 1, rosterSize: 5 }] };
const returnData = new Map([["a", [date("2024-06-01"), date("2025-01-05")]], ["scene", activeScene(date("2024-06-01"), returnCutoff)]]);
rankingAplicaInatividade(returned, returnData, returnCutoff, 150);
assert.equal(returned.teams[0].inactive, false, "jogo no recesso reinicia o prazo normalmente");

const rows = [
  { id: "a", matches: 12, overallRank: 1, rosterSize: 5, inactive: true, score: 73, blocks: { competitive: 85 } },
  { id: "b", matches: 12, overallRank: 2, rosterSize: 5, inactive: false, validRank: 1 },
  { id: "p", matches: 3, overallRank: 3, rosterSize: 5, provisional: true },
  { id: "old", matches: 0, overallRank: null, succeededBy: "a", inactive: true },
];
const repaired = activity({ elapsed: 15, rows });
assert.equal(repaired.byTeamId.a.validRank, 1, "recupera snapshot com inatividade antiga");
assert.equal(repaired.byTeamId.b.validRank, 2, "renumera tambem objetos separados em byTeamId");
assert.equal(repaired.byTeamId.p.validRank, null);
assert.equal(repaired.byTeamId.old.inactiveReason, "succession");
assert.equal(repaired.byTeamId.old.validRank, null);
assert.equal(repaired.byTeamId.a.score, 73);
assert.deepEqual(repaired.byTeamId.a.blocks, { competitive: 85 }, "elegibilidade nao altera a nota");
const once = JSON.stringify(repaired);
rankingAplicaInatividade(repaired, new Map([["a", [start]], ["scene", activeScene(start, start + 15 * DAY)]]), start + 15 * DAY, 150);
assert.equal(JSON.stringify(repaired), once, "aplicar novamente e idempotente");
const dissolved = { id: "a", currentLineup: roster(5), profile: { competitiveStatus: "dissolved" } };
assert.equal(activity({ elapsed: 1, team: dissolved }).byTeamId.a.inactiveReason, "dissolved");
const historical = { teams: [{ id: "a", matches: 12, overallRank: 1, rosterSize: 5 }] };
rankingAplicaInatividade(historical, new Map([["a", [start]]]), start + DAY, 150, [], { teams: [dissolved], currentWeek: false });
assert.equal(historical.teams[0].inactive, false, "dissolucao atual nao e projetada para semanas antigas");
assert.equal(historical.teams[0].rosterSize, 5);

// A mesma politica vale se o motor de notas estiver indisponivel.
const core = window.RankingCore;
window.RankingCore = undefined;
const now = Date.now();
const fallbackTeam = { id: "a", matches: 12, points: 50, winRate: 50, roundDiff: 0, currentLineup: roster(4) };
const fallback = applyTeamRankings([fallbackTeam], [{ startedAt: now - DAY, teamA: { id: "a" }, teamB: { id: "b" } }], [], [], [], {});
window.RankingCore = core;
assert.equal(fallback.byTeamId.a.inactive, false, "fallback respeita prazo para elenco incompleto");
assert.equal(fallbackTeam.validRank, 1);
console.log("ranking activity tests passed");
