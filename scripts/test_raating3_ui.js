const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function includes(fragment, message) {
  assert(app.includes(fragment), message);
}

function excludes(fragment, message) {
  assert(!app.includes(fragment), message);
}

includes('label: "rAAting 3.0"', "scoreboard exposes rAAting 3.0");
includes('label: "Swing/R"', "scoreboard exposes Swing/R");
includes('label: "FK-FD"', "scoreboard exposes FK-FD");
includes('label: "MKs"', "scoreboard exposes multi-kill rounds");
excludes('label: "Imp/R"', "public scoreboard labels do not use Imp/R");
excludes('label: "FD +/-"', "public scoreboard labels do not use FD +/-");

includes('const primary = metricValue(player, "raating_3")', "official rating prefers raating_3");
includes('player.rating_version !== "raa3"', "legacy rating is not silently labeled as rAAting 3.0");
includes('return Number.isFinite(rating) ? fmt(rating) : "-"', "rAAting 3.0 is formatted with two decimals");

includes('players.filter(isOfficialRatingSample)', "official player rankings filter sample_status = OK");
includes('Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0)', "official rankings sort by rAAting 3.0 descending");
includes('Number(b.rounds || 0) - Number(a.rounds || 0)', "official player ranking tie-breaks by rounds");

// Cobrava `signedDecimal(swing)`, que so existia dentro de
// teamCompetitiveSummary() - funcao nunca chamada, removida em 26/08/2026. A
// assertiva passava pelo motivo errado. formatMaybeSwing() e o caminho vivo:
// devolve `${signedDecimal(value)} pp` e aparece em 5 lugares renderizados,
// ao lado do proprio signed(fkFdDiff) da linha seguinte.
includes('formatMaybeSwing(player)', "Swing/R is rendered with positive sign support");
includes('signed(fkFdDiff)', "FK-FD is rendered with positive sign support");

includes('function playerRatingCompositionPanel', "player page exposes rAAting 3.0 composition");
includes('formatMaybeMetric(player, "kill_rating")', "player composition handles missing subratings safely");

console.log("rAAting 3.0 UI contract tests passed");
