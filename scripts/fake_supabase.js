// Supabase falso, em memoria, para testar no navegador as telas da comunidade
// sem tocar no banco de verdade. Implementa so o pedaco do SDK que o
// community-core.js usa. O teste injeta no lugar do /supabase-js.js e define
// window.__FAKE_SUPABASE__ antes, com os dados iniciais:
//   { usuarios: [{ id, email, senha, username, role }], threads: [{ id, kind, subject }],
//     comentarios: [{ id, thread, autor, body, parent, minutosAtras }], atraso: [min, max],
//     topicos: [{ id, autor, title, body, minutosAtras, apagado }] }
// As threads livres (`topicos`) seguem as regras do 0008_threads_livres.sql,
// com as mesmas mensagens de erro: o falso e o banco dos testes de tela.
// Cada resposta demora um tempo sorteado dentro de `atraso`, para as respostas
// chegarem fora de ordem como numa rede de verdade.
(function () {
  "use strict";

  const cfg = window.__FAKE_SUPABASE__ || {};
  const [atrasoMin, atrasoMax] = cfg.atraso || [5, 40];
  const espera = () => new Promise((ok) => setTimeout(ok, atrasoMin + Math.random() * (atrasoMax - atrasoMin)));
  const agora = () => new Date().toISOString();
  let seq = 1000;
  const novoId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

  const db = {
    profiles: (cfg.usuarios || []).map((u) => ({
      id: u.id, username: u.username, bio: null, role: u.role || "user", created_at: "2026-09-01T12:00:00Z",
      banned_until: null, fav_team: null, fav_player: null,
    })),
    threads: (cfg.threads || []).map((t) => ({ id: t.id, subject_kind: t.kind, subject_id: t.subject, created_at: agora() })),
    comments: (cfg.comentarios || []).map((c) => ({
      id: c.id, thread_id: c.thread, parent_id: c.parent || null, author_id: c.autor, body: c.body,
      created_at: new Date(Date.now() - (c.minutosAtras || 5) * 60000).toISOString(), edited_at: null, deleted_at: null, score: c.score || 0,
    })),
    comment_votes: [],
    topics: (cfg.topicos || []).map((t) => {
      const quando = new Date(Date.now() - (t.minutosAtras || 5) * 60000).toISOString();
      return {
        id: t.id, author_id: t.autor || null, title: t.apagado ? "" : t.title, body: t.apagado ? "" : t.body || "",
        created_at: quando, edited_at: null, deleted_at: t.apagado ? quando : null,
      };
    }),
    notifications: [],
    reports: [],
  };
  // Cada topico semeado ganha a sua thread de conversa, como o create_topic faz.
  db.topics.forEach((t) => db.threads.push({ id: novoId(), subject_kind: "topic", subject_id: t.id, created_at: t.created_at }));
  const usuarios = cfg.usuarios || [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const registro = (window.__FAKE_SUPABASE_LOG__ = []);
  const anota = (oque) => registro.push(oque);

  let sessao = null;
  const ouvintes = new Set();
  const avisa = (evento) => ouvintes.forEach((fn) => setTimeout(() => fn(evento, sessao), 0));

  function threadCounts() {
    return db.threads.map((t) => {
      const vivos = db.comments.filter((c) => c.thread_id === t.id && !c.deleted_at);
      return {
        subject_kind: t.subject_kind,
        subject_id: t.subject_id,
        comentarios: vivos.length,
        ultimo_em: vivos.reduce((max, c) => (c.created_at > max ? c.created_at : max), ""),
      };
    });
  }

  // A view topic_list: so as vivas, com autor e contagem de comentarios vivos.
  function topicList() {
    return db.topics
      .filter((t) => !t.deleted_at)
      .map((t) => {
        const th = db.threads.find((x) => x.subject_kind === "topic" && x.subject_id === t.id);
        const vivos = th ? db.comments.filter((c) => c.thread_id === th.id && !c.deleted_at) : [];
        const p = db.profiles.find((x) => x.id === t.author_id);
        return {
          id: t.id, title: t.title, created_at: t.created_at, edited_at: t.edited_at,
          author_username: p ? p.username : null,
          respostas: vivos.length,
          ultima_atividade: vivos.reduce((max, c) => (c.created_at > max ? c.created_at : max), t.created_at),
        };
      });
  }

  function topicoComAutor(t) {
    const p = db.profiles.find((x) => x.id === t.author_id);
    return { ...t, profiles: p ? { username: p.username, role: p.role, fav_team: p.fav_team, fav_player: p.fav_player } : null };
  }

  // O embed `comments(thread_id, threads(subject_kind, subject_id))` do aviso.
  function avisoComThread(n) {
    const c = db.comments.find((x) => x.id === n.comment_id);
    const th = c ? db.threads.find((x) => x.id === c.thread_id) : null;
    return { ...n, comments: c ? { thread_id: c.thread_id, threads: th ? { subject_kind: th.subject_kind, subject_id: th.subject_id } : null } : null };
  }

  function comAutor(c) {
    const p = db.profiles.find((x) => x.id === c.author_id);
    // `threads` e o embed do perfil (comentariosDoPerfil): onde o comentario esta.
    const th = db.threads.find((x) => x.id === c.thread_id);
    return {
      ...c,
      profiles: p ? { username: p.username, role: p.role, fav_team: p.fav_team, fav_player: p.fav_player } : null,
      threads: th ? { subject_kind: th.subject_kind, subject_id: th.subject_id } : null,
    };
  }

  class Consulta {
    constructor(tabela) {
      this.tabela = tabela;
      this.filtros = [];
      this.modo = "select";
      this.opcoes = {};
    }
    select(_colunas, opcoes) { if (this.modo === "select") this.opcoes = opcoes || {}; return this; }
    eq(col, val) {
      // Coluna uuid com texto qualquer: o Postgres recusa a consulta inteira.
      if (this.tabela === "topics" && col === "id" && !UUID.test(String(val))) this.idInvalido = true;
      this.filtros.push((r) => String(r[col]) === String(val));
      return this;
    }
    in(col, vals) { this.filtros.push((r) => vals.map(String).includes(String(r[col]))); return this; }
    is(col, val) { this.filtros.push((r) => (r[col] ?? null) === val); return this; }
    order(col, { ascending = true } = {}) { this.ordem = [col, ascending]; return this; }
    limit(n) { this.limite = n; return this; }
    range(de, ate) { this.faixa = [de, ate]; return this; }
    update(valores) { this.modo = "update"; this.valores = valores; return this; }
    delete() { this.modo = "delete"; return this; }
    insert(valores) { this.modo = "insert"; this.valores = valores; return this; }
    maybeSingle() { this.unico = true; return this; }
    linhas() {
      const base = this.tabela === "thread_counts" ? threadCounts() : this.tabela === "topic_list" ? topicList() : db[this.tabela] || [];
      return base.filter((r) => this.filtros.every((f) => f(r)));
    }
    async executa() {
      await espera();
      anota(`${this.modo} ${this.tabela}`);
      const uid = sessao?.user.id;
      if (this.modo === "insert") {
        if (this.tabela === "comment_votes") {
          if (this.valores.user_id !== uid) return { data: null, error: { message: "permission denied", code: "42501" } };
          if (db.comment_votes.some((v) => v.comment_id === this.valores.comment_id && v.user_id === uid)) return { data: null, error: { message: "duplicate", code: "23505" } };
          db.comment_votes.push({ value: 1, ...this.valores });
          const c = db.comments.find((x) => x.id === this.valores.comment_id);
          if (c) c.score += this.valores.value ?? 1;
        } else db[this.tabela].push({ id: novoId(), ...this.valores });
        return { data: null, error: null };
      }
      if (this.modo === "update") {
        this.linhas().forEach((r) => {
          if (this.tabela === "comment_votes") {
            const c = db.comments.find((x) => x.id === r.comment_id);
            if (c) c.score += this.valores.value - r.value;
          }
          Object.assign(r, this.valores);
        });
        return { data: null, error: null };
      }
      if (this.modo === "delete") {
        const fora = this.linhas();
        fora.forEach((r) => {
          if (this.tabela === "comment_votes") {
            const c = db.comments.find((x) => x.id === r.comment_id);
            if (c) c.score -= r.value;
          }
        });
        db[this.tabela] = db[this.tabela].filter((r) => !fora.includes(r));
        return { data: null, error: null };
      }
      if (this.idInvalido) return { data: null, error: { message: "invalid input syntax for type uuid", code: "22P02" } };
      let linhas = this.linhas();
      if (this.tabela === "comment_votes") linhas = linhas.filter((v) => v.user_id === uid);
      if (this.tabela === "comments") linhas = linhas.map(comAutor);
      if (this.tabela === "topics") linhas = linhas.map(topicoComAutor);
      if (this.tabela === "notifications") linhas = linhas.map(avisoComThread);
      if (this.ordem) {
        const [col, asc] = this.ordem;
        linhas = linhas.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      const total = linhas.length;
      if (this.faixa) linhas = linhas.slice(this.faixa[0], this.faixa[1] + 1);
      if (this.limite) linhas = linhas.slice(0, this.limite);
      if (this.opcoes.head) return { data: null, count: total, error: null };
      if (this.opcoes.count) return { data: linhas.map((r) => ({ ...r })), count: total, error: null };
      if (this.unico) return { data: linhas[0] ? { ...linhas[0] } : null, error: null };
      return { data: linhas.map((r) => ({ ...r })), error: null };
    }
    then(ok, falha) { return this.executa().then(ok, falha); }
  }

  const rpcs = {
    post_comment({ p_kind, p_subject_id, p_body, p_parent_id }) {
      const uid = sessao?.user.id;
      if (!uid) throw { message: "nao autenticado", code: "P0001" };
      if (cfg.recusaKinds && cfg.recusaKinds.includes(p_kind)) throw { message: 'new row for relation "threads" violates check constraint "threads_subject_kind_check"', code: "23514" };
      let topico = null;
      if (p_kind === "topic") {
        topico = UUID.test(String(p_subject_id)) ? db.topics.find((x) => x.id === p_subject_id && !x.deleted_at) : null;
        if (!topico) throw { message: "thread nao existe", code: "P0001" };
      }
      let t = db.threads.find((x) => x.subject_kind === p_kind && x.subject_id === p_subject_id);
      if (!t) {
        t = { id: novoId(), subject_kind: p_kind, subject_id: p_subject_id, created_at: agora() };
        db.threads.push(t);
      }
      const pai = p_parent_id ? db.comments.find((c) => c.id === p_parent_id && c.thread_id === t.id && !c.deleted_at) : null;
      if (p_parent_id && !pai) throw { message: "comentario respondido nao existe nesta thread", code: "P0001" };
      const id = novoId();
      db.comments.push({ id, thread_id: t.id, parent_id: p_parent_id || null, author_id: uid, body: p_body.trim(), created_at: agora(), edited_at: null, deleted_at: null, score: 0 });
      // Avisos: resposta, e o de thread livre sem repetir quem ja foi avisado.
      const avisa = (user_id, kind) => db.notifications.push({ id: novoId(), user_id, kind, comment_id: id, created_at: agora(), read_at: null });
      const autorPai = pai ? pai.author_id : null;
      if (autorPai && autorPai !== uid) avisa(autorPai, "reply");
      if (topico && topico.author_id && topico.author_id !== uid && topico.author_id !== autorPai) avisa(topico.author_id, "topic_reply");
      return id;
    },
    edit_comment({ p_comment_id, p_body }) {
      const c = db.comments.find((x) => x.id === p_comment_id && x.author_id === sessao?.user.id);
      if (!c) throw { message: "so da para editar comentario proprio, nos primeiros 15 minutos", code: "P0001" };
      c.body = p_body.trim();
      c.edited_at = agora();
    },
    delete_comment({ p_comment_id }) {
      const c = db.comments.find((x) => x.id === p_comment_id);
      if (!c) throw { message: "comentario nao encontrado", code: "P0001" };
      c.body = "";
      c.deleted_at = agora();
    },
    create_topic({ p_title, p_body }) {
      const uid = sessao?.user.id;
      if (!uid) throw { message: "nao autenticado", code: "P0001" };
      const title = String(p_title || "").trim();
      const body = String(p_body || "").trim();
      if (title.length < 5 || title.length > 120) throw { message: "titulo precisa ter entre 5 e 120 caracteres", code: "P0001" };
      if (body.length > 2000) throw { message: "texto pode ter no maximo 2000 caracteres", code: "P0001" };
      const desde = (min) => db.topics.filter((x) => x.author_id === uid && Date.parse(x.created_at) > Date.now() - min * 60000).length;
      if (desde(60) >= 3) throw { message: "muitas threads seguidas, espere um pouco", code: "P0001" };
      if (desde(1440) >= 10) throw { message: "limite diario de threads atingido", code: "P0001" };
      const id = novoId();
      db.topics.push({ id, author_id: uid, title, body, created_at: agora(), edited_at: null, deleted_at: null });
      db.threads.push({ id: novoId(), subject_kind: "topic", subject_id: id, created_at: agora() });
      return id;
    },
    edit_topic({ p_topic_id, p_title, p_body }) {
      const uid = sessao?.user.id;
      if (!uid) throw { message: "nao autenticado", code: "P0001" };
      const title = String(p_title || "").trim();
      const body = String(p_body || "").trim();
      if (title.length < 5 || title.length > 120) throw { message: "titulo precisa ter entre 5 e 120 caracteres", code: "P0001" };
      if (body.length > 2000) throw { message: "texto pode ter no maximo 2000 caracteres", code: "P0001" };
      const alvo = db.topics.find((x) => x.id === p_topic_id && x.author_id === uid && !x.deleted_at && Date.parse(x.created_at) > Date.now() - 15 * 60000);
      if (!alvo) throw { message: "so da para editar thread propria, nos primeiros 15 minutos", code: "P0001" };
      Object.assign(alvo, { title, body, edited_at: agora() });
    },
    delete_topic({ p_topic_id }) {
      const uid = sessao?.user.id;
      if (!uid) throw { message: "nao autenticado", code: "P0001" };
      const alvo = db.topics.find((x) => x.id === p_topic_id && !x.deleted_at);
      if (!alvo) throw { message: "thread nao encontrada", code: "P0001" };
      const admin = db.profiles.find((x) => x.id === uid)?.role === "admin";
      if (alvo.author_id !== uid && !admin) throw { message: "sem permissao", code: "P0001" };
      Object.assign(alvo, { title: "", body: "", deleted_at: agora() });
    },
    username_available({ candidate }) {
      return !db.profiles.some((p) => p.username.toLowerCase() === String(candidate).toLowerCase());
    },
  };

  function sessaoDe(u) {
    return { access_token: `token-${u.id}`, refresh_token: "r", user: { id: u.id, email: u.email } };
  }

  window.supabase = {
    createClient() {
      const cliente = {
        from: (tabela) => new Consulta(tabela),
        async rpc(nome, args) {
          await espera();
          anota(`rpc ${nome}`);
          try {
            return { data: rpcs[nome](args || {}), error: null };
          } catch (erro) {
            return { data: null, error: erro };
          }
        },
        auth: {
          async exchangeCodeForSession() { return { error: null }; },
          async setSession() { return { error: null }; },
          async getSession() { await espera(); return { data: { session: sessao } }; },
          onAuthStateChange(fn) {
            ouvintes.add(fn);
            setTimeout(() => fn("INITIAL_SESSION", sessao), 0);
            return { data: { subscription: { unsubscribe: () => ouvintes.delete(fn) } } };
          },
          async signInWithPassword({ email, password }) {
            await espera();
            const u = usuarios.find((x) => x.email === email && x.senha === password);
            if (!u) return { data: null, error: { message: "Invalid login credentials" } };
            sessao = sessaoDe(u);
            avisa("SIGNED_IN");
            return { data: { session: sessao }, error: null };
          },
          async signOut() { sessao = null; avisa("SIGNED_OUT"); return { error: null }; },
          async signUp() { return { data: null, error: { message: "cadastro desligado no teste" } }; },
          async resetPasswordForEmail() { return { error: null }; },
          async updateUser() { return { error: null }; },
          // So o teste chama: simula a renovacao do token, que dispara o aviso
          // sem a conta mudar.
          __renova() { avisa("TOKEN_REFRESHED"); },
        },
      };
      window.__FAKE_SUPABASE_CLIENTE__ = cliente;
      return cliente;
    },
  };
  window.__FAKE_SUPABASE_DB__ = db;
})();
