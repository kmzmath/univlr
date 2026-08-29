// Reescreve TROPHY_ART_FILES em app.js com a arte de trofeu POR CAMPEONATO que
// existe de fato em assets/trofeus-campeonatos/.
//
// Uso: node scripts/build_trophy_manifest.js
//
// Por que existe: trophyImageCandidates monta ate seis nomes por podio (id e
// slug do campeonato, cruzados com -campeao/_campeao/.png) e tentava cada um no
// navegador, via onerror, ate cair no generico. Medido em 28/08/2026: 225
// candidatos entre os 18 campeonatos e os tres podios, e 225 falhando - 100%,
// porque so os tres arquivos genericos existem. Na pratica eram 36 requisicoes
// 404 numa unica pagina de equipe.
//
// A alternativa era apagar a cadeia e servir sempre o generico, mas isso mataria
// a conveniencia real de largar um arquivo na pasta e ele aparecer. O manifesto
// mantem a conveniencia e cobra um passo: depois de adicionar arte, rode este
// script. E o mesmo contrato dos outros scripts que mantem artefato commitado.
//
// Rodar duas vezes nao muda um byte.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PASTA = path.join(ROOT, "assets", "trofeus-campeonatos");
const APP = path.join(ROOT, "app.js");
const MARCA = "const TROPHY_ART_FILES = new Set([";

// Os tres genericos nao entram: eles sao o fim da fila, nao candidatos por
// campeonato. Se entrassem, o filtro os trataria como arte especifica.
const GENERICOS = new Set(["campeao-generico.png", "vice-generico.png", "terceiro-generico.png"]);

function main() {
  if (!fs.existsSync(PASTA)) {
    console.error(`ABORTADO - pasta nao existe: ${path.relative(ROOT, PASTA)}`);
    return false;
  }

  const arquivos = fs
    .readdirSync(PASTA)
    .filter((nome) => /\.(png|webp|jpg|jpeg)$/i.test(nome))
    .filter((nome) => !GENERICOS.has(nome))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const antes = fs.readFileSync(APP, "utf8");
  const ini = antes.indexOf(MARCA);
  if (ini === -1) {
    console.error(`ABORTADO - nao achei "${MARCA}" em app.js. O nome da constante mudou?`);
    return false;
  }
  const fim = antes.indexOf("]);", ini);
  if (fim === -1) {
    console.error("ABORTADO - nao achei o fechamento do Set em app.js.");
    return false;
  }

  const eol = antes.includes("\r\n") ? "\r\n" : "\n";
  const corpo = arquivos.length
    ? eol + arquivos.map((nome) => `  ${JSON.stringify(nome)},`).join(eol) + eol
    : "";
  const depois = antes.slice(0, ini) + MARCA + corpo + antes.slice(fim);

  // Verificacao antes de gravar: o arquivo tem de continuar parseando e a lista
  // lida de volta tem de ser exatamente a do disco.
  const lidos = [...depois.slice(ini, depois.indexOf("]);", ini)).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const checks = [
    ["a constante continua no arquivo", depois.includes(MARCA)],
    ["a lista gravada bate com o disco", lidos.length === arquivos.length && lidos.every((n, i) => n === arquivos[i])],
    ["nenhum generico entrou", !lidos.some((n) => GENERICOS.has(n))],
    ["o resto do arquivo nao mudou", depois.length - antes.length === corpo.length - (antes.slice(ini + MARCA.length, fim).length)],
  ];
  const falhas = checks.filter(([, ok]) => !ok);
  if (falhas.length) {
    console.error("ABORTADO - verificacao falhou:");
    for (const [nome] of falhas) console.error(`  x ${nome}`);
    return false;
  }

  if (depois === antes) {
    console.log(`manifesto ja estava em dia: ${arquivos.length} arte(s) por campeonato`);
    for (const [nome] of checks) console.log(`  ok ${nome}`);
    return true;
  }

  fs.writeFileSync(APP, depois);
  console.log(`arte por campeonato no manifesto: ${arquivos.length}`);
  for (const nome of arquivos) console.log(`  + ${nome}`);
  console.log(`genericos ignorados: ${GENERICOS.size}`);
  for (const [nome] of checks) console.log(`  ok ${nome}`);
  return true;
}

if (main() === false) process.exitCode = 1;
