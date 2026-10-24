// exportar.mjs - gera todas as cartinhas (e os posts por time) sem abrir a interface.
//
// Usa a MESMA página do gerador (index.html + cartinha.js) num Chrome sem
// janela, então o PNG sai idêntico ao do botão "Baixar cartas".
//
// Uso, da raiz do Hub Uni:
//   node ferramentas/cartinhas/exportar.mjs
//   node ferramentas/cartinhas/exportar.mjs --dados univava-2026-fase-de-grupos.json --escala 1.5 --saida outputs/cartinhas --posts
//   node ferramentas/cartinhas/exportar.mjs --dados hub-temporada-2026 --so-com-foto   (só as cartas com foto)
//
// Precisa do Playwright (uma vez): npm i -D playwright && npx playwright install chromium
// As edições feitas na interface (guardadas no navegador) NÃO entram aqui:
// para levá-las, use "Baixar dados (.json)" e salve o arquivo em dados/.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");

function argumentos() {
  const a = process.argv.slice(2);
  const o = { dados: "", escala: 1.5, saida: path.join("outputs", "cartinhas"), posts: false, so: "", comFoto: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--dados") o.dados = a[++i];
    else if (a[i] === "--escala") o.escala = Number(a[++i]) || 1.5;
    else if (a[i] === "--saida") o.saida = a[++i];
    else if (a[i] === "--posts") o.posts = true;
    else if (a[i] === "--time") o.so = a[++i];
    else if (a[i] === "--so-com-foto") o.comFoto = true;
  }
  return o;
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function servidor() {
  const s = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    const arquivo = path.normalize(path.join(RAIZ, p));
    if (!arquivo.startsWith(RAIZ)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(arquivo, (erro, dados) => {
      if (erro) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TIPOS[path.extname(arquivo).toLowerCase()] || "application/octet-stream" });
      res.end(dados);
    });
  });
  return new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(s)));
}

const limpar = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const o = argumentos();
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    try {
      ({ chromium } = createRequire(import.meta.url)("playwright"));
    } catch {
      console.error("Este script precisa do Playwright. Na raiz do Hub Uni rode:\n  npm i -D playwright\n  npx playwright install chromium");
      process.exit(1);
    }
  }

  const s = await servidor();
  const porta = s.address().port;
  let navegador;
  try {
    navegador = await chromium.launch();
  } catch (e) {
    if (!String(e.message).includes("Executable doesn't exist")) throw e;
    navegador = await chromium.launch({ channel: "chrome" });
  }
  const pagina = await navegador.newPage();
  pagina.on("pageerror", (e) => console.error("erro na página:", e.message));
  const consulta = o.dados ? `?dados=${encodeURIComponent(o.dados)}` : "";
  await pagina.goto(`http://127.0.0.1:${porta}/ferramentas/cartinhas/${consulta}`);
  await pagina.evaluate(() => window.Gerador.pronto);

  const info = await pagina.evaluate(({ so, comFoto }) => {
    const G = window.Gerador;
    G.estado.filtro.ordem = "time";
    const ev = G.estado.conjunto.evento || {};
    const lista = G.visiveis()
      .filter((j) => !so || j.time === so || G.timeDe(j.time).nome === so)
      .filter((j) => !comFoto || Boolean(G.fotoDe(G.valores(j))))
      .map((j) => ({ chave: j.chave, timeId: j.time, time: G.timeDe(G.valores(j).time).nome, arquivo: G.nomeDaCarta(j), overall: Number(G.valores(j).overall) || 0 }));
    return { lista, evento: [ev.nome, ev.fase].filter(Boolean).join(" - ") };
  }, { so: o.so, comFoto: o.comFoto });

  const destino = path.resolve(RAIZ, o.saida, limpar(info.evento || "cartinhas"));
  fs.mkdirSync(destino, { recursive: true });
  console.log(`${info.lista.length} cartas -> ${destino}`);

  let n = 0;
  const usados = new Set();
  for (const item of info.lista) {
    const url = await pagina.evaluate(
      async ({ chave, escala }) => {
        const G = window.Gerador;
        const j = G.estado.jogadores.find((x) => x.chave === chave);
        return (await G.desenhar(j, escala)).toDataURL("image/png");
      },
      { chave: item.chave, escala: o.escala }
    );
    const pasta = path.join(destino, limpar(item.time));
    fs.mkdirSync(pasta, { recursive: true });
    // Windows não diferencia maiúscula de minúscula: "Kick" e "kick" seriam o mesmo arquivo
    let arquivo = item.arquivo;
    while (usados.has(path.join(pasta, arquivo).toLowerCase())) arquivo = arquivo.replace(/\.png$/, "_2.png");
    usados.add(path.join(pasta, arquivo).toLowerCase());
    fs.writeFileSync(path.join(pasta, arquivo), Buffer.from(url.split(",")[1], "base64"));
    n++;
    if (n % 10 === 0) console.log(`  ${n}/${info.lista.length}`);
  }

  if (o.posts) {
    const times = [...new Set(info.lista.map((i) => i.timeId))];
    const pastaPosts = path.join(destino, "_posts");
    fs.mkdirSync(pastaPosts, { recursive: true });
    for (const id of times) {
      const chaves = info.lista.filter((i) => i.timeId === id).sort((a, b) => b.overall - a.overall).map((i) => i.chave);
      const url = await pagina.evaluate(
        async ({ id, chaves }) => {
          const G = window.Gerador;
          const js = chaves.map((c) => G.estado.jogadores.find((x) => x.chave === c));
          return (await G.desenharPost(id, js)).toDataURL("image/jpeg", 0.93);
        },
        { id, chaves }
      );
      const nome = info.lista.find((i) => i.timeId === id).time;
      fs.writeFileSync(path.join(pastaPosts, `${limpar(nome)}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
    console.log(`${times.length} posts -> ${pastaPosts}`);
  }

  await navegador.close();
  s.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
