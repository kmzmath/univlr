// UNIVLR - botao de favoritar equipe e jogador.
//
// Arquivo proprio porque o botao aparece nas paginas de equipe e de jogador,
// que nao sao de nenhum dos outros modulos da comunidade. O dado vive no
// community-core; aqui so mora o desenho e o clique.
//
// O estado sai do cache em memoria (Community.ehFavorito), nunca de uma ida ao
// servidor: as paginas de equipe e de jogador sao montadas de uma vez so, em
// string, sem await no meio.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);

  const CORACAO = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 14.2 2.9 9.3a3.3 3.3 0 0 1 0-4.7 3.3 3.3 0 0 1 4.7 0L8 5l.4-.4a3.3 3.3 0 0 1 4.7 0 3.3 3.3 0 0 1 0 4.7Z"/></svg>`;

  function botao(kind, refId) {
    // Deslogado ainda ve o botao: clicar abre o login. Esconder o caminho de
    // uma acao e o jeito mais rapido de a pessoa nao descobrir que ela existe.
    const logado = window.Community.logado();
    const ativo = logado && window.Community.ehFavorito(kind, refId);
    const outro = logado && !ativo ? window.Community.favoritoAtual(kind) : null;
    // "equipe" e feminino e "jogador" e masculino - sem os dois artigos o
    // aviso sai como "seu equipe favorito".
    const t = kind === "team"
      ? { perde: "sua equipe favorita", limite: "uma equipe favorita" }
      : { perde: "seu jogador favorito", limite: "um jogador favorito" };

    // Só existe UM favorito de cada tipo, entao marcar aqui desmarca o outro.
    // O titulo avisa qual sai, senao a troca parece um bug: a pessoa favorita
    // um time novo e o coracao do antigo apaga sem explicacao.
    const titulo = ativo
      ? `Deixar de ser fã`
      : outro
        ? `Trocar: ${esc(nomeDe(kind, outro))} deixa de ser ${t.perde}`
        : `Ser fã (você só pode ter ${t.limite})`;

    return `<button type="button" class="fav-botao ${ativo ? "ativo" : ""}"
              data-favoritar="${esc(kind)}" data-ref="${esc(refId)}"
              aria-pressed="${ativo}" title="${titulo}">
              ${CORACAO}<span>${ativo ? "Fã" : "Ser fã"}</span>
            </button>`;
  }

  // O nome bonito vive no JSON buildado; o banco so guarda o id.
  function nomeDe(kind, refId) {
    try {
      if (kind === "team") {
        const t = typeof window.teamById === "function" ? window.teamById(refId) : null;
        return t ? t.name : refId;
      }
      const j = typeof window.playerById === "function" ? window.playerById(refId) : null;
      return j ? j.nick || j.handle : refId;
    } catch (erro) {
      return refId;
    }
  }

  // Um unico ouvinte no documento, registrado na carga. As paginas sao
  // redesenhadas inteiras a cada render, entao ligar no elemento exigiria
  // relembrar de religar em cada uma - delegar no documento nao exige nada.
  document.addEventListener("click", async (ev) => {
    const alvo = ev.target.closest("[data-favoritar]");
    if (!alvo) return;
    if (!window.Community.logado()) return window.Auth.abrir("entrar");

    const kind = alvo.dataset.favoritar;
    const ref = alvo.dataset.ref;
    const tinha = window.Community.ehFavorito(kind, ref);

    // Otimista, como o +1: pinta na hora e desfaz se o servidor recusar.
    pinta(alvo, !tinha);
    try {
      await window.Community.definirFavorito(kind, ref);
      // Se havia OUTRO favorito deste tipo em algum lugar da tela (a lista de
      // elenco mostra varios jogadores), o coracao dele precisa apagar - o
      // servidor ja trocou, e deixar dois acesos mentiria sobre o estado.
      sincronizaOutros(kind, ref);
    } catch (erro) {
      pinta(alvo, tinha);
      console.warn("favorito recusado:", window.Community.mensagemDeErro(erro));
    }
  });

  function sincronizaOutros(kind, refAtivo) {
    document.querySelectorAll(`[data-favoritar="${kind}"]`).forEach((el) => {
      if (el.dataset.ref !== refAtivo) pinta(el, false);
    });
  }

  function pinta(botaoEl, ativo) {
    botaoEl.classList.toggle("ativo", ativo);
    botaoEl.setAttribute("aria-pressed", String(ativo));
    const texto = botaoEl.querySelector("span");
    if (texto) texto.textContent = ativo ? "Fã" : "Ser fã";
  }

  window.Favorites = { botao };
})();
