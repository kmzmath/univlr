// Baixa do tracker o detalhe de partidas cujo UUID já se conhece (ex.: as do
// nosso acervo da Riot, para servir de controle do conversor).
//
// Uso: node ferramentas/tracker-campeonato/baixar_detalhes.cjs <pasta-destino> <uuid>...
//
// Mesmo ritmo do coletar.cjs (ritmo.cjs). Qualquer resposta que não seja 200
// com o id pedido encerra o script; o que já foi gravado fica.

const fs = require("fs");
const path = require("path");
const { conectar, abaDo } = require("./cdp.cjs");
const ritmo = require("./ritmo.cjs");

const API = "https://api.tracker.gg/api/v2/valorant/standard/matches/";

async function main() {
  const [destino, ...uuids] = process.argv.slice(2);
  if (!destino || !uuids.length) throw new Error("Uso: baixar_detalhes.cjs <pasta-destino> <uuid>...");
  fs.mkdirSync(destino, { recursive: true });
  const { browser, context } = await conectar();
  const page = await abaDo(context, "tracker.gg", "https://tracker.gg/valorant");
  try {
    for (const uuid of uuids) {
      const arquivo = path.join(destino, `${uuid}.json`);
      if (fs.existsSync(arquivo)) continue;
      await ritmo.esperar((...p) => console.log(...p));
      ritmo.marcar();
      const r = await page.evaluate(async (url) => {
        const resp = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
        return { status: resp.status, texto: await resp.text() };
      }, API + uuid);
      let id = null;
      try { id = JSON.parse(r.texto)?.data?.attributes?.id; } catch { /* HTML */ }
      console.log(new Date().toISOString(), r.status, uuid);
      if (r.status !== 200 || id !== uuid) throw new Error(`HTTP ${r.status} para ${uuid}: ${r.texto.slice(0, 200)}`);
      const fd = fs.openSync(arquivo + ".tmp", "w");
      try {
        fs.writeSync(fd, r.texto);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(arquivo + ".tmp", arquivo);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
