// Estudo de 21/11/2026 (fora do build): quanto vale "um ponto de dano" no
// Valorant comparado ao CS. No CS a vida é sempre 100; no Valorant ela vai a 125
// ou 150 com colete, e há cura, escudo que regenera e ressurreição.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/medir_vida.js <hltv_jogadores.csv> <saida.json>
//
// Mede nas partidas do site:
// - o colete de cada jogador em cada round (economy.armor) e a vida que ele dá;
// - a vida de quem morreu, no round em que morreu;
// - sinais de cura: quem termina o round vivo tendo levado mais dano de inimigos
//   do que a vida dele (100 + colete) só pode ter sido curado ou regenerado;
// - se o dano registrado passa da vida em abates de um atacante só (excesso de dano);
// - o dano por abate: dano em inimigos dividido pelos abates em inimigos.
// E na amostra da HLTV: o dano por abate do CS, ADR / KPR (tradicionais), pesado pelos mapas.

const fs = require("fs");
const { carregar } = require("./carregar_univlr.js");

const [arquivoHltv, saida] = process.argv.slice(2);
if (!arquivoHltv || !saida) {
  console.error("uso: node scripts/estudos/medir_vida.js <hltv_jogadores.csv> <saida.json>");
  process.exit(2);
}

const { files } = carregar();
// Os coletes que a tabela ARMOR_EXTRA_HP do app.js conhece (a constante fica
// presa ao eval; a função armorExtraHp é global e conta +50 para id desconhecido).
const CONHECIDOS = { "4DEC83D5-4902-9AB3-BED6-A7A390761157": 25, "822BCAB2-40A2-324E-C137-E09195AD7692": 50 };
for (const [id, hp] of Object.entries(CONHECIDOS)) {
  if (globalThis.armorExtraHp(id) !== hp) throw new Error(`a tabela de colete do app.js mudou: ${id}`);
}
const extra = (id) => {
  const key = String(id || "").trim().toUpperCase();
  return { hp: globalThis.armorExtraHp(key), conhecido: !key || Object.hasOwn(CONHECIDOS, key) };
};

const coletes = {}; // id do colete -> rounds de jogador
let jogadorRounds = 0;
let somaVida = 0;
let mortes = 0;
let somaVidaNaMorte = 0;
let vivosComMaisDanoQueVida = 0;
let vivosComDano = 0;
let excessoDosVivos = 0;
let abatesUmAtacante = 0;
let abatesUmAtacanteAcimaDaVida = 0;
let danoEmInimigos = 0;
let abatesEmInimigos = 0;
let danoRecebidoPorQuemMorreu = 0;
let ressurreicoes = 0;
// Por origem do arquivo: partidas da Riot (com colete) e as convertidas do tracker
// (colete desconhecido, contado como +50). Dano limitado à vida da vítima
// (100 + colete), como no applyEffectiveDamage: é o dano que entra na nota.
const porOrigem = {};
const origemDe = (raw) => (raw.roundResults || []).some((r) => (r.playerStats || []).some((ps) => String(ps.economy?.armor || "").toUpperCase() === "TRACKER-COLETE-DESCONHECIDO")) ? "tracker" : "riot";
const somar = (o, campo, v) => {
  porOrigem[o] = porOrigem[o] || { partidas: 0, jogadorRounds: 0, somaVida: 0, danoLimitado: 0, danoCru: 0, abates: 0, vivosComDano: 0, vivosComMaisDanoQueVida: 0 };
  porOrigem[o][campo] += v;
};

for (const file of files) {
  const raw = file.raw;
  const origem = origemDe(raw);
  somar(origem, "partidas", 1);
  const lado = new Map((raw.players || []).filter((p) => !p.isObserver && p.puuid).map((p) => [p.puuid, p.teamId]));
  for (const round of globalThis.officialRoundResults(raw)) {
    const vida = new Map();
    const recebido = new Map(); // vítima -> atacante -> dano
    const mortosNoRound = new Map(); // vítima -> quantas vezes morreu
    const autoresDaMorte = new Map();
    for (const ps of round.playerStats || []) {
      if (!lado.has(ps.puuid)) continue;
      const id = String(ps.economy?.armor || "").trim().toUpperCase() || "(sem colete)";
      coletes[id] = (coletes[id] || 0) + 1;
      const hp = 100 + extra(ps.economy?.armor).hp;
      vida.set(ps.puuid, hp);
      jogadorRounds += 1;
      somaVida += hp;
      somar(origem, "jogadorRounds", 1);
      somar(origem, "somaVida", hp);
      for (const d of ps.damage || []) {
        const v = Number(d.damage || 0);
        if (!d.receiver || v <= 0 || !lado.has(d.receiver) || lado.get(d.receiver) === lado.get(ps.puuid)) continue;
        if (!recebido.has(d.receiver)) recebido.set(d.receiver, new Map());
        recebido.get(d.receiver).set(ps.puuid, (recebido.get(d.receiver).get(ps.puuid) || 0) + v);
        danoEmInimigos += v;
      }
    }
    const vistos = new Set();
    for (const ps of round.playerStats || []) {
      for (const k of ps.kills || []) {
        const chave = `${k.timeSinceRoundStartMillis}|${k.killer}|${k.victim}`;
        if (vistos.has(chave) || !lado.has(k.victim)) continue;
        vistos.add(chave);
        mortosNoRound.set(k.victim, (mortosNoRound.get(k.victim) || 0) + 1);
        if (k.killer && lado.has(k.killer) && lado.get(k.killer) !== lado.get(k.victim)) {
          abatesEmInimigos += 1;
          somar(origem, "abates", 1);
          autoresDaMorte.set(k.victim, k.killer);
        }
      }
    }
    for (const [vitima, n] of mortosNoRound) {
      mortes += 1;
      somaVidaNaMorte += vida.get(vitima) ?? 100;
      if (n > 1) ressurreicoes += n - 1;
      const porAtacante = recebido.get(vitima);
      const total = porAtacante ? [...porAtacante.values()].reduce((s, v) => s + v, 0) : 0;
      danoRecebidoPorQuemMorreu += total;
      if (porAtacante && porAtacante.size === 1 && n === 1) {
        abatesUmAtacante += 1;
        if (total > (vida.get(vitima) ?? 100)) abatesUmAtacanteAcimaDaVida += 1;
      }
    }
    for (const [vitima, porAtacante] of recebido) {
      const total = [...porAtacante.values()].reduce((s, v) => s + v, 0);
      const hp = vida.get(vitima) ?? 100;
      somar(origem, "danoCru", total);
      somar(origem, "danoLimitado", Math.min(total, hp));
      if (mortosNoRound.has(vitima)) continue;
      vivosComDano += 1;
      somar(origem, "vivosComDano", 1);
      if (total > hp) {
        vivosComMaisDanoQueVida += 1;
        somar(origem, "vivosComMaisDanoQueVida", 1);
        excessoDosVivos += total - hp;
      }
    }
  }
}

// HLTV: dano por abate = ADR / KPR (tradicionais), pesado pelos mapas
const linhas = fs.readFileSync(arquivoHltv, "utf8").trim().split(/\r?\n/);
const cab = linhas[0].split(",");
const col = (nome) => cab.indexOf(nome);
const hltv = linhas.slice(1).map((l) => l.split(",").map(Number));
const pesoMapas = hltv.reduce((s, x) => s + x[col("mapas")], 0);
const adrCs = hltv.reduce((s, x) => s + x[col("adr")] * x[col("mapas")], 0) / pesoMapas;
const kprCs = hltv.reduce((s, x) => s + x[col("kpr")] * x[col("mapas")], 0) / pesoMapas;
const eadrCs = hltv.reduce((s, x) => s + x[col("eadr")] * x[col("mapas")], 0) / pesoMapas;
const ekprCs = hltv.reduce((s, x) => s + x[col("ekpr")] * x[col("mapas")], 0) / pesoMapas;

const vidaMedia = somaVida / jogadorRounds;
const danoPorAbateVal = danoEmInimigos / abatesEmInimigos;
const danoPorAbateCs = adrCs / kprCs;
const resultado = {
  partidas: files.length,
  jogadorRounds,
  coletes: Object.fromEntries(Object.entries(coletes).sort((a, b) => b[1] - a[1]).map(([id, n]) => [id, { rounds: n, parte: n / jogadorRounds, vidaExtra: id === "(sem colete)" ? 0 : extra(id).hp, conhecido: id === "(sem colete)" || extra(id).conhecido }])),
  vidaMediaPorRound: vidaMedia,
  vidaMediaDeQuemMorreu: somaVidaNaMorte / mortes,
  mortes,
  ressurreicoes,
  cura: {
    vivosQueLevaramDano: vivosComDano,
    vivosComMaisDanoQueAVida: vivosComMaisDanoQueVida,
    parte: vivosComMaisDanoQueVida / vivosComDano,
    excessoMedio: vivosComMaisDanoQueVida ? excessoDosVivos / vivosComMaisDanoQueVida : 0,
  },
  excessoDeDano: { abatesDeUmAtacante: abatesUmAtacante, acimaDaVida: abatesUmAtacanteAcimaDaVida, parte: abatesUmAtacanteAcimaDaVida / abatesUmAtacante },
  danoRecebidoPorMorte: danoRecebidoPorQuemMorreu / mortes,
  danoPorAbate: { valorant: danoPorAbateVal, cs: danoPorAbateCs, razao: danoPorAbateVal / danoPorAbateCs },
  porOrigem: Object.fromEntries(
    Object.entries(porOrigem).map(([o, v]) => [
      o,
      { ...v, vidaMedia: v.somaVida / v.jogadorRounds, danoLimitadoPorAbate: v.danoLimitado / v.abates, danoCruPorAbate: v.danoCru / v.abates, razaoLimitadoSobreCs: v.danoLimitado / v.abates / danoPorAbateCs, curaParte: v.vivosComMaisDanoQueVida / v.vivosComDano },
    ]),
  ),
  hltv: { adr: adrCs, kpr: kprCs, eadr: eadrCs, ekpr: ekprCs, eadrPorEkpr: eadrCs / ekprCs },
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

console.log(`${resultado.partidas} partidas, ${jogadorRounds} rounds de jogador`);
for (const [id, c] of Object.entries(resultado.coletes)) console.log(`  colete ${id}: ${(100 * c.parte).toFixed(1)}% (+${c.vidaExtra}${c.conhecido ? "" : ", fora da tabela do app.js, que conta +50"})`);
console.log(`vida média no round ${vidaMedia.toFixed(1)}; de quem morreu ${resultado.vidaMediaDeQuemMorreu.toFixed(1)}; ressurreições ${ressurreicoes} em ${mortes} mortes`);
console.log(`cura: ${vivosComMaisDanoQueVida} de ${vivosComDano} vivos que levaram dano levaram mais que a vida (${(100 * resultado.cura.parte).toFixed(1)}%), em média ${resultado.cura.excessoMedio.toFixed(0)} a mais`);
console.log(`excesso de dano: ${(100 * resultado.excessoDeDano.parte).toFixed(1)}% dos abates de um atacante só registram mais dano que a vida`);
console.log(`dano recebido por morte (Valorant) ${resultado.danoRecebidoPorMorte.toFixed(1)}`);
console.log(`dano por abate (cru): Valorant ${danoPorAbateVal.toFixed(1)}, CS ${danoPorAbateCs.toFixed(1)} (ADR ${adrCs.toFixed(1)} / KPR ${kprCs.toFixed(3)}), razão ${resultado.danoPorAbate.razao.toFixed(3)}`);
for (const [o, v] of Object.entries(resultado.porOrigem)) {
  console.log(`  ${o}: ${v.partidas} partidas, vida média ${v.vidaMedia.toFixed(1)}, dano por abate cru ${v.danoCruPorAbate.toFixed(1)}, limitado à vida ${v.danoLimitadoPorAbate.toFixed(1)} (${v.razaoLimitadoSobreCs.toFixed(3)} x o do CS), cura em ${(100 * v.curaParte).toFixed(1)}% dos vivos com dano`);
}
