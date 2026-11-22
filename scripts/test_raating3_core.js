const assert = require("node:assert/strict");
const RaaRatingCore = require("../raating-core.js");

function approx(actual, expected, tolerance = 1e-9) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

// rAAting 3.1 (especificacao de 21/11/2026): nota = 1 + soma de beta * (x - media do
// grupo), com os beta da formula estimada da HLTV e o do dano dividido por 1,5. Os
// valores fixados abaixo saem da conta do estudo (scripts/estudos/nota_beta.js).
const C = RaaRatingCore;
const linhas = [
  { rounds: 20, eKillPoints: 16, eDeathPoints: 14, eDamageTotal: 2400, eKastPoints: 14, adjustedRoundSwingTotalPp: 60, multiKillPoints: 5 },
  { rounds: 24, eKillPoints: 12, eDeathPoints: 19, eDamageTotal: 2100, eKastPoints: 15, adjustedRoundSwingTotalPp: -80, multiKillPoints: 2 },
  { rounds: 13, eKillPoints: 14, eDeathPoints: 6, eDamageTotal: 2300, eKastPoints: 11, adjustedRoundSwingTotalPp: 95, multiKillPoints: 6 },
];
const centro = C.groupCenter(linhas);
approx(centro.abate, 0.7368421052631579, 1e-15);
approx(centro.swing, 1.3157894736842106, 1e-15);
C.setGroupCenter(centro);
assert.deepEqual(C.getGroupCenter(), centro);
approx(C.calculateRaating3(linhas[0]).raating_3, 1.09041277777778, 1e-12);
approx(C.calculateRaating3(linhas[1]).raating_3, 0.553756944444444, 1e-12);
approx(C.calculateRaating3(linhas[2]).raating_3, 1.68473675213675, 1e-12);

// a media das notas pesada pelos rounds e 1
approx(linhas.reduce((s, l) => s + C.calculateRaating3(l).raating_3 * l.rounds, 0) / 57, 1, 1e-12);
// a linha da soma (igual a media) vale 1, e as partes somam a nota menos 1
const soma = Object.fromEntries(Object.keys(linhas[0]).map((k) => [k, linhas.reduce((s, l) => s + l[k], 0)]));
approx(C.calculateRaating3(soma).raating_3, 1, 1e-12);
const nota = C.calculateRaating3(linhas[0]);
approx(C.RATING_31_PARTS.reduce((s, p) => s + nota[`parte_${p}`], 0), nota.raating_3 - 1, 1e-12);
assert.deepEqual(C.RATING_31_PARTS, ["abate", "sobrevivencia", "dano", "kast", "swing", "multikill"]);
approx(C.RATING_31_BETAS.abate, 0.4941, 0);
approx(C.RATING_31_BETAS.sobrevivencia, 0.3795, 0);
approx(C.RATING_31_BETAS.dano, 0.428 / 1.5, 1e-15);
approx(C.RATING_31_BETAS.kast, 0.2602, 0);
approx(C.RATING_31_BETAS.swing, 0.03748, 0);
approx(C.RATING_31_BETAS.multikill, 0.0241, 0);
assert.equal(nota.rating_version, "raa3.1");
assert.equal(nota.sample_status, "LOW", "menos de 50 rounds e amostra baixa");
assert.equal(C.calculateRaating3(soma).sample_status, "OK", "57 rounds e amostra OK");
// as metricas da ficha do perfil continuam saindo nas unidades de hoje
approx(nota.ekpr, 0.8, 1e-12);
approx(nota.edpr, 0.7, 1e-12);
approx(nota.eadr, 120, 1e-12);
approx(nota.ekast, 70, 1e-12);
approx(nota.mk_per_r, 0.25, 1e-12);
approx(nota.adjusted_swing_percent, 3, 1e-12);
// os nomes da nota antiga sairam
for (const campo of ["rating_recon_proxy", "rating_3_like", "KillRating", "kill_rating", "metric_kill"]) assert(!(campo in nota), `${campo} saiu`);

// as trocas de campo de hoje: sem os campos e*, usa kills, deaths, damage, kastRounds e impactTotal
const semE = { rounds: 20, kills: 16, deaths: 14, damage: 2400, kastRounds: 14, impactTotal: 60, twoKills: 3, threeKills: 1 };
approx(C.calculateRaating3(semE).raating_3, C.calculateRaating3({ ...linhas[0], multiKillPoints: 5 }).raating_3, 1e-12);

// sem media do grupo, nota e partes sao NaN (banco antigo, sem centro)
C.setGroupCenter(null);
assert(Number.isNaN(C.calculateRaating3(linhas[0]).raating_3));
assert(Number.isNaN(C.calculateRaating3(linhas[0]).parte_abate));
// a media tambem pode vir no segundo argumento
approx(C.calculateRaating3(linhas[0], centro).raating_3, 1.09041277777778, 1e-12);

// 0 rounds: nota finita pela mesma conta, LOW; a linha vazia nao muda a media
C.setGroupCenter(centro);
const vazio = C.calculateRaating3({ rounds: 0 });
approx(vazio.raating_3, -0.0617222222222221, 1e-12);
assert.equal(vazio.sample_status, "LOW");
assert.deepEqual(C.groupCenter([...linhas, { rounds: 0 }]), centro);
assert.equal(C.groupCenter([{ rounds: 0 }]), null, "sem rounds nao ha media");

// applyRatingFields: rAAting 1.0 continua, e rating aponta para a nota
const aplicada = C.applyRatingFields({ ...linhas[0], kpr: 0.8, dpr: 0.7, apr: 0.2, adr: 120, kastFrac: 0.7, impactRound: 3 });
approx(aplicada.rating, aplicada.raating_3, 0);
assert(Number.isFinite(aplicada.raating_1));

// sem limites: mais abates, nota maior, inclusive bem acima de 1,8
const mais = (kills) => C.calculateRaating3({ rounds: 13, eKillPoints: kills, eDeathPoints: 5, eDamageTotal: kills * 150, eKastPoints: 12, adjustedRoundSwingTotalPp: kills * 4, multiKillPoints: kills / 2 }).raating_3;
assert(mais(30) > mais(26) && mais(26) > mais(22), "mais abates, nota maior, sem empate no topo");
assert(mais(30) > 1.8, "sem teto");
const baixa = C.calculateRaating3({ rounds: 60, eKillPoints: 0, eDeathPoints: 500, eDamageTotal: 0, eKastPoints: 0, adjustedRoundSwingTotalPp: -2000, multiKillPoints: 0 });
assert(baixa.raating_3 < 0, "sem piso, a nota muito baixa fica negativa");

const model = RaaRatingCore.createEcoModel([
  { attackerBucket: "$0-$1000", victimBucket: "$4700+" },
  { attackerBucket: "$4700+", victimBucket: "$0-$1000" },
  { attackerBucket: "$4700+", victimBucket: "$0-$1000" },
  { attackerBucket: "$3550-$4700", victimBucket: "$3550-$4700" },
]);
const observedMean = [
  RaaRatingCore.ecoMultiplier(model, "$0-$1000", "$4700+"),
  RaaRatingCore.ecoMultiplier(model, "$4700+", "$0-$1000"),
  RaaRatingCore.ecoMultiplier(model, "$4700+", "$0-$1000"),
  RaaRatingCore.ecoMultiplier(model, "$3550-$4700", "$3550-$4700"),
].reduce((sum, value) => sum + value, 0) / 4;
approx(observedMean, 1, 1e-12);

console.log("rAAting 3.1 core tests passed");
