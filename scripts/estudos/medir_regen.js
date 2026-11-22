// Estudo de 21/11/2026 (fora do build): quanto o Regen Shield pode errar a nota.
//
// O Regen Shield tem 25 de escudo ativo e regenera de uma reserva de 50: quem o usa
// absorve entre 125 e 175 de dano no round, conforme quanto regenerou. A Riot dá o
// dano somado por atacante no round, sem hora, e não registra a vida nem o escudo,
// então não dá para saber quanto regenerou. Aqui se mede o tamanho máximo do erro:
// o dano em vítimas com Regen Shield cortado em 125 (nada regenerou) contra o
// cortado em 175 (regenerou tudo), com o excesso tirado primeiro de quem matou,
// como no applyEffectiveDamage.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/medir_regen.js <variantes.json> <saida.json>

const fs = require("fs");
const { carregar } = require("./carregar_univlr.js");
const { BETA } = require("./nota_beta.js");

const [arquivoVariantes, saida] = process.argv.slice(2);
if (!arquivoVariantes || !saida) {
  console.error("uso: node scripts/estudos/medir_regen.js <variantes.json> <saida.json>");
  process.exit(2);
}
const REGEN = "B1B9086D-41BD-A516-5D29-E3B34A6F1644";
const PESO_DANO = BETA.dano / 1.5; // nota por 100 de ADR, com o fator fixo de 21/11

function efetivo(porAtacante, cap, quemMatou) {
  const efe = new Map(porAtacante);
  let excesso = [...efe.values()].reduce((s, v) => s + v, 0) - cap;
  if (excesso <= 0) return efe;
  let ultimo = quemMatou && efe.has(quemMatou) ? quemMatou : [...efe.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const tira = Math.min(excesso, efe.get(ultimo));
  efe.set(ultimo, efe.get(ultimo) - tira);
  excesso -= tira;
  for (const [a, v] of [...efe.entries()].sort((x, y) => y[1] - x[1])) {
    if (a === ultimo || excesso <= 0) continue;
    const t = Math.min(excesso, v);
    efe.set(a, v - t);
    excesso -= t;
  }
  return efe;
}

const { files } = carregar();
const delta = new Map(); // matchId|puuid -> dano a mais com o corte em 175
const deltaMeioBaixo = new Map(); // corte em 150 contra 125
const deltaMeioAlto = new Map(); // corte em 175 contra 150
let vitimasRegen = 0;
let mortasRegen = 0;
let mortasAmbiguas = 0; // morreram com mais de 125 de dano registrado: regenerou ou é excesso?
let vivasAcima125 = 0;
let vivasRegen = 0;
let danoAmbiguo = 0;
let danoTotal = 0;
for (const file of files) {
  const raw = file.raw;
  const matchId = raw.matchInfo.matchId;
  const lado = new Map((raw.players || []).filter((p) => !p.isObserver && p.puuid).map((p) => [p.puuid, p.teamId]));
  for (const round of globalThis.officialRoundResults(raw)) {
    const armadura = new Map((round.playerStats || []).map((ps) => [ps.puuid, String(ps.economy?.armor || "").toUpperCase()]));
    const recebido = new Map();
    for (const ps of round.playerStats || []) {
      for (const d of ps.damage || []) {
        const v = Number(d.damage || 0);
        if (!lado.has(d.receiver) || lado.get(d.receiver) === lado.get(ps.puuid) || v <= 0) continue;
        if (!recebido.has(d.receiver)) recebido.set(d.receiver, new Map());
        recebido.get(d.receiver).set(ps.puuid, (recebido.get(d.receiver).get(ps.puuid) || 0) + v);
      }
    }
    const quemMatou = new Map();
    const tempo = new Map();
    for (const ps of round.playerStats || []) {
      for (const k of ps.kills || []) {
        if (!k.killer || !k.victim) continue;
        const t = Number(k.timeSinceRoundStartMillis);
        if (!tempo.has(k.victim) || t > tempo.get(k.victim)) {
          tempo.set(k.victim, t);
          quemMatou.set(k.victim, k.killer);
        }
      }
    }
    for (const [vitima, porAtacante] of recebido) {
      const total = [...porAtacante.values()].reduce((s, v) => s + v, 0);
      const cap = 100 + globalThis.armorExtraHp(armadura.get(vitima) || "");
      danoTotal += Math.min(total, cap);
      if (armadura.get(vitima) !== REGEN) continue;
      vitimasRegen += 1;
      const morreu = quemMatou.has(vitima);
      if (morreu) {
        mortasRegen += 1;
        if (total > 125) mortasAmbiguas += 1;
      } else {
        vivasRegen += 1;
        if (total > 125) vivasAcima125 += 1;
      }
      const a = efetivo(porAtacante, 125, quemMatou.get(vitima));
      const m = efetivo(porAtacante, 150, quemMatou.get(vitima));
      const b = efetivo(porAtacante, 175, quemMatou.get(vitima));
      for (const [atacante, v] of b) {
        const d = v - (a.get(atacante) || 0);
        const chave = `${matchId}|${atacante}`;
        if (d > 0) {
          danoAmbiguo += d;
          delta.set(chave, (delta.get(chave) || 0) + d);
        }
        // corte no meio (150): erro contra cada extremo
        const baixo = (m.get(atacante) || 0) - (a.get(atacante) || 0);
        const alto = v - (m.get(atacante) || 0);
        if (baixo > 0) deltaMeioBaixo.set(chave, (deltaMeioBaixo.get(chave) || 0) + baixo);
        if (alto > 0) deltaMeioAlto.set(chave, (deltaMeioAlto.get(chave) || 0) + alto);
      }
    }
  }
}

// Quanto o Regen Shield absorve em média, medido pelos abates de um atacante só,
// com uma morte só e por arma: o dano registrado inclui o excesso além da vida, e o
// excesso depende da arma, não do colete. Com o leve (sempre 125) de referência,
// regen absorve 125 + (dano médio nas vítimas com regen - dano médio nas com leve).
// Controle: o pesado (sempre 150) tem de dar 25 acima do leve.
const LEVE = "4DEC83D5-4902-9AB3-BED6-A7A390761157";
const PESADO = "822BCAB2-40A2-324E-C137-E09195AD7692";
const porArma = new Map(); // arma -> colete -> { n, soma }
for (const file of files) {
  const raw = file.raw;
  const lado = new Map((raw.players || []).filter((p) => !p.isObserver && p.puuid).map((p) => [p.puuid, p.teamId]));
  for (const round of globalThis.officialRoundResults(raw)) {
    const armadura = new Map((round.playerStats || []).map((ps) => [ps.puuid, String(ps.economy?.armor || "").toUpperCase()]));
    const recebido = new Map();
    for (const ps of round.playerStats || []) {
      for (const d of ps.damage || []) {
        const v = Number(d.damage || 0);
        if (!lado.has(d.receiver) || lado.get(d.receiver) === lado.get(ps.puuid) || v <= 0) continue;
        if (!recebido.has(d.receiver)) recebido.set(d.receiver, new Map());
        recebido.get(d.receiver).set(ps.puuid, (recebido.get(d.receiver).get(ps.puuid) || 0) + v);
      }
    }
    const mortes = new Map();
    for (const ps of round.playerStats || []) {
      for (const k of ps.kills || []) {
        if (!k.victim) continue;
        if (!mortes.has(k.victim)) mortes.set(k.victim, []);
        mortes.get(k.victim).push(k);
      }
    }
    for (const [vitima, ks] of mortes) {
      const unicas = new Set(ks.map((k) => `${k.timeSinceRoundStartMillis}|${k.killer}`));
      if (unicas.size !== 1) continue;
      const k = ks[0];
      const porAtacante = recebido.get(vitima);
      if (!porAtacante || porAtacante.size !== 1 || !porAtacante.has(k.killer)) continue;
      if (k.finishingDamage?.damageType !== "Weapon") continue;
      const colete = armadura.get(vitima);
      if (![LEVE, PESADO, REGEN].includes(colete)) continue;
      const arma = String(k.finishingDamage.damageItem || "").toUpperCase();
      if (!porArma.has(arma)) porArma.set(arma, new Map());
      const g = porArma.get(arma);
      if (!g.has(colete)) g.set(colete, { n: 0, soma: 0 });
      g.get(colete).n += 1;
      g.get(colete).soma += porAtacante.get(k.killer);
    }
  }
}
// média das diferenças por arma, pesada pelo número de vítimas com regen (armas com 30+ em cada colete)
let pesoR = 0;
let somaR = 0;
let pesoP = 0;
let somaP = 0;
const armasUsadas = [];
for (const [arma, g] of porArma) {
  const l = g.get(LEVE);
  const p = g.get(PESADO);
  const r = g.get(REGEN);
  if (!l || l.n < 30) continue;
  const ml = l.soma / l.n;
  if (r && r.n >= 30) {
    somaR += (r.soma / r.n - ml) * r.n;
    pesoR += r.n;
    armasUsadas.push(arma);
  }
  if (p && p.n >= 30) {
    somaP += (p.soma / p.n - ml) * p.n;
    pesoP += p.n;
  }
}
const regenMedio = { absorveAlemDoLeve: somaR / pesoR, vitimas: pesoR, armas: armasUsadas.length, controlePesadoAlemDoLeve: somaP / pesoP, vitimasPesado: pesoP };

// em nota: dano a mais / rounds / 100 x peso do dano (β ÷ 1,5); por mapa e por campeonato
const dados = JSON.parse(fs.readFileSync(arquivoVariantes, "utf8"));
const ref = dados.referencia;
const porMapa = [];
const porCamp = new Map();
for (const [chave, b] of Object.entries(ref)) {
  const d = delta.get(chave) || 0;
  if (b.rounds) porMapa.push((PESO_DANO * d) / b.rounds / 100);
  const k = `${b.eventId}|${b.id}`;
  if (!porCamp.has(k)) porCamp.set(k, { d: 0, r: 0 });
  porCamp.get(k).d += d;
  porCamp.get(k).r += b.rounds;
}
const camp = [...porCamp.values()].filter((x) => x.r >= 50).map((x) => (PESO_DANO * x.d) / x.r / 100);
const quantil = (v, q) => [...v].sort((x, y) => x - y)[Math.floor((v.length - 1) * q)];
// erro de cada corte contra o pior extremo, por campeonato (50+ rounds)
function errosPorCampeonato(mapa) {
  const g = new Map();
  for (const [chave, b] of Object.entries(ref)) {
    const k = `${b.eventId}|${b.id}`;
    if (!g.has(k)) g.set(k, { d: 0, r: 0 });
    g.get(k).d += mapa.get(chave) || 0;
    g.get(k).r += b.rounds;
  }
  return [...g.values()].filter((x) => x.r >= 50).map((x) => (PESO_DANO * x.d) / x.r / 100);
}
const resumoErro = (v) => ({ maior: Math.max(...v), p99: quantil(v, 0.99), acima0005: v.filter((x) => x >= 0.005).length, total: v.length });
const somaMapa = (mapa) => [...mapa.values()].reduce((s, x) => s + x, 0);
const resultado = {
  vitimasRegen,
  mortasRegen,
  mortasAmbiguas,
  vivasRegen,
  vivasAcima125,
  danoAmbiguo,
  parteDoDanoDoSite: danoAmbiguo / danoTotal,
  notaPorMapa: { maior: Math.max(...porMapa), p99: quantil(porMapa, 0.99), afetados: porMapa.filter((x) => x > 0).length, total: porMapa.length },
  notaPorCampeonato: { maior: Math.max(...camp), p99: quantil(camp, 0.99), acima0005: camp.filter((x) => x >= 0.005).length, total: camp.length },
  // A média por arma NÃO serve: o controle do pesado deu bem menos que 25, porque o
  // dano registrado conta o tiro cheio e quase não depende da vida da vítima.
  regenMedio,
  cortes: {
    "125 (só o escudo ativo)": { piorCaso: "regenerou tudo", parteDoDano: danoAmbiguo / danoTotal, campeonato: resumoErro(camp) },
    "150 (meio, o +50 de hoje)": {
      seNaoRegenerou: { parteDoDano: somaMapa(deltaMeioBaixo) / danoTotal, campeonato: resumoErro(errosPorCampeonato(deltaMeioBaixo)) },
      seRegenerouTudo: { parteDoDano: somaMapa(deltaMeioAlto) / danoTotal, campeonato: resumoErro(errosPorCampeonato(deltaMeioAlto)) },
    },
    "175 (escudo e reserva inteira)": { piorCaso: "não regenerou", parteDoDano: danoAmbiguo / danoTotal, campeonato: resumoErro(camp) },
  },
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));
console.log(`vítimas com Regen Shield: ${vitimasRegen} (morreram ${mortasRegen}, das quais ${mortasAmbiguas} com mais de 125 de dano; vivas ${vivasRegen}, das quais ${vivasAcima125} com mais de 125)`);
console.log(`dano que pode ou não contar (corte em 125 x 175): ${danoAmbiguo.toFixed(0)}, ${(100 * resultado.parteDoDanoDoSite).toFixed(2)}% do dano contado no site`);
console.log(`erro máximo na nota de um mapa: ${resultado.notaPorMapa.maior.toFixed(3)} (99% dos mapas até ${resultado.notaPorMapa.p99.toFixed(4)}; ${resultado.notaPorMapa.afetados} de ${resultado.notaPorMapa.total} mapas com alguma diferença)`);
console.log(`erro máximo na nota de campeonato (50+ rounds): ${resultado.notaPorCampeonato.maior.toFixed(4)} (99% até ${resultado.notaPorCampeonato.p99.toFixed(4)}; ${resultado.notaPorCampeonato.acima0005} de ${resultado.notaPorCampeonato.total} com 0,005 ou mais)`);
const meio = resultado.cortes["150 (meio, o +50 de hoje)"];
for (const [nome, e] of [["se não regenerou", meio.seNaoRegenerou], ["se regenerou tudo", meio.seRegenerouTudo]]) {
  console.log(`corte em 150, ${nome}: ${(100 * e.parteDoDano).toFixed(2)}% do dano; campeonato: maior ${e.campeonato.maior.toFixed(4)}, 99% até ${e.campeonato.p99.toFixed(4)}, ${e.campeonato.acima0005} de ${e.campeonato.total} com 0,005 ou mais`);
}
console.log(`regen em média (método reprovado pelo controle, não usar): absorve ${regenMedio.absorveAlemDoLeve.toFixed(1)} além do leve (vida ${(125 + regenMedio.absorveAlemDoLeve).toFixed(1)}), em ${regenMedio.vitimas} vítimas e ${regenMedio.armas} armas; controle: o pesado dá ${regenMedio.controlePesadoAlemDoLeve.toFixed(1)} além do leve (o certo é 25), em ${regenMedio.vitimasPesado} vítimas`);
