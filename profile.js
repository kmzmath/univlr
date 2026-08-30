// UNIVLR - perfil publico, na rota #/u/<username>.
//
// Renderiza em duas etapas: o Shell sai sincrono com a casca (o app.js e
// sincrono e nao espera promessa), e o conteudo entra quando o Supabase
// responde. Mesma razao dos comentarios - a navegacao nao pode travar
// esperando rede.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);

  function assuntoHref(t) {
    if (!t) return null;
    if (t.subject_kind === "match") return `#/matches/${encodeURIComponent(t.subject_id)}`;
    if (t.subject_kind === "event") return `#/tournaments/${encodeURIComponent(t.subject_id)}`;
    return null;
  }

  // O nome bonito do assunto vive no JSON buildado, nao no Supabase - a thread
  // so guarda o id. Quando o banco ainda nao chegou, ou o id sumiu num rebuild,
  // cai no rotulo generico em vez de mostrar um id cru para o usuario.
  function assuntoNome(t) {
    if (!t) return "conteúdo removido";
    try {
      // `state` sem `window.`: no app.js ele e `const`, e declaracao lexica de
      // topo nao vira propriedade do window - `window.state` seria undefined.
      // Ler o binding direto funciona aqui porque isto roda em evento, muito
      // depois de o app.js ter executado (no load cairia na zona morta).
      if (typeof state === "undefined" || !state.db) return rotuloGenerico(t);
      if (t.subject_kind === "match") {
        // Mesma busca que renderMatchDetail faz: nao existe matchById().
        const m = state.db.matches.find((x) => x.id === t.subject_id);
        if (m) return `${m.teamA.name} x ${m.teamB.name}`;
      }
      if (t.subject_kind === "event") {
        const e = state.db.tournaments.find((x) => x.id === t.subject_id);
        if (e) return e.name;
      }
    } catch (erro) {
      /* banco ainda carregando, ou id que sumiu num rebuild */
    }
    return rotuloGenerico(t);
  }

  function rotuloGenerico(t) {
    return t.subject_kind === "match" ? "uma partida" : "um campeonato";
  }

  function favoritoHtml(f) {
    if (f.kind === "team") {
      const t = typeof window.teamById === "function" ? window.teamById(f.ref_id) : null;
      return `<a class="perfil-fav" href="#/teams/${esc(f.ref_id)}">${esc(t ? t.name : f.ref_id)}</a>`;
    }
    const p = typeof window.playerById === "function" ? window.playerById(f.ref_id) : null;
    return `<a class="perfil-fav" href="#/players/${esc(f.ref_id)}">${esc(p ? p.nick || p.handle : f.ref_id)}</a>`;
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
    const times = dados.favoritos.filter((f) => f.kind === "team");
    const jogadores = dados.favoritos.filter((f) => f.kind === "player");

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
          <div><dt>Times favoritos</dt><dd>${times.length}</dd></div>
          <div><dt>Jogadores favoritos</dt><dd>${jogadores.length}</dd></div>
        </dl>
      </header>

      ${
        times.length || jogadores.length
          ? `<section class="match-panel">
               <div class="section-head"><div><h2>Favoritos</h2></div></div>
               ${times.length ? `<div class="perfil-favs"><h3>Times</h3><div>${times.map(favoritoHtml).join("")}</div></div>` : ""}
               ${jogadores.length ? `<div class="perfil-favs"><h3>Jogadores</h3><div>${jogadores.map(favoritoHtml).join("")}</div></div>` : ""}
             </section>`
          : ""
      }

      <section class="match-panel">
        <div class="section-head">
          <div><h2>Atividade</h2><p>${dados.total === 0 ? "Nenhum comentário ainda." : "Comentários mais recentes"}</p></div>
        </div>
        ${
          dados.comentarios.length
            ? `<div class="perfil-atividade">
                 ${dados.comentarios
                   .map((c) => {
                     const href = assuntoHref(c.threads);
                     const nome = assuntoNome(c.threads);
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
        const [total, comentarios, favoritos] = await Promise.all([
          window.Community.contarComentarios(p.id),
          window.Community.comentariosDoPerfil(p.id),
          window.Community.listarFavoritos(p.id),
        ]);
        // A rota pode ter mudado durante o await - sem esta guarda, o perfil
        // pintaria por cima da pagina para onde a pessoa ja navegou.
        if (!document.querySelector(`[data-perfil="${CSS.escape(nome)}"]`)) return;
        raiz.innerHTML = conteudo(p, { total, comentarios, favoritos });
      } catch (erro) {
        raiz.innerHTML = `<div class="empty-state">Não deu para carregar o perfil: ${esc(
          window.Community.mensagemDeErro(erro)
        )}</div>`;
      }
    })();
  }

  window.Profile = { renderProfilePage };
})();
