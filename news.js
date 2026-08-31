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

  // ------------------------------------------------------------- blocos
  //
  // Um paragrafo sozinho com `{{nome: argumento | argumento}}` vira um bloco
  // montado AQUI, a partir do banco. A regra e a mesma do placar: digitar a
  // tabela na mao funciona hoje e envelhece amanha - se a partida for
  // reprocessada ou o ranking rodar de novo, o numero escrito no Word passa a
  // mentir. Assim o texto envelhece junto com o banco, nunca contra ele.
  //
  // Token desconhecido, ou dado que nao existe, some da tela em vez de vazar
  // como texto cru para o leitor.

  const TOKEN = /^\{\{\s*([a-zA-Z]+)\s*:\s*([\s\S]+?)\s*\}\}$/;

  function trocaBlocos(raiz) {
    raiz.querySelectorAll("p").forEach((p) => {
      const m = (p.textContent || "").trim().match(TOKEN);
      if (!m) return;
      const monta = BLOCOS[m[1].toLowerCase()];
      if (!monta) return;
      const args = m[2].split("|").map((s) => s.trim());
      let bloco = null;
      try {
        bloco = monta(args);
      } catch (erro) {
        bloco = null;
      }
      p.outerHTML = bloco || "";
    });
  }

  // ------------------------------------------------------------ a ficha
  //
  // O cartao de identificacao da equipe: posicao, nota, grupo e estreia.
  // Posicao e nota saem do ranking na hora de desenhar - sao exatamente os dois
  // numeros que mudam toda semana.

  function montaFicha([idTime, grupo, idAdversario]) {
    if (typeof state === "undefined" || !state.db) return null;
    const t = window.teamById ? window.teamById(idTime) : null;
    if (!t) return null;

    const lista = state.db.ranking?.teams || [];
    const i = lista.findIndex((x) => x.id === idTime);
    const pos = i >= 0 ? i + 1 : null;
    const nota = i >= 0 ? lista[i].score : null;

    const adv = idAdversario && window.teamById ? window.teamById(idAdversario) : null;
    const escudoAdv = adv && window.teamLogo ? window.teamLogo(adv.id, "news-ent-logo") : "";

    const celulas = [
      pos ? [`#${pos}`, "Ranking UNIVLR"] : null,
      Number.isFinite(nota) ? [num(nota, 1), "Nota"] : null,
      grupo ? [`Grupo ${esc(grupo)}`, "Fase de grupos"] : null,
    ].filter(Boolean);

    return `
      <div class="news-ficha">
        <div class="news-ficha-time">
          ${window.teamLogo ? window.teamLogo(t.id, "news-ficha-escudo") : ""}
          <a href="#/teams/${esc(t.id)}"><strong>${esc(t.name)}</strong></a>
        </div>
        <div class="news-ficha-grade">
          ${celulas.map(([v, r]) => `<div class="news-ficha-item"><strong>${v}</strong><span>${esc(r)}</span></div>`).join("")}
          ${adv ? `<div class="news-ficha-item news-ficha-estreia">
                     <a class="news-ent news-ent-teams" href="#/teams/${esc(adv.id)}">${escudoAdv}${esc(adv.name)}</a>
                     <span>Estreia contra</span>
                   </div>` : ""}
        </div>
      </div>`;
  }

  // --------------------------------------------------------- o map pool
  //
  // Recorde por mapa e saldo de rounds, direto das partidas. O saldo nao vem
  // pronto em `mapStats` (que so guarda vitorias e derrotas), entao ele e
  // somado aqui - e a soma so existe porque `teamA.score` e `teamB.score` sao
  // os rounds do mapa.

  function montaMapPool([idTime]) {
    if (typeof state === "undefined" || !state.db) return null;
    const t = window.teamById ? window.teamById(idTime) : null;
    if (!t) return null;

    const porMapa = new Map();
    for (const m of state.db.matches) {
      const lado = m.teamA.id === idTime ? "teamA" : m.teamB.id === idTime ? "teamB" : null;
      if (!lado) continue;
      const outro = lado === "teamA" ? "teamB" : "teamA";
      const nomeMapa = m.mapName || "-";
      if (!porMapa.has(nomeMapa)) porMapa.set(nomeMapa, { nome: nomeMapa, v: 0, d: 0, rv: 0, rd: 0 });
      const r = porMapa.get(nomeMapa);
      if (m.winnerId === idTime) r.v += 1;
      else r.d += 1;
      r.rv += Number(m[lado].score) || 0;
      r.rd += Number(m[outro].score) || 0;
    }
    if (!porMapa.size) return null;

    const linhas = [...porMapa.values()].sort(
      (a, b) => b.v + b.d - (a.v + a.d) || b.v - b.d - (a.v - a.d) || a.nome.localeCompare(b.nome)
    );

    const icone = (nome) => {
      const mapa = (state.db.maps || []).find(
        (x) => String(x.name).toLowerCase() === String(nome).toLowerCase()
      );
      return mapa && window.mapLogo ? window.mapLogo(mapa.id, "news-mapa-icone") : "";
    };

    return `
      <div class="news-tabela-rolagem">
        <table class="news-mappool">
          <thead><tr><th>Mapa</th><th>Recorde</th><th>Rounds</th><th>Aproveitamento</th></tr></thead>
          <tbody>
            ${linhas.map((r) => {
              const jogos = r.v + r.d;
              const pct = jogos ? (r.v / jogos) * 100 : 0;
              return `<tr>
                <td class="news-mappool-nome">${icone(r.nome)}<span>${esc(r.nome)}</span></td>
                <td class="news-mappool-recorde"><strong>${r.v}</strong><span>-</span><em>${r.d}</em></td>
                <td class="news-mappool-rounds">${r.rv}-${r.rd}</td>
                <td class="news-mappool-barra">
                  <span class="news-mappool-trilho"><span class="news-barra" style="--pct:${pct.toFixed(1)}%"></span></span>
                  <small>${num(pct, 0)}%</small>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // ----------------------------------------------------------- o elenco
  //
  // Quem a equipe usou num campeonato, com a nota daquele campeonato - e nao a
  // do ano. E a unica leitura honesta antes de uma etapa presencial: a nota
  // anual de quem entrou no meio da temporada carrega partidas de outro time.
  //
  // Quem aparece: todo mundo que jogou pelo menos 40% dos mapas da equipe. Um
  // corte fixo de cinco esconderia rodizio de verdade (uma equipe que alternou
  // dois jogadores em pe de igualdade), e mostrar todos traria o reserva que
  // entrou meio mapa como se fosse titular.

  const PARTICIPACAO_MINIMA = 0.4;

  function montaElenco([idTime, idEvento]) {
    if (typeof state === "undefined" || !state.db) return null;
    const t = window.teamById ? window.teamById(idTime) : null;
    if (!t) return null;

    const porJogador = new Map();
    let mapasDaEquipe = 0;
    for (const m of state.db.matches) {
      if (idEvento && m.eventId !== idEvento) continue;
      const lado = m.teamA.id === idTime ? "teamA" : m.teamB.id === idTime ? "teamB" : null;
      if (!lado) continue;
      mapasDaEquipe += 1;
      for (const p of m.players || []) {
        // A cor do lado e o que amarra o jogador a equipe dentro do mapa; o
        // `currentTeam` do jogador diria o time de HOJE, e nao o daquele dia.
        if (p.teamColor !== m[lado].color) continue;
        if (!porJogador.has(p.nick)) porJogador.set(p.nick, { nick: p.nick, mapas: 0, rounds: 0, somaR: 0, somaAcs: 0 });
        const r = porJogador.get(p.nick);
        const rounds = Number(p.rounds) || 0;
        r.mapas += 1;
        r.rounds += rounds;
        r.somaR += (Number(p.raating_3 ?? p.rating) || 0) * rounds;
        r.somaAcs += (Number(p.acs) || 0) * rounds;
      }
    }
    if (!mapasDaEquipe) return null;

    const corte = mapasDaEquipe * PARTICIPACAO_MINIMA;
    const elenco = [...porJogador.values()]
      .filter((r) => r.mapas >= corte && r.rounds > 0)
      // Media ponderada por round, e nao por mapa: um mapa de 26 rounds pesa
      // mais que um de 16, que e como a nota do jogador e calculada no site.
      .map((r) => ({ ...r, raating: r.somaR / r.rounds, acs: r.somaAcs / r.rounds }))
      .sort((a, b) => b.raating - a.raating);
    if (!elenco.length) return null;

    const ev = idEvento ? (state.db.tournaments || []).find((x) => x.id === idEvento) : null;

    return `
      <div class="news-elenco">
        ${ev ? `<div class="news-elenco-topo">${window.eventLogo ? window.eventLogo(ev, "news-ent-logo") : ""}<span>${esc(ev.name)}</span></div>` : ""}
        <div class="news-elenco-grade">
          ${elenco.map((r) => {
            const j = window.playerById ? window.playerById(r.nick) : null;
            const foto = j && window.playerLogo ? window.playerLogo(j.id, "news-elenco-foto") : "";
            const href = j ? `#/players/${esc(j.routeSlug || j.id)}` : null;
            const miolo = `
              ${foto}
              <strong class="news-elenco-nick">${esc(r.nick)}</strong>
              <div class="news-elenco-numeros">
                <span><strong>${num(r.raating, 2)}</strong><small>rAAting</small></span>
                <span><strong>${r.mapas}</strong><small>Mapas</small></span>
                <span><strong>${num(r.acs, 0)}</strong><small>ACS</small></span>
              </div>`;
            return href
              ? `<a class="news-elenco-card" href="${href}">${miolo}</a>`
              : `<div class="news-elenco-card">${miolo}</div>`;
          }).join("")}
        </div>
      </div>`;
  }

  // -------------------------------------------------------- a previsao
  //
  // As tres probabilidades do supercomputador. Vao com barra porque o assunto
  // do bloco e a comparacao entre elas, e nao o valor exato de cada uma - e
  // porque tres numeros soltos em linhas separadas leem como uma lista de
  // resultados, que e justamente o que uma probabilidade nao e.

  function montaPrevisao(args) {
    const rotulos = ["Playoffs", "Grande Final", "Título"];
    const valores = args.map((v) => Number(String(v).replace("%", "").replace(",", ".").trim()));
    if (valores.some((v) => !Number.isFinite(v))) return null;
    // O texto mostrado e o que foi escrito, nao o numero reformatado: passar
    // "0,3" por um formatador de duas casas devolve "0,30", que inventa uma
    // casa de precisao que a simulacao nao tem. O numero convertido serve so
    // para o comprimento da barra.
    const escritos = args.map((v) => String(v).replace("%", "").trim());

    return `
      <div class="news-previsao">
        <div class="news-previsao-titulo">Opinião do Supercomputador</div>
        ${valores.map((v, i) => `
          <div class="news-previsao-linha">
            <span class="news-previsao-rotulo">${esc(rotulos[i] || "")}</span>
            <span class="news-previsao-trilho"><span class="news-barra" style="--pct:${Math.max(0, Math.min(100, v)).toFixed(2)}%"></span></span>
            <strong class="news-previsao-valor">${esc(escritos[i])}%</strong>
          </div>`).join("")}
      </div>`;
  }

  // -------------------------------------------------------- a formula
  //
  // Um LaTeX de bolso, com o que este site precisa e nada alem: fracao,
  // expoente e indice. Vendorizar KaTeX seriam 300 KB servidos a todo leitor
  // por causa de duas formulas - e as duas cabem em <sup>, <sub> e uma div.
  //
  // O texto passa por esc() ANTES de virar marcacao, entao nada do que estiver
  // escrito no Word pode fechar uma tag.

  function marcaMatematica(txt) {
    let s = esc(txt);
    // Um nivel de aninhamento basta, e e onde este site para: o denominador
    // da logistica e `1+e^{...}`, entao um `[^{}]*` solto fecharia na chave
    // errada e a fracao sairia pela metade.
    const RE_FRAC = /\\frac\{((?:[^{}]|\{[^{}]*\})*)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    s = s.replace(RE_FRAC, (t, a, b) =>
      `<span class="news-frac"><span class="news-frac-cima">${marcaMatematica2(a, true)}</span><span class="news-frac-baixo">${marcaMatematica2(b, true)}</span></span>`
    );
    return marcaMatematica2(s, true);
  }

  // Expoente e indice, aplicados tambem dentro da fracao. Separado de
  // `marcaMatematica` para nao reprocessar a fracao que acabou de ser montada.
  function marcaMatematica2(s, jaEscapado) {
    let t = jaEscapado ? s : esc(s);
    t = t.replace(/\^\{([^{}]*)\}/g, (m, a) => `<sup>${a}</sup>`);
    t = t.replace(/\^(-?[A-Za-z0-9,.]+)/g, (m, a) => `<sup>${a}</sup>`);
    t = t.replace(/_\{([^{}]*)\}/g, (m, a) => `<sub>${a}</sub>`);
    t = t.replace(/_([A-Za-z0-9]+)/g, (m, a) => `<sub>${a}</sub>`);
    return t;
  }

  function montaFormula(args) {
    const expr = args.join("|").trim();
    if (!expr) return null;
    return `<div class="news-formula"><span>${marcaMatematica(expr)}</span></div>`;
  }

  const BLOCOS = {
    placar: (args) => montaPlacar(args[0], args[1]),
    ficha: montaFicha,
    mappool: montaMapPool,
    elenco: montaElenco,
    previsao: montaPrevisao,
    formula: montaFormula,
  };

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
      // Enriquecer ANTES de montar os blocos, e nao depois. Os blocos trazem os
      // proprios escudos e a propria cor; passar o enriquecimento por cima
      // deles colava um segundo escudo em cada link (41 sobrando so no elenco)
      // e pintava nome de jogador com o vermelho da marca, que aqui e dado.
      // Os paragrafos de token nao tem link nenhum, entao a ordem nova nao
      // deixa nada por enriquecer.
      enriqueceMencoes(corpo);
      trocaBlocos(corpo);
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
