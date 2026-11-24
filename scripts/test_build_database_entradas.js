// Entrada errada para o build_database.js em vez de virar dado errado no site.
//
// Uso: node scripts/test_build_database_entradas.js
//
// Cada caso e um defeito que antes passava com o build dizendo que deu certo
// (auditoria de 23/11/2026). Carrega o build como modulo, sem rodar o main().

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { checkMatchFiles, readJsonOptional } = require("./build_database.js");

const NOME = "campeonatos/AOC/AOC_007a_24-05-26_ceub_octopus_13_x_7_ufmt_turuna_haven.json";
const lados = (red, blue) => ({ teams: [{ teamId: "Red", roundsWon: red }, { teamId: "Blue", roundsWon: blue }] });
const arquivo = (raw, filePath = NOME) => ({ eventId: "aoc", path: filePath, raw });
const recusa = (loaded, trecho) =>
  assert.throws(() => checkMatchFiles(loaded), (erro) => erro.message.includes(trecho), `deveria recusar: ${trecho}`);

// O que esta certo passa, nas duas orientacoes de cor.
checkMatchFiles([arquivo(lados(13, 7)), arquivo(lados(7, 13))]);
// Nome compacto do Rivals nao tem placar: a cor sai dos jogadores.
checkMatchFiles([arquivo({ teams: lados(13, 7).teams }, "campeonatos/RivvalsGG/Rivals_001_a_puccXazr.json")]);

recusa([arquivo(lados(13, 8))], "placar do nome 13x7, no arquivo 13x8");
recusa([{ eventId: "aoc", path: NOME, error: new Error("Unexpected end of JSON input") }], "nao abriu");
recusa([arquivo(lados(13, 7), "campeonatos/AOC/sem_placar.json")], "nome fora do padrao");
recusa([arquivo({ teams: [{ teamId: "Red", roundsWon: 13 }] })], "sem as equipes Red e Blue");
// Um problema no meio do lote para o lote inteiro.
recusa([arquivo(lados(13, 7)), arquivo(lados(2, 13))], "no arquivo 2x13");

// Opcional e so o arquivo que falta; JSON quebrado para o build.
assert.strictEqual(readJsonOptional("nao-existe-univlr.json"), null, "arquivo ausente segue opcional");
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "univlr-"));
const quebrado = path.join(pasta, "pesos.json");
fs.writeFileSync(quebrado, '{"tournaments": {');
assert.throws(() => readJsonOptional(path.relative(path.resolve(__dirname, ".."), quebrado)), SyntaxError, "JSON quebrado para o build");
fs.rmSync(pasta, { recursive: true, force: true });

console.log("ok: build_database recusa 5 tipos de entrada errada e aceita as certas");
