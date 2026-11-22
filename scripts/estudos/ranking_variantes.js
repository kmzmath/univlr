// Estudo de 20/11/2026 (fora do build): roda o buildDatabase inteiro do app.js em
// memória com uma variante do rAAting (raating_variantes.js) e grava só o ranking
// de equipes, para medir o efeito da nota no bloco de força do elenco (5% do
// ranking). Não grava database.json, home.json nem metadata.json.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/ranking_variantes.js <chance_spike.json> <variante> <saida.json>
// Cada variante roda num processo próprio, para nenhuma mutação de uma rodada vazar na outra.

const fs = require("fs");
const path = require("path");
const { carregar, ROOT } = require("./carregar_univlr.js");
const { VARIANTES, configurar, instalar, restaurar } = require("./raating_variantes.js");
const { centroDoGrupo } = require("./nota_beta.js");

const [arquivoTabela, nome, saida] = process.argv.slice(2);
if (!arquivoTabela || !VARIANTES[nome] || !saida) {
  console.error(`uso: node scripts/estudos/ranking_variantes.js <chance_spike.json> <${Object.keys(VARIANTES).join("|")}> <saida.json>`);
  process.exit(2);
}

const inicio = Date.now();
const { files, metadata, manifest, readJson } = carregar();
configurar({ files, metadata, tabelaSpike: JSON.parse(fs.readFileSync(arquivoTabela, "utf8")).porLado });
const teamProfiles = globalThis.prepareTeamProfiles(fs.existsSync(path.join(ROOT, "team-profiles.json")) ? readJson("team-profiles.json") : null);
const rankingWeights = fs.existsSync(path.join(ROOT, "ranking-weights.json")) ? readJson("ranking-weights.json") : null;

let cfg = VARIANTES[nome];
let centro = null;
if (cfg.pesosHltv) {
  // Primeira passada: a média do grupo (x̄) com as contagens da variante, sobre
  // todas as linhas jogador x mapa que o build monta. Depois o build de verdade.
  instalar({ ...cfg, pesosHltv: false });
  const raatingContext = globalThis.buildRaatingContext(files);
  const linhas = files.flatMap((file) => globalThis.parseMatchFile(file, { ...metadata, raatingContext })?.players || []);
  restaurar();
  centro = centroDoGrupo(linhas);
  cfg = { ...cfg, centro };
  if (cfg.betasDe) {
    const arquivo = path.join(ROOT, "outputs", "estudo-raating-hltv-2026-11-20", "betas_convertidos.json");
    cfg.betas = JSON.parse(fs.readFileSync(arquivo, "utf8"))[cfg.betasDe];
    if (!cfg.betas) throw new Error(`pesos ${cfg.betasDe} não encontrados em ${arquivo}`);
    console.log(`pesos ${cfg.betasDe}:`, JSON.stringify(cfg.betas));
  }
  console.log(`centro do grupo (${linhas.length} linhas):`, JSON.stringify(centro));
}
instalar(cfg);
const db = globalThis.buildDatabase(manifest.events, files, metadata, teamProfiles, rankingWeights);
restaurar();

const resumoEquipe = (t) => ({ id: t.id, score: t.score, rank: t.rank, validRank: t.validRank, roster: t.blocks?.rosterStrength });
const resultado = {
  variante: nome,
  geradoEm: new Date().toISOString(),
  atual: (db.ranking.teams || []).map(resumoEquipe),
  semanas: (db.rankingSnapshots || []).map((s) => ({ cutoffAt: s.cutoffAt, label: s.label, teams: (s.teams || []).map(resumoEquipe) })),
  nomes: Object.fromEntries((db.teams || []).map((t) => [t.id, t.name])),
};
fs.writeFileSync(saida, JSON.stringify(resultado));
console.log(`${nome}: ${resultado.atual.length} equipes, ${resultado.semanas.length} semanas, ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
