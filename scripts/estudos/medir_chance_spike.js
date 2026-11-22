// Estudo de 20/11/2026 (fora do build): mede nas partidas do site a chance de o
// ataque vencer o round por (vivos do ataque, vivos da defesa, spike plantada),
// e a tabela simétrica de hoje (meus vivos x vivos do rival) para conferir com a
// de metadata.json.
//
// Uso: node scripts/estudos/medir_chance_spike.js <saida.json>
//
// Mesmas regras do swing do app.js, para a tabela servir a ele:
// - vivos no início = elenco do lado na partida (rosters), como em applyRoundSwingStats;
// - abates deduplicados por tempo|quem matou|vítima; cada vítima morre uma vez;
// - o plantio entra no tempo plantRoundTime, antes de um abate no mesmo instante;
// - depois do desarme, da explosão (plantio + 45 s) ou da eliminação, nada conta;
// - cada situação conta uma vez por round (como ferramentas/estudos/medir-chance.js do Hub CS2).

const fs = require("fs");
const { carregar } = require("./carregar_univlr.js");

const SPIKE_MS = 45000;
const saida = process.argv[2];
if (!saida) {
  console.error("uso: node scripts/estudos/medir_chance_spike.js <saida.json>");
  process.exit(2);
}

const inicio = Date.now();
const { files, metadata, resumo } = carregar();

const porLado = { visitas: {}, vitorias: {} };
const simetrica = { visitas: {}, vitorias: {} };
const somar = (cont, chave, venceu) => {
  cont.visitas[chave] = (cont.visitas[chave] || 0) + 1;
  cont.vitorias[chave] = (cont.vitorias[chave] || 0) + (venceu ? 1 : 0);
};
const contagem = { rounds: 0, semLado: 0, comPlantio: 0, roundsComElencoMaiorQue5: 0, ataqueVenceu: 0 };

for (const file of files) {
  const raw = file.raw;
  const sideByPuuid = new Map();
  const rosters = { Blue: new Set(), Red: new Set() };
  for (const player of raw.players || []) {
    if (player.isObserver || !["Blue", "Red"].includes(player.teamId) || !player.puuid) continue;
    sideByPuuid.set(player.puuid, player.teamId);
    rosters[player.teamId].add(player.puuid);
  }
  for (const round of globalThis.officialRoundResults(raw)) {
    const venc = round.winningTeam;
    const papel = round.winningTeamRole;
    if (!["Blue", "Red"].includes(venc) || !["Attacker", "Defender"].includes(papel)) {
      contagem.semLado += 1;
      continue;
    }
    contagem.rounds += 1;
    const outro = venc === "Blue" ? "Red" : "Blue";
    const ataque = papel === "Attacker" ? venc : outro;
    const defesa = ataque === "Blue" ? "Red" : "Blue";
    const ataqueVenceu = papel === "Attacker";
    if (ataqueVenceu) contagem.ataqueVenceu += 1;
    if (rosters.Blue.size > 5 || rosters.Red.size > 5) contagem.roundsComElencoMaiorQue5 += 1;

    const eventos = [];
    const vistos = new Set();
    for (const row of round.playerStats || []) {
      for (const kill of row.kills || []) {
        const t = kill.timeSinceRoundStartMillis;
        if (t === null || t === undefined) continue;
        const victim = String(kill.victim || "");
        if (!victim || !sideByPuuid.has(victim)) continue;
        let killer = String(kill.killer || "");
        if (!killer || !sideByPuuid.has(killer)) killer = "";
        const chave = `${Number(t)}|${killer}|${victim}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        eventos.push({ tipo: "morte", t: Number(t), victim });
      }
    }
    const plantio = round.bombPlanter && Number.isFinite(Number(round.plantRoundTime)) ? Number(round.plantRoundTime) : null;
    if (plantio !== null) {
      eventos.push({ tipo: "plantio", t: plantio, ordem: -1 });
      contagem.comPlantio += 1;
    }
    const fim = round.bombDefuser && Number.isFinite(Number(round.defuseRoundTime)) ? Number(round.defuseRoundTime) : plantio !== null ? plantio + SPIKE_MS : Infinity;
    eventos.sort((a, b) => a.t - b.t || (a.ordem ?? 0) - (b.ordem ?? 0));

    const vivos = { Blue: new Set(rosters.Blue), Red: new Set(rosters.Red) };
    let plantada = false;
    const vistosLado = new Set();
    const vistosSim = new Set();
    const marcar = () => {
      const a = vivos[ataque].size;
      const d = vivos[defesa].size;
      if (d > 0 && (a > 0 || plantada)) vistosLado.add(`${a}v${d}${plantada ? "b" : ""}`);
      if (a > 0 && d > 0) {
        vistosSim.add(`${a}v${d}|${ataque}`);
        vistosSim.add(`${d}v${a}|${defesa}`);
      }
    };
    marcar();
    for (const e of eventos) {
      if (e.t > fim) break;
      if (e.tipo === "plantio") plantada = true;
      else {
        const lado = vivos.Blue.has(e.victim) ? "Blue" : vivos.Red.has(e.victim) ? "Red" : "";
        if (!lado) continue;
        vivos[lado].delete(e.victim);
      }
      marcar();
      if (vivos[defesa].size === 0 || (vivos[ataque].size === 0 && !plantada)) break;
    }
    for (const chave of vistosLado) somar(porLado, chave, ataqueVenceu);
    for (const v of vistosSim) {
      const [chave, quem] = v.split("|");
      somar(simetrica, chave, quem === venc);
    }
  }
}

const tabela = (cont) => {
  const t = {};
  for (const chave of Object.keys(cont.visitas).sort()) t[chave] = { n: cont.visitas[chave], p: cont.vitorias[chave] / cont.visitas[chave] };
  return t;
};
const tabelaMetadata = Object.fromEntries((metadata.stateWinrates || []).map((row) => [`${row.allies}v${row.enemies}`, Number(row.winRate)]));
const resultado = {
  geradoEm: new Date().toISOString(),
  resumo: { ...resumo, ...contagem },
  porLado: tabela(porLado),
  simetrica: tabela(simetrica),
  metadata: tabelaMetadata,
};
fs.writeFileSync(saida, JSON.stringify(resultado, null, 1));

const pct = (x) => (x === undefined ? "  -  " : `${(100 * x).toFixed(1)}%`);
console.log("partidas", resumo.arquivos, "| rounds", contagem.rounds, "| sem lado", contagem.semLado, "| com plantio", contagem.comPlantio, "| elenco > 5", contagem.roundsComElencoMaiorQue5);
console.log("ataque vence", pct(contagem.ataqueVenceu / contagem.rounds));
console.log("controle de referência (20/11): 1v1 39% sem e 63% com; 2v2 46% e 62%");
for (const k of ["1v1", "2v2", "3v3", "4v4", "5v5"]) {
  console.log(k, "sem", pct(resultado.porLado[k]?.p), `(${resultado.porLado[k]?.n})`, "com", pct(resultado.porLado[`${k}b`]?.p), `(${resultado.porLado[`${k}b`]?.n})`);
}
console.log("simétrica medida x metadata:");
let maior = 0;
for (const [k, v] of Object.entries(resultado.simetrica)) {
  const m = tabelaMetadata[k];
  if (m === undefined) continue;
  maior = Math.max(maior, Math.abs(v.p - m));
}
console.log("maior diferença", (100 * maior).toFixed(2), "pontos; 5v4", pct(resultado.simetrica["5v4"]?.p), "x", pct(tabelaMetadata["5v4"]), "| 2v1", pct(resultado.simetrica["2v1"]?.p), "x", pct(tabelaMetadata["2v1"]));
console.log(`${((Date.now() - inicio) / 1000).toFixed(0)}s`);
