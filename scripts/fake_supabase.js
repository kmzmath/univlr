// Supabase falso, em memoria, para testar no navegador as telas da comunidade
// sem tocar no banco de verdade. Implementa so o pedaco do SDK que o
// community-core.js usa. O teste injeta no lugar do /supabase-js.js e define
// window.__FAKE_SUPABASE__ antes, com os dados iniciais:
//   { usuarios: [{ id, email, senha, username, role }], threads: [{ id, kind, subject }],
//     comentarios: [{ id, thread, autor, body, parent, minutosAtras }], atraso: [min, max] }
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
    notifications: [],
    reports: [],
  };
  const usuarios = cfg.usuarios || [];
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

  function comAutor(c) {
    const p = db.profiles.find((x) => x.id === c.author_id);
    return { ...c, profiles: p ? { username: p.username, role: p.role, fav_team: p.fav_team, fav_player: p.fav_player } : null };
  }

  class Consulta {
    constructor(tabela) {
      this.tabela = tabela;
      this.filtros = [];
      this.modo = "select";
      this.opcoes = {};
    }
    select(_colunas, opcoes) { if (this.modo === "select") this.opcoes = opcoes || {}; return this; }
    eq(col, val) { this.filtros.push((r) => String(r[col]) === String(val)); return this; }
    in(col, vals) { this.filtros.push((r) => vals.map(String).includes(String(r[col]))); return this; }
    is(col, val) { this.filtros.push((r) => (r[col] ?? null) === val); return this; }
    order(col, { ascending = true } = {}) { this.ordem = [col, ascending]; return this; }
    limit(n) { this.limite = n; return this; }
    update(valores) { this.modo = "update"; this.valores = valores; return this; }
    delete() { this.modo = "delete"; return this; }
    insert(valores) { this.modo = "insert"; this.valores = valores; return this; }
    maybeSingle() { this.unico = true; return this; }
    linhas() {
      const base = this.tabela === "thread_counts" ? threadCounts() : db[this.tabela] || [];
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
      let linhas = this.linhas();
      if (this.tabela === "comment_votes") linhas = linhas.filter((v) => v.user_id === uid);
      if (this.tabela === "comments") linhas = linhas.map(comAutor);
      if (this.ordem) {
        const [col, asc] = this.ordem;
        linhas = linhas.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.limite) linhas = linhas.slice(0, this.limite);
      if (this.opcoes.head) return { data: null, count: linhas.length, error: null };
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
      let t = db.threads.find((x) => x.subject_kind === p_kind && x.subject_id === p_subject_id);
      if (!t) {
        t = { id: novoId(), subject_kind: p_kind, subject_id: p_subject_id, created_at: agora() };
        db.threads.push(t);
      }
      if (p_parent_id && !db.comments.some((c) => c.id === p_parent_id && c.thread_id === t.id)) throw { message: "comentario respondido nao existe nesta thread", code: "P0001" };
      const id = novoId();
      db.comments.push({ id, thread_id: t.id, parent_id: p_parent_id || null, author_id: uid, body: p_body.trim(), created_at: agora(), edited_at: null, deleted_at: null, score: 0 });
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
