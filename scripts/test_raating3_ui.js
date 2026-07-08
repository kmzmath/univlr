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

includes('signedDecimal(swing)', "Swing/R is rendered with positive sign support");
includes('signed(fkFdDiff)', "FK-FD is rendered with positive sign support");

includes('function playerRatingCompositionPanel', "player page exposes rAAting 3.0 composition");
includes('formatMaybeMetric(player, "kill_rating")', "player composition handles missing subratings safely");
includes('function matchAdvancedStatsTable', "match page exposes advanced rAAting 3.0 audit table");

console.log("rAAting 3.0 UI contract tests passed");
