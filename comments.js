// UNIVLR - secao de comentarios.
//
// Entra no fim da pagina de partida e da de evento. O desenho segue a doutrina
// do projeto: vermelho e marca, nunca dado - o botao de +1 aceso usa o teal,
// nao o vermelho, porque contagem de voto e dado.
//
// Carrega DEPOIS do primeiro paint: `shell()` devolve a casca sincrona e
// `montar()` busca os comentarios em seguida. Sem isso, a partida (que e o
// motivo de a pessoa estar ali) esperaria uma ida ao Supabase para aparecer.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);
  const MAX = 2000;
  // Tres niveis de recuo e o limite antes de a conversa virar uma escada fina
  // demais no celular. Do quarto em diante a resposta fica no mesmo nivel do
  // pai - a linha "respondendo a fulano" e quem carrega o vinculo.
  const RECUO_MAX = 3;

  let atual = null; // { kind, id, comentarios, meusVotos, respondendo, editando }

  // ------------------------------------------------------------------ tempo

  function quando(iso) {
    const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) return "agora";
    if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
    if (seg < 604800) return `há ${Math.floor(seg / 86400)} d`;
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
  }

  // ----------------------------------------------------------------- avatar
  // Sem upload de foto neste ciclo: a inicial sobre uma cor derivada do nome.
  // O mesmo nome sempre cai na mesma cor, entao a pessoa fica reconhecivel na
  // thread sem nenhuma requisicao de imagem.

  const TONS = ["#6658b8", "#2ad4c1", "#ffb340", "#8ab4ff", "#31e981", "#ff6678", "#d17cc4", "#7cb3d1"];

  function avatar(username, tamanho) {
    const nome = String(username || "?");
    let soma = 0;
    for (let i = 0; i < nome.length; i++) soma = (soma * 31 + nome.charCodeAt(i)) >>> 0;
    const cor = TONS[soma % TONS.length];
    return `<span class="cmt-avatar ${tamanho === "grande" ? "grande" : ""}" style="--avatar-cor:${cor}" aria-hidden="true">${esc(nome[0].toUpperCase())}</span>`;
  }

  // ------------------------------------------------------------- fa de quem
  //
  // Formato da HLTV: "♥ jogador | [bandeira] usuario". Aqui o time favorito
  // ocupa o lugar da bandeira, porque e o mesmo papel - o vinculo que a pessoa
  // declara, colado no nome dela.
  //
  // Os dois ids vem no embed do autor (profiles.fav_team / fav_player), entao
  // isto nao custa consulta nenhuma. O nome bonito vem do JSON buildado; se o
  // banco ainda nao chegou, ou o id sumiu num rebuild, o selo simplesmente nao
  // aparece - melhor faltar do que mostrar um id cru ao lado do nome.
  function selosDeFa(autor) {
    if (!autor) return "";
    let saida = "";

    if (autor.fav_player) {
      const j = typeof window.playerById === "function" ? window.playerById(autor.fav_player) : null;
      if (j) {
        saida += `<a class="cmt-fa-jogador" href="#/players/${esc(j.routeSlug || j.id)}"
                     title="Jogador favorito">♥ ${esc(j.nick || j.handle)}</a>
                  <span class="cmt-fa-sep" aria-hidden="true">|</span>`;
      }
    }

    if (autor.fav_team) {
      const t = typeof window.teamById === "function" ? window.teamById(autor.fav_team) : null;
      if (t && typeof window.teamLogo === "function") {
        saida += `<a class="cmt-fa-time" href="#/teams/${esc(t.id)}" title="Time favorito: ${esc(t.name)}">
                    ${window.teamLogo(t.id, "cmt-fa-logo")}
                  </a>`;
      }
    }

    return saida;
  }

  // ------------------------------------------------------------------ corpo
  // Escapa PRIMEIRO, marca mencao depois. Na ordem inversa, um `<script>` no
  // texto entraria no HTML antes de virar entidade.

  function corpo(texto) {
    return esc(texto)
      .replace(/@([A-Za-z0-9_]{3,20})/g, '<a class="cmt-mencao" href="#/u/$1">@$1</a>')
      .replace(/\n/g, "<br>");
  }

  // ------------------------------------------------------------------ arvore

  function emArvore(lista) {
    const porId = new Map(lista.map((c) => [c.id, { ...c, filhos: [] }]));
    const raizes = [];
    porId.forEach((c) => {
      const pai = c.parent_id ? porId.get(c.parent_id) : null;
      if (pai) pai.filhos.push(c);
      else raizes.push(c);
    });
    return raizes;
  }

  // --------------------------------------------------------------- desenho

  function umComentario(c, nivel, paiNome) {
    const C = window.Community;
    const eu = C.usuario();
    const meu = eu && c.author_id === eu.id;
    const apagado = Boolean(c.deleted_at);
    const autor = c.profiles ? c.profiles.username : "desconhecido";
    const votei = atual.meusVotos.has(c.id);
    const podeEditar = meu && !apagado && Date.now() - new Date(c.created_at).getTime() < 15 * 60 * 1000;
    const podeApagar = !apagado && (meu || C.ehAdmin());
    const editando = atual.editando === c.id;

    const acoes = apagado
      ? ""
      : `
        <div class="cmt-acoes">
          <button type="button" class="cmt-voto ${votei ? "ativo" : ""}" data-votar="${esc(c.id)}"
                  aria-pressed="${votei}" aria-label="Dar +1 neste comentário">
            <span aria-hidden="true">+1</span><span class="cmt-score">${c.score}</span>
          </button>
          ${C.logado() ? `<button type="button" class="cmt-link" data-responder="${esc(c.id)}">Responder</button>` : ""}
          ${podeEditar ? `<button type="button" class="cmt-link" data-editar="${esc(c.id)}">Editar</button>` : ""}
          ${podeApagar ? `<button type="button" class="cmt-link" data-apagar="${esc(c.id)}">Apagar</button>` : ""}
          ${C.logado() && !meu ? `<button type="button" class="cmt-link discreto" data-denunciar="${esc(c.id)}">Denunciar</button>` : ""}
        </div>`;

    const texto = apagado
      ? `<p class="cmt-removido">Comentário removido.</p>`
      : editando
        ? formulario("editar", c.id, c.body)
        : `<div class="cmt-corpo">${corpo(c.body)}</div>`;

    const filhos = c.filhos.length
      ? `<div class="cmt-filhos ${nivel >= RECUO_MAX ? "sem-recuo" : ""}">
           ${c.filhos.map((f) => umComentario(f, nivel + 1, autor)).join("")}
         </div>`
      : "";

    return `
      <article class="cmt ${apagado ? "apagado" : ""}" data-cmt="${esc(c.id)}" id="cmt-${esc(c.id)}">
        <div class="cmt-linha">
          ${avatar(autor)}
          <div class="cmt-conteudo">
            <header class="cmt-cabeca">
              ${apagado ? "" : selosDeFa(c.profiles)}
              ${apagado ? `<span class="cmt-autor">-</span>` : `<a class="cmt-autor" href="#/u/${esc(autor)}">${esc(autor)}</a>`}
              ${c.profiles && c.profiles.role === "admin" ? `<span class="cmt-selo">admin</span>` : ""}
              <time datetime="${esc(c.created_at)}">${quando(c.created_at)}</time>
              ${c.edited_at && !apagado ? `<span class="cmt-editado">editado</span>` : ""}
              ${nivel > RECUO_MAX && paiNome ? `<span class="cmt-para">para @${esc(paiNome)}</span>` : ""}
            </header>
            ${texto}
            ${acoes}
            <div class="cmt-resposta-slot" data-slot="${esc(c.id)}">${
              atual.respondendo === c.id ? formulario("responder", c.id, "") : ""
            }</div>
          </div>
        </div>
        ${filhos}
      </article>`;
  }

  function formulario(modo, id, valor) {
    const rotulo = modo === "editar" ? "Salvar" : modo === "responder" ? "Responder" : "Comentar";
    return `
      <form class="cmt-form" data-form="${esc(modo)}" data-alvo="${esc(id || "")}">
        <textarea name="corpo" rows="${modo === "novo" ? 3 : 2}" maxlength="${MAX}"
                  placeholder="${modo === "responder" ? "Escreva uma resposta" : "Escreva um comentário"}"
                  aria-label="${rotulo}">${esc(valor)}</textarea>
        <div class="cmt-form-rodape">
          <span class="cmt-contador" aria-live="polite">${MAX - String(valor).length}</span>
          <div class="cmt-form-botoes">
            ${modo !== "novo" ? `<button type="button" class="cmt-link" data-cancelar="1">Cancelar</button>` : ""}
            <button type="submit" class="cmt-enviar">${rotulo}</button>
          </div>
        </div>
        <p class="cmt-erro" role="alert" hidden></p>
      </form>`;
  }

  function cabecalhoForm() {
    const C = window.Community;
    if (!C.logado())
      return `<div class="cmt-convite">
                <p>Entre na sua conta para comentar.</p>
                <button type="button" class="cmt-enviar" data-abrir-login="1">Entrar ou criar conta</button>
              </div>`;
    if (C.banido())
      return `<div class="cmt-convite"><p>Sua conta está suspensa e não pode comentar.</p></div>`;
    return formulario("novo", "", "");
  }

  function desenha() {
    const raiz = document.querySelector(`[data-comentarios]`);
    if (!raiz || !atual) return;
    const n = atual.comentarios.filter((c) => !c.deleted_at).length;
    raiz.innerHTML = `
      <div class="section-head">
        <div><h2>Comentários</h2><p>${n === 0 ? "Ninguém comentou ainda." : `${n} ${n === 1 ? "comentário" : "comentários"}`}</p></div>
      </div>
      ${cabecalhoForm()}
      <div class="cmt-lista">
        ${emArvore(atual.comentarios).map((c) => umComentario(c, 0, null)).join("")}
      </div>`;
  }

  // ---------------------------------------------------------------- eventos

  function erroNoForm(form, texto) {
    const p = form.querySelector(".cmt-erro");
    if (!p) return;
    p.textContent = texto;
    p.hidden = false;
  }

  async function recarrega() {
    const { comentarios, meusVotos } = await window.Community.listarComentarios(atual.kind, atual.id);
    atual.comentarios = comentarios;
    atual.meusVotos = meusVotos;
    desenha();
  }

  function liga(raiz) {
    raiz.addEventListener("input", (ev) => {
      const ta = ev.target.closest("textarea[name=corpo]");
      if (!ta) return;
      const contador = ta.closest(".cmt-form")?.querySelector(".cmt-contador");
      if (contador) contador.textContent = String(MAX - ta.value.length);
    });

    raiz.addEventListener("submit", async (ev) => {
      const form = ev.target.closest(".cmt-form");
      if (!form) return;
      ev.preventDefault();
      const modo = form.dataset.form;
      const alvo = form.dataset.alvo;
      const texto = form.querySelector("textarea[name=corpo]").value.trim();
      if (!texto) return erroNoForm(form, "Escreva alguma coisa antes de enviar.");

      const botao = form.querySelector(".cmt-enviar");
      botao.disabled = true;
      try {
        if (modo === "editar") await window.Community.editarComentario(alvo, texto);
        else await window.Community.comentar(atual.kind, atual.id, texto, modo === "responder" ? alvo : null);
        atual.respondendo = null;
        atual.editando = null;
        await recarrega();
      } catch (erro) {
        botao.disabled = false;
        erroNoForm(form, window.Community.mensagemDeErro(erro));
      }
    });

    raiz.addEventListener("click", async (ev) => {
      const alvo = ev.target;

      if (alvo.closest("[data-abrir-login]")) return window.Auth.abrir("entrar");

      const cancelar = alvo.closest("[data-cancelar]");
      if (cancelar) {
        atual.respondendo = null;
        atual.editando = null;
        return desenha();
      }

      const responder = alvo.closest("[data-responder]");
      if (responder) {
        atual.respondendo = atual.respondendo === responder.dataset.responder ? null : responder.dataset.responder;
        atual.editando = null;
        desenha();
        raiz.querySelector(`[data-slot="${atual.respondendo}"] textarea`)?.focus();
        return;
      }

      const editar = alvo.closest("[data-editar]");
      if (editar) {
        atual.editando = atual.editando === editar.dataset.editar ? null : editar.dataset.editar;
        atual.respondendo = null;
        desenha();
        raiz.querySelector(`[data-cmt="${atual.editando}"] textarea`)?.focus();
        return;
      }

      const votar = alvo.closest("[data-votar]");
      if (votar) {
        if (!window.Community.logado()) return window.Auth.abrir("entrar");
        const id = votar.dataset.votar;
        const tinha = atual.meusVotos.has(id);
        // Otimista: o botao responde no clique e a lista so e refeita se o
        // servidor recusar. Esperar a ida e volta para pintar um +1 faz o
        // botao parecer quebrado numa conexao ruim.
        const alvoCmt = atual.comentarios.find((c) => c.id === id);
        if (alvoCmt) alvoCmt.score += tinha ? -1 : 1;
        if (tinha) atual.meusVotos.delete(id);
        else atual.meusVotos.add(id);
        desenha();
        try {
          await window.Community.votar(id, !tinha);
        } catch (erro) {
          console.warn("voto recusado:", window.Community.mensagemDeErro(erro));
          await recarrega();
        }
        return;
      }

      const apagar = alvo.closest("[data-apagar]");
      if (apagar) {
        if (!window.confirm("Apagar este comentário? O texto não volta.")) return;
        try {
          await window.Community.apagarComentario(apagar.dataset.apagar);
          await recarrega();
        } catch (erro) {
          window.alert(window.Community.mensagemDeErro(erro));
        }
        return;
      }

      const denunciar = alvo.closest("[data-denunciar]");
      if (denunciar) {
        const motivo = window.prompt("Por que este comentário deve ser revisado?");
        if (!motivo) return;
        try {
          await window.Community.denunciar(denunciar.dataset.denunciar, motivo.slice(0, 500));
          window.alert("Denúncia enviada. Obrigado.");
        } catch (erro) {
          window.alert(window.Community.mensagemDeErro(erro));
        }
      }
    });
  }

  // ------------------------------------------------------------------ saida

  // Casca sincrona, para o HTML da partida sair inteiro no primeiro paint.
  function shell(kind, id) {
    return `<section class="match-panel cmt-secao" data-comentarios data-kind="${esc(kind)}" data-id="${esc(id)}">
              <div class="section-head"><div><h2>Comentários</h2><p>Carregando...</p></div></div>
            </section>`;
  }

  async function montar(kind, id) {
    const raiz = document.querySelector("[data-comentarios]");
    if (!raiz) return;
    atual = { kind, id: String(id), comentarios: [], meusVotos: new Set(), respondendo: null, editando: null };
    liga(raiz);
    try {
      await recarrega();
    } catch (erro) {
      raiz.innerHTML = `<div class="section-head"><div><h2>Comentários</h2>
        <p>Não deu para carregar: ${esc(window.Community.mensagemDeErro(erro))}</p></div></div>`;
    }
  }

  window.Comments = { shell, montar, avatar, quando, corpo };
})();
