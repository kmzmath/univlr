// Estudo de 20/11/2026 (fora do build): recalcula as linhas jogador x partida do
// rAAting 3.0 com cada variante e grava os campos que entram na nota. Não grava
// database.json, home.json nem metadata.json.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/raating_variantes.js <chance_spike.json> <saida.json>
//   <chance_spike.json> vem de scripts/estudos/medir_chance_spike.js
//
// Variantes (cada uma muda só o que diz, o resto fica como no app.js):
// - atual: as funções do app.js, sem troca nenhuma;
// - controle: o swing reescrito aqui com todas as chaves desligadas (tem que dar
//   exatamente o atual, senão a reescrita está errada);
// - v1_dano: o crédito de quem matou é dividido entre os inimigos da vítima que
//   deram dano nela no round, na proporção do dano; sem dano registrado, tudo
//   para quem matou;
// - v1_dano_limitado: o mesmo, com o dano limitado à vida (100 + colete) como em
//   applyEffectiveDamage, o excesso tirado primeiro de quem matou;
// - v2_spike: chance por (vivos do ataque, vivos da defesa, spike), sem crédito
//   pelo plantio (o plantio só muda o estado);
// - v2_spike_plantio: a mesma tabela, e quem planta ganha o salto da chance, que
//   é cobrado dos defensores vivos em partes iguais (regra antiga do Hub CS2);
// - v3_eco: economia sem os ajustes sem fonte (3a + 3b + 3c);
//   - v3a_modelo: multiplicador sem dividir pela média e sem o limite de 0,35 a 1,75;
//   - v3b_dano: dano com o multiplicador inteiro (hoje é metade do efeito);
//   - v3c_kast: KAST sem ajuste de economia (hoje é 35% do efeito);
// - todas: v1 + v2_spike + v3; todas_plantio: v1 + v2_spike_plantio + v3.

const fs = require("fs");
const { carregar } = require("./carregar_univlr.js");
const { notaBeta } = require("./nota_beta.js");

// Também serve de módulo (ranking_variantes.js): configurar() recebe as partidas,
// o metadata e a tabela com spike, e instalar(cfg)/restaurar() trocam as funções.
const Core = globalThis.RaaRatingCore;
let files = [];
let metadata = null;
let tabelaSpike = {};
function configurar(opcoes) {
  files = opcoes.files;
  metadata = opcoes.metadata;
  tabelaSpike = opcoes.tabelaSpike;
}

const ORIGINAL = {
  applyRoundSwingStats: globalThis.applyRoundSwingStats,
  applyEffectiveDamage: globalThis.applyEffectiveDamage,
  createEcoModel: Core.createEcoModel,
  reducedEcoMultiplier: Core.reducedEcoMultiplier,
  applyRatingFields: Core.applyRatingFields,
};
for (const [nome, fn] of Object.entries(ORIGINAL)) {
  if (typeof fn !== "function") throw new Error(`função ${nome} não encontrada`);
}

// ---------- Chance com spike ----------
// Chance de o ataque vencer. Rival sem vivos = 100%; ataque sem vivos e sem
// spike = 0%; ataque sem vivos com spike = a tabela (a defesa ainda tem de desarmar).
function chanceAtaque(a, d, plantada) {
  if (d <= 0) return 1;
  if (a <= 0 && !plantada) return 0;
  const celula = tabelaSpike[`${a}v${d}${plantada ? "b" : ""}`];
  if (!celula) {
    diag.global.celulaAusente += 1;
    // fora da tabela (elenco maior que 5): cai na tabela simétrica de hoje
    return globalThis.stateWinRate(metadata, a, d);
  }
  return celula.p;
}

// ---------- Diagnósticos ----------
const diag = { global: {}, porJogador: new Map() };
function zerarDiag() {
  diag.global = {
    abates: 0,
    abatesInimigo: 0,
    abatesAliado: 0,
    suicidios: 0,
    aliadoNaExplosao: 0,
    swingAliado: 0,
    abatesSemAutor: 0,
    abatesDivididos: 0,
    abatesSemDano: 0,
    abatesQuemMatouSemDano: 0,
    creditoTotal: 0,
    creditoCedido: 0,
    vitimaMorreuDuasVezes: 0,
    roundsComSpike: 0,
    roundsSemLado: 0,
    plantios: 0,
    plantadorFora: 0,
    creditoPlantio: 0,
    saltoDoPlantio: 0,
    cortadosNoFim: 0,
    roundsPlantados: 0,
    swingDoAtaqueComPlantio: 0,
    abatesAposFim: 0,
    celulaAusente: 0,
  };
  diag.porJogador = new Map();
}
let partidaAtual = "";
// Swing de cada jogador por tipo de evento, em pontos percentuais, para explicar
// quem sobe e quem desce: abate e morte por lado (Ata/Def) e por spike (Sem/Com),
// a parte recebida de abates de colegas (v1), abate em aliado, plantio, resíduo
// do fim do round e a correção para somar zero.
const CATEGORIAS = [
  "abAtaSem", "abAtaCom", "abDefSem", "abDefCom", "moAtaSem", "moAtaCom", "moDefSem", "moDefCom",
  "recebido", "cedido", "aliado", "plantio", "plantioCobrado", "residuo", "correcao",
  "nAbAtaSem", "nAbAtaCom", "nAbDefSem", "nAbDefCom", "nPlantios",
];
function diagJogador(puuid) {
  const chave = `${partidaAtual}|${puuid}`;
  if (!diag.porJogador.has(chave)) diag.porJogador.set(chave, Object.fromEntries(CATEGORIAS.map((c) => [c, 0])));
  return diag.porJogador.get(chave);
}

// ---------- Swing reescrito com chaves ----------
let danoDoRound = null; // damageByVictim do round em andamento (inimigos apenas)

function criarSwing(cfg) {
  return function applyRoundSwingStatsEstudo(events, participants, round, stats, sideByPuuid, rosters, meta) {
    const alive = { Blue: new Set(rosters.Blue), Red: new Set(rosters.Red) };
    const roundSwing = new Map([...participants].map((puuid) => [puuid, 0]));
    const legacySwing = new Map([...participants].map((puuid) => [puuid, 0]));
    const addSwing = (map, puuid, amount) => {
      if (!puuid || !map.has(puuid)) return;
      map.set(puuid, map.get(puuid) + amount);
    };
    const anotar = (puuid, categoria, valor) => {
      if (puuid && roundSwing.has(puuid)) diagJogador(puuid)[categoria] += valor;
    };
    const outro = (lado) => (lado === "Blue" ? "Red" : "Blue");

    // Lado do ataque neste round (para a tabela com spike e para as categorias).
    let ataque = "";
    const venc = round.winningTeam;
    const papel = round.winningTeamRole;
    if (["Blue", "Red"].includes(venc) && ["Attacker", "Defender"].includes(papel)) ataque = papel === "Attacker" ? venc : outro(venc);
    else if (cfg.spike) diag.global.roundsSemLado += 1;
    const usaSpike = Boolean(cfg.spike && ataque);
    let plantada = false;
    const chanceDo = (lado) => {
      const pAta = chanceAtaque(alive[ataque].size, alive[outro(ataque)].size, plantada);
      return lado === ataque ? pAta : 1 - pAta;
    };
    const rotulo = (lado) => `${lado === ataque ? "Ata" : "Def"}${plantada ? "Com" : "Sem"}`;

    // Eventos: as mortes, como hoje, e o plantio. Sem a tabela com spike o
    // plantio só marca o estado para as categorias e não muda nenhum número.
    const fila = events.map((event) => ({ tipo: "morte", time: event.time, event }));
    const plantio = ataque && round.bombPlanter && Number.isFinite(Number(round.plantRoundTime)) ? Number(round.plantRoundTime) : null;
    if (plantio !== null) {
      fila.push({ tipo: "plantio", time: plantio, ordem: -1 });
      if (usaSpike) {
        diag.global.roundsComSpike += 1;
        const fim = round.bombDefuser && Number.isFinite(Number(round.defuseRoundTime)) ? Number(round.defuseRoundTime) : plantio + 45000;
        diag.global.abatesAposFim += events.filter((e) => e.time > fim).length;
      }
    }
    fila.sort((a, b) => a.time - b.time || (a.ordem ?? 0) - (b.ordem ?? 0));

    const mortesPorVitima = new Map();
    for (const event of events) mortesPorVitima.set(event.victim, (mortesPorVitima.get(event.victim) || 0) + 1);
    for (const n of mortesPorVitima.values()) if (n > 1) diag.global.vitimaMorreuDuasVezes += 1;

    // Fim do round (decisão do dono em 21/11): o swing fecha quando o round acaba.
    // Desarme e explosão pelo motivo que a Riot registra; a explosão é aos 45 s da
    // spike (as mortes por ela caem de 0 a 1,6 s depois). Eliminação: a defesa toda
    // morta, ou o ataque todo morto sem spike plantada. Tempo esgotado: sem corte.
    let fimTempo = Infinity;
    if (cfg.cortarNoFim) {
      if (round.roundResult === "Bomb defused" && Number.isFinite(Number(round.defuseRoundTime))) fimTempo = Number(round.defuseRoundTime);
      else if (round.roundResult === "Bomb detonated" && plantio !== null) fimTempo = plantio + 45000 - 50;
    }
    let acabou = false;
    const vivosEm = (lado) => [...alive[lado]].filter((puuid) => participants.has(puuid)).length;

    for (const item of fila) {
      if (cfg.cortarNoFim && (acabou || item.time > fimTempo)) {
        if (item.tipo === "morte") diag.global.cortadosNoFim += 1;
        continue;
      }
      if (item.tipo === "plantio") {
        const planter = String(round.bombPlanter);
        anotar(planter, "nPlantios", 1);
        if (!usaSpike) {
          plantada = true;
          continue;
        }
        const antes = chanceDo(ataque);
        plantada = true;
        diag.global.plantios += 1;
        const salto = (chanceDo(ataque) - antes) * 100;
        diag.global.saltoDoPlantio += salto;
        if (!cfg.creditoPlantio) continue;
        if (cfg.creditoPlantio === "time") {
          // o salto vai para os vivos do ataque em partes iguais, como o resíduo do fim do round
          const atacantes = [...alive[ataque]].filter((puuid) => roundSwing.has(puuid));
          for (const puuid of atacantes) {
            addSwing(roundSwing, puuid, salto / atacantes.length);
            anotar(puuid, "plantio", salto / atacantes.length);
          }
          diag.global.creditoPlantio += salto;
        } else {
          if (!roundSwing.has(planter) || sideByPuuid.get(planter) !== ataque) {
            diag.global.plantadorFora += 1;
            continue;
          }
          addSwing(roundSwing, planter, salto);
          anotar(planter, "plantio", salto);
          diag.global.creditoPlantio += salto;
        }
        const defensores = [...alive[outro(ataque)]].filter((puuid) => roundSwing.has(puuid));
        for (const puuid of defensores) {
          addSwing(roundSwing, puuid, -salto / defensores.length);
          anotar(puuid, "plantioCobrado", -salto / defensores.length);
        }
        continue;
      }

      const event = item.event;
      const victim = event.victim;
      if (!victim || !sideByPuuid.has(victim)) continue;
      const victimSide = alive.Blue.has(victim) ? "Blue" : alive.Red.has(victim) ? "Red" : "";
      if (!victimSide) continue;
      const enemySide = outro(victimSide);
      diag.global.abates += 1;

      // Swing legado (rAAting 1.0): sempre como hoje.
      const deathLegacy = globalThis.deltaDeathPp(meta, alive[victimSide].size, alive[enemySide].size);
      addSwing(legacySwing, victim, deathLegacy);

      let deathSwing;
      let killSwingInimigo;
      if (usaSpike) {
        const antes = chanceDo(victimSide);
        alive[victimSide].delete(victim);
        deathSwing = (chanceDo(victimSide) - antes) * 100;
        alive[victimSide].add(victim);
        killSwingInimigo = -deathSwing;
      } else {
        deathSwing = deathLegacy;
      }
      addSwing(roundSwing, victim, deathSwing);
      if (ataque) anotar(victim, `mo${rotulo(victimSide)}`, deathSwing);

      const killer = event.killer;
      if (killer && sideByPuuid.has(killer) && stats.has(killer)) {
        const killerSide = sideByPuuid.get(killer);
        const killerEnemySide = outro(killerSide);
        const killLegacy = globalThis.deltaKillPp(meta, alive[killerSide].size, alive[killerEnemySide].size);
        addSwing(legacySwing, killer, killLegacy);
        if (killerSide === victimSide) {
          // abate em aliado: como hoje em todas as variantes
          diag.global.abatesAliado += 1;
          if (killer === victim) diag.global.suicidios += 1;
          else if (plantio !== null && Math.abs(event.time - (plantio + 45000)) <= 1000) diag.global.aliadoNaExplosao += 1;
          diag.global.swingAliado += killLegacy;
          if (cfg.aliadoNegativo) {
            // Decisão do dono em 21/11: quem matou o aliado leva a perda inteira do
            // time (quem morreu não perde nada) e os vivos do rival dividem o ganho.
            // Suicídio (queda, a própria habilidade): quem morreu fica com a perda.
            if (killer !== victim) {
              addSwing(roundSwing, victim, -deathSwing);
              anotar(victim, "aliado", -deathSwing);
              addSwing(roundSwing, killer, deathSwing);
              anotar(killer, "aliado", deathSwing);
            }
            const rivais = [...alive[enemySide]].filter((puuid) => roundSwing.has(puuid));
            for (const puuid of rivais) {
              addSwing(roundSwing, puuid, -deathSwing / rivais.length);
              anotar(puuid, "aliado", -deathSwing / rivais.length);
            }
          } else {
            addSwing(roundSwing, killer, killLegacy);
            anotar(killer, "aliado", killLegacy);
          }
        } else {
          diag.global.abatesInimigo += 1;
          const categoria = ataque ? `ab${rotulo(killerSide)}` : "";
          if (categoria) anotar(killer, `n${categoria[0].toUpperCase()}${categoria.slice(1)}`, 1);
          const credito = usaSpike ? killSwingInimigo : killLegacy;
          diag.global.creditoTotal += credito;
          const dano = cfg.dividirPeloDano ? danoDoRound?.get(victim) : null;
          const autores = dano ? [...dano.entries()].filter(([puuid, valor]) => valor > 0 && roundSwing.has(puuid)) : [];
          const totalDano = autores.reduce((soma, [, valor]) => soma + valor, 0);
          if (cfg.dividirPeloDano && totalDano > 0) {
            if (!autores.some(([puuid]) => puuid === killer)) diag.global.abatesQuemMatouSemDano += 1;
            if (autores.length > 1 || autores[0][0] !== killer) diag.global.abatesDivididos += 1;
            let parteDeQuemMatou = 0;
            for (const [puuid, valor] of autores) {
              const parte = (credito * valor) / totalDano;
              addSwing(roundSwing, puuid, parte);
              if (puuid === killer) parteDeQuemMatou += parte;
              else anotar(puuid, "recebido", parte);
            }
            if (categoria) anotar(killer, categoria, parteDeQuemMatou);
            anotar(killer, "cedido", credito - parteDeQuemMatou);
            diag.global.creditoCedido += credito - parteDeQuemMatou;
          } else {
            if (cfg.dividirPeloDano) diag.global.abatesSemDano += 1;
            addSwing(roundSwing, killer, credito);
            if (categoria) anotar(killer, categoria, credito);
          }
        }
      } else {
        diag.global.abatesSemAutor += 1;
        if (cfg.aliadoNegativo) {
          const rivais = [...alive[enemySide]].filter((puuid) => roundSwing.has(puuid));
          for (const puuid of rivais) {
            addSwing(roundSwing, puuid, -deathSwing / rivais.length);
            anotar(puuid, "aliado", -deathSwing / rivais.length);
          }
        }
      }

      alive[victimSide].delete(victim);
      if (cfg.cortarNoFim && ataque) {
        const defesa = outro(ataque);
        if (vivosEm(defesa) === 0 || (vivosEm(ataque) === 0 && !plantada)) acabou = true;
      }
    }

    const winningTeam = ["Blue", "Red"].includes(round.winningTeam) ? round.winningTeam : "";
    if (winningTeam) {
      const losingTeam = outro(winningTeam);
      const winnerAlive = alive[winningTeam];
      const loserAlive = alive[losingTeam];
      const winnerParticipants = [...participants].filter((puuid) => sideByPuuid.get(puuid) === winningTeam);
      const loserParticipants = [...participants].filter((puuid) => sideByPuuid.get(puuid) === losingTeam);
      const winnerCreditTargets = (winnerAlive.size ? [...winnerAlive] : winnerParticipants).filter((puuid) => roundSwing.has(puuid));
      const loserDebitTargets = (loserAlive.size ? [...loserAlive] : loserParticipants).filter((puuid) => roundSwing.has(puuid));
      const chanceFinal = usaSpike ? chanceDo(winningTeam) : globalThis.stateWinRate(meta, winnerAlive.size, loserAlive.size);
      const residual = Math.max(0, (1 - chanceFinal) * 100);
      if (residual > 0 && winnerCreditTargets.length && loserDebitTargets.length) {
        const credit = residual / winnerCreditTargets.length;
        const debit = residual / loserDebitTargets.length;
        winnerCreditTargets.forEach((puuid) => {
          addSwing(roundSwing, puuid, credit);
          anotar(puuid, "residuo", credit);
        });
        loserDebitTargets.forEach((puuid) => {
          addSwing(roundSwing, puuid, -debit);
          anotar(puuid, "residuo", -debit);
        });
      }
    }

    const total = [...roundSwing.values()].reduce((sum, value) => sum + value, 0);
    if (Math.abs(total) > 1e-6 && roundSwing.size) {
      const correction = total / roundSwing.size;
      for (const puuid of roundSwing.keys()) {
        addSwing(roundSwing, puuid, -correction);
        anotar(puuid, "correcao", -correction);
      }
    }

    // Conta do time do ataque nos rounds com plantio: com a spike e sem crédito,
    // o salto do plantio não entra em lugar nenhum e o resíduo do fim do round o
    // passa para a defesa. Aqui se mede quanto.
    if (usaSpike && plantio !== null) {
      diag.global.roundsPlantados += 1;
      for (const [puuid, value] of roundSwing.entries()) if (sideByPuuid.get(puuid) === ataque) diag.global.swingDoAtaqueComPlantio += value;
    }

    for (const [puuid, value] of roundSwing.entries()) {
      if (!stats.has(puuid)) continue;
      stats.get(puuid).impactTotal += value;
      stats.get(puuid).adjustedRoundSwingTotalPp += value;
    }
    for (const [puuid, value] of legacySwing.entries()) {
      if (stats.has(puuid)) stats.get(puuid).impactTotalLegacy += value;
    }
  };
}

// ---------- Economia ----------
// Igual a createEcoModel, sem dividir pela média e sem o limite de 0,35 a 1,75.
function createEcoModelSemAjustes(killRows = []) {
  const counts = new Map();
  const observed = [];
  for (const row of killRows || []) {
    const attackerBucket = row.attackerBucket || row.killerBucket;
    const victimBucket = row.victimBucket;
    if (!attackerBucket || !victimBucket) continue;
    const key = `${attackerBucket}|${victimBucket}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    observed.push({ attackerBucket, victimBucket });
  }
  if (!observed.length) return { counts, multipliers: new Map(), meanRaw: 1, hasObservedEco: false };
  const labels = Core.ECO_BUCKETS.map((bucket) => bucket.label);
  const multipliers = new Map();
  for (const attacker of labels) {
    for (const victim of labels) {
      const forward = counts.get(`${attacker}|${victim}`) || 0;
      const reverse = counts.get(`${victim}|${attacker}`) || 0;
      const pDuel = forward + reverse ? forward / (forward + reverse) : 0.5;
      multipliers.set(`${attacker}|${victim}`, 2.095 - 2.074 * pDuel);
    }
  }
  const meanRaw = observed.reduce((sum, row) => sum + multipliers.get(`${row.attackerBucket}|${row.victimBucket}`), 0) / observed.length;
  return { counts, multipliers, meanRaw, hasObservedEco: true };
}

function criarReduced(cfg) {
  return function reducedEcoMultiplierEstudo(multiplier, strength) {
    if (strength === 0.5 && cfg.danoInteiro) return Core.finiteNumber(multiplier, 1);
    if (strength === 0.35 && cfg.kastSemAjuste) return 1;
    return ORIGINAL.reducedEcoMultiplier(multiplier, strength);
  };
}

// ---------- Rodar uma variante ----------
const CAMPOS = [
  "rounds", "eKillPoints", "eDeathPoints", "eDamageTotal", "eKastPoints", "adjustedRoundSwingTotalPp", "multiKillPoints",
  "firstKills", "firstDeaths", "tradeDenials", "tradedDeaths", "failedTradeDeaths", "savedLossRounds", "survivedWinRounds",
];

// Dano em cada vítima limitado à vida (100 + colete), com o excesso tirado
// primeiro de quem matou: a mesma conta de applyEffectiveDamage no app.js.
function danoLimitadoAVida(damageByVictim, armorExtraByPuuid, events) {
  const killerOfVictim = new Map();
  const killerTime = new Map();
  for (const event of events) {
    if (!event.victim || !event.killer) continue;
    const previous = killerTime.get(event.victim);
    if (previous === undefined || event.time > previous) {
      killerTime.set(event.victim, event.time);
      killerOfVictim.set(event.victim, event.killer);
    }
  }
  const saida = new Map();
  for (const [victim, byAttacker] of damageByVictim.entries()) {
    const rawTotal = [...byAttacker.values()].reduce((sum, value) => sum + value, 0);
    const effective = new Map(byAttacker);
    saida.set(victim, effective);
    if (rawTotal <= 0) continue;
    const cap = 100 + (armorExtraByPuuid.get(victim) ?? 50);
    let over = rawTotal - cap;
    if (over <= 0) continue;
    let last = killerOfVictim.get(victim);
    if (!last || !effective.has(last)) last = [...effective.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (last) {
      const take = Math.min(over, effective.get(last) || 0);
      effective.set(last, Math.max(0, (effective.get(last) || 0) - take));
      over -= take;
    }
    if (over > 0) {
      for (const [attacker, value] of [...effective.entries()].sort((a, b) => b[1] - a[1])) {
        if (attacker === last || over <= 0) continue;
        const take = Math.min(over, value);
        effective.set(attacker, Math.max(0, value - take));
        over -= take;
      }
    }
  }
  return saida;
}

function instalar(cfg) {
  globalThis.applyRoundSwingStats = cfg.reescrito ? criarSwing(cfg) : ORIGINAL.applyRoundSwingStats;
  globalThis.applyEffectiveDamage = function applyEffectiveDamageEstudo(damageByVictim, armorExtraByPuuid, events, ...resto) {
    danoDoRound = cfg.danoLimitado ? danoLimitadoAVida(damageByVictim, armorExtraByPuuid, events) : damageByVictim;
    return ORIGINAL.applyEffectiveDamage(damageByVictim, armorExtraByPuuid, events, ...resto);
  };
  Core.createEcoModel = cfg.modeloSemAjustes ? createEcoModelSemAjustes : ORIGINAL.createEcoModel;
  Core.reducedEcoMultiplier = criarReduced(cfg);
  // Nota pelos β: o app.js só chama RaaRatingCore.applyRatingFields (mapa,
  // campeonato, carreira, equipe), então trocar a nota ali basta.
  if (cfg.pesosHltv && cfg.centro) {
    Core.applyRatingFields = function applyRatingFieldsEstudo(row) {
      ORIGINAL.applyRatingFields(row);
      const nota = notaBeta(row, cfg.centro, cfg.betas);
      row.raating_3 = nota;
      row.rating = nota;
      row.rating_3_like = nota;
      return row;
    };
  } else {
    Core.applyRatingFields = ORIGINAL.applyRatingFields;
  }
}

function restaurar() {
  globalThis.applyRoundSwingStats = ORIGINAL.applyRoundSwingStats;
  globalThis.applyEffectiveDamage = ORIGINAL.applyEffectiveDamage;
  Core.createEcoModel = ORIGINAL.createEcoModel;
  Core.reducedEcoMultiplier = ORIGINAL.reducedEcoMultiplier;
  Core.applyRatingFields = ORIGINAL.applyRatingFields;
}

// Linhas de referência (pessoa, evento) pelo parseMatchFile do app.js.
function linhasDeReferencia(ratingMetadata) {
  const linhas = new Map();
  for (const file of files) {
    const match = globalThis.parseMatchFile(file, ratingMetadata);
    if (!match) continue;
    for (const player of match.players) {
      linhas.set(`${match.id}|${player.puuid}`, {
        matchId: match.id,
        eventId: match.eventId,
        puuid: player.puuid,
        id: player.id,
        nick: player.nick,
        teamId: player.teamId,
        startedAt: match.startedAt,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        damage: player.damage,
        kastRounds: player.kastRounds,
        raating_3: player.raating_3,
        raating_1: player.raating_1,
        ...Object.fromEntries(CAMPOS.map((campo) => [campo, player[campo]])),
      });
    }
  }
  return linhas;
}

function rodar(nome, cfg, referencia) {
  const t0 = Date.now();
  zerarDiag();
  instalar(cfg);
  const raatingContext = globalThis.buildRaatingContext(files);
  const ratingMetadata = { ...metadata, raatingContext };
  const linhas = {};
  for (const file of files) {
    partidaAtual = file.raw.matchInfo.matchId;
    const stats = globalThis.aggregateMatchPlayerRoundStats(file.raw.players || [], globalThis.officialRoundResults(file.raw), ratingMetadata);
    for (const [puuid, agg] of stats.entries()) {
      const chave = `${partidaAtual}|${puuid}`;
      const base = referencia.get(chave);
      if (!base) continue;
      const row = { rounds: base.rounds };
      for (const campo of CAMPOS) if (campo !== "rounds") row[campo] = agg[campo];
      const nota = Core.calculateRaating3(row);
      linhas[chave] = [nota.raating_3, ...CAMPOS.map((campo) => row[campo])];
    }
  }
  restaurar();
  const porJogador = Object.fromEntries(diag.porJogador);
  console.log(`${nome}: ${Object.keys(linhas).length} linhas em ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(diag.global));
  return { cfg, linhas, diag: diag.global, porJogador, eco: { meanRaw: raatingContext.ecoModel.meanRaw, multiplicadores: Object.fromEntries(raatingContext.ecoModel.multipliers), contagens: Object.fromEntries(raatingContext.ecoModel.counts) } };
}

const VARIANTES = {
  atual: {},
  controle: { reescrito: true },
  v1_dano: { reescrito: true, dividirPeloDano: true },
  v1_dano_limitado: { reescrito: true, dividirPeloDano: true, danoLimitado: true },
  v2_spike: { reescrito: true, spike: true },
  v2_spike_plantio: { reescrito: true, spike: true, creditoPlantio: true },
  v3_eco: { modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true },
  v3a_modelo: { modeloSemAjustes: true },
  v3b_dano: { danoInteiro: true },
  v3c_kast: { kastSemAjuste: true },
  todas: { reescrito: true, dividirPeloDano: true, spike: true, modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true },
  todas_plantio: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: true, modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true },
  v12: { reescrito: true, dividirPeloDano: true, spike: true },
  // o salto do plantio dividido entre os vivos do ataque, cobrado dos vivos da defesa
  v2_spike_time: { reescrito: true, spike: true, creditoPlantio: "time" },
  // Decisões de 21/11 sobre 1 + 2 + 3: o swing fecha no fim do round, e o abate em aliado pune quem matou.
  final_fim: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, cortarNoFim: true },
  final_aliado: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, aliadoNegativo: true },
  final: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, cortarNoFim: true, aliadoNegativo: true },
  todas_time: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true },
  // Com a nota pelos β da HLTV (nota_beta.js). As contagens são as da variante
  // base, então o main() não as grava de novo; comparar_variantes.js as deriva e
  // ranking_variantes.js troca o applyRatingFields com o centro do grupo.
  pesos: { pesosHltv: true },
  pesos_dano: { reescrito: true, dividirPeloDano: true, pesosHltv: true },
  pesos_spike: { reescrito: true, spike: true, pesosHltv: true },
  pesos_dano_spike: { reescrito: true, dividirPeloDano: true, spike: true, pesosHltv: true },
  pesos_todas: { reescrito: true, dividirPeloDano: true, spike: true, modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, pesosHltv: true },
  // Teste dos pesos (20/11): β convertidos pelo desvio e β com o dano pela vida,
  // sobre as contagens de 1 + 2 + 3; os pesos vêm de betas_convertidos.json.
  convertidos_todas_time: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, pesosHltv: true, betasDe: "todas_time" },
  vida_todas_time: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, pesosHltv: true, betasDe: "vida_todas_time" },
  vida_final: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, cortarNoFim: true, aliadoNegativo: true, pesosHltv: true, betasDe: "vida_todas_time" },
  dpa_todas_time: { reescrito: true, dividirPeloDano: true, spike: true, creditoPlantio: "time", modeloSemAjustes: true, danoInteiro: true, kastSemAjuste: true, pesosHltv: true, betasDe: "dpa_todas_time" },
};

function main() {
  const [arquivoTabela, saida] = process.argv.slice(2);
  if (!arquivoTabela || !saida) {
    console.error("uso: node scripts/estudos/raating_variantes.js <chance_spike.json> <saida.json>");
    process.exit(2);
  }
  const inicio = Date.now();
  const carregado = carregar();
  configurar({ files: carregado.files, metadata: carregado.metadata, tabelaSpike: JSON.parse(fs.readFileSync(arquivoTabela, "utf8")).porLado });

  restaurar();
  const contextoAtual = globalThis.buildRaatingContext(files);
  const referencia = linhasDeReferencia({ ...metadata, raatingContext: contextoAtual });
  console.log(`carregado: ${carregado.resumo.arquivos} partidas, ${referencia.size} linhas de referência, ${((Date.now() - inicio) / 1000).toFixed(0)}s`);

  const resultado = { geradoEm: new Date().toISOString(), campos: ["raating_3", ...CAMPOS], referencia: Object.fromEntries(referencia), variantes: {} };
  for (const [nome, cfg] of Object.entries(VARIANTES)) {
    if (cfg.pesosHltv) continue;
    resultado.variantes[nome] = rodar(nome, cfg, referencia);
  }

  // Controles: a referência do parseMatchFile, o "atual" pelo caminho enxuto e o
  // swing reescrito sem chaves têm de dar a mesma nota em todas as linhas.
  const maiorDiferenca = (a, b) => {
    let maior = 0;
    for (const [chave, linha] of Object.entries(resultado.variantes[a].linhas)) {
      const outra = b === "referencia" ? referencia.get(chave).raating_3 : resultado.variantes[b].linhas[chave][0];
      maior = Math.max(maior, Math.abs(linha[0] - outra));
    }
    return maior;
  };
  resultado.controles = {
    atual_x_referencia: maiorDiferenca("atual", "referencia"),
    controle_x_atual: maiorDiferenca("controle", "atual"),
    v1_x_atual: maiorDiferenca("v1_dano", "atual"),
  };
  console.log("controles (maior diferença de nota):", JSON.stringify(resultado.controles));
  fs.writeFileSync(saida, JSON.stringify(resultado));
  console.log(`gravado em ${saida} (${((Date.now() - inicio) / 1000).toFixed(0)}s)`);
}

module.exports = { VARIANTES, CAMPOS, configurar, instalar, restaurar, rodar, linhasDeReferencia };
if (require.main === module) main();
