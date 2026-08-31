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

  // ------------------------------------------------------------ bloco da home
  //
  // Metade da largura para a materia principal (capa com o titulo por cima),
  // metade para os titulos menores mais a atividade recente da comunidade.
  //
  // Sincrono de proposito: a home e montada de uma vez em string. Se nao ha
  // materia NEM atividade, devolve "" e o bloco nao existe - placeholder na
  // home seria espaco morto na pagina mais importante do site.

  function heroi(a) {
    // O titulo entra SOBRE a capa, sob um veu, e nao embaixo dela: assim a
    // metade esquerda le como um bloco so em vez de duas pecas empilhadas.
    // Sem capa nao ha veu - o titulo assenta na propria superficie do cartao.
    const temCapa = Boolean(a.capa);
    return `
      <a class="news-heroi ${temCapa ? "com-capa" : "sem-capa"}" href="#/news/${esc(a.slug)}">
        ${temCapa ? `<img class="news-heroi-capa" src="${esc(a.capa)}" alt="" loading="eager" decoding="async" />` : ""}
        <div class="news-heroi-texto">
          <time datetime="${esc(a.data)}">${dataLonga(a.data)}</time>
          <h3>${esc(a.titulo)}</h3>
        </div>
      </a>`;
  }

  function tituloMenor(a) {
    return `
      <a class="news-titulo" href="#/news/${esc(a.slug)}">
        <time datetime="${esc(a.data)}">${dataCurta(a.data)}</time>
        <strong>${esc(a.titulo)}</strong>
        ${window.Comments ? window.Comments.selo("article", a.slug) : ""}
      </a>`;
  }

  function blocoHome() {
    const itens = lista();
    const atividade = window.Comments ? window.Comments.atividadeHome(6) : "";

    // Sem materia, a metade esquerda ficaria vazia e a direita sozinha. Entao
    // a atividade deixa de ser coluna estreita e ocupa a largura toda.
    if (!itens.length) {
      return window.Comments ? window.Comments.atividadeLarga(9) : "";
    }

    const [destaque, ...resto] = itens;
    const menores = resto.slice(0, 5);
    // Com uma materia so e nenhuma conversa, a coluna da direita nao teria
    // nada - e meia largura de vazio ao lado do heroi e pior que um heroi
    // largo. Nesse caso a linha vira de uma coluna so.
    const sozinho = !menores.length && !atividade;

    return `
      <section class="home-topo ${sozinho ? "sozinho" : ""}">
        <div class="section-head home-topo-head">
          <div><h2>Notícias</h2></div>
          <a class="subtle-link" href="#/news">Ver todas</a>
        </div>
        <div class="home-topo-principal">
          ${heroi(destaque)}
        </div>
        ${
          sozinho
            ? ""
            : `<div class="home-topo-lado">
                 ${menores.length ? `<div class="news-titulos">${menores.map(tituloMenor).join("")}</div>` : ""}
                 ${atividade}
               </div>`
        }
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
                       <h2>${esc(a.titulo)}${window.Comments ? window.Comments.selo("article", a.slug) : ""}</h2>
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

  // ------------------------------------------------- mencoes a entidades
  //
  // No Word voce marca uma mencao como link normal (Ctrl+K), colando o
  // endereco copiado do proprio site. O mammoth entrega isso como <a href>, e
  // aqui o link vira uma mencao rica: logo ao lado do nome, e cor propria
  // quando e partida.
  //
  // Feito no RENDER e nao no build de proposito: a logo e o nome vem do JSON
  // do banco, que muda a cada atualizacao. Se ficasse gravado no news.json,
  // uma equipe que trocasse de escudo ficaria com o antigo na materia.

  const ROTAS = /^#\/(teams|players|matches|tournaments|events|u)\/([^/?#]+)/;

  // Aceita o endereco completo copiado do navegador, nao so o hash: colar a
  // URL da barra de enderecos e o gesto natural de quem esta escrevendo.
  function paraHashInterno(href) {
    if (!href) return null;
    if (href.startsWith("#/")) return href;
    const m = href.match(/^https?:\/\/[^/]+\/(?:index\.html)?(#\/.*)$/);
    return m ? m[1] : null;
  }

  function logoDaMencao(tipo, id) {
    try {
      if (typeof state === "undefined" || !state.db) return "";

      if (tipo === "teams") {
        return typeof window.teamLogo === "function" ? window.teamLogo(id, "news-ent-logo") : "";
      }

      if (tipo === "players") {
        // A pedido: jogador mostra o escudo da EQUIPE, nao a foto. So 9,6% dos
        // jogadores tem foto, entao a silhueta apareceria na maioria das
        // mencoes - e o escudo diz mais sobre quem e a pessoa no texto.
        const j = typeof window.playerById === "function" ? window.playerById(id) : null;
        const t = j && typeof window.playerPrimaryTeam === "function" ? window.playerPrimaryTeam(j) : null;
        return t && typeof window.teamLogo === "function" ? window.teamLogo(t.id, "news-ent-logo") : "";
      }

      if (tipo === "matches") {
        const m = state.db.matches.find((x) => x.id === id);
        const ev = m && state.db.tournaments.find((t) => t.id === m.eventId);
        return ev && typeof window.eventLogo === "function" ? window.eventLogo(ev, "news-ent-logo") : "";
      }

      if (tipo === "tournaments" || tipo === "events") {
        const ev = state.db.tournaments.find((t) => t.id === id);
        return ev && typeof window.eventLogo === "function" ? window.eventLogo(ev, "news-ent-logo") : "";
      }
    } catch (erro) {
      return "";
    }
    return "";
  }

  function enriqueceMencoes(raiz) {
    raiz.querySelectorAll("a[href]").forEach((a) => {
      const hash = paraHashInterno(a.getAttribute("href"));
      if (!hash) return;
      a.setAttribute("href", hash);

      const m = hash.match(ROTAS);
      if (!m) return;
      const [, tipo, id] = m;

      a.classList.add("news-ent", `news-ent-${tipo}`);
      // O bloco de placar ja monta os proprios links COM escudo. Sem esta
      // guarda, o enriquecimento passa depois e cola um segundo escudo neles.
      if (a.querySelector(".news-ent-logo")) return;
      const logo = logoDaMencao(tipo, decodeURIComponent(id));
      // Sem logo o link continua funcionando e so nao ganha o simbolo - melhor
      // que uma caixa vazia no meio da frase.
      if (logo) a.insertAdjacentHTML("afterbegin", logo);
    });
  }

  // ------------------------------------------------- placar de uma partida
  //
  // No Word, um paragrafo sozinho com:
  //
  //   {{placar: <id da partida> | <nick do jogador>}}
  //
  // vira o bloco de estatisticas montado AQUI, a partir do banco. Digitar a
  // tabela na mao funcionaria hoje e envelheceria amanha: se a partida for
  // reprocessada, os numeros do texto ficariam mentindo. Assim eles seguem o
  // banco para sempre.

  const TOKEN_PLACAR = /^\{\{\s*placar\s*:\s*([^|]+?)\s*\|\s*(.+?)\s*\}\}$/i;

  // Virgula decimal: o resto da materia e escrito em portugues, e "1.00" no
  // meio de um texto que diz "0,68" le como outra coisa.
  const num = (v, casas = 0) =>
    Number.isFinite(Number(v)) ? Number(v).toFixed(casas).replace(".", ",") : "-";

  function montaPlacar(idPartida, nick) {
    if (typeof state === "undefined" || !state.db) return null;
    const m = state.db.matches.find((x) => x.id === idPartida || x.id.startsWith(idPartida));
    if (!m) return null;
    const jogador = (m.players || []).find(
      (x) => String(x.nick || "").toLowerCase() === String(nick).toLowerCase()
    );
    if (!jogador) return null;

    const ev = state.db.tournaments.find((t) => t.id === m.eventId);
    const nomeTime = (id) => (state.db.teams.find((t) => t.id === id) || {}).name || id;
    const placar = `${esc(nomeTime(m.teamA.id))} ${m.teamA.score ?? m.teamA.roundsWon ?? ""} x ${m.teamB.score ?? m.teamB.roundsWon ?? ""} ${esc(nomeTime(m.teamB.id))}`;
    const jog = typeof window.playerById === "function" ? window.playerById(jogador.nick) : null;
    const timeDoJogador = jog && typeof window.playerPrimaryTeam === "function" ? window.playerPrimaryTeam(jog) : null;
    const escudo = timeDoJogador && typeof window.teamLogo === "function" ? window.teamLogo(timeDoJogador.id, "news-ent-logo") : "";
    const logoEv = ev && typeof window.eventLogo === "function" ? window.eventLogo(ev, "news-ent-logo") : "";

    const swing = Number(jogador.impactRound);
    const colunas = [
      ["ACS", num(jogador.acs)],
      ["Kills", num(jogador.kills)],
      ["Mortes", num(jogador.deaths)],
      ["Assist.", num(jogador.assists)],
      ["KAST", num(jogador.kast) + "%"],
      ["ADR", num(jogador.adr)],
      ["Swing/R", (swing >= 0 ? "+" : "") + num(swing, 1)],
      ["Multi-kills", num(jogador.multi_kill_rounds)],
      ["FK", num(jogador.opening_kills)],
      ["FD", num(jogador.opening_deaths)],
    ];

    return `
      <div class="news-placar">
        <div class="news-placar-topo">
          <a class="news-placar-partida" href="#/matches/${esc(m.id)}">${logoEv}${placar}</a>
          ${ev ? `<span class="news-placar-evento">${esc(ev.name)}</span>` : ""}
        </div>
        <div class="news-placar-corpo">
          <div class="news-placar-nota">
            <a class="news-placar-jogador" href="#/players/${esc(jog?.routeSlug || jogador.nick)}">${escudo}${esc(jogador.nick)}</a>
            <span class="news-placar-valor">${num(jogador.raating_3 ?? jogador.rating, 2)}</span>
            <span class="news-placar-rotulo">rAAting 3.0</span>
          </div>
          <div class="news-placar-grade">
            ${colunas.map(([r, v]) => `<div class="news-placar-item"><strong>${esc(v)}</strong><span>${esc(r)}</span></div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function trocaPlacares(raiz) {
    raiz.querySelectorAll("p").forEach((p) => {
      const m = (p.textContent || "").trim().match(TOKEN_PLACAR);
      if (!m) return;
      const bloco = montaPlacar(m[1], m[2]);
      // Sem partida ou sem jogador o token some, em vez de ficar na tela como
      // texto cru para o leitor.
      p.outerHTML = bloco || "";
    });
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

    const corpo = document.querySelector(".news-corpo");
    if (corpo) {
      trocaPlacares(corpo);
      enriqueceMencoes(corpo);
    }

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

  window.News = { carregar, lista, porSlug, blocoHome, renderNews, dataLonga };
})();
