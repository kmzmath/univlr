// UNIVLR - camada de dados da comunidade (contas, perfis, comentarios).
//
// Unico arquivo que fala com o Supabase. As telas (auth.js, comments.js,
// profile.js) chamam daqui e nunca montam requisicao na mao - assim a forma de
// cada consulta fica num lugar so, e a desambiguacao de embed (ver
// COMENTARIO_COM_AUTOR) nao precisa ser lembrada em quatro lugares.
//
// Carrega ANTES do app.js, junto com os outros *-core. Nada aqui toca `state`
// no momento da carga: `state` e `const` no app.js, entao ler no load cairia na
// zona morta temporal. Tudo que precisa do app roda em evento ou em render.

(function () {
  "use strict";

  const SUPABASE_URL = "https://ruqomwmdmhwivooqdlcf.supabase.co";
  // Chave publicavel: nasceu para ficar exposta no navegador. Quem protege o
  // banco e a RLS, nao o segredo desta linha. A `service_role` NUNCA entra aqui.
  const SUPABASE_KEY = "sb_publishable_ca2ZnTmgztXW4g84lx7lNQ_OhilNLB9";

  // O PostgREST enxerga tres caminhos entre `comments` e `profiles`: a FK
  // direta de author_id, mais `comment_votes` e `reports`, que tem chave para
  // as duas pontas e por isso parecem tabelas de juncao. Sem nomear a
  // constraint, a consulta morre com "more than one relationship was found".
  const COMENTARIO_COM_AUTOR =
    "id, body, score, created_at, edited_at, deleted_at, parent_id, author_id, profiles!comments_author_id_fkey(username, role, fav_team, fav_player)";

  // ---------------------------------------------------- resgate do fragmento
  //
  // O /auth/v1/verify do Supabase devolve o resultado NO FRAGMENTO, mesmo com
  // PKCE ligado no cliente. Um link de recuperacao vencido volta assim:
  //
  //   #error=access_denied&error_code=otp_expired&error_description=...
  //
  // O UNIVLR roteia por hash. Sem tirar isso da frente, `route()` le
  // "error=access_denied&..." como nome de secao, cai na home por fallback, e
  // a pessoa nunca descobre por que o link nao funcionou.
  //
  // Roda AGORA, na carga do script, e nao dentro do init(): o init e async e o
  // app.js chama render() antes de ele terminar. Rodar aqui e seguro porque
  // este arquivo carrega antes do app.js e nao toca em `state`.
  const AUTH_FRAG = (function resgataFragmento() {
    const bruto = window.location.hash || "";
    // Rota de verdade sempre comeca com "#/". Carga de auth vem sem a barra e
    // com "=" dentro - e o que separa os dois casos sem falso positivo.
    if (!bruto.startsWith("#") || bruto.startsWith("#/") || !bruto.includes("=")) return null;
    const p = new URLSearchParams(bruto.slice(1));
    if (!p.has("error") && !p.has("access_token") && !p.has("error_description")) return null;
    const dados = Object.fromEntries(p.entries());
    // Devolve a URL a uma rota limpa antes de qualquer render.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return dados;
  })();

  let client = null;
  let sessao = null;
  let perfil = null;
  // Um time e um jogador, no maximo - como na HLTV. Vem junto do perfil, e
  // fica em memoria para o botao nascer no estado certo: as paginas de equipe
  // e de jogador sao montadas de uma vez em string, sem await no meio, entao
  // perguntar ao servidor na hora de desenhar faria o coracao piscar.
  // Ligado pelo evento PASSWORD_RECOVERY; o auth.js le para abrir a janela de
  // nova senha. Fica aqui, e nao numa variavel do auth.js, porque o evento
  // chega antes de o auth.js terminar de iniciar.
  let recuperando = false;
  const ouvintes = new Set();
  const COLUNA_FAV = { team: "fav_team", player: "fav_player" };

  function api() {
    if (client) return client;
    if (!window.supabase) throw new Error("SDK do Supabase nao carregou");
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        // PKCE devolve o retorno como `?code=` na query. O padrao devolveria
        // `#access_token=` no fragmento, que o roteador por hash do UNIVLR
        // leria como rota e destruiria antes do login terminar.
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        // Trocamos o code na mao em init(), para limpar a URL antes de
        // qualquer render. Deixar o SDK fazer sozinho abriria uma janela em
        // que o roteador ja rodou com a URL suja.
        detectSessionInUrl: false,
      },
    });
    return client;
  }

  function esc(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function avisa(evento) {
    ouvintes.forEach((fn) => {
      try {
        fn(sessao, perfil, evento);
      } catch (erro) {
        console.error("ouvinte da comunidade falhou", erro);
      }
    });
  }

  async function carregaPerfil() {
    if (!sessao) {
      perfil = null;
      return null;
    }
    const { data } = await api()
      .from("profiles")
      .select("id, username, bio, role, created_at, banned_until, fav_team, fav_player")
      .eq("id", sessao.user.id)
      .maybeSingle();
    perfil = data || null;
    return perfil;
  }

  // ------------------------------------------------------------------ inicio

  async function init() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    // O erro pode chegar pelos dois caminhos: query (fluxo PKCE) ou fragmento
    // (resposta do /verify). O fragmento ja foi resgatado na carga.
    const erroAuth =
      url.searchParams.get("error_description") ||
      (AUTH_FRAG && (AUTH_FRAG.error_description || AUTH_FRAG.error)) ||
      null;

    if (code) {
      const { error } = await api().auth.exchangeCodeForSession(code);
      limpaQuery(["code", "error", "error_description"]);
      if (error) console.warn("troca de code falhou:", error.message);
    } else if (url.searchParams.has("error_description")) {
      limpaQuery(["error", "error_description"]);
    } else if (AUTH_FRAG && AUTH_FRAG.access_token && AUTH_FRAG.refresh_token) {
      // Caminho sem PKCE: o Supabase pode devolver a sessao pronta no
      // fragmento. Acontece quando o link e aberto em OUTRO navegador, onde o
      // verificador PKCE guardado localmente nao existe.
      const { error } = await api().auth.setSession({
        access_token: AUTH_FRAG.access_token,
        refresh_token: AUTH_FRAG.refresh_token,
      });
      if (error) console.warn("sessao do fragmento falhou:", error.message);
      else if (AUTH_FRAG.type === "recovery") recuperando = true;
    }

    const { data } = await api().auth.getSession();
    sessao = data.session || null;
    await carregaPerfil();

    api().auth.onAuthStateChange(async (evento, nova) => {
      sessao = nova || null;
      await carregaPerfil();
      // O link de "esqueci a senha" volta como `?code=` igual a qualquer outro
      // retorno PKCE - nao da para saber pela URL que veio de recuperacao. O
      // SDK avisa por este evento, e e a unica forma confiavel de abrir a
      // janela de nova senha no momento certo.
      if (evento === "PASSWORD_RECOVERY") recuperando = true;
      avisa(evento);
    });

    return { sessao, perfil, erroAuth };
  }

  // Tira so os parametros do OAuth e devolve a URL ao que era, preservando o
  // hash - que e a rota de verdade neste site.
  function limpaQuery(chaves) {
    const url = new URL(window.location.href);
    chaves.forEach((c) => url.searchParams.delete(c));
    const busca = url.searchParams.toString();
    const limpa = url.pathname + (busca ? "?" + busca : "") + url.hash;
    window.history.replaceState(null, "", limpa);
  }

  // ------------------------------------------------------------------- conta

  async function usernameLivre(nome) {
    const { data, error } = await api().rpc("username_available", { candidate: nome });
    if (error) throw error;
    return data === true;
  }

  async function cadastrar({ username, email, password }) {
    const { data, error } = await api().auth.signUp({
      email,
      password,
      // A trigger handle_new_user() le este metadata para criar o perfil.
      options: { data: { username } },
    });
    if (error) throw error;
    return data;
  }

  async function entrar({ email, password }) {
    const { data, error } = await api().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function sair() {
    await api().auth.signOut();
  }

  async function pedirRedefinicao(email) {
    const { error } = await api().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
  }

  async function trocarSenha(novaSenha) {
    const { error } = await api().auth.updateUser({ password: novaSenha });
    if (error) throw error;
  }

  async function salvarBio(bio) {
    if (!sessao) throw new Error("nao autenticado");
    const { error } = await api().from("profiles").update({ bio }).eq("id", sessao.user.id);
    if (error) throw error;
    if (perfil) perfil.bio = bio;
  }

  async function trocarUsername(nome) {
    const { error } = await api().rpc("set_username", { p_username: nome });
    if (error) throw error;
    await carregaPerfil();
  }

  async function excluirConta() {
    const { error } = await api().rpc("delete_account");
    if (error) throw error;
    await api().auth.signOut();
  }

  async function perfilPublico(username) {
    const { data, error } = await api()
      .from("profiles")
      .select("id, username, bio, role, created_at, fav_team, fav_player")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // ------------------------------------------------------------- comentarios

  async function listarComentarios(kind, subjectId) {
    const { data: thread } = await api()
      .from("threads")
      .select("id")
      .eq("subject_kind", kind)
      .eq("subject_id", String(subjectId))
      .maybeSingle();
    // Sem thread significa que ninguem comentou ainda - e um estado normal,
    // nao um erro. A thread nasce no primeiro post_comment().
    if (!thread) return { comentarios: [], meusVotos: new Set() };

    const { data, error } = await api()
      .from("comments")
      .select(COMENTARIO_COM_AUTOR)
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const comentarios = data || [];
    let meusVotos = new Set();
    if (sessao && comentarios.length) {
      // A policy de leitura de voto e `user_id = auth.uid()`, entao isto so
      // volta com o que o proprio usuario votou - que e o que a tela precisa
      // para pintar o botao. O total publico vem de comments.score.
      const { data: votos } = await api()
        .from("comment_votes")
        .select("comment_id")
        .in("comment_id", comentarios.map((c) => c.id));
      meusVotos = new Set((votos || []).map((v) => v.comment_id));
    }
    return { comentarios, meusVotos };
  }

  async function comentar(kind, subjectId, body, parentId) {
    const { data, error } = await api().rpc("post_comment", {
      p_kind: kind,
      p_subject_id: String(subjectId),
      p_body: body,
      p_parent_id: parentId || null,
    });
    if (error) throw error;
    return data;
  }

  async function editarComentario(id, body) {
    const { error } = await api().rpc("edit_comment", { p_comment_id: id, p_body: body });
    if (error) throw error;
  }

  async function apagarComentario(id) {
    const { error } = await api().rpc("delete_comment", { p_comment_id: id });
    if (error) throw error;
  }

  async function votar(id, votando) {
    if (!sessao) throw new Error("nao autenticado");
    if (votando) {
      const { error } = await api()
        .from("comment_votes")
        .insert({ comment_id: id, user_id: sessao.user.id });
      if (error) throw error;
    } else {
      const { error } = await api()
        .from("comment_votes")
        .delete()
        .eq("comment_id", id)
        .eq("user_id", sessao.user.id);
      if (error) throw error;
    }
  }

  async function denunciar(id, motivo) {
    if (!sessao) throw new Error("nao autenticado");
    const { error } = await api()
      .from("reports")
      .insert({ comment_id: id, reporter_id: sessao.user.id, reason: motivo });
    if (error) throw error;
  }

  async function comentariosDoPerfil(userId, limite = 20) {
    const { data, error } = await api()
      .from("comments")
      .select("id, body, score, created_at, thread_id, threads(subject_kind, subject_id)")
      .eq("author_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  }

  async function contarComentarios(userId) {
    const { count, error } = await api()
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .is("deleted_at", null);
    if (error) throw error;
    return count || 0;
  }

  // --------------------------------------------------------------- favoritos
  //
  // Um time e um jogador, no maximo. Escolher outro TROCA o atual, e clicar no
  // que ja e favorito desmarca. Nao ha "lista de favoritos" para gerenciar -
  // por isso isso e um UPDATE de coluna, e nao insert/delete de linha.

  function favoritoAtual(kind) {
    if (!perfil) return null;
    return perfil[COLUNA_FAV[kind]] || null;
  }

  function ehFavorito(kind, refId) {
    return favoritoAtual(kind) === String(refId);
  }

  // Devolve o valor que ficou, para quem chamou saber se marcou ou desmarcou.
  async function definirFavorito(kind, refId) {
    if (!sessao) throw new Error("nao autenticado");
    const coluna = COLUNA_FAV[kind];
    if (!coluna) throw new Error("tipo de favorito invalido: " + kind);
    const alvo = ehFavorito(kind, refId) ? null : String(refId);
    const { error } = await api()
      .from("profiles")
      .update({ [coluna]: alvo })
      .eq("id", sessao.user.id);
    if (error) throw error;
    if (perfil) perfil[coluna] = alvo;
    return alvo;
  }

  // ------------------------------------------------------------ notificacoes

  async function listarNotificacoes(limite = 30) {
    if (!sessao) return [];
    const { data, error } = await api()
      .from("notifications")
      .select("id, kind, comment_id, created_at, read_at")
      .eq("user_id", sessao.user.id)
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;
    return data || [];
  }

  async function contarNaoLidas() {
    if (!sessao) return 0;
    const { count } = await api()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", sessao.user.id)
      .is("read_at", null);
    return count || 0;
  }

  async function marcarLidas() {
    if (!sessao) return;
    await api()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", sessao.user.id)
      .is("read_at", null);
  }

  // ------------------------------------------------------------------- erros
  // As RPCs levantam P0001 com texto ja em portugues e ja legivel para quem
  // esta lendo a tela. O que precisa de traducao e o resto: codigo de RLS,
  // de constraint e as mensagens do GoTrue, que chegam em ingles.

  const TRADUCAO = {
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "User already registered": "Ja existe conta com esse e-mail.",
    "Email address is invalid": "Esse e-mail nao parece valido.",
    "Password should be at least 6 characters":
      "A senha precisa de pelo menos 6 caracteres.",
    "Email not confirmed": "Confirme o e-mail antes de entrar.",
    "For security purposes, you can only request this after 60 seconds":
      "Espere um minuto antes de tentar de novo.",
    // Chega pelo fragmento, quando o link de recuperacao venceu ou ja foi
    // usado. E o texto que a pessoa mais tem chance de encontrar na pratica.
    "Email link is invalid or has expired":
      "Esse link expirou ou já foi usado. Peça um novo em \"Esqueci a senha\".",
    "Token has expired or is invalid":
      "Esse link expirou ou já foi usado. Peça um novo em \"Esqueci a senha\".",
    "New password should be different from the old password":
      "A senha nova precisa ser diferente da atual.",
  };

  function mensagemDeErro(erro) {
    if (!erro) return "Algo deu errado.";
    const texto = erro.message || String(erro);
    for (const chave in TRADUCAO) if (texto.includes(chave)) return TRADUCAO[chave];
    if (erro.code === "23505") return "Isso ja existe.";
    if (erro.code === "42501") return "Voce nao tem permissao para isso.";
    if (texto.includes("Failed to fetch") || texto.includes("NetworkError"))
      return "Sem conexao com o servidor. Tente de novo.";
    return texto;
  }

  window.Community = {
    init,
    esc,
    aoMudar: (fn) => {
      ouvintes.add(fn);
      return () => ouvintes.delete(fn);
    },
    sessao: () => sessao,
    // Consome de uma vez: a janela de nova senha abre uma unica vez por volta
    // do link, e nao de novo a cada render.
    consomeRecuperacao: () => {
      const valor = recuperando;
      recuperando = false;
      return valor;
    },
    usuario: () => (sessao ? sessao.user : null),
    perfil: () => perfil,
    // Exige sessao E perfil, nao so sessao. O token sobrevive ao apagar da
    // conta ate expirar, entao "tem sessao" chega a ser verdade com a linha de
    // profiles ja deletada - e sem ela nao da para fazer nada, porque toda
    // escrita tem chave estrangeira para profiles. Definir logado() so por
    // `sessao` fazia o cabecalho dizer "Entrar" e a caixa de comentario
    // aparecer ao mesmo tempo, e o envio morria num erro de chave.
    logado: () => Boolean(sessao && perfil),
    ehAdmin: () => Boolean(perfil && perfil.role === "admin"),
    banido: () =>
      Boolean(perfil && perfil.banned_until && new Date(perfil.banned_until) > new Date()),
    usernameLivre,
    cadastrar,
    entrar,
    sair,
    pedirRedefinicao,
    trocarSenha,
    salvarBio,
    trocarUsername,
    excluirConta,
    perfilPublico,
    listarComentarios,
    comentar,
    editarComentario,
    apagarComentario,
    votar,
    denunciar,
    comentariosDoPerfil,
    contarComentarios,
    favoritoAtual,
    definirFavorito,
    ehFavorito,
    listarNotificacoes,
    contarNaoLidas,
    marcarLidas,
    mensagemDeErro,
    recarregarPerfil: carregaPerfil,
  };
})();
