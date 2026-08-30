// UNIVLR - noticias.
//
// O conteudo vem de news.json, gerado por scripts/build_news.js a partir dos
// .docx em noticias/. Mesma logica de todo o resto do site: o dado e buildado
// e servido estatico. O Supabase so entra nos comentarios de cada materia,
// pela thread `article` (que ja existia no schema desde o ciclo 1).
//
// Arquivo separado do app.js pelo motivo de sempre: ele ja tem 16 mil linhas.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);
  const ARQUIVO = "news.json";

  let artigos = null; // null = ainda nao carregou; [] = carregou e nao ha nada

  async function carregar() {
    if (artigos) return artigos;
    try {
      const resposta = await fetch(ARQUIVO);
      if (!resposta.ok) throw new Error(String(resposta.status));
      const dados = await resposta.json();
      artigos = dados && dados.format === "univlr-news@1" ? dados.artigos || [] : [];
    } catch (erro) {
      // Sem news.json o site inteiro continua de pe - noticia e um acrescimo,
      // nao um pre-requisito. Por isso falha em silencio e some da tela.
      artigos = [];
    }
    return artigos;
  }

  const lista = () => artigos || [];
  const porSlug = (slug) => lista().find((a) => a.slug === slug) || null;

  function dataLonga(iso) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function dataCurta(iso) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  }

  // `reservaEspaco` decide o que fazer quando a materia nao tem capa. Nas
  // listas em linha vale manter a caixa: sem ela o texto de uma linha comeca
  // 200px a esquerda do da linha de cima. No cartao de destaque, nao - a
  // imagem fica em cima do texto, entao um retangulo 16:9 vazio vira bloco
  // morto e empurra o titulo para fora da tela.
  function capa(artigo, classe, reservaEspaco = true) {
    if (!artigo.capa) {
      return reservaEspaco ? `<span class="news-capa ${classe} vazia" aria-hidden="true"></span>` : "";
    }
    return `<span class="news-capa ${classe}"><img src="${esc(artigo.capa)}" alt="" loading="lazy" decoding="async" /></span>`;
  }

  // ------------------------------------------------------------ faixa da home
  //
  // Sincrona de proposito: a home e montada de uma vez em string. Se ainda nao
  // carregou, ou nao ha materia, devolve "" e a faixa simplesmente nao existe -
  // placeholder na home seria espaco morto na pagina mais importante do site.

  function faixaHome() {
    const itens = lista();
    if (!itens.length) return "";
    const [destaque, ...resto] = itens.slice(0, 4);
    return `
      <section class="news-faixa">
        <div class="section-head">
          <div><h2>Notícias</h2></div>
          <a class="subtle-link" href="#/news">Ver todas</a>
        </div>
        <div class="news-faixa-grade">
          <a class="news-destaque" href="#/news/${esc(destaque.slug)}">
            ${capa(destaque, "grande", false)}
            <div class="news-destaque-texto">
              <time datetime="${esc(destaque.data)}">${dataLonga(destaque.data)}</time>
              <h3>${esc(destaque.titulo)}</h3>
              <p>${esc(destaque.resumo)}</p>
            </div>
          </a>
          ${
            resto.length
              ? `<div class="news-secundarias">
                   ${resto.map((a) => `
                     <a class="news-secundaria" href="#/news/${esc(a.slug)}">
                       ${capa(a, "pequena")}
                       <div>
                         <time datetime="${esc(a.data)}">${dataCurta(a.data)}</time>
                         <strong>${esc(a.titulo)}</strong>
                       </div>
                     </a>`).join("")}
                 </div>`
              : ""
          }
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- listagem

  function renderLista() {
    const itens = lista();
    window.Shell(`
      <section class="news-pagina">
        <header class="page-header slim-header">
          <div class="page-title"><h1>Notícias</h1></div>
        </header>
        ${
          itens.length
            ? `<div class="news-lista">
                 ${itens.map((a) => `
                   <a class="news-item" href="#/news/${esc(a.slug)}">
                     ${capa(a, "media")}
                     <div class="news-item-texto">
                       <time datetime="${esc(a.data)}">${dataLonga(a.data)}</time>
                       <h2>${esc(a.titulo)}</h2>
                       <p>${esc(a.resumo)}</p>
                     </div>
                   </a>`).join("")}
               </div>`
            : `<div class="empty-state news-vazio">
                 <strong>Nenhuma notícia publicada ainda.</strong>
                 <p>Quando a primeira sair, ela aparece aqui e na página inicial.</p>
               </div>`
        }
      </section>`);
  }

  // ------------------------------------------------------------------ materia

  function renderArtigo(slug) {
    const a = porSlug(slug);
    if (!a) {
      window.Shell(`
        <section class="news-pagina">
          <div class="empty-state">
            <strong>Notícia não encontrada.</strong>
            <p><a class="subtle-link" href="#/news">Ver todas as notícias</a></p>
          </div>
        </section>`);
      return;
    }

    window.Shell(`
      <article class="news-artigo">
        <header class="news-artigo-capa">
          ${a.capa ? `<img class="news-artigo-imagem" src="${esc(a.capa)}" alt="" />` : ""}
          <div class="news-artigo-titulo">
            <a class="subtle-link" href="#/news">Notícias</a>
            <h1>${esc(a.titulo)}</h1>
            <time datetime="${esc(a.data)}">${dataLonga(a.data)}</time>
          </div>
        </header>
        <div class="news-corpo">${a.html}</div>
        ${window.Comments ? window.Comments.shell("article", a.slug) : ""}
      </article>`);

    window.Comments?.montar("article", a.slug);
  }

  // O app.js chama isto do mapa de rotas.
  function renderNews(slug) {
    if (slug) return renderArtigo(slug);
    return renderLista();
  }

  // O corpo do artigo entra como HTML sem escapar, e isso e deliberado: ele foi
  // gerado pelo build a partir de um .docx que so o dono do site escreve. Nao ha
  // caminho por onde um visitante ponha conteudo aqui - o que o publico escreve
  // vive em comments, e la tudo passa por esc().

  window.News = { carregar, lista, porSlug, faixaHome, renderNews, dataLonga };
})();
