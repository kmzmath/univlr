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
  // Duas materias, as duas com capa: a mais recente grande a esquerda, a
  // seguinte menor a direita. A atividade recente entra embaixo da menor e
  // ocupa exatamente a sobra de altura entre as duas - ela e o detalhe da
  // linha, nao uma terceira peca disputando espaco.
  //
  // Sincrono de proposito: a home e montada de uma vez em string. Se nao ha
  // materia NEM atividade, devolve "" e o bloco nao existe - placeholder na
  // home seria espaco morto na pagina mais importante do site.

  function heroi(a, menor) {
    // O titulo entra SOBRE a capa, sob um veu, e nao embaixo dela: assim cada
    // cartao le como um bloco so em vez de duas pecas empilhadas. Sem capa nao
    // ha veu - o titulo assenta na propria superficie do cartao.
    const temCapa = Boolean(a.capa);
    return `
      <a class="news-heroi ${menor ? "menor" : ""} ${temCapa ? "com-capa" : "sem-capa"}" href="#/news/${esc(a.slug)}">
        ${/* As duas capas carregam adiantadas: sao as duas maiores imagens do
              topo da home, e `lazy` na segunda so trocava a espera por um
              retangulo vazio no lugar mais visivel do site. */ ""}
        ${temCapa ? `<img class="news-heroi-capa" src="${esc(a.capa)}" alt="" loading="eager" decoding="async" />` : ""}
        <div class="news-heroi-texto">
          <div class="news-heroi-meta">
            <time datetime="${esc(a.data)}">${menor ? dataCurta(a.data) : dataLonga(a.data)}</time>
            ${window.Comments ? window.Comments.selo("article", a.slug) : ""}
          </div>
          <h3>${esc(a.titulo)}</h3>
        </div>
      </a>`;
  }

  function blocoHome() {
    const itens = lista();
    const atividade = window.Comments ? window.Comments.atividadeHome(5) : "";

    // Sem materia, a metade esquerda ficaria vazia e a direita sozinha. Entao
    // a atividade deixa de ser coluna estreita e ocupa a largura toda.
    if (!itens.length) {
      return window.Comments ? window.Comments.atividadeLarga(9) : "";
    }

    const [destaque, ...resto] = itens;
    const secundarias = resto.slice(0, 2);

    // Com DUAS secundarias a coluna da direita fica inteira para elas e a
    // atividade desce para uma faixa fina. Dois cartoes 2:1 empilhados nao
    // cabem na coluna junto da atividade: eles somam mais que a altura do
    // heroi, e o que sobraria para a conversa seria uma tira de 3,8:1.
    const trio = secundarias.length === 2;
    // Com uma materia so e nenhuma conversa, a coluna da direita nao teria
    // nada - e meia largura de vazio ao lado do heroi e pior que um heroi
    // largo. Nesse caso a linha vira de uma coluna so.
    const sozinho = !secundarias.length && !atividade;
    const faixa = trio && window.Comments ? window.Comments.atividadeFaixa(5) : "";

    return `
      <section class="${["home-topo", sozinho && "sozinho", trio && "trio"].filter(Boolean).join(" ")}">
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
                 ${secundarias.map((item) => heroi(item, true)).join("")}
                 ${trio ? "" : atividade}
               </div>`
        }
        ${faixa}
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
        // O paragrafo vai junto porque ha bloco que le o que vem DEPOIS dele
        // no texto - a projecao consome a tabela que o autor escreveu logo
        // abaixo do token. Quem nao precisa simplesmente ignora o segundo
        // argumento.
        bloco = monta(args, p);
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

    // A arte do mapa vira o fundo da linha inteira. O `web/<id>.webp` e a versao
    // de 640px que o resto do site ja usa; o PNG de origem tem 1600px e sao sete
    // linhas por equipe, oito equipes na materia.
    const arte = (nome) => {
      const mapa = (state.db.maps || []).find(
        (x) => String(x.name).toLowerCase() === String(nome).toLowerCase()
      );
      if (!mapa) return "";
      const attrs = typeof window.mapArtAttrs === "function" ? window.mapArtAttrs(mapa) : null;
      return attrs?.src || "";
    };

    // As celulas ganham `role` explicito porque o CSS troca o `display` de
    // tabela por grade - sem os papeis, o leitor de tela deixaria de anunciar
    // isto como tabela e as colunas perderiam o cabecalho.
    return `
      <div class="news-tabela-rolagem">
        <table class="news-mappool" role="table">
          <thead>
            <tr role="row">
              <th role="columnheader">Mapa</th>
              <th role="columnheader">Recorde</th>
              <th role="columnheader">Aproveitamento</th>
              <th role="columnheader">Rounds</th>
              <th role="columnheader">Win% rounds</th>
            </tr>
          </thead>
          <tbody>
            ${linhas.map((r) => {
              const jogos = r.v + r.d;
              const pct = jogos ? (r.v / jogos) * 100 : 0;
              const rounds = r.rv + r.rd;
              const pctR = rounds ? (r.rv / rounds) * 100 : 0;
              const fundo = arte(r.nome);
              return `<tr role="row"${fundo ? ` style="--arte:url('${esc(fundo)}')"` : ""}>
                <td class="news-mappool-nome" role="cell">${esc(r.nome)}</td>
                <td class="news-mappool-recorde" role="cell"><strong>${r.v}</strong><span>-</span><em>${r.d}</em></td>
                <td class="news-mappool-barra" role="cell">
                  <span class="news-mappool-trilho"><span class="news-barra" style="--pct:${pct.toFixed(1)}%"></span></span>
                  <small>${num(pct, 0)}%</small>
                </td>
                <td class="news-mappool-rounds" role="cell">${r.rv}-${r.rd}</td>
                <td class="news-mappool-pctr" role="cell">${num(pctR, 1)}%</td>
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

  // ------------------------------------------------------- a projecao
  //
  // Duas formas do mesmo dado: a grade com todas as equipes e o cartao de cada
  // uma. As duas leem a MESMA tabela - a que o autor escreveu no Word, que o
  // token consome e substitui. Fonte unica, entao cartao e grade nao tem como
  // divergir: mudar um numero no Word muda os dois.
  //
  // Por que este bloco nao sai do banco como os outros: probabilidade de
  // simulacao nao existe no database.json e nunca vai existir. O que o banco
  // entrega aqui e escudo e nome, e esses sim saem de la na hora de desenhar.
  //
  // A grade e de DISTRIBUICAO, nao de acumulado: as colunas sao faixas
  // exclusivas que somam 100%. Coluna acumulada (Top 8, Top 16) cresce sempre
  // na mesma direcao e desenha um degrade; faixa exclusiva mostra ONDE a massa
  // de cada equipe cai, e e isso que faz a diagonal aparecer.

  // `grupo` = quantas colunas pertencem ao bloco "com vaga". `totais` = quantas
  // delas, a partir da primeira, sao TOTAIS e nao faixas: "Classificado" e a
  // soma de "upper" e "lower", entao somar as tres daria 100% mais a chance de
  // vaga. A coluna existe para o leitor, mas fica fora da distribuicao.
  const projecao = { colunas: [], linhas: new Map(), grupo: 1, totais: 0 };

  // A intensidade da celula E a probabilidade. A rampa nao e linear de
  // proposito: numa distribuicao a massa se acumula nas faixas baixas, entao
  // uma escala linear deixaria quatro quintos da grade pretos e a diagonal -
  // que e o assunto do grafico - sumiria. O expoente levanta a faixa de 5 a
  // 25% sem estourar o topo.
  //
  // Vai ate o alfa CHEIO (era 0,9) porque a cor da materia e escura: entre o
  // campo e o #3a08c2 chapado ha so 1,85:1 de luminancia, contra 3,38:1 do
  // violeta claro anterior. Gastar a faixa toda e o que mantem a diagonal
  // visivel, e da para gastar: mesmo no degrau cheio o texto claro tem 9,2:1.
  const tinta = (p) => Math.pow(Math.max(0, Math.min(1, p / 100)), 0.62);

  const numeroBr = (v) => Number(String(v).replace("%", "").replace(",", ".").trim());

  // `corte` marca a primeira coluna depois do grupo com vaga: e ali que o
  // torneio se parte em dois, entao e ali que a grade ganha a unica linha
  // vertical que ela tem.
  function celulaProjecao(valor, corte) {
    const p = numeroBr(valor);
    const marca = corte ? " corte" : "";
    if (!Number.isFinite(p)) return `<td class="news-proj-vazia${marca}"></td>`;
    return `<td class="news-proj-celula${p >= 10 ? " clara" : ""}${marca}" style="--tinta:${tinta(p).toFixed(3)}">${esc(String(valor).replace("%", ""))}</td>`;
  }

  // O id da equipe vem do href que o autor colou no Word - a mesma marcacao
  // que vira mencao no resto do texto. Assim a planilha nao precisa repetir id
  // nenhum: quem manda e o link.
  function idDoLink(celula) {
    const href = celula.querySelector('a[href*="/teams/"]')?.getAttribute("href") || "";
    return href.split("/teams/")[1]?.split(/[?#/]/)[0] || "";
  }

  function montaTabelaProjecao(args, paragrafo) {
    // A tabela de origem e a proxima irma do token. Ela e consumida: some do
    // texto depois de virar grade, senao o leitor veria as duas.
    let irma = paragrafo?.nextElementSibling;
    while (irma && irma.tagName !== "TABLE" && !irma.querySelector?.("table")) irma = irma.nextElementSibling;
    const tabela = irma?.tagName === "TABLE" ? irma : irma?.querySelector?.("table");
    if (!tabela) return null;
    const linhas = [...tabela.rows];
    if (linhas.length < 2) return null;
    (irma === tabela ? tabela : irma).remove();

    projecao.grupo = Math.max(1, Number(args[1]) || 1);
    projecao.totais = Math.max(0, Math.min(projecao.grupo - 1, Number(args[2]) || 0));
    const cabecalho = [...linhas[0].cells].map((c) => (c.textContent || "").trim());
    projecao.colunas = cabecalho.slice(1);

    const corpo = [];
    for (const linha of linhas.slice(1)) {
      const celulas = [...linha.cells];
      if (celulas.length < 2) continue;
      const id = idDoLink(celulas[0]);
      const cru = (celulas[0].textContent || "").trim();
      // "(Seed)" e um estado da equipe no torneio, nao parte do nome dela:
      // sai do nome e vira etiqueta propria. O autor continua escrevendo do
      // jeito natural no Word.
      const marca = cru.match(/\s*\((seed[^)]*)\)\s*$/i);
      const nome = marca ? cru.slice(0, marca.index).trim() : cru;
      const etiqueta = marca ? marca[1].trim() : "";
      const valores = celulas.slice(1).map((c) => (c.textContent || "").trim());
      corpo.push({ id, nome, etiqueta, valores });
      if (id) projecao.linhas.set(id, { nome, etiqueta, valores });
    }
    if (!corpo.length) return null;

    const nGrupo = projecao.grupo;
    const nResto = projecao.colunas.length - nGrupo;
    const escudo = (id) => (window.teamLogo ? window.teamLogo(id, "news-proj-escudo") : "");

    return `
      <div class="news-tabela news-proj-rolagem">
        <table class="news-proj">
          <colgroup>
            <col class="news-proj-col-equipe" />
            ${projecao.colunas.map(() => `<col style="width:${(62 / projecao.colunas.length).toFixed(3)}%" />`).join("")}
          </colgroup>
          <thead>
            <tr class="news-proj-faixas">
              <th class="news-proj-canto" scope="col"><span class="news-proj-legenda">Chance de terminar em</span></th>
              <th class="news-proj-faixa vaga" scope="colgroup" colspan="${nGrupo}">Com vaga</th>
              ${nResto > 0 ? `<th class="news-proj-faixa" scope="colgroup" colspan="${nResto}">Sem vaga</th>` : ""}
            </tr>
            <tr class="news-proj-colunas">
              <th class="news-proj-equipe" scope="col">Equipe</th>
              ${projecao.colunas.map((c, i) => `<th scope="col"${i === nGrupo ? ' class="corte"' : ""}>${esc(c)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${corpo.map((r, i) => `
              <tr>
                <th class="news-proj-equipe" scope="row">
                  <span class="news-proj-time">
                    <span class="news-proj-pos">${i + 1}</span>
                    ${escudo(r.id)}
                    <a href="#/teams/${esc(r.id)}">${esc(r.nome)}</a>
                    ${r.etiqueta ? `<span class="news-proj-tag">${esc(r.etiqueta)}</span>` : ""}
                  </span>
                </th>
                ${r.valores.map((v, j) => celulaProjecao(v, j === nGrupo)).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // A faixa do cartao, em dois niveis.
  //
  // As fatias COM VAGA ficam debaixo de UMA legenda, em vez de uma legenda
  // cada. Rotular fatia por fatia fazia a palavra sumir justamente em quem
  // tem chance baixa: a CAAP divide seus 13,4% em 6,1% e 7,3%, e nenhuma das
  // duas tem largura para caber "UPPER". Somadas, as mesmas 13,4% dao 100px
  // no cartao, e "COM VAGA" cabe - que e tambem a leitura que interessa ali,
  // porque a divisao entre as duas rotas ja esta na grade acima.
  //
  // O resto da faixa nao leva texto nenhum: dali para a direita o que se le e
  // o gradiente. O nome exato de cada fatia fica no title e no aria-label.
  function fatiaProjecao(c, total) {
    const p = numeroBr(c.v);
    if (!Number.isFinite(p) || p <= 0) return { html: "", share: 0 };
    const legenda = `${c.rotulo}: ${c.v}%`;
    const share = (p / total) * 100;
    return {
      share,
      html: `<span class="news-proj-fatia${c.i < projecao.grupo ? " vaga" : ""}" style="--larg:${share.toFixed(2)}%;--tinta:${tinta(p).toFixed(3)}" title="${esc(legenda)}" aria-label="${esc(legenda)}"><b>${esc(c.v)}</b></span>`,
    };
  }

  function montaFaixa(faixas, total) {
    const comVaga = faixas.filter((c) => c.i < projecao.grupo);
    const resto = faixas.filter((c) => c.i >= projecao.grupo);
    const partes = [];

    if (comVaga.length) {
      const fatias = comVaga.map((c) => fatiaProjecao(c, total)).filter((f) => f.html);
      const larg = fatias.reduce((s, f) => s + f.share, 0);
      // Dentro do grupo a largura de cada fatia e relativa AO GRUPO, nao a
      // faixa inteira - senao as duas somariam 13% de um container que ja e
      // os 13%.
      const dentro = fatias
        .map((f) => f.html.replace(/--larg:[\d.]+%/, `--larg:${((f.share / larg) * 100).toFixed(2)}%`))
        .join("");
      // Com uma coluna so o grupo nao e um par, entao a legenda e o nome dela.
      const rotulo = comVaga.length > 1 ? "Com vaga" : comVaga[0].rotulo;
      partes.push(
        `<span class="news-proj-grupo" style="--larg:${larg.toFixed(2)}%"><em>${esc(rotulo)}</em><span class="news-proj-grupo-fatias">${dentro}</span></span>`
      );
    }

    for (const c of resto) partes.push(fatiaProjecao(c, total).html);
    return partes.join("");
  }

  // O cartao da equipe: escudo grande, nome, a nota de forca que veio no token
  // e a MESMA linha da grade, agora lida como uma faixa so. E de proposito que
  // a faixa use a mesma rampa da tabela - quem ja viu a grade reconhece a
  // forma da equipe sem precisar reler os numeros.
  function montaCartaoProjecao([id, nota]) {
    const linha = projecao.linhas.get(id);
    if (!linha) return null;
    const t = window.teamById ? window.teamById(id) : null;
    const nome = t?.name || linha.nome;
    const escudo = window.teamLogo ? window.teamLogo(id, "news-proj-cartao-escudo") : "";
    // A faixa do cartao e a distribuicao, entao as colunas de total ficam de
    // fora dela - elas entrariam duas vezes e a soma passaria de 100%.
    const faixas = linha.valores
      .map((v, i) => ({ v, i, rotulo: projecao.colunas[i] || "" }))
      .filter((c) => c.i >= projecao.totais);
    const vaga = projecao.totais ? linha.valores[0] : faixas[0].v;
    const total = faixas.reduce((s, c) => s + (Number.isFinite(numeroBr(c.v)) ? numeroBr(c.v) : 0), 0) || 100;

    // O cartao veste as duas cores da equipe. Elas entram como variavel e o
    // CSS decide a forca: cor de equipe vai de #ffffff a #040404, entao
    // chapar qualquer uma delas atras de texto claro quebraria metade dos
    // cartoes. Aqui elas tingem, nao pintam.
    // Em canais, e nao em hex, para o CSS poder dar alfa nelas sem color-mix.
    const canais = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
      if (!m) return "";
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
    };
    const cores = (Array.isArray(t?.colors) ? t.colors : []).map(canais).filter(Boolean);
    const veste = cores.length
      ? ` style="--c1:${cores[0]};--c2:${cores[1] || cores[0]}"`
      : "";

    return `
      <div class="news-ficha news-proj-cartao${cores.length ? " vestido" : ""}"${veste}>
        <div class="news-ficha-time">
          ${escudo}
          <a href="#/teams/${esc(id)}"><strong>${esc(nome)}</strong></a>
          ${linha.etiqueta ? `<span class="news-proj-tag">${esc(linha.etiqueta)}</span>` : ""}
        </div>
        <div class="news-ficha-grade">
          ${nota ? `<div class="news-ficha-item"><strong>${esc(nota)}</strong><span>Nota de força</span></div>` : ""}
          <div class="news-ficha-item news-proj-vaga"><strong>${esc(vaga)}%</strong><span>Chance de vaga</span></div>
        </div>
        <div class="news-proj-faixa-equipe">${montaFaixa(faixas, total)}</div>
      </div>`;
  }

  function montaProjecao(args, paragrafo) {
    if ((args[0] || "").toLowerCase() === "tabela") return montaTabelaProjecao(args, paragrafo);
    return montaCartaoProjecao(args);
  }

  const BLOCOS = {
    placar: (args) => montaPlacar(args[0], args[1]),
    ficha: montaFicha,
    mappool: montaMapPool,
    elenco: montaElenco,
    previsao: montaPrevisao,
    formula: montaFormula,
    projecao: montaProjecao,
  };

  // Numa materia que apresenta equipe por equipe, cada bloco termina num
  // cartao (a previsao) e o proximo comeca num titulo - sem respiro, o titulo
  // da equipe seguinte cola no cartao da anterior e as duas leem como uma coisa
  // so. Quem marca o inicio de uma equipe e a ficha logo abaixo do titulo, e
  // nao a posicao do titulo no texto: assim isto vale para qualquer materia
  // escrita nesse formato, sem contar paragrafos.
  function marcaSecoesDeEquipe(raiz) {
    const inicios = [...raiz.querySelectorAll("h2")].filter((h) =>
      h.nextElementSibling?.classList.contains("news-ficha")
    );
    inicios.forEach((h, i) => {
      h.classList.add("news-secao");
      // A primeira ganha mais: ali o texto sai da introducao e entra na lista
      // de equipes, que e uma virada maior do que passar de uma equipe a outra.
      if (i === 0) h.classList.add("primeira");
    });
  }

  // ------------------------------------------------------------------ materia

  // Uma tabela de 8 colunas com nome de equipe dentro nao desce de 533px, e a
  // coluna de texto da materia tem 516px num note estreito e 343px num telefone.
  // Sem envelope, ela era cortada na borda direita e nada dizia ao leitor que
  // faltava conteudo - as ultimas colunas simplesmente nao existiam. O envelope
  // rola no eixo X so quando a tabela nao cabe, entao as de 3 e 4 colunas das
  // materias antigas continuam exatamente como eram.
  function rolaTabelasLargas(raiz) {
    for (const tabela of raiz.querySelectorAll("table")) {
      if (tabela.parentElement?.classList.contains("news-tabela")) continue;
      const envelope = document.createElement("div");
      envelope.className = "news-tabela";
      tabela.replaceWith(envelope);
      envelope.appendChild(tabela);
    }
  }

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
      marcaSecoesDeEquipe(corpo);
      // Por ultimo: os blocos tambem montam tabela, e elas merecem o envelope.
      rolaTabelasLargas(corpo);
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
