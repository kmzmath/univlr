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

includes('label: "rAAting 3.1"', "scoreboard exposes rAAting 3.1");
includes('label: "Swing/R"', "scoreboard exposes Swing/R");
includes('label: "FK-FD"', "scoreboard exposes FK-FD");
includes('label: "MKs"', "scoreboard exposes multi-kill rounds");
excludes('label: "Imp/R"', "public scoreboard labels do not use Imp/R");
excludes('label: "FD +/-"', "public scoreboard labels do not use FD +/-");

includes('const primary = metricValue(player, "raating_3")', "official rating prefers raating_3");
includes('player.rating_version !== "raa3.1"', "a rating of another version is not labeled as rAAting 3.1");
includes('return Number.isFinite(rating) ? fmt(rating) : "-"', "rAAting 3.1 is formatted with two decimals");

// `players.filter(isOfficialRatingSample)` so existia em playerRankingRows(),
// que nenhuma tela chamava (a pagina de Jogadores nao ordena por rAAting, por
// decisao do dono): a assertiva protegia codigo morto. Saiu com a funcao em
// 23/11/2026, junto com isOfficialRatingSample e sampleStatusChip.
includes('Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0)', "official rankings sort by rAAting 3.1 descending");
includes('Number(b.rounds || 0) - Number(a.rounds || 0)', "official player ranking tie-breaks by rounds");

// Cobrava `signedDecimal(swing)`, que so existia dentro de
// teamCompetitiveSummary() - funcao nunca chamada, removida em 26/08/2026. A
// assertiva passava pelo motivo errado. formatMaybeSwing() e o caminho vivo:
// devolve `${signedDecimal(value)} pp` e aparece em 5 lugares renderizados,
// ao lado do proprio signed(fkFdDiff) da linha seguinte.
includes('formatMaybeSwing(player)', "Swing/R is rendered with positive sign support");
// `signed(fkFdDiff)` so existia em playerTable(), nunca chamada e removida em
// 23/11/2026. As tabelas vivas (campeonato, perfil e estatisticas) escrevem o
// sinal com signed(fkFd(player)).
includes('signed(fkFd(player))', "FK-FD is rendered with positive sign support");

// A composicao saiu do painel proprio (playerRatingCompositionPanel, removido
// em 24/10/2026) e hoje e um bloco da aba Estatisticas (playerComposicao), que
// so aparece quando ha algum valor.
includes('<h3>Composição da rAAting 3.1</h3>', "player page exposes rAAting 3.1 composition");
includes('formatRatingPart(metricValue(player, key))', "the tooltip handles missing parts safely");

console.log("rAAting 3.1 UI contract tests passed");
