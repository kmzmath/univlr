// UNIVLR - conta do usuario: espaco no cabecalho e as janelas de entrar,
// cadastrar, recuperar senha e gerenciar a conta.
//
// As telas de conta sao modal sobre a pagina atual, e nao rota propria, de
// proposito: quem clica em "entrar" para comentar numa partida volta para a
// partida, no mesmo scroll, em vez de perder o lugar e ter de achar de novo.
//
// A excecao e a redefinicao de senha, que chega por link de e-mail: ali nao ha
// pagina anterior, entao a janela abre sozinha sobre a home.

(function () {
  "use strict";

  const esc = (v) => window.Community.esc(v);

  // Recuperar senha por e-mail exige SMTP proprio configurado no Supabase, e
  // hoje ele esta desligado - o servidor embutido entrega uns poucos por hora e
  // e so para desenvolvimento. Com isto em `false`, "Esqueci a senha" diz a
  // verdade em vez de mandar um e-mail que nunca chega.
  //
  // Para religar: ponha `true` aqui depois de configurar o SMTP em
  // Authentication -> SMTP Settings. Nada mais muda; o fluxo inteiro
  // (pedido, link, janela de nova senha) continua escrito e testado.
  const RESET_POR_EMAIL = false;

  // ------------------------------------------------------------- o convite
  //
  // Quem chega deslogado ve uma vez por visita o que a conta abre. E uma VISTA
  // do mesmo modal, e nao um pop-up separado: "Criar conta" troca o conteudo da
  // janela que ja esta aberta, em vez de empilhar uma segunda camada sobre a
  // primeira.
  //
  // A espera cresce a cada dispensa. Insistir sempre com os mesmos 10 minutos e
  // o que transforma convite em amolacao: quem dispensou quatro vezes ja
  // respondeu, e a quinta pergunta so gasta a paciencia.
  const CONVITE_CHAVE = "univlr-convite-conta";
  const CONVITE_ESPERAS = [10 * 60e3, 60 * 60e3, 6 * 3600e3, 24 * 3600e3, 7 * 24 * 3600e3];
  // Tempo de tela antes de aparecer. Sem ele o convite chega junto com o
  // primeiro paint e le como muro, nao como convite - a pessoa dispensa sem ler
  // porque ainda nao viu o que esta sendo oferecido.
  const CONVITE_ATRASO = 7000;

  let overlay = null;
  let ultimoFoco = null;
  let naoLidas = 0;

  // ------------------------------------------------------------- cabecalho

  function slotHtml() {
    const C = window.Community;
    if (!C.logado() || !C.perfil()) {
      return `<div class="conta-slot">
                <button type="button" class="conta-entrar" data-auth="entrar">Entrar</button>
              </div>`;
    }
    const p = C.perfil();
    return `<div class="conta-slot">
              <button type="button" class="conta-sino" data-auth="avisos" aria-label="Notificações${naoLidas ? `, ${naoLidas} não lidas` : ""}">
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.6a3.6 3.6 0 0 0-3.6 3.6v2.3L3.2 10.2h9.6l-1.2-2.7V5.2A3.6 3.6 0 0 0 8 1.6Zm0 12.8a1.8 1.8 0 0 0 1.8-1.6H6.2A1.8 1.8 0 0 0 8 14.4Z"/></svg>
                ${naoLidas ? `<span class="conta-badge">${naoLidas > 9 ? "9+" : naoLidas}</span>` : ""}
              </button>
              <button type="button" class="conta-avatar-botao" data-auth="conta" aria-label="Sua conta">
                ${window.Comments.avatar(p.username)}
              </button>
            </div>`;
  }

  async function atualizaAvisos() {
    if (!window.Community.logado()) {
      naoLidas = 0;
      return;
    }
    try {
      naoLidas = await window.Community.contarNaoLidas();
    } catch (erro) {
      naoLidas = 0;
    }
  }

  // Redesenha so o cantinho da conta, sem re-render da pagina inteira: trocar
  // a topbar toda apagaria o que a pessoa esta digitando num filtro ou numa
  // caixa de comentario.
  function pintaSlot() {
    const alvo = document.querySelector(".conta-slot");
    if (alvo) alvo.outerHTML = slotHtml();
  }

  // ------------------------------------------------------------------ modal

  function fecha() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", teclado);
    if (ultimoFoco && document.contains(ultimoFoco)) ultimoFoco.focus();
  }

  function teclado(ev) {
    if (ev.key === "Escape") return fecha();
    if (ev.key !== "Tab" || !overlay) return;
    // Prender o Tab dentro da janela: sem isso o foco escapa para a pagina
    // atras, que esta inerte para o mouse mas nao para o teclado.
    const focaveis = overlay.querySelectorAll("button, input, textarea, a[href]");
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  }

  function abrir(vista, dados) {
    ultimoFoco = document.activeElement;
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.className = "auth-overlay";
    overlay.innerHTML = `<div class="auth-janela" role="dialog" aria-modal="true" aria-label="Conta">
                           <button type="button" class="auth-fechar" data-fechar="1" aria-label="Fechar">&times;</button>
                           <div class="auth-corpo"></div>
                         </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay || ev.target.closest("[data-fechar]")) fecha();
    });
    document.addEventListener("keydown", teclado);
    pinta(vista, dados);
  }

  function pinta(vista, dados) {
    if (!overlay) return;
    const antigo = overlay.querySelector(".auth-corpo");
    // Troca o ELEMENTO, nao so o innerHTML. ligaVista() registra listener no
    // corpo; reaproveitar o mesmo no ao mudar de vista empilharia um conjunto
    // novo a cada troca, e o segundo envio do formulario dispararia duas vezes.
    const corpo = document.createElement("div");
    corpo.className = "auth-corpo";
    corpo.innerHTML = VISTAS[vista] ? VISTAS[vista](dados) : VISTAS.entrar();
    antigo.replaceWith(corpo);
    ligaVista(corpo, vista);
    corpo.querySelector("input, textarea, button")?.focus();
  }

  const campo = (nome, rotulo, tipo, extra) =>
    `<label class="auth-campo">
       <span>${esc(rotulo)}</span>
       <input name="${esc(nome)}" type="${esc(tipo)}" ${extra || ""} />
     </label>`;

  // Os proprios simbolos do site, e nao icones de banco de imagem: sao os
  // mesmos desenhos que a pessoa vai encontrar no comentario e no perfil, entao
  // a lista mostra os controles que ela ganha em vez de descreve-los.
  const ICONE_BOLHA = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3h12v8H6.6L3 13.6V11H2Z"/></svg>`;
  const ICONE_CORACAO = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 14.2 2.9 9.3a3.3 3.3 0 0 1 0-4.7 3.3 3.3 0 0 1 4.7 0L8 5l.4-.4a3.3 3.3 0 0 1 4.7 0 3.3 3.3 0 0 1 0 4.7Z"/></svg>`;
  const ICONE_VOTOS = `<svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 0.6 10 5H2z"/><path fill="currentColor" d="M6 11.4 2 7h8z"/></svg>`;

  const VISTAS = {
    convite: () => `
      <h2>O UNIVLR fica melhor com conta</h2>
      <ul class="auth-convite">
        <li>${ICONE_BOLHA}<span>Comentar em partidas, campeonatos, jogadores e notícias</span></li>
        <li>${ICONE_CORACAO}<span>Ser fã de uma equipe e de um jogador</span></li>
        <li>${ICONE_VOTOS}<span>Votar nos comentários</span></li>
      </ul>
      <button type="button" class="auth-principal" data-ir="cadastrar">Criar conta</button>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="entrar">Já tenho conta</button>
        <button type="button" class="cmt-link" data-fechar="1">Agora não</button>
      </div>`,

    entrar: () => `
      <h2>Entrar</h2>
      <form data-vista="entrar">
        ${campo("email", "E-mail", "email", 'autocomplete="email" required')}
        ${campo("senha", "Senha", "password", 'autocomplete="current-password" required')}
        <p class="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-principal">Entrar</button>
      </form>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="cadastrar">Criar conta</button>
        <button type="button" class="cmt-link" data-ir="esqueci">Esqueci a senha</button>
      </div>`,

    cadastrar: () => `
      <h2>Criar conta</h2>
      <form data-vista="cadastrar">
        ${campo("username", "Nome de usuário", "text", 'required minlength="3" maxlength="20" autocomplete="username" pattern="[A-Za-z0-9_]{3,20}"')}
        <p class="auth-dica" data-dica-username>3 a 20 caracteres: letras, números e _</p>
        ${campo("email", "E-mail", "email", 'autocomplete="email" required')}
        ${campo("senha", "Senha", "password", 'autocomplete="new-password" required minlength="8"')}
        <p class="auth-dica">Pelo menos 8 caracteres.</p>
        <p class="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-principal">Criar conta</button>
      </form>
      <p class="auth-legal">Guardamos só seu e-mail e o que você escrever aqui.
      A senha fica com o provedor de autenticação, nunca com o site. Você pode
      apagar a conta e tudo que publicou a qualquer momento, em Sua conta.</p>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="entrar">Já tenho conta</button>
      </div>`,

    esqueci: () =>
      RESET_POR_EMAIL
        ? `
      <h2>Recuperar senha</h2>
      <p class="auth-dica">Enviamos um link para você criar uma senha nova.</p>
      <form data-vista="esqueci">
        ${campo("email", "E-mail", "email", 'autocomplete="email" required')}
        <p class="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-principal">Enviar link</button>
      </form>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="entrar">Voltar</button>
      </div>`
        : `
      <h2>Perdeu a senha?</h2>
      <p class="auth-dica">O UNIVLR ainda não envia e-mail, então a troca de
      senha é feita na mão. Fale com um administrador e ele redefine para você.</p>
      <p class="auth-dica">Já dentro da conta, você pode trocar a senha quando
      quiser em <strong>Sua conta → Trocar senha</strong>.</p>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="entrar">Voltar</button>
      </div>`,

    senha: () => `
      <h2>Trocar senha</h2>
      <form data-vista="senha">
        ${campo("senha", "Nova senha", "password", 'autocomplete="new-password" required minlength="8"')}
        <p class="auth-dica">Pelo menos 8 caracteres.</p>
        <p class="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-principal">Salvar senha</button>
      </form>
      <div class="auth-rodape">
        <button type="button" class="cmt-link" data-ir="conta">Voltar</button>
      </div>`,

    redefinir: () => `
      <h2>Nova senha</h2>
      <form data-vista="redefinir">
        ${campo("senha", "Nova senha", "password", 'autocomplete="new-password" required minlength="8"')}
        <p class="auth-erro" role="alert" hidden></p>
        <button type="submit" class="auth-principal">Salvar senha</button>
      </form>`,

    conta: () => {
      const p = window.Community.perfil();
      if (!p) return VISTAS.entrar();
      return `
        <h2>Sua conta</h2>
        <div class="auth-perfil">
          ${window.Comments.avatar(p.username, "grande")}
          <div>
            <strong>${esc(p.username)}</strong>
            <span class="auth-dica">no UNIVLR desde ${new Date(p.created_at).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
          </div>
        </div>
        <form data-vista="bio">
          <label class="auth-campo">
            <span>Bio</span>
            <textarea name="bio" rows="3" maxlength="300" placeholder="Conte alguma coisa sobre você">${esc(p.bio || "")}</textarea>
          </label>
          <p class="auth-erro" role="alert" hidden></p>
          <button type="submit" class="auth-principal">Salvar</button>
        </form>
        <div class="auth-rodape coluna">
          <a class="cmt-link" href="#/u/${esc(p.username)}" data-fechar="1">Ver meu perfil público</a>
          <button type="button" class="cmt-link" data-ir="avisos">Notificações</button>
          <button type="button" class="cmt-link" data-ir="senha">Trocar senha</button>
          <button type="button" class="cmt-link" data-sair="1">Sair</button>
          <button type="button" class="cmt-link perigo" data-excluir="1">Excluir minha conta</button>
        </div>`;
    },

    avisos: (dados) => {
      const itens = (dados && dados.itens) || [];
      if (!itens.length)
        return `<h2>Notificações</h2><p class="auth-dica">Nada por aqui ainda.</p>
                <div class="auth-rodape"><button type="button" class="cmt-link" data-ir="conta">Voltar</button></div>`;
      const naoLidas = itens.filter((n) => !n.read_at).length;
      return `<h2>Notificações</h2>
        <ul class="auth-avisos">
          ${itens
            .map(
              (n) => `<li class="${n.read_at ? "" : "nova"}">
                        <a href="#cmt-${esc(n.comment_id)}" data-lida="${esc(n.id)}" data-fechar="1">
                          ${n.kind === "mention" ? "Mencionaram você" : "Responderam você"}
                        </a>
                        <time>${window.Comments.quando(n.created_at)}</time>
                      </li>`
            )
            .join("")}
        </ul>
        <div class="auth-rodape">
          <button type="button" class="cmt-link" data-ir="conta">Voltar</button>
          ${naoLidas ? `<button type="button" class="cmt-link" data-todas-lidas="1">Marcar todas como lidas</button>` : ""}
        </div>`;
    },
  };

  function erro(corpo, texto) {
    const p = corpo.querySelector(".auth-erro");
    if (!p) return;
    p.textContent = texto;
    p.hidden = false;
  }

  function ligaVista(corpo, vista) {
    corpo.addEventListener("click", async (ev) => {
      const ir = ev.target.closest("[data-ir]");
      if (ir) return abrirVista(ir.dataset.ir);

      // Abrir o aviso marca SO ele. Antes, abrir o painel marcava tudo - um
      // aviso que a pessoa nem viu sumia do contador junto com os que ela leu.
      const aviso = ev.target.closest("[data-lida]");
      if (aviso) {
        window.Community.marcarLida(aviso.dataset.lida)
          .then(() => atualizaAvisos())
          .then(() => pintaSlot())
          .catch(() => {});
        return;
      }

      if (ev.target.closest("[data-todas-lidas]")) {
        await window.Community.marcarLidas();
        await atualizaAvisos();
        pintaSlot();
        abrirVista("avisos");
        return;
      }

      if (ev.target.closest("[data-sair]")) {
        await window.Community.sair();
        fecha();
        return;
      }

      if (ev.target.closest("[data-excluir]")) {
        if (!window.confirm("Excluir a conta apaga seus comentários e não tem volta. Continuar?")) return;
        try {
          await window.Community.excluirConta();
          fecha();
        } catch (e) {
          erro(corpo, window.Community.mensagemDeErro(e));
        }
      }
    });

    // Aviso de username ocupado enquanto digita, para a pessoa nao descobrir
    // so no envio - momento em que ela ja escolheu senha e e-mail.
    if (vista === "cadastrar") {
      const input = corpo.querySelector("input[name=username]");
      let timer = null;
      input?.addEventListener("input", () => {
        const dica = corpo.querySelector("[data-dica-username]");
        const valor = input.value.trim();
        clearTimeout(timer);
        if (!/^[A-Za-z0-9_]{3,20}$/.test(valor)) {
          dica.textContent = "3 a 20 caracteres: letras, números e _";
          dica.classList.remove("ok", "ruim");
          return;
        }
        timer = setTimeout(async () => {
          try {
            const livre = await window.Community.usernameLivre(valor);
            dica.textContent = livre ? "Disponível." : "Esse nome já está em uso.";
            dica.classList.toggle("ok", livre);
            dica.classList.toggle("ruim", !livre);
          } catch (e) {
            /* rede instavel: a dica some, o envio ainda valida */
          }
        }, 350);
      });
    }

    corpo.addEventListener("submit", async (ev) => {
      const form = ev.target.closest("form");
      if (!form) return;
      ev.preventDefault();
      const dados = Object.fromEntries(new FormData(form));
      const botao = form.querySelector("button[type=submit]");
      botao.disabled = true;
      try {
        if (form.dataset.vista === "entrar") {
          await window.Community.entrar({ email: dados.email, password: dados.senha });
          fecha();
        } else if (form.dataset.vista === "cadastrar") {
          if (!(await window.Community.usernameLivre(dados.username)))
            throw new Error("Esse nome de usuário já está em uso.");
          const r = await window.Community.cadastrar({
            username: dados.username,
            email: dados.email,
            password: dados.senha,
          });
          // Sem sessao aqui significa que "Confirm email" esta ligado no
          // painel: a conta existe, mas so vale depois do link do e-mail.
          if (!r.session) {
            corpo.innerHTML = `<h2>Confirme o e-mail</h2>
              <p class="auth-dica">Enviamos um link para <strong>${esc(dados.email)}</strong>.
              Abra o link para ativar a conta.</p>`;
            return;
          }
          fecha();
        } else if (form.dataset.vista === "esqueci") {
          await window.Community.pedirRedefinicao(dados.email);
          corpo.innerHTML = `<h2>Verifique o e-mail</h2>
            <p class="auth-dica">Se existir conta com <strong>${esc(dados.email)}</strong>,
            o link para criar uma senha nova chegou lá.</p>`;
        } else if (form.dataset.vista === "redefinir" || form.dataset.vista === "senha") {
          await window.Community.trocarSenha(dados.senha);
          corpo.innerHTML = `<h2>Senha trocada</h2><p class="auth-dica">Já pode usar a senha nova.</p>`;
        } else if (form.dataset.vista === "bio") {
          await window.Community.salvarBio(String(dados.bio || "").slice(0, 300));
          fecha();
        }
      } catch (e) {
        botao.disabled = false;
        erro(corpo, window.Community.mensagemDeErro(e));
      }
    });
  }

  // Ponto de entrada de fora (comments.js, profile.js): garante a janela antes
  // de pedir a vista. Sem isto, chamar com a janela fechada nao faria nada -
  // pinta() sai cedo quando nao ha overlay.
  async function abrirVista(vista, dados) {
    if (!overlay) abrir(vista === "avisos" ? "conta" : vista, dados);
    if (vista === "avisos") {
      const itens = await window.Community.listarNotificacoes();
      pinta("avisos", { itens });
      return;
    }
    pinta(vista);
  }

  // ---------------------------------------------------------- convite: quando

  // Tudo em try/catch: em aba anonima e com cookies bloqueados o proprio ACESSO
  // ao localStorage lanca, e um convite nao pode derrubar o site.
  function leConvite() {
    try {
      return JSON.parse(localStorage.getItem(CONVITE_CHAVE)) || {};
    } catch (_e) {
      return {};
    }
  }

  function gravaConvite(dados) {
    try {
      localStorage.setItem(CONVITE_CHAVE, JSON.stringify(dados));
    } catch (_e) {
      /* sem armazenamento o convite volta na proxima visita; melhor que quebrar */
    }
  }

  function esqueceConvite() {
    try {
      localStorage.removeItem(CONVITE_CHAVE);
    } catch (_e) {
      /* nada a fazer */
    }
  }

  function convitePendente() {
    if (window.Community.logado()) return false;
    const { visto = 0, dispensas = 0 } = leConvite();
    if (!visto) return true;
    const espera = CONVITE_ESPERAS[Math.min(dispensas, CONVITE_ESPERAS.length - 1)];
    return Date.now() - visto >= espera;
  }

  function mostraConvite() {
    // Rechecado na hora de aparecer, e nao so ao agendar: em sete segundos a
    // pessoa pode ter entrado pelo cabecalho, ou aberto a janela por conta
    // propria - abrir por cima disso seria roubar o que ela ja estava fazendo.
    if (overlay || !convitePendente()) return;
    const ativo = document.activeElement;
    if (ativo && ativo.matches("input, textarea, [contenteditable]")) return;

    const { dispensas = 0 } = leConvite();
    gravaConvite({ visto: Date.now(), dispensas: dispensas + 1 });
    abrir("convite");
  }

  function agendaConvite() {
    if (!convitePendente()) return;
    setTimeout(() => {
      // Aba aberta em segundo plano: esperar o primeiro olhar em vez de gastar
      // o convite numa tela que ninguem esta vendo.
      if (document.visibilityState === "visible") return mostraConvite();
      document.addEventListener("visibilitychange", function aoVoltar() {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", aoVoltar);
        mostraConvite();
      });
    }, CONVITE_ATRASO);
  }

  // ------------------------------------------------------------------ inicio

  function ligaCabecalho() {
    document.addEventListener("click", (ev) => {
      const botao = ev.target.closest("[data-auth]");
      if (!botao) return;
      abrirVista(botao.dataset.auth);
    });
  }

  async function iniciar() {
    const { erroAuth } = await window.Community.init();
    await atualizaAvisos();
    ligaCabecalho();

    window.Community.aoMudar(async (_sessao, _perfil, evento) => {
      await atualizaAvisos();
      pintaSlot();
      // Entrou: o convite perde a razao de existir, e a contagem de dispensas
      // some junto - se um dia sair, recomeca do zero em vez de voltar ja
      // esgotado por dispensas de antes de ter conta.
      if (window.Community.logado()) esqueceConvite();
      // A pagina inteira precisa refazer: comentarios mudam de "entre para
      // comentar" para o formulario, e o perfil ganha os botoes de dono.
      if (typeof window.render === "function") window.render();
      // O evento de recuperacao costuma chegar DEPOIS do iniciar() terminar,
      // porque o SDK so o emite ao processar o code. Por isso a janela tambem
      // abre daqui, e nao so na checagem de uma vez la embaixo.
      if (evento === "PASSWORD_RECOVERY" && window.Community.consomeRecuperacao()) {
        abrir("redefinir");
      }
    });

    // Se o evento chegou antes de este ouvinte existir, a bandeira ficou
    // guardada no core - esta linha e quem pega esse caso.
    if (window.Community.consomeRecuperacao()) {
      abrir("redefinir");
    } else if (erroAuth) {
      abrir("entrar");
      setTimeout(() => {
        const corpo = overlay?.querySelector(".auth-corpo");
        // Pelo tradutor, nao cru: erroAuth chega em ingles, vindo do GoTrue.
        if (corpo) erro(corpo, window.Community.mensagemDeErro({ message: erroAuth }));
      }, 0);
    } else {
      // So no caminho limpo. Convidar por cima de uma janela que abriu para
      // redefinir senha ou mostrar erro seria atropelar o que importa mais.
      agendaConvite();
    }
  }

  window.Auth = { slotHtml, pintaSlot, abrir: abrirVista, iniciar, fecha };
})();
