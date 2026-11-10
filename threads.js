// UNIVLR - threads livres.
//
// A conversa de assunto livre, aberta por quem tem conta: o painel da home
// (trilho da esquerda, embaixo do ranking), a lista completa (#/forum), a
// pagina de cada uma (#/forum/<id>) e o formulario (#/forum/nova).
//
// O dado vem do Supabase pelo community-core.js (listarTopicos, topico,
// criarTopico...). A conversa dentro da thread e o comments.js de sempre, no
// tipo `topic`: resposta, voto, denuncia e aviso nao tem codigo novo aqui.
//
// Arquivo separado do app.js pelo motivo de sempre (ver news.js). Carrega
// depois do comments.js e antes do app.js, e nao toca `state` na carga.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);
  const POR_PAGINA = 50;
  const PAINEL_LIMITE = 5;
  const EDITA_MINUTOS = 15;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const hrefDaThread = (id) => `#/forum/${encodeURIComponent(id)}`;
  const quando = (iso) => (window.Comments ? window.Comments.quando(iso) : "");
  const logado = () => Boolean(window.Community && window.Community.logado());

  // Conta apagada fica sem link: o perfil nao existe mais.
  function autorHtml(username) {
    if (!username) return `<span class="th-apagada">conta apagada</span>`;
    return `<a class="th-autor" href="#/u/${encodeURIComponent(username)}">${esc(username)}</a>`;
  }

  // Link e nao botao: o endereco funciona sozinho (Voltar, abrir em outra aba).
  // Sem conta, o clique abre o convite de login em vez de navegar.
  function botaoNova(secundario) {
    return `<a class="th-nova${secundario ? " sec" : ""}" href="#/forum/nova" data-th-nova>+ Nova thread</a>`;
  }

  // ---------------------------------------------------------- painel da home

  function painelHome() {
    const itens = (window.Community?.topicosRecentes?.() || []).slice(0, PAINEL_LIMITE);
    const linhas = itens.length
      ? itens
          .map(
            (t) => `<a class="th-linha" href="${hrefDaThread(t.id)}">
              <span class="th-titulo" title="${esc(t.title)}">${esc(t.title)}</span>
              <span class="th-meta">${t.author_username ? esc(t.author_username) : "conta apagada"} · ${esc(quando(t.ultima_atividade))}</span>
              <span class="atv-conta th-conta">${Number(t.respostas) || 0}</span>
            </a>`
          )
          .join("")
      : `<p class="th-vazio">Nenhuma thread ainda.</p>`;
    return `
      <section class="th-painel">
        ${window.panelTitle ? window.panelTitle("Fórum", "forum", "Ver todas") : `<header class="vp-sec"><h2>Fórum</h2><a class="vp-sec-more" href="#/forum">Ver todas</a></header>`}
        <div class="th-lista">${linhas}</div>
        <div class="th-pe">${botaoNova(true)}</div>
        ${window.Comments?.atividadeNoPainel ? window.Comments.atividadeNoPainel(5) : ""}
      </section>`;
  }

  // ------------------------------------------------------------------ casca
  //
  // As tres telas carregam do banco depois do primeiro paint. A casca sai na
  // hora (sem pular a pagina) e o conteudo entra no lugar dela. `vez` descarta
  // a resposta de uma navegacao que ja ficou para tras.

  let vez = 0;

  // `conteudoPrimeiro`: no celular a thread (ou o formulario) vem antes das
  // outras threads. Na lista e o contrario: o botao de abrir fica no topo, e
  // nao depois de 50 linhas.
  function casca(esquerda, principal, conteudoPrimeiro) {
    window.Shell(`
      <div class="th-pagina${conteudoPrimeiro ? " th-conteudo-primeiro" : ""}">
        <aside class="th-esq">${esquerda}</aside>
        <section class="th-larga" data-th-principal>${principal}</section>
      </div>`);
    return ++vez;
  }

  function preenche(minhaVez, seletor, html) {
    if (minhaVez !== vez) return null;
    const alvo = document.querySelector(seletor);
    if (alvo) alvo.innerHTML = html;
    return alvo;
  }

  const carregando = `<p class="th-carregando">Carregando...</p>`;
  const falhou = (erro) =>
    `<div class="empty-state"><strong>Não deu para carregar as threads.</strong><p>${esc(window.Community.mensagemDeErro(erro))}</p></div>`;

  const blocoNovaConversa = `
    <header class="vp-sec"><h2>Nova conversa</h2></header>
    <div class="th-explica">
      ${botaoNova()}
    </div>`;

  function outrasThreads(atual) {
    const itens = (window.Community.topicosRecentes() || []).filter((t) => t.id !== atual).slice(0, 6);
    return `
      <header class="vp-sec"><h2>Outras threads</h2><a class="vp-sec-more" href="#/forum">Ver todas</a></header>
      ${
        itens.length
          ? `<div class="th-bloco th-outras">${itens
              .map((t) => `<a href="${hrefDaThread(t.id)}"><b title="${esc(t.title)}">${esc(t.title)}</b><i>${Number(t.respostas) || 0}</i></a>`)
              .join("")}</div>`
          : ""
      }
      <div class="th-esq-pe">${botaoNova(true)}</div>`;
  }

  // ------------------------------------------------------------------- lista

  function linhaDaTabela(t) {
    return `<tr>
      <td class="th-c-tit"><a href="${hrefDaThread(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a></td>
      <td class="th-c-num">${Number(t.respostas) || 0}</td>
      <td class="th-c-aut">${autorHtml(t.author_username)}</td>
      <td class="th-c-atv">${esc(quando(t.ultima_atividade))}</td>
    </tr>`;
  }

  // No celular a tabela nao cabe sem cortar coluna, e nada fica escondido no
  // site: la a mesma lista vira as linhas compactas do painel da home.
  function linhaCompacta(t) {
    return `<a class="th-linha" href="${hrefDaThread(t.id)}">
      <span class="th-titulo" title="${esc(t.title)}">${esc(t.title)}</span>
      <span class="th-meta">${t.author_username ? esc(t.author_username) : "conta apagada"} · ${esc(quando(t.ultima_atividade))}</span>
      <span class="atv-conta th-conta">${Number(t.respostas) || 0}</span>
    </a>`;
  }

  async function renderLista() {
    const pagina = Math.max(1, parseInt(window.routeQuery().get("pagina"), 10) || 1);
    const minhaVez = casca(blocoNovaConversa, `<header class="vp-sec"><h1>Fórum</h1></header>${carregando}`);
    let resultado;
    try {
      resultado = await window.Community.listarTopicos({ pagina, porPagina: POR_PAGINA });
    } catch (erro) {
      preenche(minhaVez, "[data-th-principal]", `<header class="vp-sec"><h1>Fórum</h1></header>${falhou(erro)}`);
      return;
    }
    const { itens, total } = resultado;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const contagem = `<p class="lista-contagem" role="status" aria-live="polite">${total} ${total === 1 ? "thread" : "threads"}</p>`;
    const corpo = itens.length
      ? `<div class="th-bloco th-tabela-bloco">
           <table class="th-tabela">
             <thead><tr><th scope="col">Tópico</th><th scope="col" class="th-c-num">Respostas</th><th scope="col">Autor</th><th scope="col">Atividade</th></tr></thead>
             <tbody>${itens.map(linhaDaTabela).join("")}</tbody>
           </table>
         </div>
         <div class="th-bloco th-compactas">${itens.map(linhaCompacta).join("")}</div>
         ${window.paginacaoDaLista("forum", pagina, paginas, new URLSearchParams())}`
      : `<p class="th-vazio">Nenhuma thread ainda.</p>`;
    preenche(minhaVez, "[data-th-principal]", `<header class="vp-sec"><h1>Fórum</h1>${contagem}</header>${corpo}`);
  }

  // ------------------------------------------------------------- formulario
  //
  // Escrever no proprio cartao da thread (opcao B, escolha do dono): o
  // formulario tem a cara do que vai ser publicado. Serve para abrir e para
  // editar.

  function cartaoFormulario({ titulo = "", texto = "", autor, botao, cancelar }) {
    return `
      <form class="th-bloco th-cartao th-form" data-th-form novalidate>
        <div class="th-cabeca">
          <label class="sr-only" for="th-titulo">Título</label>
          <input class="th-input-titulo" id="th-titulo" name="titulo" maxlength="120" placeholder="Título da thread" value="${esc(titulo)}" autocomplete="off" required />
          <div class="th-meta">${window.Comments.avatar(autor)}<span>${esc(autor)}</span></div>
        </div>
        <div class="th-corpo">
          <label class="sr-only" for="th-texto">Texto (opcional)</label>
          <textarea class="th-input-texto" id="th-texto" name="texto" maxlength="2000" placeholder="Texto (opcional)">${esc(texto)}</textarea>
        </div>
        <p class="th-erro" role="alert" hidden></p>
        <div class="th-acoes">
          <button class="th-nova" type="submit">${botao}</button>
          <a class="th-cancelar" href="${cancelar}">Cancelar</a>
          <small class="th-dica-form">Título de 5 a 120 caracteres · texto opcional</small>
        </div>
      </form>`;
  }

  // Liga o envio. `acao` recebe titulo e texto e devolve uma Promise; com
  // erro, a mensagem aparece no cartao e o que foi digitado continua la.
  function ligaFormulario(form, acao) {
    if (!form) return;
    const erro = form.querySelector(".th-erro");
    const botao = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (botao.disabled) return;
      botao.disabled = true;
      erro.hidden = true;
      try {
        await acao(form.titulo.value, form.texto.value);
      } catch (e) {
        erro.textContent = window.Community.mensagemDeErro(e);
        erro.hidden = false;
        botao.disabled = false;
      }
    });
  }

  // O auth.js redesenha a pagina inteira a cada evento de conta, inclusive a
  // renovacao do token, que chega sozinha enquanto a pessoa digita. Sem isto
  // o redesenho apagava o titulo e o texto (os comentarios fazem o mesmo com o
  // rascunho deles). Guarda o que estava escrito e devolve no formulario novo.
  function rascunhoAtual() {
    const form = document.querySelector("[data-th-form]");
    if (!form || !/^#\/threads\/nova\b/.test(window.location.hash)) return null;
    return { titulo: form.titulo.value, texto: form.texto.value };
  }

  function renderNova() {
    const rascunho = rascunhoAtual();
    const perfil = window.Community.perfil();
    let principal;
    if (!logado()) {
      principal = `<div class="th-bloco th-aviso"><p>Entre na sua conta para abrir uma thread.</p>
        <button type="button" class="th-nova" data-th-login>Entrar ou criar conta</button></div>`;
    } else if (window.Community.banido()) {
      principal = `<div class="th-bloco th-aviso"><p>Sua conta está suspensa e não pode abrir threads agora.</p></div>`;
    } else {
      principal = cartaoFormulario({
        autor: perfil.username,
        titulo: rascunho ? rascunho.titulo : "",
        texto: rascunho ? rascunho.texto : "",
        botao: "Publicar",
        cancelar: "#/forum",
      });
    }
    casca(outrasThreads(null), `<a class="th-voltar" href="#/forum">‹ Fórum</a><h1 class="sr-only">Nova thread</h1>${principal}`, true);
    const form = document.querySelector("[data-th-form]");
    ligaFormulario(form, async (titulo, texto) => {
      const id = await window.Community.criarTopico(titulo, texto);
      window.location.hash = hrefDaThread(id);
    });
    // Foco no titulo so na chegada: num redesenho a pessoa pode estar no texto.
    if (form && !rascunho) form.titulo.focus();
  }

  // ------------------------------------------------------------------ thread

  function podeEditar(t) {
    const perfil = window.Community.perfil();
    return Boolean(perfil && t.author_id === perfil.id && Date.now() - Date.parse(t.created_at) < EDITA_MINUTOS * 60000);
  }

  function podeApagar(t) {
    const perfil = window.Community.perfil();
    return Boolean(perfil && (t.author_id === perfil.id || window.Community.ehAdmin()));
  }

  function cartaoDaThread(t) {
    const respostas = window.Community.contagem("topic", t.id);
    const autor = t.autor;
    const acoes = [
      podeEditar(t) ? `<button type="button" class="th-acao" data-th-editar>Editar</button>` : "",
      podeApagar(t) ? `<button type="button" class="th-acao" data-th-apagar>Apagar</button>` : "",
    ].join("");
    return `
      <article class="th-bloco th-cartao">
        <div class="th-cabeca">
          <h1>${esc(t.title)}</h1>
          <div class="th-meta">
            ${autor ? window.Comments.avatar(autor.username) : ""}
            ${autorHtml(autor && autor.username)}
            ${autor && window.Comments.selos ? window.Comments.selos(autor) : ""}
            <span aria-hidden="true">·</span><time datetime="${esc(t.created_at)}">${esc(quando(t.created_at))}</time>
            ${t.edited_at ? `<span class="th-editada">editada</span>` : ""}
            <span aria-hidden="true">·</span><span>${respostas} ${respostas === 1 ? "resposta" : "respostas"}</span>
          </div>
        </div>
        ${t.body ? `<div class="th-corpo">${window.Comments.corpo(t.body)}</div>` : ""}
        ${acoes ? `<div class="th-acoes">${acoes}</div>` : ""}
      </article>`;
  }

  async function renderThread(id) {
    const minhaVez = casca(outrasThreads(id), `<a class="th-voltar" href="#/forum">‹ Fórum</a>${carregando}`, true);
    let t;
    try {
      t = UUID.test(id) ? await window.Community.topico(id) : null;
    } catch (erro) {
      preenche(minhaVez, "[data-th-principal]", `<a class="th-voltar" href="#/forum">‹ Fórum</a>${falhou(erro)}`);
      return;
    }
    if (!t) {
      preenche(minhaVez, "[data-th-principal]", `<a class="th-voltar" href="#/forum">‹ Fórum</a>
        <div class="empty-state"><strong>Thread não encontrada.</strong><p><a class="subtle-link" href="#/forum">Ver todas as threads</a></p></div>`);
      return;
    }
    if (t.deleted_at) {
      preenche(minhaVez, "[data-th-principal]", `<a class="th-voltar" href="#/forum">‹ Fórum</a>
        <div class="th-bloco th-aviso"><h1>Thread apagada</h1><p>Quem abriu esta thread apagou. A conversa dela não aparece mais.</p></div>`);
      return;
    }
    document.title = `${t.title} - UNIVLR`;
    const alvo = preenche(
      minhaVez,
      "[data-th-principal]",
      `<a class="th-voltar" href="#/forum">‹ Fórum</a>
       <div data-th-cartao>${cartaoDaThread(t)}</div>
       ${window.Comments.shell("topic", t.id)}`
    );
    if (!alvo) return;
    window.Comments.montar("topic", t.id);
    ligaCartao(alvo, t);
  }

  function ligaCartao(alvo, t) {
    const lugar = alvo.querySelector("[data-th-cartao]");
    lugar.querySelector("[data-th-apagar]")?.addEventListener("click", async (ev) => {
      if (!window.confirm("Apagar esta thread? A conversa dela deixa de aparecer, e isso não tem volta.")) return;
      ev.currentTarget.disabled = true;
      try {
        await window.Community.apagarTopico(t.id);
        window.location.hash = "#/forum";
      } catch (erro) {
        ev.currentTarget.disabled = false;
        window.alert(window.Community.mensagemDeErro(erro));
      }
    });
    lugar.querySelector("[data-th-editar]")?.addEventListener("click", () => {
      lugar.innerHTML = cartaoFormulario({
        titulo: t.title,
        texto: t.body,
        autor: t.autor ? t.autor.username : "",
        botao: "Salvar",
        cancelar: hrefDaThread(t.id),
      });
      const form = lugar.querySelector("[data-th-form]");
      // Cancelar volta ao cartao sem recarregar a pagina (a rota e a mesma).
      form.querySelector(".th-cancelar").addEventListener("click", (ev) => {
        ev.preventDefault();
        lugar.innerHTML = cartaoDaThread(t);
        ligaCartao(alvo, t);
      });
      ligaFormulario(form, async (titulo, texto) => {
        const salvo = await window.Community.editarTopico(t.id, titulo, texto);
        if (salvo) Object.assign(t, { title: salvo.title, body: salvo.body, edited_at: salvo.edited_at });
        lugar.innerHTML = cartaoDaThread(t);
        ligaCartao(alvo, t);
      });
      form.titulo.focus();
    });
  }

  // ------------------------------------------------------------------ rotas

  function renderThreads(id) {
    if (!id) return renderLista();
    if (id === "nova") return renderNova();
    return renderThread(decodeURIComponent(id));
  }

  // Um ouvinte so, na carga: "+ Nova thread" sem conta abre o convite em vez
  // de navegar, e o botao de entrar da tela de nova thread tambem.
  document.addEventListener("click", (ev) => {
    const alvo = ev.target.closest && ev.target.closest("[data-th-nova], [data-th-login]");
    if (!alvo) return;
    if (alvo.hasAttribute("data-th-login") || !logado()) {
      ev.preventDefault();
      window.Auth?.abrir("entrar");
    }
  });

  window.Threads = { painelHome, renderThreads, hrefDaThread };
})();
