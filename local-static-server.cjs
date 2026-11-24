const http = require("http");
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const port = Number(process.env.PORT || 8000);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// So o proprio computador. Um site aberto no navegador que aponte o dominio
// dele para 127.0.0.1 (DNS rebinding) chegaria aqui com outro Host e leria
// qualquer arquivo da pasta, inclusive a chave da Riot em trabalho/.env.
const HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const recusa = (res, status, texto) => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(texto);
};

const server = http.createServer((req, res) => {
  // O Host do cabecalho, e nao o da URL: `GET //127.0.0.1/x` faria o URL
  // achar que o host e local mesmo com o Host de outro dominio.
  const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
  if (!HOSTS.has(host)) return recusa(res, 403, "Forbidden");
  if (!req.url.startsWith("/") || req.url.startsWith("//")) return recusa(res, 400, "Bad request");
  const url = new URL(req.url, "http://127.0.0.1");

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    // `%` malformado derrubava o servidor inteiro.
    return recusa(res, 400, "Bad request");
  }
  if (pathname === "/") pathname = "/index.html";

  // .git, .env, .claude e a pasta de trabalho nao sao do site. O Windows nao
  // diferencia maiuscula, ignora ponto e espaco no fim do nome ("trabalho ")
  // e aceita nome curto ("TRABAL~1") e fluxo alternativo ("x::$DATA"): o site
  // nao usa nenhum desses, entao eles saem antes de comparar.
  const partes = pathname.split(/[\\/]/).filter(Boolean);
  const suspeita = (parte) => parte.startsWith(".") || /[. ]$/.test(parte) || /[~:]/.test(parte);
  if (partes.some(suspeita) || partes[0]?.toLowerCase() === "trabalho") {
    return recusa(res, 403, "Forbidden");
  }

  let filePath = path.normalize(path.join(root, pathname));

  // Diretorio serve o index.html de dentro dele, como faz o Render. E o que
  // faz `/news/<slug>` abrir a pagina de preview daquela materia; sem isto, so
  // aqui, o caminho daria 404 e a diferenca so apareceria depois do deploy.
  if (!path.extname(filePath)) {
    const comIndice = path.join(filePath, "index.html");
    if (fs.existsSync(comIndice)) filePath = comIndice;
  }
  // `root + sep`: so `startsWith(root)` deixava passar a pasta vizinha que
  // comeca com o mesmo nome ("Hub Uni2").
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return recusa(res, 403, "Forbidden");

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) return recusa(res, 404, "Not found");

    res.writeHead(200, {
      "content-type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UNIVLR local server http://127.0.0.1:${port}`);
});
