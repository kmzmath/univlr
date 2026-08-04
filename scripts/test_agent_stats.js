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

function close(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: esperado ${expected}, recebido ${actual}`);
}

function makePlayer(id, teamId, teamColor, agentSlug, rounds = 20) {
  return {
    id,
    teamId,
    teamColor,
    agentSlug,
    agent: agentSlug,
    agentClass: "Classe",
    rounds,
    score: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    impactTotal: 0,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
  };
}

function makeMatch(id, winnerId, agentsA, agentsB, options = {}) {
  const teamA = { id: "alpha", name: "Alpha", color: "Red" };
  const teamB = { id: "bravo", name: "Bravo", color: "Blue" };
  const rounds = options.rounds || 20;
  return {
    id,
    eventId: "fixture",
    mapId: options.mapId || "ascent",
    mapName: options.mapName || "Ascent",
    rounds,
    roundResults: [],
    teamA,
    teamB,
    winnerId,
    players: [
      ...agentsA.map((agent, index) => makePlayer(options.playerIdsA?.[index] || `${id}-a-${index}`, teamA.id, teamA.color, agent, rounds)),
      ...agentsB.map((agent, index) => makePlayer(options.playerIdsB?.[index] || `${id}-b-${index}`, teamB.id, teamB.color, agent, rounds)),
    ],
  };
}

const mirrored = makeMatch(
  "mirror",
  "alpha",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["omen", "raze", "fade", "cypher", "brimstone"],
);
const mirroredOmen = tournamentAgentRows([mirrored]).find((row) => row.slug === "omen");
assert.strictEqual(mirroredOmen.picks, 2, "mirror mantém as duas escolhas no volume");
close(mirroredOmen.pickRate, 100, "duas escolhas em um mapa equivalem a 100% de pick");
assert.strictEqual(mirroredOmen.nonMirroredPicks, 0, "mirror não entra na amostra de vitória");
assert.strictEqual(tournamentAgentNonMirroredWinRate(mirroredOmen), "-", "amostra NM vazia não aparece como 0%");

const nonMirrorWin = makeMatch(
  "nm-win",
  "alpha",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher", "brimstone"],
);
const nonMirrorLoss = makeMatch(
  "nm-loss",
  "alpha",
  ["astra", "jett", "sova", "viper", "killjoy"],
  ["omen", "raze", "fade", "cypher", "brimstone"],
);
const combinedOmen = tournamentAgentRows([mirrored, nonMirrorWin, nonMirrorLoss]).find((row) => row.slug === "omen");
assert.strictEqual(combinedOmen.picks, 4);
close(combinedOmen.pickRate, (4 / 6) * 100, "pick usa duas oportunidades por mapa");
assert.strictEqual(combinedOmen.nonMirroredPicks, 2);
assert.strictEqual(combinedOmen.nonMirroredWins, 1);
assert.strictEqual(combinedOmen.nonMirroredLosses, 1);
close(combinedOmen.winRateNM, 50, "win rate ignora por completo o mapa espelhado");

const mapRows = tournamentMapAnalyticsRows({ mapPool: ["Ascent"] }, [mirrored, nonMirrorWin, nonMirrorLoss]);
const mapOmen = mapRows[0].agentRates.get("omen");
close(mapOmen.rate, (4 / 6) * 100, "heatmap por mapa usa mapas vezes dois");
const totalMapRow = tournamentMapTotalAgentRow(mapRows, tournamentMapAgentColumns(mapRows));
close(totalMapRow.agentRates.get("omen").rate, (4 / 6) * 100, "linha total usa mapas vezes dois");

const incomplete = makeMatch(
  "incomplete",
  "alpha",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher"],
);
const incompleteOmen = tournamentAgentRows([incomplete]).find((row) => row.slug === "omen");
close(incompleteOmen.pickRate, 50, "mapa incompleto continua oferecendo dois slots no pick rate");
assert.strictEqual(incompleteOmen.unknownMirrorPicks, 1, "ausência em lineup incompleta não prova que o pick não foi espelhado");
assert.strictEqual(incompleteOmen.nonMirroredPicks, 0, "mapa incompleto não contamina a amostra NM");
assert.strictEqual(tournamentAgentNonMirroredWinRate(incompleteOmen), "-");
const incompleteAstra = tournamentAgentRows([incomplete]).find((row) => row.slug === "astra");
assert.strictEqual(incompleteAstra.nonMirroredPicks, 1, "lineup adversária completa ainda permite provar que o pick não foi espelhado");
assert.strictEqual(incompleteAstra.nonMirroredLosses, 1);

const personalOmenMap = makeMatch(
  "personal-omen",
  "alpha",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher", "brimstone"],
  { playerIdsA: ["hero"] },
);
const personalJettMap = makeMatch(
  "personal-jett",
  "alpha",
  ["jett", "omen", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher", "brimstone"],
  { playerIdsA: ["hero"] },
);
const personalRows = playerAgentRows("hero", [{ maps: [personalOmenMap, personalJettMap] }]);
close(personalRows.find((row) => row.slug === "omen").pickRate, 50, "perfil pessoal mantém uma oportunidade por mapa");
close(personalRows.find((row) => row.slug === "jett").pickRate, 50, "distribuição pessoal soma 100%");

const shortMap = makeMatch(
  "short",
  "alpha",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher", "brimstone"],
  { rounds: 13 },
);
const longMap = makeMatch(
  "long",
  "bravo",
  ["omen", "jett", "sova", "viper", "killjoy"],
  ["astra", "raze", "fade", "cypher", "brimstone"],
  { rounds: 28 },
);
const generalMapOmen = aggregateMaps([shortMap, longMap], [])[0].agentStats.find((row) => row.slug === "omen");
assert.strictEqual(generalMapOmen.picks, 2);
close(generalMapOmen.rate, 50, "agregado geral conta picks, sem ponderar pela duração dos mapas");

const codec = require(path.join(ROOT, "db-codec.js"));
const database = codec.decode(JSON.parse(fs.readFileSync(path.join(ROOT, "database.json"), "utf8")));
const classificatoria2 = database.matches.filter((match) => match.eventId === "univava-classificatoria-2");
const omen = tournamentAgentRows(classificatoria2).find((row) => row.slug === "omen");
assert.strictEqual(classificatoria2.length, 39, "fixture real mantém 39 mapas");
assert.strictEqual(omen.picks, 71, "fixture real mantém 71 picks de Omen");
close(omen.pickRate, (71 / 78) * 100, "Omen tem 91,03% de pick na Classificatória 2");
assert.strictEqual(omen.mirroredPicks, 64, "32 mirrors equivalem a 64 escolhas espelhadas");
assert.strictEqual(omen.nonMirroredWins, 4);
assert.strictEqual(omen.nonMirroredLosses, 3);
close(omen.winRateNM, (4 / 7) * 100, "Omen tem 57,14% de Win% NM");

console.log("Agent pick rate and non-mirrored win rate tests passed");
