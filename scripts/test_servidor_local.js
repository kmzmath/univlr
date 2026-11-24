// O servidor local serve o site e nada alem dele.
//
// Uso: node scripts/test_servidor_local.js
//
// Sobe o local-static-server.cjs numa porta livre e confere: a pagina abre, a
// chave da Riot e o .git nao saem, outro Host e recusado, e `%` malformado nao
// derruba o servidor (auditoria de 23/11/2026).

const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function portaLivre() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function pede(porta, caminho, host = `127.0.0.1:${porta}`) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: porta, path: caminho, headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const porta = await portaLivre();
  const servidor = spawn(process.execPath, ["local-static-server.cjs"], { cwd: ROOT, env: { ...process.env, PORT: String(porta) } });
  await new Promise((resolve, reject) => {
    servidor.stdout.on("data", resolve);
    servidor.on("exit", (code) => reject(new Error(`servidor saiu com ${code}`)));
  });
  try {
    assert.strictEqual(await pede(porta, "/"), 200, "a pagina abre");
    assert.strictEqual(await pede(porta, "/app.js"), 200, "o app abre");
    assert.strictEqual(await pede(porta, "/", `localhost:${porta}`), 200, "localhost tambem vale");
    assert.strictEqual(await pede(porta, "/nao-existe.json"), 404);
    assert.strictEqual(await pede(porta, "/.git/config"), 403, ".git nao sai");
    assert.strictEqual(await pede(porta, "/trabalho/.env"), 403, "a chave da Riot nao sai");
    assert.strictEqual(await pede(porta, "/TRABALHO/x.json"), 403, "nem com maiuscula");
    assert.strictEqual(await pede(porta, "/%2e%2egit/config"), 403, "nem codificado");
    assert.strictEqual(await pede(porta, "/..%2fHub%20Uni2/x.json"), 403, "pasta vizinha nao sai");
    assert.strictEqual(await pede(porta, "/trabalho%20/x.json"), 403, "nem com espaco no fim (Windows)");
    assert.strictEqual(await pede(porta, "/trabalho./x.json"), 403, "nem com ponto no fim (Windows)");
    assert.strictEqual(await pede(porta, "/TRABAL~1/x.json"), 403, "nem pelo nome curto (Windows)");
    assert.strictEqual(await pede(porta, "/app.js::$DATA"), 403, "nem pelo fluxo alternativo (Windows)");
    assert.strictEqual(await pede(porta, "/", "univlr.exemplo.invalid"), 403, "outro Host e recusado");
    assert.strictEqual(await pede(porta, "//127.0.0.1/app.js", "univlr.exemplo.invalid"), 403, "Host de fora com URL apontando para ca");
    assert.strictEqual(await pede(porta, "//127.0.0.1/app.js"), 400, "URL que comeca com //");
    assert.strictEqual(await pede(porta, "/", `[::1]:${porta}`), 200, "IPv6 local vale");
    assert.strictEqual(await pede(porta, "/%E0%A4%A"), 400, "% malformado");
    assert.strictEqual(await pede(porta, "/"), 200, "e o servidor segue de pe");
    console.log("ok: servidor local serve o site e recusa 11 caminhos e 2 Hosts de fora");
  } finally {
    servidor.kill();
  }
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
