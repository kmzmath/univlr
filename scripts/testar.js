// Roda todos os testes que nao precisam de navegador e para com erro se algum
// falhar. Uso, antes de commitar: node scripts/testar.js
//
// Acha os testes pelo nome (scripts/test_*.js e test_*.py, previa-local-*.test.js
// e o coletor do tracker), entao teste novo entra sozinho. Os *_navegador.cjs
// abrem um Chrome e ficam de fora.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const nomes = (pasta, re) => fs.readdirSync(path.join(ROOT, pasta)).filter((f) => re.test(f)).sort();

const testes = [
  ...nomes("scripts", /^test_.*\.js$/).map((f) => [process.execPath, [`scripts/${f}`]]),
  ...nomes(".", /^previa-local-.*\.test\.js$/).map((f) => [process.execPath, [f]]),
  [process.execPath, ["--test", "ferramentas/tracker-historico/coletor.test.cjs"]],
  ...nomes("scripts", /^test_.*\.py$/).map((f) => ["python", [`scripts/${f}`]]),
];

// O banco nao fica no git (o Render gera no deploy); cinco testes leem ele.
if (!fs.existsSync(path.join(ROOT, "database.json"))) {
  console.log("aviso: sem database.json; rode antes `node scripts/build_database.js`\n");
}

let falhas = 0;
for (const [comando, args] of testes) {
  const r = spawnSync(comando, args, { cwd: ROOT, encoding: "utf8" });
  const passou = r.status === 0;
  console.log(`${passou ? "ok    " : "FALHOU"} ${args.join(" ")}`);
  if (!passou) {
    falhas += 1;
    console.log(String(r.stderr || r.stdout || r.error || "").trim().split("\n").slice(-8).map((l) => `       ${l}`).join("\n"));
  }
}
console.log(`\n${testes.length - falhas} de ${testes.length} passaram`);
process.exitCode = falhas ? 1 : 0;
