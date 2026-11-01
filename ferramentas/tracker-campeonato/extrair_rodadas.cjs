// Grava a estrutura das chaves de um torneio do Challengermode: cada chave
// (superior, inferior, final) com as rodadas na ordem e o número (Ordinal) das
// partidas de cada rodada. O cm.json tem as partidas, mas não a rodada de cada
// uma, e a numeração muda de uma edição para outra.
//
// Uso: node ferramentas/tracker-campeonato/extrair_rodadas.cjs <pasta-com-cm.json>
// Grava <pasta>/rodadas.json.

const fs = require("fs");
const path = require("path");
const { conectar, abaDo } = require("./cdp.cjs");

async function main() {
  const pasta = process.argv[2];
  const cm = JSON.parse(fs.readFileSync(path.join(pasta, "cm.json"), "utf8"));
  const base = cm.fonte;
  const { browser, context } = await conectar();
  try {
    const page = await abaDo(context, "challengermode.com", base + "/brackets/1");
    await page.goto(base + "/brackets/1", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForFunction(() => typeof window._cm?.loadObject === "function" && window._cm.store?._objects?.size > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(3000);
    const chaves = await page.evaluate(async ({ tid, ids }) => {
      const L = (ns, id) => window._cm.loadObject(ns, id);
      const saida = [];
      for (const id of ids) {
        const b = await L("tournament_bracket2", id);
        const rodadas = [];
        for (const rodada of b.Match2Ids || []) {
          const mts = await Promise.all((Array.isArray(rodada) ? rodada : [rodada]).map((m) => L("tournament_match2", m)));
          rodadas.push(mts.map((m) => m?.Ordinal ?? null));
        }
        // Fase de grupos (tipo 6): a classificação oficial vem do grupo, já na
        // ordem final da plataforma (TeamScores: [pontos, vitórias, ..., saldo
        // de rounds no índice 4, ..., derrotas no índice 8, ...]).
        const grupos = [];
        for (const gid of b.GroupIds || []) {
          const g = await L("tournament_group", gid);
          if (g) grupos.push({ id: gid, avancam: g.MinimumAdvancingTeamCount ?? null, encontros: g.Encounters ?? null, pontuacao: g.Scores ?? null, tabela: g.TeamScores ?? [] });
        }
        saida.push({ id, tipo: b.Type, eliminacao: b.IsElimination, etapa: b.StageIndex, rounds: b.Rounds ?? null, rodadas, grupos });
      }
      return saida;
    }, { tid: cm.torneio.id, ids: cm.torneio.chaves.map((c) => c.id) });
    fs.writeFileSync(path.join(pasta, "rodadas.json"), JSON.stringify({ torneio: cm.torneio.id, chaves }, null, 1));
    for (const c of chaves) console.log(`chave tipo ${c.tipo}: ${c.rodadas.map((r) => `[${r[0]}-${r[r.length - 1]}]`).join(" ")}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
