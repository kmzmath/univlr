// UNIVLR - perfil publico, na rota #/u/<username>.
//
// Renderiza em duas etapas: o Shell sai sincrono com a casca (o app.js e
// sincrono e nao espera promessa), e o conteudo entra quando o Supabase
// responde. Mesma razao dos comentarios - a navegacao nao pode travar
// esperando rede.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);

  // A resolucao de assunto vive no comments.js e cobre os cinco tipos. A versao
  // que existia aqui so conhecia partida e evento, entao comentario em perfil
  // de jogador caia no fallback e aparecia como "um campeonato". Duas
  // implementacoes da mesma coisa, e a segunda incompleta - agora e uma so.
  function assunto(t) {
    if (!t) return null;
    return window.Comments?.assuntoDaThread(t.subject_kind, t.subject_id) || null;
  }

  function favoritoHtml(kind, refId) {
    if (!refId) return "";
    if (kind === "team") {
      const t = typeof window.teamById === "function" ? window.teamById(refId) : null;
      const logo = t && typeof window.teamLogo === "function" ? window.teamLogo(t.id, "perfil-fav-logo") : "";
      return `<a class="perfil-fav" href="#/teams/${esc(refId)}">${logo}${esc(t ? t.name : refId)}</a>`;
    }
    const j = typeof window.playerById === "function" ? window.playerById(refId) : null;
    return `<a class="perfil-fav" href="#/players/${esc(j ? j.routeSlug || j.id : refId)}">♥ ${esc(j ? j.nick || j.handle : refId)}</a>`;
  }

  function casca(username) {
    return `
      <section class="perfil-pagina" data-perfil="${esc(username)}">
        <div class="empty-state">Carregando o perfil de ${esc(username)}...</div>
      </section>`;
  }

  function naoEncontrado(username) {
    return `
      <header class="perfil-capa">
        <div class="perfil-identidade">
          <div>
            <h1>Perfil não encontrado</h1>
            <p class="perfil-desde">Ninguém usa o nome <strong>${esc(username)}</strong> no UNIVLR.</p>
          </div>
        </div>
      </header>`;
  }

  function conteudo(p, dados) {
    const eu = window.Community.usuario();
    const souEu = eu && eu.id === p.id;
    const desde = new Date(p.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const time = favoritoHtml("team", p.fav_team);
    const jogador = favoritoHtml("player", p.fav_player);

    return `
      <header class="perfil-capa">
        <div class="perfil-identidade">
          ${window.Comments.avatar(p.username, "grande")}
          <div>
            <h1>${esc(p.username)}${p.role === "admin" ? `<span class="cmt-selo">admin</span>` : ""}</h1>
            <p class="perfil-desde">no UNIVLR desde ${esc(desde)}</p>
            ${p.bio ? `<p class="perfil-bio">${esc(p.bio)}</p>` : ""}
          </div>
          ${souEu ? `<button type="button" class="cmt-enviar perfil-editar" data-auth="conta">Editar perfil</button>` : ""}
        </div>
        <dl class="perfil-numeros">
          <div><dt>Comentários</dt><dd>${dados.total}</dd></div>
          <div><dt>Time</dt><dd class="perfil-numero-fav">${time || "<span>-</span>"}</dd></div>
          <div><dt>Jogador</dt><dd class="perfil-numero-fav">${jogador || "<span>-</span>"}</dd></div>
        </dl>
      </header>

      <section class="match-panel">
        <div class="section-head">
          <div><h2>Atividade</h2><p>${dados.total === 0 ? "Nenhum comentário ainda." : "Comentários mais recentes"}</p></div>
        </div>
        ${
          dados.comentarios.length
            ? `<div class="perfil-atividade">
                 ${dados.comentarios
                   .map((c) => {
                     const a = assunto(c.threads);
                     // `?c=` leva ao comentario em si: o roteador do site le a
                     // query depois do hash, e a secao de comentarios rola ate
                     // ele e o destaca ao montar. Ancora normal (#cmt-id) nao
                     // serve - o hash ja e a rota.
                     const href = a ? `${a.href}${a.href.includes("?") ? "&" : "?"}c=${encodeURIComponent(c.id)}` : null;
                     const nome = a ? a.nome : "conteúdo removido";
                     return `<article class="perfil-item">
                               <header>
                                 ${href ? `<a href="${esc(href)}">${esc(nome)}</a>` : `<span>${esc(nome)}</span>`}
                                 <time>${window.Comments.quando(c.created_at)}</time>
                                 ${c.score > 0 ? `<span class="perfil-score">+${c.score}</span>` : ""}
                               </header>
                               <div class="cmt-corpo">${window.Comments.corpo(c.body)}</div>
                             </article>`;
                   })
                   .join("")}
               </div>`
            : ""
        }
      </section>`;
  }

  // O app.js chama isto de dentro do mapa de rotas; e sincrono por fora e
  // completa sozinho depois.
  function renderProfilePage(username) {
    const nome = String(username || "").trim();
    window.Shell(casca(nome));

    (async () => {
      const raiz = document.querySelector(`[data-perfil]`);
      if (!raiz) return;
      try {
        const p = await window.Community.perfilPublico(nome);
        if (!p) {
          raiz.innerHTML = naoEncontrado(nome);
          return;
        }
        const [total, comentarios] = await Promise.all([
          window.Community.contarComentarios(p.id),
          window.Community.comentariosDoPerfil(p.id),
        ]);
        // A rota pode ter mudado durante o await - sem esta guarda, o perfil
        // pintaria por cima da pagina para onde a pessoa ja navegou.
        if (!document.querySelector(`[data-perfil="${CSS.escape(nome)}"]`)) return;
        raiz.innerHTML = conteudo(p, { total, comentarios });
      } catch (erro) {
        raiz.innerHTML = `<div class="empty-state">Não deu para carregar o perfil: ${esc(
          window.Community.mensagemDeErro(erro)
        )}</div>`;
      }
    })();
  }

  window.Profile = { renderProfilePage };
})();
