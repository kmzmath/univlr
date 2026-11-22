// Estudo de 21/11/2026 (fora do build): separa o arquivo único que o coletor da
// HLTV salva (hltv_coleta_grande.json, na pasta Downloads) nos dois CSV que
// comparar_hltv_grande.js lê, com cabeçalho.
//
// Uso: node scripts/estudos/separar_coleta_hltv.js <hltv_coleta_grande.json> <pasta de saída>

const fs = require("fs");
const path = require("path");

const [entrada, pasta] = process.argv.slice(2);
if (!entrada || !pasta) {
  console.error("uso: node scripts/estudos/separar_coleta_hltv.js <hltv_coleta_grande.json> <pasta de saída>");
  process.exit(2);
}
const d = JSON.parse(fs.readFileSync(entrada, "utf8"));
const jogadores = path.join(pasta, "hltv_jogadores_grande.csv");
const mapas = path.join(pasta, "hltv_mapas.csv");
fs.writeFileSync(jogadores, [d.colunasJogadores, ...d.jogadores].join("\n") + "\n");
fs.writeFileSync(mapas, [d.colunasMapas, ...d.mapas].join("\n") + "\n");
const nMapas = new Set(d.mapas.map((l) => l.split(",")[0])).size;
console.log(`gerado em ${d.geradoEm} (${d.motivo}); período ${d.periodo}`);
console.log(`${d.jogadores.length} jogadores -> ${jogadores}`);
console.log(`${d.mapas.length} linhas de ${nMapas} mapas (${d.paginasDeMapas.length} páginas da lista) -> ${mapas}`);
console.log(`ocorrências no registro do coletor: ${d.log.length}`, d.log.slice(-5));
