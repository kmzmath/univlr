// Abate e so o de inimigo (decisao do dono, 23/11/2026).
//
// Uso: node scripts/test_abate_de_inimigo.js
//
// Uma rodada com as tres mortes possiveis: c morre pela propria acao (spike),
// a mata b (inimigo) e d mata e (aliado). So a recebe credito de abate: no
// KAST, no multi-kill, nos pontos de abate e no first kill. As tres vitimas
// seguem mortas.

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("./carrega_app.js");

const metadata = prepareMetadata(JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "metadata.json"), "utf8")));
const jogadores = [
  { puuid: "a", teamId: "Blue" }, { puuid: "c", teamId: "Blue" },
  { puuid: "b", teamId: "Red" }, { puuid: "d", teamId: "Red" }, { puuid: "e", teamId: "Red" },
];
const abate = (time, killer, victim) => ({ timeSinceRoundStartMillis: time, killer, victim, assistants: [] });
const linha = (puuid, kills = []) => ({ puuid, kills, damage: [], economy: {} });
const rodada = {
  winningTeam: "Blue",
  winningTeamRole: "Attacker",
  roundResult: "Eliminated",
  playerStats: [
    linha("c", [abate(1000, "c", "c")]),
    linha("a", [abate(2000, "a", "b")]),
    linha("d", [abate(3000, "d", "e")]),
    linha("b"),
    linha("e"),
  ],
};

const stats = aggregateMatchPlayerRoundStats(jogadores, [rodada], metadata);
const de = (puuid) => stats.get(puuid);

// a matou um inimigo: e o unico abate da rodada.
assert.equal(de("a").oneKills, 1, "abate em inimigo conta no 1K");
assert.equal(de("a").eKillPoints, 1, "abate em inimigo conta nos pontos de abate");

// c morreu pela propria acao: morte sim, abate nao.
assert.equal(de("c").oneKills, 0, "morte pela propria acao nao e abate");
assert.equal(de("c").eKillPoints, 0, "nem nos pontos de abate");
assert.equal(de("c").eDeathPoints, 1, "mas segue sendo morte");
assert.equal(de("c").firstKills, 0, "e nao abre a rodada como abate");
assert.equal(de("c").firstDeaths, 1, "a primeira morte da rodada segue sendo dele");

// d matou um aliado: nao e abate; e (o aliado) morreu.
assert.equal(de("d").oneKills, 0, "abate em aliado nao conta no 1K");
assert.equal(de("d").eKillPoints, 0, "nem nos pontos de abate");
assert.equal(de("e").eDeathPoints, 1, "o aliado abatido segue morto");

console.log("ok: so o abate em inimigo da credito de abate");
