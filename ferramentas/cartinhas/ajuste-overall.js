/* ajuste-overall.js - overall ajustado pela força dos adversários e pela
 * quantidade de rounds (o mesmo cálculo da planilha "Overall ajustado").
 *
 * 1. Força dos adversários: um modelo com o rAAting de cada jogador em cada
 *    mapa = nível do jogador + efeito do adversário + ruído (peso = rounds),
 *    resolvido com os dois termos encolhidos (kJogador e kAdversario, os
 *    valores estimados por máxima verossimilhança restrita na análise).
 *    "Nível dos adversários" de um jogador = média, pesada pelos rounds, de
 *    quanto os times que ele enfrentou costumam derrubar o rAAting de quem
 *    joga contra eles (positivo = adversários mais fortes que o típico).
 * 2. Amostra: rAAting final = média + peso × (rAAting + nível − média),
 *    com peso = rounds / (rounds + k).
 *
 * Funciona no navegador (window.AjusteOverall) e no Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AjusteOverall = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // pesos e referências do rAAting 3.0 (os mesmos do raating-core.js do site)
  const PESOS = { KillRating: 0.25, DamageRating: 0.15, MultiKillRating: 0.04, RoundSwingRating: 0.33, SurvivalRating: 0.15, KASTRating: 0.08 };
  const REFERENCIAS = {
    metric_kill: { median: 0.69080751, iqr: 0.1786497375 },
    metric_damage: { median: 1.01149739, iqr: 0.23446389 },
    metric_multikill: { median: 0.2241625, iqr: 0.11087375 },
    metric_round_swing: { median: -0.3482385, iqr: 4.0305735 },
    metric_survival: { median: 0.285871175, iqr: 0.08546929 },
    metric_kast: { median: 0.71465847, iqr: 0.0765002825 },
  };
  const PARES = [
    ["KillRating", "metric_kill"],
    ["DamageRating", "metric_damage"],
    ["MultiKillRating", "metric_multikill"],
    ["RoundSwingRating", "metric_round_swing"],
    ["SurvivalRating", "metric_survival"],
    ["KASTRating", "metric_kast"],
  ];

  /* rAAting 3.0 de um mapa sem os limites (0,3 a 1,8 e z entre -3 e 3): nessa
   * forma ele soma certinho por rounds, e a média dos mapas pesada pelos
   * rounds dá o rAAting agregado que o site mostra (quando nenhum limite atua). */
  function ratingLinear(linha, core) {
    const pesos = (core && core.RATING_3_WEIGHTS) || PESOS;
    const refs = (core && core.RATING_3_BASELINES) || REFERENCIAS;
    let total = -0.008426;
    for (const [sub, metrica] of PARES) {
      const ref = refs[metrica];
      const v = Number(linha[metrica]);
      if (!Number.isFinite(v) || !ref) return NaN;
      total += pesos[sub] * (1 + (0.28 * (v - ref.median)) / ref.iqr);
    }
    return total;
  }

  // sistema simétrico positivo definido: Cholesky
  function resolver(M, r) {
    const n = r.length;
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = M[i * n + j];
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (s <= 0) throw new Error("sistema do ajuste não é positivo definido");
          L[i * n + i] = Math.sqrt(s);
        } else L[i * n + j] = s / L[j * n + j];
      }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = r[i];
      for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
      y[i] = s / L[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
      x[i] = s / L[i * n + i];
    }
    return x;
  }

  /* db: o database.json já decodificado. Devolve a média de referência, a
   * força de cada time como adversário e o nível dos adversários de cada
   * jogador (chave = puuid principal do jogador no site). */
  function calcular(db, opcoes) {
    const o = Object.assign({ kJogador: 39.244, kAdversario: 52.034, core: null }, opcoes || {});
    const principal = new Map();
    for (const p of db.players || []) {
      principal.set(p.puuid, p.puuid);
      for (const a of p.accounts || []) principal.set(a.puuid, p.puuid);
    }

    const times = new Map(); // id do time -> índice
    const indiceTime = (id) => {
      if (!times.has(id)) times.set(id, times.size);
      return times.get(id);
    };
    const jogadores = new Map(); // puuid -> { n, s, porTime: Map(índice -> rounds) }
    const linhas = [];
    for (const m of db.matches || []) {
      const A = m.teamA && m.teamA.id;
      const B = m.teamB && m.teamB.id;
      for (const p of m.players || []) {
        const adv = p.teamId === A ? B : p.teamId === B ? A : null;
        const w = Number(p.rounds);
        if (!adv || !(w > 0)) continue;
        const y = ratingLinear(p, o.core);
        if (!Number.isFinite(y)) continue;
        const pid = principal.get(p.puuid) || p.puuid;
        const t = indiceTime(adv);
        linhas.push({ pid, t, w, y });
      }
    }
    const T = times.size;
    const N1 = 1 + T;
    const M = new Float64Array(N1 * N1);
    const r = new Float64Array(N1);
    const Wt = new Float64Array(T);
    for (const { pid, t, w, y } of linhas) {
      M[0] += w;
      r[0] += w * y;
      Wt[t] += w;
      r[1 + t] += w * y;
      let j = jogadores.get(pid);
      if (!j) jogadores.set(pid, (j = { n: 0, s: 0, porTime: new Map() }));
      j.n += w;
      j.s += w * y;
      j.porTime.set(t, (j.porTime.get(t) || 0) + w);
    }
    for (let t = 0; t < T; t++) {
      M[0 * N1 + 1 + t] += Wt[t];
      M[(1 + t) * N1 + 0] += Wt[t];
      M[(1 + t) * N1 + 1 + t] += Wt[t] + o.kAdversario;
    }
    // elimina o nível de cada jogador (bloco diagonal): complemento de Schur
    for (const j of jogadores.values()) {
      const D = j.n + o.kJogador;
      const idx = [0];
      const val = [j.n];
      for (const [t, w] of j.porTime) {
        idx.push(1 + t);
        val.push(w);
      }
      for (let a = 0; a < idx.length; a++) {
        r[idx[a]] -= (j.s / D) * val[a];
        for (let b = 0; b < idx.length; b++) M[idx[a] * N1 + idx[b]] -= (val[a] * val[b]) / D;
      }
    }
    const u = resolver(M, r);
    const b0 = u[0];
    let soma = 0;
    let peso = 0;
    for (let t = 0; t < T; t++) {
      soma += Wt[t] * u[1 + t];
      peso += Wt[t];
    }
    const c = peso ? soma / peso : 0; // adversário típico (média pesada pelos rounds)
    const media = b0 + c;
    const forca = new Map();
    for (const [id, t] of times) forca.set(id, -(u[1 + t] - c));
    const nivel = new Map();
    const rounds = new Map();
    for (const [pid, j] of jogadores) {
      let d = 0;
      for (const [t, w] of j.porTime) d += w * (u[1 + t] - c);
      nivel.set(pid, -(d / j.n));
      rounds.set(pid, j.n);
    }
    return { media, forca, nivel, rounds, mapas: (db.matches || []).length, kJogador: o.kJogador, kAdversario: o.kAdversario };
  }

  /* rAAting final do jogador: média + peso × (rAAting + intensidade × nível − média) */
  function ajustar(rating, rounds, nivel, cfg) {
    const k = Number(cfg.k ?? 40);
    const intensidade = Number(cfg.intensidade ?? 1);
    const media = Number(cfg.media);
    const n = Number(rounds) || 0;
    const pesoAmostra = k > 0 ? n / (n + k) : 1;
    return media + pesoAmostra * (Number(rating) + intensidade * (Number(nivel) || 0) - media);
  }

  return { calcular, ajustar, ratingLinear };
});
