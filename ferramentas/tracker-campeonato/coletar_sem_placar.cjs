// Coleta no tracker.gg os mapas de séries que o Challengermode só guarda com o
// resultado lançado pelo admin (1x0 por jogo, sem placar de rounds), caso dos
// Playoffs da Copa Aliança 2025. O coletar.cjs não serve: ele casa pelo placar.
//
// Uso:
//   node ferramentas/tracker-campeonato/coletar_sem_placar.cjs <pasta> [opções]
//     --max N                 teto de requisições nesta execução (padrão 400)
//     --reaproveitar <dir>    índices do tracker já baixados (outra coleta),
//                             lidos só como fonte de candidatos; repetível
//
// A pasta precisa de cm.json e puuids.json. Use uma pasta só para esta coleta:
// o estado (lote/estado.json) guarda séries, e não jogos, como alvos.
//
// Método:
// 1. Cada série vira um alvo. A janela vai do primeiro jogo criado ao último
//    encerrado. Série lançada mais de 12 h depois do horário marcado (a final
//    dos Playoffs 2025 foi marcada para 04/10 e lançada em 08/10) começa no fim
//    da série anterior mais tardia das duas equipes. Os mapas esperados são a
//    soma do placar.
// 2. Toda personalizada de bomba do índice que começa na janela é candidata.
//    Em janela de mais de um dia, que pega semanas de treino, o candidato só é
//    baixado depois de aparecer no índice de contas das duas equipes.
// 3. O arquivo confirma a série pelos dois elencos, como no coletar.cjs: pelo
//    menos 3 jogadores de cada lado entre os competidores dos jogos da série e
//    os membros da equipe.
// 4. Enquanto faltar mapa, escolhe a conta que jogou o maior número de séries
//    faltantes e percorre o índice dela na janela.
//
// Grava lote/sem-placar.json e lote/sem-placar.md. Os detalhes ficam em tracker/.

const fs = require("fs");
const path = require("path");
const { conectar, abaDo } = require("./cdp.cjs");
const ritmo = require("./ritmo.cjs");
const C = require("./coletar.cjs");

const LANCADA_DEPOIS_MS = 12 * 3600_000;
const ANTES_DO_MARCADO_MS = 6 * 3600_000;
const JANELA_LONGA_MS = 24 * 3600_000;
const MAX_CONTAS_POR_SERIE = 3;

function argumentos() {
  const a = process.argv.slice(2);
  const op = { pasta: a[0], max: 400, reaproveitar: [] };
  for (let i = 1; i < a.length; i++) {
    if (a[i] === "--max") op.max = Number(a[++i]);
    else if (a[i] === "--reaproveitar") op.reaproveitar.push(a[++i]);
  }
  if (!op.pasta) throw new Error("Uso: coletar_sem_placar.cjs <pasta> [--max N] [--reaproveitar dir]");
  return op;
}

// ---------- séries ----------

function montarSeries(cm) {
  const equipe = new Map(cm.equipes.map((e) => [e.id, e]));
  const reais = cm.partidas.filter((p) => (p.equipes || []).filter((t) => t.equipeId && !t.bye).length === 2);
  const numeros = new Map();
  for (const p of reais) numeros.set(p.numero, (numeros.get(p.numero) || 0) + 1);
  const fimDa = (p) => Math.max(...p.jogos.map((j) => C.utc(j.fim)).filter(Boolean));
  return reais
    .map((p) => {
      const ids = p.equipes.map((t) => t.equipeId);
      const marcada = C.utc(p.agendada);
      let inicio = Math.min(...p.jogos.map((j) => C.utc(j.criado)));
      if (marcada && inicio - marcada > LANCADA_DEPOIS_MS) {
        const anteriores = reais.filter((q) => q.numero < p.numero && q.equipes.some((t) => ids.includes(t.equipeId)));
        inicio = anteriores.length ? Math.max(...anteriores.map(fimDa)) : marcada - ANTES_DO_MARCADO_MS;
      }
      const competidores = ids.map((id) => {
        const porId = new Map();
        for (const j of p.jogos) {
          const lado = j.lados.find((l) => l.equipeId === id)?.lado;
          for (const c of j.competidores) if (c.lado === lado && c.papel === 0) porId.set(C.chaveId(c.riotId), c);
        }
        for (const m of equipe.get(id)?.membros || []) {
          if (m.papel === 0 && m.riotId && !porId.has(C.chaveId(m.riotId))) porId.set(C.chaveId(m.riotId), { riotId: m.riotId, papel: 0, membro: true });
        }
        return [...porId.values()];
      });
      return {
        chave: numeros.get(p.numero) > 1 ? `S${p.numero}:${p.id}` : `S${p.numero}`, serie: p.numero, marcada, inicio, fim: fimDa(p),
        placarSerie: p.equipes.map((t) => t.placar), mapas: p.equipes.reduce((soma, t) => soma + (t.placar || 0), 0),
        equipes: ids.map((id) => ({ id, nome: equipe.get(id)?.nome })), competidores,
      };
    });
}

const naJanela = (s, ts) => ts >= s.inicio - C.FOLGA_INICIO_MS && ts <= s.fim + C.FOLGA_FIM_MS;

// ---------- conferência ----------

// A do coletar.cjs sem o placar: os dois lados do arquivo contra as duas
// equipes da série, na orientação que reconhece mais jogadores.
function conferir(ctx, s, J) {
  const cores = Object.keys(J.times);
  if (cores.length !== 2) return null;
  const ladoCm = s.competidores.map((cs) => new Set(cs.map((c) => ctx.id.chave(c.riotId))));
  let melhor = null;
  for (const par of [[cores[0], cores[1]], [cores[1], cores[0]]]) {
    const lados = par.map((cor, i) => {
      const ks = J.times[cor].map((rid) => ({ rid, k: ctx.id.chave(rid) }));
      return {
        cor, placar: J.placar[cor],
        reconhecidos: ks.filter((x) => ladoCm[i].has(x.k)).map((x) => x.rid),
        sobra: ks.filter((x) => !ladoCm[i].has(x.k)).map((x) => x.rid),
      };
    });
    const total = lados[0].reconhecidos.length + lados[1].reconhecidos.length;
    if (!melhor || total > melhor.total) melhor = { total, lados };
  }
  const dentro = naJanela(s, J.inicio);
  const minimo = Math.min(...melhor.lados.map((l) => l.reconhecidos.length));
  const situacao = !dentro || minimo < C.MIN_CONFERE_LADO ? "rejeitado" : minimo === 5 ? "confirmado" : "parcial";
  return { situacao, dentro, ...melhor, inicio: J.inicio, duracao: J.duracao, mapa: J.mapa };
}

function reconciliar(ctx) {
  const achados = Object.fromEntries(ctx.series.map((s) => [s.chave, []]));
  for (const c of Object.values(ctx.estado.candidatos)) {
    const J = C.lerDetalhe(ctx, c.uuid);
    if (!J) continue;
    for (const chave of c.alvos) {
      const r = conferir(ctx, ctx.seriePorChave.get(chave), J);
      if (r && r.situacao !== "rejeitado") achados[chave].push({ uuid: c.uuid, ...r });
    }
  }
  for (const lista of Object.values(achados)) lista.sort((a, b) => a.inicio - b.inicio);
  ctx.achados = achados;
  return achados;
}

const faltantes = (ctx) => ctx.series.filter((s) => ctx.achados[s.chave].length < s.mapas);

// Lados da série cujas contas trouxeram o candidato no índice. A conta do
// índice vem pelo Riot ID atual, então vale tanto a chave quanto o nome atual.
function ladosDasFontes(ctx, c, s) {
  const lados = new Set();
  s.competidores.forEach((cs, i) => {
    const chaves = new Set(cs.map((x) => ctx.id.chave(x.riotId)));
    const atuais = new Set(cs.map((x) => C.chaveId(ctx.id.atual(x.riotId))).filter(Boolean));
    if (c.fontes.some((f) => chaves.has(ctx.id.chave(f.quem)) || atuais.has(C.chaveId(f.quem)))) lados.add(i);
  });
  return lados.size;
}

const elegivel = (ctx, c, s) => s.fim - s.inicio <= JANELA_LONGA_MS || ladosDasFontes(ctx, c, s) === 2;

// Primeiro o candidato que mais contas viram: em série com janela de dias, o
// índice de uma conta traz também os treinos da equipe.
async function baixarPendentes(ctx) {
  reconciliar(ctx);
  let faltam = new Set(faltantes(ctx).map((s) => s.chave));
  const quer = (c) => c.alvos.some((k) => faltam.has(k) && elegivel(ctx, c, ctx.seriePorChave.get(k)));
  const fila = Object.values(ctx.estado.candidatos)
    .filter((c) => !C.lerDetalhe(ctx, c.uuid) && !ctx.estado.adiados[c.uuid] && quer(c))
    .sort((a, b) => b.fontes.length - a.fontes.length || a.ts - b.ts);
  for (const c of fila) {
    if (!quer(c)) continue;
    if (await C.baixarDetalhe(ctx, c.uuid)) {
      reconciliar(ctx);
      faltam = new Set(faltantes(ctx).map((s) => s.chave));
    }
  }
  return reconciliar(ctx);
}

// ---------- escolha de contas ----------

// No empate, a conta da equipe com menos contas percorridas: na janela longa
// o candidato precisa aparecer no índice das duas.
function proximaConta(ctx) {
  const tent = ctx.estado.tentativas || {};
  const pontos = new Map();
  for (const s of faltantes(ctx).filter((s) => (tent[s.chave] || 0) < MAX_CONTAS_POR_SERIE)) {
    for (const cs of s.competidores) {
      const percorridas = cs.filter((c) => ctx.estado.contas[ctx.id.atual(c.riotId)]?.esgotada).length;
      for (const c of cs) {
        const atual = ctx.id.atual(c.riotId);
        if (!atual || ctx.estado.contas[atual]?.esgotada) continue;
        const p = pontos.get(atual) || { conta: atual, series: [], percorridas };
        if (!p.series.includes(s)) p.series.push(s);
        pontos.set(atual, p);
      }
    }
  }
  return [...pontos.values()].sort((x, y) => y.series.length - x.series.length || x.percorridas - y.percorridas)[0] || null;
}

// ---------- relatório ----------

function relatorio(ctx) {
  const achados = reconciliar(ctx);
  const dia = (ms) => new Date(ms).toISOString().slice(0, 10);
  const md = [`# ${ctx.cm.torneio.nome}: mapas pelo horário`, "", `Atualizado em ${new Date().toISOString()}.`, ""];
  md.push("| Série | Janela (UTC) | Equipes | Série | Mapas | Achados |", "|---|---|---|---|---|---|");
  for (const s of ctx.series) {
    const lista = achados[s.chave];
    const desc = lista.map((a) => {
      const placar = a.lados.map((l) => l.placar).join("-");
      const rec = a.lados.map((l) => l.reconhecidos.length).join("+");
      return `${C.hora(a.inicio)} ${a.mapa} ${placar} (${rec} de 10${a.situacao === "parcial" ? ", parcial" : ""})`;
    }).join("; ");
    md.push(`| ${s.serie} | ${dia(s.inicio)} ${C.hora(s.inicio)} a ${dia(s.fim)} ${C.hora(s.fim)} | ${s.equipes[0].nome} × ${s.equipes[1].nome} | ${s.placarSerie.join("x")} | ${lista.length} de ${s.mapas} | ${desc || "nenhum"} |`);
  }
  const req = ctx.estado.requisicoes;
  md.push("", `Requisições: ${req.length} no total (${req.filter((r) => r.tipo === "indice").length} de índice, ${req.filter((r) => r.tipo === "detalhe").length} de detalhe), ${req.filter((r) => r.t >= ctx.inicioMs).length} nesta execução.`);
  const contas = Object.entries(ctx.estado.contas).filter(([, c]) => c.esgotada).map(([conta, c]) => `${conta} (${c.resultado?.ok ? "janela coberta" : JSON.stringify(c.resultado)})`);
  md.push("", `Contas percorridas: ${contas.join(", ") || "nenhuma"}.`);
  const semPuuid = new Set();
  for (const c of Object.values(ctx.estado.candidatos)) {
    const J = C.lerDetalhe(ctx, c.uuid);
    if (J) for (const rids of Object.values(J.times)) for (const rid of rids) if (!ctx.id.registro(rid)) semPuuid.add(rid);
  }
  C.gravarAtomico(path.join(ctx.op.pasta, "lote", "ids_tracker.txt"), [...semPuuid].sort().join("\n") + "\n");
  C.gravarAtomico(path.join(ctx.op.pasta, "lote", "sem-placar.md"), md.join("\n") + "\n");
  C.gravarAtomico(path.join(ctx.op.pasta, "lote", "sem-placar.json"), JSON.stringify({
    torneio: ctx.cm.torneio, geradoEm: new Date().toISOString(),
    series: ctx.series.map((s) => ({ ...s, achados: achados[s.chave] })),
    requisicoes: { total: req.length, nestaExecucao: req.filter((r) => r.t >= ctx.inicioMs).length },
  }, null, 1));
  return ctx.series.map((s) => `${s.serie}:${achados[s.chave].length}/${s.mapas}`).join(" ");
}

// ---------- principal ----------

async function main() {
  const op = argumentos();
  C.definirLog(path.join(op.pasta, "lote", "coleta.log"));
  fs.mkdirSync(path.join(op.pasta, "lote"), { recursive: true });

  const cm = C.lerJson(path.join(op.pasta, "cm.json"));
  const puuids = C.lerJson(path.join(op.pasta, "puuids.json"), {});
  const series = montarSeries(cm);
  const estado = C.lerJson(path.join(op.pasta, "lote", "estado.json"), { requisicoes: [], contas: {}, candidatos: {}, adiados: {} });
  ritmo.semear(estado.requisicoes.map((r) => r.t));
  const ctx = {
    op, cm, series, estado, id: C.identidades(puuids), feitas: 0, inicioMs: Date.now(),
    seriePorChave: new Map(series.map((s) => [s.chave, s])),
    casar: (ctx, e) => (e.modo === "bomb" ? ctx.series.filter((s) => naJanela(s, e.ts)) : []),
  };
  C.log("INICIO", `${series.length} séries, ${series.reduce((soma, s) => soma + s.mapas, 0)} mapas esperados; ${Object.keys(puuids).length} Riot IDs resolvidos`);

  for (const dir of op.reaproveitar) {
    let n = 0;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      n += C.registrarCandidatos(ctx, C.entradasDoIndice(C.lerJson(path.join(dir, f), {}, true), f), `reaproveitado:${path.basename(path.dirname(dir))}/${f}`);
    }
    C.log("REAPROVEITADO", dir, `${n} fontes de candidatos`);
  }
  C.salvarEstado(ctx);

  try {
    const { browser, context } = await conectar();
    ctx.browser = browser;
    ctx.page = await abaDo(context, "tracker.gg", "https://tracker.gg/valorant");
    await baixarPendentes(ctx);
    for (;;) {
      const prox = proximaConta(ctx);
      if (!prox) break;
      const ini = Math.min(...prox.series.map((s) => s.inicio)) - C.FOLGA_INICIO_MS;
      const fim = Math.max(...prox.series.map((s) => s.fim)) + C.FOLGA_FIM_MS;
      C.log("CONTA", prox.conta, `joga ${prox.series.length} série(s) com mapa faltando: ${prox.series.map((s) => s.serie).join(", ")}`);
      const r = await C.percorrerJanela(ctx, prox.conta, ini, fim);
      ctx.estado.contas[prox.conta] ||= { paginas: {} };
      ctx.estado.contas[prox.conta].esgotada = true;
      ctx.estado.contas[prox.conta].resultado = r;
      await baixarPendentes(ctx);
      ctx.estado.tentativas ||= {};
      for (const s of prox.series) if (ctx.achados[s.chave].length < s.mapas) ctx.estado.tentativas[s.chave] = (ctx.estado.tentativas[s.chave] || 0) + 1;
      C.salvarEstado(ctx);
      C.log("COBERTURA", relatorio(ctx));
    }
    for (const uuid of Object.keys(ctx.estado.adiados)) await C.baixarDetalhe(ctx, uuid);
  } catch (e) {
    if (!(e instanceof C.Parada)) throw e;
    C.log("PARADA", e.message);
  } finally {
    C.log("FIM", relatorio(ctx), `${ctx.feitas} requisições nesta execução`);
    if (ctx.browser) await ctx.browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
