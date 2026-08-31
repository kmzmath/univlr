// Gera news.json a partir dos .docx em noticias/.
//
// Uso: node scripts/build_news.js
//
// Por que Word e nao markdown: quem escreve prefere Word, e o .docx tem
// estrutura de verdade - estilo de titulo, negrito, lista, link. O mammoth
// mapeia isso para HTML semantico, entao o texto chega limpo sem ninguem
// aprender sintaxe nova.
//
// A conversao acontece AQUI, no build, nunca no navegador: o news.json ja sai
// com o HTML pronto. O mammoth (636 KB) fica em scripts/vendor/ e nunca e
// servido a ninguem - e o mesmo arranjo do supabase-js.js, mas do lado de ca.
//
// Metadados saem do proprio documento, porque Word nao tem frontmatter:
//
//   data    <- prefixo YYYY-MM-DD do nome do arquivo (senao, data do arquivo)
//   slug    <- o resto do nome do arquivo
//   titulo  <- o primeiro Titulo 1 do documento
//   resumo  <- o primeiro paragrafo
//   capa    <- um arquivo de imagem com o MESMO nome do .docx, ao lado dele
//              (ex.: 2026-08-30-titulo.webp); na falta dele, a primeira
//              imagem de dentro do documento
//
// Titulo e capa saem do corpo depois de virarem metadado, senao apareceriam
// duas vezes na pagina da materia. O resumo FICA - ele e a abertura do texto,
// e so aparece sozinho nos cartoes de listagem.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const mammoth = require("./vendor/mammoth.js");

const ROOT = path.resolve(__dirname, "..");
const ENTRADA = path.join(ROOT, "noticias");
const SAIDA = path.join(ROOT, "news.json");
const ASSETS = path.join(ROOT, "assets", "noticias");
const PREVIEWS = path.join(ROOT, "news");
const EXT_IMAGEM = [".webp", ".jpg", ".jpeg", ".png", ".gif"];

// Word grava PNG/JPEG sem content-type as vezes (e o gerador de teste tambem),
// entao o tipo sai dos bytes, que nunca mentem.
function extensaoPorBytes(buf, contentType) {
  if (buf.length > 8) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
    if (buf[0] === 0x47 && buf[1] === 0x49) return "gif";
    if (buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  }
  const doTipo = String(contentType || "").split("/")[1];
  return doTipo ? doTipo.replace("jpeg", "jpg") : "png";
}

function partesDoNome(arquivo) {
  const base = path.basename(arquivo, path.extname(arquivo));
  const m = base.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (m) return { data: m[1], slug: m[2] };
  // Sem prefixo de data, cai na data do arquivo. Funciona, mas o prefixo e
  // melhor: ele sobrevive a copiar o arquivo de um lugar para outro.
  const stat = fs.statSync(arquivo);
  return { data: stat.mtime.toISOString().slice(0, 10), slug: base };
}

function limpaSlug(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function textoDe(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Capa ao lado do documento, com o mesmo nome. Existe porque a capa e a maior
// imagem da materia e a que mais pesa: colada dentro do Word ela entraria no
// tamanho e formato que o Word guardou (o PNG desta materia tinha 1,1 MB
// contra 50 KB do mesmo quadro em WebP). Como arquivo separado, da para
// dimensionar e comprimir antes, sem brigar com o Word.
function capaAoLado(arquivo) {
  const base = arquivo.slice(0, -path.extname(arquivo).length);
  for (const ext of EXT_IMAGEM) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null;
}

async function converte(arquivo) {
  const { data, slug } = partesDoNome(arquivo);
  const destinoImagens = path.join(ASSETS, slug);
  const imagens = [];

  const buf = fs.readFileSync(arquivo);
  const resultado = await mammoth.convertToHtml(
    { arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const bytes = await image.read();
        const ext = extensaoPorBytes(bytes, image.contentType);
        const nome = `imagem-${imagens.length + 1}.${ext}`;
        fs.mkdirSync(destinoImagens, { recursive: true });
        fs.writeFileSync(path.join(destinoImagens, nome), bytes);
        const src = `assets/noticias/${slug}/${nome}`;
        imagens.push(src);
        return { src, alt: image.altText || "" };
      }),
    }
  );

  let html = resultado.value;

  // Titulo: primeiro <h1>, e sai do corpo.
  let titulo = "";
  html = html.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/, (todo, dentro) => {
    if (titulo) return todo; // so o primeiro
    titulo = textoDe(dentro);
    return "";
  });
  if (!titulo) titulo = slug.replace(/-/g, " ");

  // Capa. O arquivo ao lado do documento tem prioridade; sem ele, a primeira
  // imagem de dentro do texto e promovida a capa e SAI do corpo, senao ela
  // apareceria duas vezes na pagina.
  let capa = "";
  const aoLado = capaAoLado(arquivo);
  if (aoLado) {
    fs.mkdirSync(destinoImagens, { recursive: true });
    const nome = "capa" + path.extname(aoLado).toLowerCase();
    fs.copyFileSync(aoLado, path.join(destinoImagens, nome));
    capa = `assets/noticias/${slug}/${nome}`;
  } else {
    html = html.replace(/<p>\s*<img[^>]*src="([^"]+)"[^>]*>\s*<\/p>/, (todo, src) => {
      if (capa) return todo;
      capa = src;
      return "";
    });
    if (!capa && imagens.length) capa = imagens[0];
  }

  // Resumo: primeiro paragrafo com texto. Continua no corpo.
  let resumo = "";
  const paragrafos = html.match(/<p>[\s\S]*?<\/p>/g) || [];
  for (const p of paragrafos) {
    const t = textoDe(p);
    if (t.length > 20) {
      resumo = t.length > 240 ? t.slice(0, 237).replace(/\s+\S*$/, "") + "..." : t;
      break;
    }
  }

  return {
    slug: limpaSlug(slug),
    titulo,
    resumo,
    data,
    capa,
    html: html.trim(),
    avisos: resultado.messages.filter((m) => m.type === "warning").map((m) => m.message),
  };
}

// ------------------------------------------------ paginas de preview de link
//
// O site roteia por hash, e tudo depois do `#` NUNCA chega ao servidor. Quando
// alguem cola `univlr.onrender.com/#/news/x` no WhatsApp, o robo de preview
// pede a raiz e recebe o index.html - ele nao tem como saber de que materia se
// trata. E ele nao roda JavaScript, entao nada que o news.js monte depois
// existe para ele.
//
// A saida e uma pagina de verdade por materia, num caminho sem `#`:
//
//   news/<slug>/index.html   ->   https://univlr.onrender.com/news/<slug>
//
// Ela carrega as tags og: prontas no arquivo e devolve a pessoa para a rota do
// site. O robo le as tags; o humano nem ve esta pagina.
//
// O redirecionamento e por JavaScript, e nao por <meta refresh>: robo nao roda
// script, entao ele fica na pagina e le as tags com calma, enquanto o navegador
// de gente salta na hora. `location.replace` para nao empilhar no historico -
// senao o botao Voltar traria a pessoa de volta para ca, e daqui ela seria
// mandada para frente de novo.

const SITE = "https://univlr.onrender.com";

function escAtributo(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A imagem do card e o JPEG de 1200x630 gerado por build_share_images.py; sem
// ele, a propria capa. Ver o cabecalho daquele arquivo para o porque do JPEG.
function imagemDeCompartilhamento(artigo) {
  if (!artigo.capa) return `${SITE}/assets/share/univlr.jpg`;
  const share = artigo.capa.replace(/\/capa\.[a-z0-9]+$/i, "/capa-share.jpg");
  const existe = share !== artigo.capa && fs.existsSync(path.join(ROOT, share));
  return `${SITE}/${existe ? share : artigo.capa}`;
}

function paginaDePreview(artigo) {
  const rota = `${SITE}/#/news/${artigo.slug}`;
  const titulo = `${artigo.titulo} - UNIVLR`;
  const a = escAtributo;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>${a(titulo)}</title>
    <link rel="canonical" href="${a(rota)}" />
    <meta name="description" content="${a(artigo.resumo)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="UNIVLR" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:url" content="${a(`${SITE}/news/${artigo.slug}`)}" />
    <meta property="og:title" content="${a(artigo.titulo)}" />
    <meta property="og:description" content="${a(artigo.resumo)}" />
    <meta property="og:image" content="${a(imagemDeCompartilhamento(artigo))}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="article:published_time" content="${a(artigo.data)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script>location.replace(${JSON.stringify(`/#/news/${artigo.slug}`)});</script>
  </head>
  <body>
    <p><a href="${a(rota)}">${a(artigo.titulo)}</a></p>
  </body>
</html>
`;
}

function gravaPaginasDePreview(artigos) {
  fs.mkdirSync(PREVIEWS, { recursive: true });

  // Materia apagada deixa a pasta para tras, e o link antigo continuaria
  // servindo um card de algo que nao existe mais.
  const vivos = new Set(artigos.map((a) => a.slug));
  for (const nome of fs.readdirSync(PREVIEWS)) {
    const alvo = path.join(PREVIEWS, nome);
    if (fs.statSync(alvo).isDirectory() && !vivos.has(nome)) {
      fs.rmSync(alvo, { recursive: true, force: true });
      console.log(`  removido news/${nome}/ (materia nao existe mais)`);
    }
  }

  for (const artigo of artigos) {
    const pasta = path.join(PREVIEWS, artigo.slug);
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, "index.html"), paginaDePreview(artigo));
  }
  console.log(`${artigos.length} pagina(s) de preview -> news/<slug>/index.html`);
}

// As imagens de preview sao feitas em Python, que ja e o que este projeto usa
// para tratar imagem. Se o Python ou o Pillow nao estiverem ali, o build de
// noticias segue: o card cai para a capa em WebP, que so alguns aplicativos
// deixam de renderizar.
function geraImagensDeCompartilhamento() {
  const script = path.join(__dirname, "build_share_images.py");
  for (const python of ["python", "python3"]) {
    const r = spawnSync(python, [script], { encoding: "utf8" });
    if (r.status === 0) {
      process.stdout.write(r.stdout);
      return;
    }
    if (r.error && r.error.code !== "ENOENT") break;
  }
  console.log("aviso: nao consegui rodar build_share_images.py - o card de link vai usar a capa em WebP");
}

async function main() {
  if (!fs.existsSync(ENTRADA)) {
    console.log("noticias/ nao existe - nada a fazer");
    fs.writeFileSync(SAIDA, JSON.stringify({ format: "univlr-news@1", artigos: [] }, null, 2));
    return;
  }

  const arquivos = fs
    .readdirSync(ENTRADA)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    // ~$arquivo.docx e o lixo que o Word deixa enquanto o documento esta aberto.
    .filter((f) => !f.startsWith("~$"))
    .map((f) => path.join(ENTRADA, f));

  const artigos = [];
  for (const arquivo of arquivos) {
    try {
      const artigo = await converte(arquivo);
      artigos.push(artigo);
      const aviso = artigo.avisos.length ? `  (${artigo.avisos.length} aviso(s))` : "";
      console.log(`ok  ${path.basename(arquivo)} -> ${artigo.slug}${aviso}`);
      artigo.avisos.forEach((a) => console.log(`      ${a}`));
    } catch (erro) {
      console.error(`ERRO ${path.basename(arquivo)}: ${erro.message}`);
      process.exitCode = 1;
    }
  }

  // Mais recente primeiro; empate desempata pelo slug, para a ordem nao mudar
  // sozinha entre dois builds.
  artigos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.slug.localeCompare(b.slug)));
  artigos.forEach((a) => delete a.avisos);

  fs.writeFileSync(
    SAIDA,
    JSON.stringify({ format: "univlr-news@1", geradoEm: new Date().toISOString(), artigos }, null, 2)
  );
  console.log(`\n${artigos.length} materia(s) -> news.json`);

  geraImagensDeCompartilhamento();
  gravaPaginasDePreview(artigos);
}

main();
