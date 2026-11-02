// Sucessao de equipe e atividade por semana no ranking.
//
// Uso: node scripts/test_team_successions.js
//
// Cenario: a "velha" joga 6 mapas e ganha a "copa"; o nucleo dela (3 de 5)
// estreia como "nova" 20 dias depois, com `succeeds: "velha"`. Antes da estreia
// as duas sao equipes separadas; depois, a nova carrega as partidas e o titulo
// da velha no ranking, e a velha fica com uma linha vazia que aponta para ela.
// O controle e o mesmo cenario sem a declaracao.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
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
globalThis.fetch = () => new Promise(noop);

function loadScript(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  (0, eval)(source);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript("app.js");

const { checkTeamSuccessions } = require("./team_successions.js");

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-03-03T12:00:00Z");
const at = (day) => START + day * DAY;

const roster = (prefix) => [1, 2, 3, 4, 5].map((n) => `${prefix}${n}`);
const VELHA = ["v1", "v2", "v3", "v4", "v5"];
const NOVA = ["v1", "v2", "v3", "n4", "n5"];

function mapa(id, day, a, scoreA, b, scoreB, playersA, playersB) {
  return {
    id,
    eventId: "copa",
    seriesKey: id,
    seriesCode: id.replace(/\D/g, ""),
    startedAt: at(day),
    teamA: { id: a, score: scoreA, color: "Red" },
    teamB: { id: b, score: scoreB, color: "Blue" },
    winnerId: scoreA > scoreB ? a : b,
    loserId: scoreA > scoreB ? b : a,
    players: [
      ...playersA.map((playerId) => ({ id: playerId, nick: playerId, teamId: a, rating: 1.1, rounds: 20 })),
      ...playersB.map((playerId) => ({ id: playerId, nick: playerId, teamId: b, rating: 0.9, rounds: 20 })),
    ],
  };
}

function serie(row) {
  return { ...row, sortAt: row.startedAt, scoreA: row.winnerId === row.teamA.id ? 1 : 0, scoreB: row.winnerId === row.teamB.id ? 1 : 0, maps: [row] };
}

const matches = [
  mapa("m1", 1, "velha", 13, "r1", 5, VELHA, roster("a")),
  mapa("m2", 2, "velha", 13, "r2", 7, VELHA, roster("b")),
  mapa("m3", 3, "r1", 13, "r2", 9, roster("a"), roster("b")),
  mapa("m4", 4, "velha", 13, "r1", 8, VELHA, roster("a")),
  mapa("m5", 5, "velha", 11, "r2", 13, VELHA, roster("b")),
  mapa("m6", 6, "velha", 13, "r1", 10, VELHA, roster("a")),
  mapa("m7", 7, "velha", 13, "r2", 3, VELHA, roster("b")),
  mapa("m8", 27, "nova", 13, "r1", 6, NOVA, roster("a")),
  mapa("m9", 28, "nova", 9, "r2", 13, NOVA, roster("b")),
  mapa("m10", 29, "r1", 13, "r2", 11, roster("a"), roster("b")),
  mapa("m11", 30, "nova", 13, "r2", 8, NOVA, roster("b")),
];
const lineup = (ids) => ids.map((playerId, index) => ({ slot: index + 1, name: playerId, playerId }));
const teamsWith = (succeeds) => [
  // A velha perdeu o elenco: a planilha so tem 2 dos jogadores dela hoje.
  { id: "velha", name: "Velha", org: "Faculdade", currentLineup: lineup(["v4", "v5"]) },
  { id: "nova", name: "Nova", org: "Faculdade", currentLineup: lineup(NOVA), ...(succeeds ? { succeeds } : {}) },
  { id: "r1", name: "Rival 1", org: "Outra", currentLineup: lineup(roster("a")) },
  { id: "r2", name: "Rival 2", org: "Outra", currentLineup: lineup(roster("b")) },
];
const tournaments = [
  {
    id: "copa",
    name: "Copa",
    teams: ["velha", "r1", "r2"],
    placements: [{ range: "1", id: "velha" }, { range: "2", id: "r1" }, { range: "3", id: "r2" }],
    end: at(8),
  },
];
const weights = { tournaments: { copa: { teams: 3, endAt: new Date(at(8)).toISOString(), placementPoints: { 1: 30, 2: 20, 3: 10 } } } };
const rank = (teams, cutoffAt) =>
  calculateRankingForCutoff({ teams, matches, matchSeries: matches.map(serie), players: [], tournaments, rankingWeights: weights, cutoffAt });

// Antes da estreia da nova: nada muda.
const antes = rank(teamsWith("velha"), at(20));
assert.equal(antes.byTeamId.velha.matches, 6, "before the debut the old team keeps its own maps");
assert.equal(antes.byTeamId.velha.succeededBy, undefined, "before the debut nothing is succeeded");
assert.equal(antes.byTeamId.nova.matches, 0, "the new team has not played yet");

// Depois da estreia: a nova carrega as partidas e o titulo da velha.
const depois = rank(teamsWith("velha"), at(35));
assert.equal(depois.byTeamId.nova.matches, 9, "the successor carries the predecessor maps (6) plus its own (3)");
assert.deepEqual(depois.byTeamId.nova.inherits, ["velha"], "the successor row names what it inherited");
assert(depois.byTeamId.nova.achievements.some((row) => row.eventId === "copa" && row.placement === 1), "the predecessor title counts for the successor");
const velha = depois.byTeamId.velha;
assert.equal(velha.succeededBy, "nova", "the predecessor row points to the successor");
assert.equal(velha.succeededAt, at(27), "the inheritance starts at the successor debut");
assert.equal(velha.matches, 0, "the predecessor row is empty, so the ranking list hides it");
assert(velha.inactive && !rankingIsValid(velha) && !rankingRowExistsInSnapshot(velha), "the predecessor is out of the ranking list");
assert(!depois.teams.some((row) => row.id === "velha" && row.matches > 0), "no ranked row for the predecessor");
assert.equal(matches[0].teamA.id, "velha", "the matches themselves are not renamed");
assert.equal(tournaments[0].placements[0].id, "velha", "the event placements are not renamed");
assert.equal(weights.tournaments.copa.placements, undefined, "the weights are not touched");

// Controle: sem a declaracao, cada uma fica com o que jogou.
const semDeclarar = rank(teamsWith(undefined), at(35));
assert.equal(semDeclarar.byTeamId.nova.matches, 3, "control: without `succeeds` the new team starts from zero");
assert.equal(semDeclarar.byTeamId.velha.matches, 6, "control: without `succeeds` the old team keeps its maps");
assert(!semDeclarar.byTeamId.nova.achievements.some((row) => row.eventId === "copa"), "control: the title stays with the old team");

// Cadeia: velha -> nova -> novissima manda tudo para a ultima.
const cadeia = [...teamsWith("velha"), { id: "novissima", name: "Novissima", org: "Faculdade", currentLineup: lineup(NOVA), succeeds: "nova" }];
const comNovissima = [...matches, mapa("m12", 40, "novissima", 13, "r1", 2, NOVA, roster("a"))];
const fimDaCadeia = calculateRankingForCutoff({ teams: cadeia, matches: comNovissima, matchSeries: comNovissima.map(serie), players: [], tournaments, rankingWeights: weights, cutoffAt: at(45) });
assert.equal(fimDaCadeia.byTeamId.novissima.matches, 10, "a chain sends every map to its last team");
assert.deepEqual(fimDaCadeia.byTeamId.novissima.inherits.sort(), ["nova", "velha"], "the last team inherits the whole chain");
assert.equal(fimDaCadeia.byTeamId.velha.succeededBy, "nova", "each predecessor points to its direct successor");

// Atividade: nas semanas passadas vale a formacao que jogou; na atual, o elenco
// cadastrado. A velha (2 cadastrados hoje) jogou completa ate o dia 7.
const passada = rank(teamsWith(undefined), at(20));
assert.equal(passada.byTeamId.velha.rosterSize, 5, "a past week uses the lineup that played");
assert.equal(passada.byTeamId.velha.inactive, false, "the old team was complete in a past week");
const atual = rank(teamsWith(undefined), rankingTuesdayStartOnOrBefore(Date.now()));
assert.equal(atual.byTeamId.velha.rosterSize, 2, "the current week uses the registered roster");
assert.equal(atual.byTeamId.velha.inactive, true, "the old team is inactive today");

// Detector: acha o par sem a declaracao e fica quieto com ela.
const detectado = checkTeamSuccessions(matches, teamsWith(undefined));
assert.deepEqual(detectado.undeclared.map((row) => `${row.from}>${row.to}`), ["velha>nova"], "the detector finds the undeclared succession");
assert.deepEqual(detectado.undeclared[0].players.sort(), ["v1", "v2", "v3"], "the detector names the shared core");
assert.equal(checkTeamSuccessions(matches, teamsWith("velha")).undeclared.length, 0, "a declared succession is not reported");
const outraFaculdade = teamsWith(undefined).map((team) => (team.id === "nova" ? { ...team, org: "Longe" } : team));
assert.equal(checkTeamSuccessions(matches, outraFaculdade).undeclared.length, 0, "teams from different universities are not paired");
// Declaracao que as partidas desmentem: a r1 joga ate o fim, entao nao foi sucedida.
const errada = teamsWith(undefined).map((team) => (team.id === "nova" ? { ...team, succeeds: "r1" } : team));
assert.deepEqual(checkTeamSuccessions(matches, errada).contradicted.map((row) => `${row.from}>${row.to}`), ["r1>nova"], "a predecessor that keeps playing is reported");

// Herança parcial: mapas acompanham a formação, conquistas não.
const partialTeams = teamsWith(undefined).map((team) => team.id === "nova" ? {
  ...team, profile: { performancePredecessors: [{ id: "velha", since: new Date(at(30)).toISOString() }] },
} : team);
const beforePartial = rank(partialTeams, at(29));
assert.equal(beforePartial.byTeamId.velha.matches, 6, "a regra não antecipa a fusão para a estreia antiga do destino");
assert.equal(beforePartial.byTeamId.nova.matches, 2);
const afterPartial = rank(partialTeams, at(35));
assert.equal(afterPartial.byTeamId.nova.matches, 9);
assert.equal(afterPartial.byTeamId.velha.succeededAt, at(30), "herança começa no primeiro mapa do destino após o marco confirmado");
assert(afterPartial.byTeamId.velha.performanceOnly);
assert(!checkTeamSuccessions(matches, partialTeams).undeclared.some((row) => row.from === "velha"), "a decisão parcial não gera sugestão de sucessão integral concorrente");
assert.deepEqual(afterPartial.byTeamId.nova.performanceInherits, ["velha"]);
assert(!afterPartial.byTeamId.nova.achievements.some((a) => a.eventId === "copa"), "a conquista da antiga não acompanha a herança parcial");
assert.equal(tournaments[0].placements[0].id, "velha");

// Uma fusão pode ter duas origens, mas não duas destinações para a mesma origem.
const mergeTeams = [...teamsWith(undefined), { id: "outra", name: "Outra" }].map((t) => t.id === "nova" ? {
  ...t, profile: { performancePredecessors: ["velha", "outra"].map((id) => ({ id, since: new Date(at(27)).toISOString() })) },
} : t);
const mergeAliases = rankingPerformanceAliases(mergeTeams, matches, at(35));
assert.equal(mergeAliases.get("velha").to, "nova");
assert.equal(mergeAliases.get("outra").to, "nova");
const oldDerby = mapa("derby", 5, "velha", 13, "outra", 9, VELHA, roster("o"));
const mergerInput = { teams: mergeTeams, matches: [oldDerby], matchSeries: [serie(oldDerby)], tournaments, rankingWeights: weights };
const mergerOutput = applyRankingSuccessions(mergerInput, mergeAliases);
assert.equal(mergerOutput.matches.length, 0, "um confronto entre as origens não vira jogo da sucessora contra ela mesma");
assert.equal(oldDerby.teamA.id, "velha", "o arquivo/campanha original não é alterado");
const loop = [
  { id: "velha", profile: { performancePredecessors: [{ id: "nova", since: new Date(at(1)).toISOString() }] } },
  { id: "nova", profile: { performancePredecessors: [{ id: "velha", since: new Date(at(1)).toISOString() }] } },
];
assert.throws(() => rankingPerformanceAliases(loop, matches, at(35)), /Ciclo/);
const conflict = [...mergeTeams, { id: "r1", profile: { performancePredecessors: [{ id: "velha", since: new Date(at(1)).toISOString() }] } }];
assert.throws(() => rankingPerformanceAliases(conflict, matches, at(35)), /duplicada/);
const noContinuity = mergeTeams.map((t) => t.id === "velha" ? { ...t, profile: { continuity: "none" } } : t);
assert.throws(() => rankingPerformanceAliases(noContinuity, matches, at(35)), /sem continuidade/);
const dissolved = { currentLineup: lineup(VELHA), profile: { competitiveStatus: "dissolved" } };
assert.equal(teamActiveRoster(dissolved).length, 0, "uma dissolvida não se torna ativa por elenco residual");
assert.equal(teamActiveRoster({ currentLineup: lineup(VELHA) }).length, 5);
// Fusões integrais levam a melhor colocação uma vez, sem duplicar campanhas.
const fullMerge = mergeTeams.map((t) => t.id === "nova" ? { ...t, profile: {
  historyPredecessors: ["velha", "outra"].map((id) => ({ id, since: new Date(at(27)).toISOString(), relation: "merger" })),
} } : t);
const fullMergeAliases = rankingSuccessionAliases(fullMerge, matches, at(35));
assert.equal(fullMergeAliases.get("velha").to, "nova");
assert.equal(fullMergeAliases.get("outra").to, "nova");
const mergedCampaigns = applyRankingSuccessions({ teams: fullMerge, matches, matchSeries: matches.map(serie), tournaments: [{ id: "copa", placements: [{ id: "velha", range: "1" }, { id: "outra", range: "2" }, { id: "nova", range: "5-6" }] }], rankingWeights: {} }, fullMergeAliases);
assert.deepEqual(mergedCampaigns.tournaments[0].placements, [{ id: "nova", range: "1" }]);
const datedLegacy = teamsWith("velha").map((t) => t.id === "nova" ? { ...t, profile: { successionSince: new Date(at(30)).toISOString() } } : t);
assert.equal(rankingSuccessionAliases(datedLegacy, matches, at(29)).size, 0, "uma estreia antiga não antecipa a sucessão datada");
assert.equal(rankingSuccessionAliases(datedLegacy, matches, at(35)).get("velha").since, at(30));
assert(rank(fullMerge, at(35)).byTeamId.nova.achievements.some((a) => a.eventId === "copa"), "fusão integral inclui conquistas");

// As duas equipes da fusão no mesmo campeonato: a tabela era completa antes da
// fusão, então as demais equipes não perdem a conquista. Foi o que zerou C2, C4
// e CPUE na prévia: a lista ficava com N-1 equipes e o evento inteiro saía.
const copaComAsDuas = [{
  id: "copa",
  name: "Copa",
  teams: ["velha", "nova", "r1", "r2"],
  placements: [{ range: "1", id: "velha" }, { range: "2", id: "nova" }, { range: "3", id: "r1" }, { range: "4", id: "r2" }],
  end: at(8),
}];
const pesosComAsDuas = { tournaments: { copa: { teams: 4, endAt: new Date(at(8)).toISOString(), placementPoints: { 1: 30, 2: 20, 3: 10, 4: 5 } } } };
const fundidas = calculateRankingForCutoff({ teams: teamsWith("velha"), matches, matchSeries: matches.map(serie), players: [], tournaments: copaComAsDuas, rankingWeights: pesosComAsDuas, cutoffAt: at(35) });
const campanhaNaCopa = (id) => fundidas.byTeamId[id].achievements.filter((row) => row.eventId === "copa");
assert.equal(campanhaNaCopa("r1").length, 1, "a fusão de duas equipes não apaga a conquista das outras");
assert.equal(campanhaNaCopa("r1")[0].placementLabel, "3", "a colocação das outras não muda");
assert.equal(campanhaNaCopa("r2")[0].basePoints, 5, "a tabela do campeonato continua valendo");
assert.equal(campanhaNaCopa("nova").length, 1, "a fusão recebe o campeonato uma vez só");
assert.equal(campanhaNaCopa("nova")[0].placement, 1, "a fusão fica com a melhor colocação");
// Controle: tabela incompleta antes da fusão continua sem conquista.
const copaIncompleta = [{ ...copaComAsDuas[0], placements: copaComAsDuas[0].placements.slice(0, 3) }];
const incompleta = calculateRankingForCutoff({ teams: teamsWith("velha"), matches, matchSeries: matches.map(serie), players: [], tournaments: copaIncompleta, rankingWeights: pesosComAsDuas, cutoffAt: at(35) });
assert.equal(incompleta.byTeamId.r1.achievements.filter((row) => row.eventId === "copa").length, 0, "controle: evento sem tabela completa segue sem conquista");
console.log("team succession tests passed");
