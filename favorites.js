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

  function botao(kind, refId, rotulo) {
    // Deslogado ainda ve o botao: clicar abre o login. Esconder o caminho de
    // uma acao e o jeito mais rapido de a pessoa nao descobrir que ela existe.
    const ativo = window.Community.logado() && window.Community.ehFavorito(kind, refId);
    const nome = rotulo || (kind === "team" ? "equipe" : "jogador");
    return `<button type="button" class="fav-botao ${ativo ? "ativo" : ""}"
              data-favoritar="${esc(kind)}" data-ref="${esc(refId)}"
              aria-pressed="${ativo}"
              title="${ativo ? `Desfavoritar ${esc(nome)}` : `Favoritar ${esc(nome)}`}">
              ${CORACAO}<span>${ativo ? "Favorito" : "Favoritar"}</span>
            </button>`;
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
      await window.Community.favoritar(kind, ref, !tinha);
    } catch (erro) {
      pinta(alvo, tinha);
      console.warn("favorito recusado:", window.Community.mensagemDeErro(erro));
    }
  });

  function pinta(botaoEl, ativo) {
    botaoEl.classList.toggle("ativo", ativo);
    botaoEl.setAttribute("aria-pressed", String(ativo));
    const texto = botaoEl.querySelector("span");
    if (texto) texto.textContent = ativo ? "Favorito" : "Favoritar";
  }

  window.Favorites = { botao };
})();
