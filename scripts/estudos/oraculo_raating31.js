// Estudo de 22/11/2026 (fora do build): o oráculo do rAAting 3.1.
//
// Roda, com o app.js de ANTES da implementação, a variante `final` do estudo
// (crédito pelo dano, tabela com spike, plantio para os vivos do ataque, fim do
// round, abate em aliado, economia sem ajustes) e grava a nota esperada de cada
// linha jogador x mapa: 1 + Σ β·(x − x̄), com os β da estimativa, o do dano ÷ 1,5
// e x̄ = a média do grupo de todas as linhas. Guarda também o rAAting 1.0 de hoje
// de cada linha, que a implementação não pode mudar, a média do grupo e a tabela
// com spike. O conferidor (conferir_raating31.js) compara o banco novo com isto.
//
// Uso: node --max-old-space-size=12000 scripts/estudos/oraculo_raating31.js <pasta de saída>
// Tem de rodar num commit em que o app.js ainda é o do rAAting 3.0.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const pasta = process.argv[2];
if (!pasta) {
  console.error("uso: node scripts/estudos/oraculo_raating31.js <pasta de saída>");
  process.exit(2);
}
fs.mkdirSync(pasta, { recursive: true });
const inicio = Date.now();

// 1. a tabela com spike, pela regra do estudo
const arqTabela = path.join(pasta, "chance_spike.json");
execFileSync(process.execPath, ["--max-old-space-size=12000", path.join(__dirname, "medir_chance_spike.js"), arqTabela], { stdio: "inherit" });
const tabelaSpike = JSON.parse(fs.readFileSync(arqTabela, "utf8")).porLado;

// 2. as partidas e o app.js de hoje
const { carregar, ROOT } = require("./carregar_univlr.js");
const { BETA, centroDoGrupo, notaBeta } = require("./nota_beta.js");
const { VARIANTES, CAMPOS, configurar, restaurar, rodar, linhasDeReferencia } = require("./raating_variantes.js");
const carregado = carregar();
configurar({ files: carregado.files, metadata: carregado.metadata, tabelaSpike });

// 3. as linhas de referência com o código de hoje (daí sai o rAAting 1.0 de hoje)
restaurar();
const contextoHoje = globalThis.buildRaatingContext(carregado.files);
const referencia = linhasDeReferencia({ ...carregado.metadata, raatingContext: contextoHoje });

// 4. a variante final e a nota 3.1
const final = rodar("final", VARIANTES.final, referencia);
const contagens = Object.fromEntries(Object.entries(final.linhas).map(([chave, v]) => [chave, Object.fromEntries(CAMPOS.map((campo, i) => [campo, v[i + 1]]))]));
const centro = centroDoGrupo(Object.values(contagens));
const betas = { ...BETA, dano: BETA.dano / 1.5 };
const linhas = {};
let somaPesada = 0;
let somaRounds = 0;
for (const [chave, c] of Object.entries(contagens)) {
  const raating31 = notaBeta(c, centro, betas);
  linhas[chave] = { raating_31: raating31, raating_1: referencia.get(chave).raating_1, rounds: c.rounds };
  somaPesada += raating31 * c.rounds;
  somaRounds += c.rounds;
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const saida = { geradoEm: new Date().toISOString(), commit, partidas: carregado.resumo.arquivos, centro, tabelaSpike, linhas };
fs.writeFileSync(path.join(pasta, "oraculo.json"), JSON.stringify(saida));
console.log(`oráculo: ${Object.keys(linhas).length} linhas de ${carregado.resumo.arquivos} partidas, commit ${commit.slice(0, 7)}`);
console.log(`controle: média pesada da nota 3.1 = ${(somaPesada / somaRounds).toFixed(12)} (tem de ser 1)`);
console.log("centro:", JSON.stringify(centro));
console.log(`${((Date.now() - inicio) / 1000).toFixed(0)}s`);
