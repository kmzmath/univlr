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
//   capa    <- a primeira imagem do documento
//
// Titulo e capa saem do corpo depois de virarem metadado, senao apareceriam
// duas vezes na pagina da materia. O resumo FICA - ele e a abertura do texto,
// e so aparece sozinho nos cartoes de listagem.

const fs = require("fs");
const path = require("path");
const mammoth = require("./vendor/mammoth.js");

const ROOT = path.resolve(__dirname, "..");
const ENTRADA = path.join(ROOT, "noticias");
const SAIDA = path.join(ROOT, "news.json");
const ASSETS = path.join(ROOT, "assets", "noticias");

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

  // Capa: primeira imagem, e sai do corpo (vira o heroi da materia).
  let capa = "";
  html = html.replace(/<p>\s*<img[^>]*src="([^"]+)"[^>]*>\s*<\/p>/, (todo, src) => {
    if (capa) return todo;
    capa = src;
    return "";
  });
  if (!capa && imagens.length) capa = imagens[0];

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
}

main();
