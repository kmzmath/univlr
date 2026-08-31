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

  // Silhueta neutra. Comentario apagado nao pode continuar mostrando a inicial
  // e a cor de quem escreveu - a pessoa foi removida da conversa, e o avatar
  // colorido a mantinha reconhecivel ali.
  function avatarRemovido(tamanho) {
    return `<span class="cmt-avatar removido ${tamanho === "grande" ? "grande" : ""}" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 8.4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.2c-2.6 0-5 1.3-5 2.9v1.1h10v-1.1c0-1.6-2.4-2.9-5-2.9Z"/></svg>
            </span>`;
  }

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
  //
  // BBCode, e nao markdown: o `*` e o `_` do markdown aparecem sozinhos em
  // texto normal o tempo todo ("nota 1.5*", "pdf_final"), e virariam formatacao
  // sem ninguem pedir. O colchete nao aparece por acidente.
  //
  // A ORDEM aqui e a seguranca do recurso:
  //   1. esc() primeiro, entao nada do que a pessoa escreveu pode virar tag;
  //   2. [code] sai de cena antes de tudo, senao BBCode dentro de um exemplo
  //      de codigo seria interpretado em vez de mostrado;
  //   3. so entao as tags viram HTML, uma lista fechada e conhecida.
  // Nenhum atributo vem do texto do usuario, exceto o href de [url], que passa
  // por validacao de esquema logo abaixo.

  // So http, https e link interno do proprio site. Sem isto,
  // [url=javascript:...] viraria um link executavel.
  function hrefSeguro(bruto) {
    const limpo = String(bruto || "").trim().replace(/&quot;/g, "").replace(/&#039;/g, "");
    if (/^https?:\/\/[^\s<>"]+$/i.test(limpo)) return limpo;
    if (/^#\/[^\s<>"]*$/.test(limpo)) return limpo;
    return null;
  }

  const PARES = {
    b: ["strong", ""],
    i: ["em", ""],
    u: ["span", "cmt-u"],
    s: ["s", ""],
    strike: ["s", ""],
    // Cabecalho de comentario NAO vira <h1> de verdade: a pagina ja tem um, e
    // dois <h1> quebram a estrutura do documento para leitor de tela. Vira
    // h3/h4/h5 com classe, que e hierarquia correta DENTRO do comentario.
    h1: ["h3", "cmt-h cmt-h1"],
    h2: ["h4", "cmt-h cmt-h2"],
    h3: ["h5", "cmt-h cmt-h3"],
    quote: ["blockquote", "cmt-quote"],
  };

  // Regex LITERAL, e nao montada por string: a primeira versao montava o
  // padrao dentro de um template literal, onde `\[` vira `[` e `\s` vira `s`.
  // O resultado era `[strike](...)[/strike]` lido como CLASSE DE CARACTERES -
  // em "forte", o `r` casava a classe e o `t` casava o fechamento, e a palavra
  // virava "fo<s></s>e". O retrovisor `\1` tambem garante que o fechamento e
  // da mesma tag que abriu.
  const RE_PARES = /\[(b|i|u|s|strike|h1|h2|h3|quote)\]([\s\S]*?)\[\/\1\]/gi;

  // Recursivo para o que esta dentro tambem ser interpretado ([b]a [i]b[/i][/b]).
  // O teto de profundidade evita que um texto com cem tags aninhadas prenda a
  // aba enquanto desenha um comentario.
  function aplicaPares(txt, nivel = 0) {
    if (nivel > 6) return txt;
    return txt.replace(RE_PARES, (todo, tag, dentro) => {
      const [elem, classe] = PARES[tag.toLowerCase()];
      const abre = classe ? `<${elem} class="${classe}">` : `<${elem}>`;
      return `${abre}${aplicaPares(dentro, nivel + 1)}</${elem}>`;
    });
  }

  function corpo(texto) {
    let out = esc(texto);

    // [code] guardado antes de qualquer outra tag ser interpretada.
    const blocos = [];
    out = out.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (todo, dentro) => {
      blocos.push(dentro);
      return `\u0000CODE${blocos.length - 1}\u0000`;
    });

    out = aplicaPares(out);

    // [spoiler] fica escondido ate o clique. O botao e o proprio bloco.
    out = out.replace(
      /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
      '<span class="cmt-spoiler" role="button" tabindex="0" data-spoiler title="Clique para revelar">$1</span>'
    );

    // [url=destino]texto[/url] e [url]destino[/url]
    out = out.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (todo, destino, dentro) => {
      const href = hrefSeguro(destino);
      // Destino recusado nao vira link nem some: fica o texto que a pessoa
      // escreveu, para ela ver que algo ali nao foi aceito.
      if (!href) return dentro;
      const externo = href.startsWith("#") ? "" : ' target="_blank" rel="noopener nofollow ugc"';
      return `<a class="cmt-url" href="${href}"${externo}>${dentro}</a>`;
    });
    out = out.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (todo, dentro) => {
      const href = hrefSeguro(dentro);
      if (!href) return dentro;
      const externo = href.startsWith("#") ? "" : ' target="_blank" rel="noopener nofollow ugc"';
      return `<a class="cmt-url" href="${href}"${externo}>${href}</a>`;
    });

    out = out.replace(/\[hr\]/gi, '<hr class="cmt-hr">');

    // Mencao a usuario, que ja existia.
    out = out.replace(/@([A-Za-z0-9_]{3,20})/g, '<a class="cmt-mencao" href="#/u/$1">@$1</a>');

    out = out.replace(/\n/g, "<br>");

    // <br> colado em bloco vira linha vazia na tela: o proprio bloco ja quebra.
    out = out
      .replace(/<br>\s*(<(?:hr|blockquote|h3|h4|h5)\b)/gi, "$1")
      .replace(/(<\/(?:blockquote|h3|h4|h5)>|<hr class="cmt-hr">)\s*<br>/gi, "$1");

    // Devolve o [code] guardado, agora sim como texto literal.
    out = out.replace(/\u0000CODE(\d+)\u0000/g, (todo, i) => `<code class="cmt-code">${blocos[Number(i)]}</code>`);

    return out;
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
    const podeEditar = meu && !apagado && Date.now() - new Date(c.created_at).getTime() < 15 * 60 * 1000;
    const podeApagar = !apagado && (meu || C.ehAdmin());
    const editando = atual.editando === c.id;

    const meuVoto = atual.meusVotos.get(c.id) || 0;
    const acoes = apagado
      ? ""
      : `
        <div class="cmt-acoes">
          <span class="cmt-voto" role="group" aria-label="Votar neste comentário">
            <button type="button" class="cmt-voto-seta ${meuVoto === 1 ? "ativo" : ""}"
                    data-votar="${esc(c.id)}" data-sinal="1"
                    aria-pressed="${meuVoto === 1}" aria-label="Votar a favor">
              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2.2 11 9H1z"/></svg>
            </button>
            <span class="cmt-score ${c.score > 0 ? "positivo" : c.score < 0 ? "negativo" : ""}">${c.score > 0 ? "+" : ""}${c.score}</span>
            <button type="button" class="cmt-voto-seta baixo ${meuVoto === -1 ? "ativo" : ""}"
                    data-votar="${esc(c.id)}" data-sinal="-1"
                    aria-pressed="${meuVoto === -1}" aria-label="Votar contra">
              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 9.8 1 3h10z"/></svg>
            </button>
          </span>
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
          ${apagado ? avatarRemovido() : avatar(autor)}
          <div class="cmt-conteudo">
            <header class="cmt-cabeca">
              ${apagado ? "" : selosDeFa(c.profiles)}
              ${apagado ? `<span class="cmt-autor">-</span>` : `<a class="cmt-autor" href="#/u/${esc(autor)}">${esc(autor)}</a>`}
              ${!apagado && c.profiles && c.profiles.role === "admin" ? `<span class="cmt-selo">admin</span>` : ""}
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

  // ------------------------------------------------------ barra de formatacao

  // `envolve` = o par de tags. `sozinho` = tag sem fechamento.
  const BOTOES = [
    { tag: "b", rotulo: "N", titulo: "Negrito", classe: "negrito" },
    { tag: "i", rotulo: "I", titulo: "Itálico", classe: "italico" },
    { tag: "u", rotulo: "S", titulo: "Sublinhado", classe: "sublinhado" },
    { tag: "s", rotulo: "T", titulo: "Riscado", classe: "riscado" },
    { tag: "h2", rotulo: "H", titulo: "Título" },
    { tag: "quote", rotulo: "\u201C\u201D", titulo: "Citação" },
    { tag: "code", rotulo: "&lt;/&gt;", titulo: "Código" },
    { tag: "spoiler", rotulo: "\u2609", titulo: "Spoiler" },
    { tag: "url", rotulo: "\u26AD", titulo: "Link" },
    { tag: "hr", rotulo: "\u2014", titulo: "Linha", sozinho: true },
  ];

  function barraFormatacao() {
    return `
      <div class="cmt-barra" role="toolbar" aria-label="Formatação">
        ${BOTOES.map((b) => `
          <button type="button" class="cmt-barra-botao ${b.classe || ""}"
                  data-tag="${esc(b.tag)}" ${b.sozinho ? 'data-sozinho="1"' : ""}
                  title="${esc(b.titulo)}" aria-label="${esc(b.titulo)}">${b.rotulo}</button>`).join("")}
        <button type="button" class="cmt-barra-botao ajuda" data-ajuda="1"
                title="Como formatar" aria-label="Como formatar" aria-expanded="false">?</button>
      </div>`;
  }

  const AJUDA = [
    ["[b]texto[/b]", "negrito"],
    ["[i]texto[/i]", "itálico"],
    ["[u]texto[/u]", "sublinhado"],
    ["[s]texto[/s]", "riscado"],
    ["[h1]…[/h1] a [h3]…[/h3]", "títulos, do maior ao menor"],
    ["[quote]texto[/quote]", "citação"],
    ["[code]texto[/code]", "código, sem formatar nada por dentro"],
    ["[spoiler]texto[/spoiler]", "escondido até alguém clicar"],
    ["[url=endereço]texto[/url]", "link"],
    ["[url]endereço[/url]", "link mostrando o próprio endereço"],
    ["[hr]", "linha separando"],
    ["@usuario", "menciona alguém, e a pessoa é avisada"],
  ];

  function painelAjuda() {
    return `
      <div class="cmt-ajuda" hidden>
        <table>
          <tbody>
            ${AJUDA.map(([codigo, oque]) => `<tr><td><code>${esc(codigo)}</code></td><td>${esc(oque)}</td></tr>`).join("")}
          </tbody>
        </table>
        <p>Só valem essas. Qualquer outra coisa entre colchetes fica como você escreveu.</p>
      </div>`;
  }

  // Envolve a selecao, ou insere o par e deixa o cursor no meio quando nao ha
  // nada selecionado - que e o que qualquer editor faz e o que a mao espera.
  function aplicaTag(area, tag, sozinho) {
    const ini = area.selectionStart;
    const fim = area.selectionEnd;
    const texto = area.value;
    const dentro = texto.slice(ini, fim);

    if (sozinho) {
      const marca = `[${tag}]`;
      area.value = texto.slice(0, ini) + marca + texto.slice(fim);
      area.selectionStart = area.selectionEnd = ini + marca.length;
    } else if (tag === "url") {
      // O link pede um destino; sem selecao, o cursor vai para o lugar dele.
      const modelo = dentro ? `[url=]${dentro}[/url]` : `[url=][/url]`;
      area.value = texto.slice(0, ini) + modelo + texto.slice(fim);
      const posDestino = ini + "[url=".length;
      area.selectionStart = area.selectionEnd = posDestino;
    } else {
      const abre = `[${tag}]`;
      const fecha = `[/${tag}]`;
      area.value = texto.slice(0, ini) + abre + dentro + fecha + texto.slice(fim);
      area.selectionStart = ini + abre.length;
      area.selectionEnd = ini + abre.length + dentro.length;
    }
    area.focus();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function formulario(modo, id, valor) {
    const rotulo = modo === "editar" ? "Salvar" : modo === "responder" ? "Responder" : "Comentar";
    return `
      <form class="cmt-form" data-form="${esc(modo)}" data-alvo="${esc(id || "")}">
        ${barraFormatacao()}
        ${painelAjuda()}
        <textarea name="corpo" rows="${modo === "novo" ? 3 : 2}" maxlength="${MAX}"
                  placeholder="${modo === "responder" ? "Escreva uma resposta" : "Escreva um comentário"}"
                  aria-label="${rotulo}">${esc(valor)}</textarea>
        <div class="cmt-form-rodape">
          <span class="cmt-contador"><b aria-live="polite">${MAX - String(valor).length}</b> restantes</span>
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
    // Spoiler tem role=button, entao precisa responder a Enter e Espaco.
    raiz.addEventListener("keydown", (ev) => {
      const spoiler = ev.target.closest?.("[data-spoiler]");
      if (!spoiler || (ev.key !== "Enter" && ev.key !== " ")) return;
      ev.preventDefault();
      spoiler.classList.toggle("aberto");
      spoiler.removeAttribute("title");
    });

    raiz.addEventListener("input", (ev) => {
      const ta = ev.target.closest("textarea[name=corpo]");
      if (!ta) return;
      // So o numero e trocado, nao a frase inteira: o `aria-live` esta no <b>,
      // entao o leitor de tela anuncia "1840", e nao "1840 restantes" a cada
      // tecla digitada.
      const contador = ta.closest(".cmt-form")?.querySelector(".cmt-contador");
      if (contador) {
        const sobra = MAX - ta.value.length;
        contador.querySelector("b").textContent = String(sobra);
        contador.classList.toggle("pouco", sobra <= 100);
      }
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

      // --- formatacao
      const btnTag = alvo.closest("[data-tag]");
      if (btnTag) {
        const area = btnTag.closest(".cmt-form")?.querySelector("textarea[name=corpo]");
        if (area) aplicaTag(area, btnTag.dataset.tag, btnTag.hasAttribute("data-sozinho"));
        return;
      }

      const btnAjuda = alvo.closest("[data-ajuda]");
      if (btnAjuda) {
        const painel = btnAjuda.closest(".cmt-form")?.querySelector(".cmt-ajuda");
        if (painel) {
          painel.hidden = !painel.hidden;
          btnAjuda.setAttribute("aria-expanded", String(!painel.hidden));
          btnAjuda.classList.toggle("ativo", !painel.hidden);
        }
        return;
      }

      // --- spoiler: o bloco inteiro e o botao
      const spoiler = alvo.closest("[data-spoiler]");
      if (spoiler) {
        spoiler.classList.toggle("aberto");
        spoiler.removeAttribute("title");
        return;
      }

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
        const clicado = Number(votar.dataset.sinal);
        const atualDoVoto = atual.meusVotos.get(id) || 0;
        // Clicar de novo na mesma seta TIRA o voto; clicar na outra troca.
        const novoSinal = atualDoVoto === clicado ? 0 : clicado;

        // Otimista: o botao responde no clique e a lista so e refeita se o
        // servidor recusar. Esperar a ida e volta faz o voto parecer quebrado
        // numa conexao ruim.
        const alvoCmt = atual.comentarios.find((c) => c.id === id);
        if (alvoCmt) alvoCmt.score += novoSinal - atualDoVoto;
        if (novoSinal === 0) atual.meusVotos.delete(id);
        else atual.meusVotos.set(id, novoSinal);
        desenha();

        try {
          await window.Community.votar(id, novoSinal);
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

  // ----------------------------------------------------- selo nas listagens
  //
  // Aparece SO onde ha conversa. Uma lista de 40 partidas com "0 comentários"
  // em 40 linhas nao informa nada e ainda pesa a leitura; o selo so existindo
  // onde alguem falou transforma a lista num mapa de onde esta o assunto.

  const BALAO = `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M8 2C4.7 2 2 4.2 2 7c0 1.5.8 2.9 2 3.8V14l2.9-1.7c.4.1.7.1 1.1.1 3.3 0 6-2.2 6-5S11.3 2 8 2Z"/></svg>`;

  function selo(kind, id) {
    const n = window.Community?.contagem(kind, id) || 0;
    if (!n) return "";
    return `<span class="cmt-selo-contagem" title="${n} ${n === 1 ? "comentário" : "comentários"}">
              ${BALAO}<span>${n}</span>
            </span>`;
  }

  // ------------------------------------------------------- atividade recente
  //
  // Uma linha por THREAD, nao por comentario - dez comentarios numa partida
  // viram "essa partida tem 10", e nao dez linhas iguais empurrando o resto
  // para fora. E o assunto e o que carrega o clique, entao ele e o texto da
  // linha; quem falou nao entra, porque a lista responde "onde esta a
  // conversa", nao "quem falou".

  function assuntoDaThread(kind, id) {
    try {
      if (typeof state === "undefined" || !state.db) return null;
      if (kind === "match") {
        // O assunto e a SERIE: `id` aqui e o seriesKey, nao um id de partida.
        const s = state.db.matchSeries.find((x) => x.seriesKey === id);
        if (!s) return null;
        return {
          href: `#/matches/${s.primaryMatchId}${s.mapCount > 1 ? "/all" : ""}`,
          nome: `${s.teamA.name} x ${s.teamB.name}`,
        };
      }
      if (kind === "event") {
        const e = state.db.tournaments.find((x) => x.id === id);
        return e ? { href: `#/tournaments/${id}`, nome: e.name } : null;
      }
      if (kind === "team") {
        const t = state.db.teams.find((x) => x.id === id);
        return t ? { href: `#/teams/${id}`, nome: t.name } : null;
      }
      if (kind === "player") {
        const p = typeof window.playerById === "function" ? window.playerById(id) : null;
        return p ? { href: `#/players/${id}`, nome: p.nick || p.handle } : null;
      }
      if (kind === "article") {
        const a = window.News?.porSlug(id);
        return a ? { href: `#/news/${id}`, nome: a.titulo } : null;
      }
    } catch (erro) {
      return null;
    }
    return null;
  }

  const ROTULO_TIPO = { match: "partida", event: "campeonato", team: "equipe", player: "jogador", article: "notícia" };

  function linhasDeAtividade(limite) {
    return (window.Community?.atividadeRecente(limite) || [])
      .map((r) => ({ r, assunto: assuntoDaThread(r.subject_kind, r.subject_id) }))
      // Thread cujo assunto sumiu do JSON nao vira linha morta: ela sai.
      .filter((x) => x.assunto);
  }

  function umaLinha({ r, assunto }) {
    return `
      <a class="atv-linha" href="${esc(assunto.href)}">
        <span class="atv-tipo">${esc(ROTULO_TIPO[r.subject_kind] || "")}</span>
        <span class="atv-nome">${esc(assunto.nome)}</span>
        <span class="atv-conta">${r.comentarios}</span>
      </a>`;
  }

  // Coluna estreita, ao lado das noticias.
  function atividadeHome(limite = 6) {
    const itens = linhasDeAtividade(limite);
    if (!itens.length) return "";
    return `
      <section class="atividade">
        <div class="section-head"><div><h2>Atividade recente</h2></div></div>
        <div class="atv-lista">${itens.map(umaLinha).join("")}</div>
      </section>`;
  }

  // Sem noticia nenhuma a coluna estreita nao existe, e a atividade sozinha
  // numa metade deixaria a outra vazia. Aqui ela se espalha em colunas.
  function atividadeLarga(limite = 9) {
    const itens = linhasDeAtividade(limite);
    if (!itens.length) return "";
    return `
      <section class="atividade atividade-larga">
        <div class="section-head"><div><h2>Atividade recente</h2></div></div>
        <div class="atv-lista">${itens.map(umaLinha).join("")}</div>
      </section>`;
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
      destacaComentarioDaUrl();
    } catch (erro) {
      raiz.innerHTML = `<div class="section-head"><div><h2>Comentários</h2>
        <p>Não deu para carregar: ${esc(window.Community.mensagemDeErro(erro))}</p></div></div>`;
    }
  }

  // Quem chega por um link de atividade traz `?c=<id>` na rota. Sem isto a
  // pessoa cairia no topo da pagina e teria de procurar o comentario na mao.
  function destacaComentarioDaUrl() {
    const id = typeof routeQuery === "function" ? routeQuery().get("c") : null;
    if (!id) return;
    const alvo = document.getElementById(`cmt-${id}`);
    if (!alvo) return;
    alvo.classList.add("destacado");

    // Salto seco, e nao `smooth`. O site inteiro tem `scroll-behavior: smooth`
    // no CSS, entao o scroll que o roteador da ao trocar de pagina tambem e
    // animado - as duas animacoes disputam o mesmo eixo e a nossa morre no meio
    // do caminho (medido: parava em 150px de 1152). Salto nao tem meio do
    // caminho para ser interrompido.
    const posiciona = () => alvo.scrollIntoView({ block: "center", behavior: "instant" });
    posiciona();

    // A pagina ainda esta crescendo quando chegamos: escudo de equipe, tabela de
    // mapas, imagem de capa. Cada uma empurra o comentario para baixo depois do
    // salto. Reposiciona enquanto a altura muda - e para na hora em que a
    // pessoa toma o controle, porque puxar o scroll de quem ja esta rolando e
    // pior do que deixar o alvo fora de lugar.
    let alturaAnterior = document.body.scrollHeight;
    let tentativas = 0;
    const assenta = setInterval(() => {
      if (++tentativas > 8) return clearInterval(assenta);
      const altura = document.body.scrollHeight;
      if (altura !== alturaAnterior) {
        alturaAnterior = altura;
        posiciona();
      }
    }, 120);
    const solta = () => clearInterval(assenta);
    window.addEventListener("wheel", solta, { once: true, passive: true });
    window.addEventListener("touchstart", solta, { once: true, passive: true });
    window.addEventListener("keydown", solta, { once: true });

    // O destaque sai sozinho: ele serve para achar o comentario, nao para
    // marca-lo para sempre.
    setTimeout(() => alvo.classList.remove("destacado"), 2600);
  }

  window.Comments = { shell, montar, avatar, quando, corpo, selo, atividadeHome, atividadeLarga, assuntoDaThread };
})();
