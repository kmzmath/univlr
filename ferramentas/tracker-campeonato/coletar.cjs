// Coleta no tracker.gg as partidas de um campeonato já extraído do
// Challengermode (extrair_cm.cjs) e com os PUUIDs resolvidos (resolver_puuid.py).
//
// Uso:
//   node ferramentas/tracker-campeonato/coletar.cjs <pasta> [opções]
//     --max N                 teto de requisições nesta execução (padrão 400)
//     --reaproveitar <dir>    índices do tracker já baixados (outra coleta),
//                             lidos só como fonte de candidatos; repetível
//     --semear <estado.json>  requisições de uma coleta anterior a ritmo.cjs
//                             (requests[].at ou requisicoes[].t), para o ritmo
//                             contar o que já saiu deste IP
//
// Método:
// 1. Cada jogo com placar real vira um alvo, com a janela DateCreated-StopTime
//    do store e o placar do jogo.
// 2. Partidas do índice de uma conta casam com um alvo pelo início dentro da
//    janela e pelo placar. Candidato casado é baixado uma vez só.
// 3. O arquivo confirma o jogo pelos dois elencos: os jogadores do tracker são
//    comparados com os competidores do jogo, por PUUID (Riot ID atual pela
//    account-v1) ou, sem PUUID, pelo Riot ID.
// 4. Enquanto houver alvo sem arquivo, escolhe a conta que JOGOU o maior
//    número deles e percorre o índice dela só na janela (busca exponencial e
//    binária da página, depois sequencial).
//
// Ritmo em ritmo.cjs, comum aos scripts desta pasta. 403 ou página de
// verificação para a coleta na hora; ninguém contorna Cloudflare.

const fs = require("fs");
const path = require("path");
const { conectar, abaDo } = require("./cdp.cjs");
const ritmo = require("./ritmo.cjs");

const API = "https://api.tracker.gg/api/v2/valorant/standard/matches/";
const FOLGA_INICIO_MS = 15 * 60_000; // lobby às vezes é criado depois do início
const FOLGA_FIM_MS = 5 * 60_000;
const MIN_CONFERE_LADO = 3;

// ---------- argumentos e arquivos ----------

function argumentos() {
  const a = process.argv.slice(2);
  const op = { pasta: a[0], max: 400, reaproveitar: [], semear: [] };
  for (let i = 1; i < a.length; i++) {
    if (a[i] === "--max") op.max = Number(a[++i]);
    else if (a[i] === "--reaproveitar") op.reaproveitar.push(a[++i]);
    else if (a[i] === "--semear") op.semear.push(a[++i]);
  }
  if (!op.pasta) throw new Error("Uso: coletar.cjs <pasta> [--max N] [--reaproveitar dir] [--semear estado.json]");
  return op;
}

// tolerante = true devolve o padrão também para arquivo corrompido.
function lerJson(f, padrao, tolerante = false) {
  if (!fs.existsSync(f)) return padrao;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    if (tolerante) return padrao;
    throw new Error(`${f} está corrompido (${e.message}). Recupere ou apague o arquivo antes de rodar de novo.`);
  }
}

// fsync antes do rename: sem ele, um desligamento abrupto deixou o rename no
// disco e o conteúdo não (estado.json virou bytes nulos em 25/10/2026).
function gravarAtomico(f, texto) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, texto);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, f);
}

const chaveId = (rid) => String(rid || "").trim().toLowerCase();
const slug = (rid) => chaveId(rid).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "x";
const utc = (s) => (s ? Date.parse(/z$|[+-]\d\d:\d\d$/i.test(s) ? s : s + "Z") : null);
const hora = (ms) => new Date(ms).toISOString().slice(11, 16);

let LOG;
function log(...partes) {
  const linha = `[${new Date().toISOString()}] ${partes.join(" ")}`;
  console.log(linha);
  fs.appendFileSync(LOG, linha + "\n");
}

// ---------- alvos a partir do store ----------

function montarAlvos(cm) {
  const nomeEquipe = new Map(cm.equipes.map((e) => [e.id, e.nome]));
  const alvos = [];
  const outros = [];
  for (const p of cm.partidas) {
    const reais = (p.equipes || []).filter((t) => t.equipeId && !t.bye);
    if (reais.length < 2) continue;
    for (const j of p.jogos) {
      if (j.semChallenge) continue;
      const lados = [...j.lados].sort((a, b) => a.lado - b.lado);
      const placar = lados.map((l) => l.placar);
      const base = {
        chave: `${p.numero}.${j.ordemNaSerie ?? 0}.${j.id.slice(0, 8)}`,
        serie: p.numero, jogoId: j.id, nome: j.nome,
        inicio: utc(j.criado), fim: utc(j.fim), placar,
        equipes: lados.map((l) => ({ id: l.equipeId, nome: nomeEquipe.get(l.equipeId) || l.nome })),
        resolucao: j.resolucao,
        competidores: [0, 1].map((lado) => j.competidores.filter((c) => c.lado === lado)),
      };
      const inteiros = placar.length === 2 && placar.every(Number.isInteger);
      if (inteiros && Math.max(...placar) >= 13) alvos.push(base);
      else outros.push({ ...base, tipo: inteiros && Math.max(...placar) === 1 ? "admin_1x0" : "sem_placar" });
    }
  }
  return { alvos, outros };
}

// ---------- identidade ----------

function identidades(puuids) {
  const porId = new Map();
  for (const r of Object.values(puuids)) porId.set(chaveId(r.riotId), r);
  return {
    // PUUID se resolvido; senão o próprio Riot ID (prefixado, para não colidir)
    chave(rid) {
      const r = porId.get(chaveId(rid));
      return r && r.puuid ? "p:" + r.puuid : "n:" + chaveId(rid);
    },
    atual(rid) {
      const r = porId.get(chaveId(rid));
      return r && r.status === 200 ? r.atual : null;
    },
    registro: (rid) => porId.get(chaveId(rid)) || null,
  };
}

// ---------- transporte ----------

class Parada extends Error {}

async function buscar(ctx, url, tipo) {
  if (ctx.feitas >= ctx.op.max) throw new Parada(`teto de ${ctx.op.max} requisições desta execução`);
  await ritmo.esperar(log);
  ritmo.marcar();
  ctx.feitas++;
  const r = await ctx.page.evaluate(async (url) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60_000);
    try {
      const resp = await fetch(url, { credentials: "include", headers: { Accept: "application/json" }, signal: ac.signal });
      return { status: resp.status, tipo: resp.headers.get("content-type") || "", texto: await resp.text() };
    } catch (e) {
      return { status: 0, erro: String(e) };
    } finally {
      clearTimeout(t);
    }
  }, url);
  ctx.estado.requisicoes.push({ t: Date.now(), url, tipo, status: r.status });
  salvarEstado(ctx);
  log("REQ", tipo, r.status, url.replace(API, ""));

  if (r.status === 0) return { falha: "rede", erro: r.erro };
  let json = null;
  try { json = JSON.parse(r.texto); } catch { /* HTML */ }
  if (json?.errors?.some((e) => e.code === "StandardApiV2::NoData")) return { semDados: true, texto: r.texto };
  if (r.status !== 200) {
    gravarAtomico(path.join(ctx.op.pasta, "lote", "erros", `${Date.now()}-${r.status}.txt`), `${url}\n\n${r.texto}`);
  }
  // 451 é perfil privado (o jogador escondeu o histórico) e 404 é conta que o
  // tracker não conhece: condição da conta, não do IP. Segue para a próxima.
  if (r.status === 451 || r.status === 404) return { indisponivel: true, status: r.status, texto: r.texto };
  if (r.status === 403 || (!json && /<html/i.test(r.texto))) throw new Parada(`HTTP ${r.status} sem JSON (verificação de acesso?). Abra o tracker no Chrome dedicado.`);
  if (r.status === 429) return { falha: "429" };
  if (r.status >= 500) return { falha: "5xx", status: r.status };
  if (r.status !== 200 || !json?.data) return { falha: "outro", status: r.status, texto: r.texto.slice(0, 300) };
  return { json, texto: r.texto };
}

async function buscarComRetentativa(ctx, url, tipo) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await buscar(ctx, url, tipo);
    if (!r.falha) return r;
    // Só falha de rede justifica repetir; 4xx e 5xx voltam para quem chamou
    // (detalhe com 5xx fica adiado, página com erro encerra a conta).
    if (r.falha === "5xx" || r.falha === "outro") return r;
    if (r.falha === "429") {
      if (tentativa > 1) throw new Parada("segundo 429; coleta interrompida");
      log("ESPERA", "429; 30 min de pausa");
      await new Promise((res) => setTimeout(res, 30 * 60_000));
      continue;
    }
    if (tentativa >= 3) throw new Parada(`${r.falha} ${r.status ?? ""} três vezes: ${url}`);
    log("ESPERA", `${r.falha} ${r.status ?? ""}; 60 s`);
    await new Promise((res) => setTimeout(res, 60_000));
  }
}

// ---------- estado ----------

function salvarEstado(ctx) {
  gravarAtomico(path.join(ctx.op.pasta, "lote", "estado.json"), JSON.stringify(ctx.estado, null, 1));
}

// ---------- índice ----------

function entradasDoIndice(json, fonte) {
  const quem = json?.data?.requestingPlayerAttributes?.platformUserIdentifier ?? fonte;
  return (json?.data?.matches || []).map((m) => {
    const ov = (m.segments || []).find((s) => s.type === "overview")?.stats || {};
    return {
      uuid: m.attributes.id, ts: utc(m.metadata.timestamp), modo: m.metadata.modeKey,
      mapa: m.attributes.mapId, ganhou: ov.roundsWon?.value, perdeu: ov.roundsLost?.value, quem,
    };
  });
}

function casarEntrada(ctx, e) {
  if (e.modo !== "bomb" || !Number.isInteger(e.ganhou)) return [];
  const par = [e.ganhou, e.perdeu].sort((a, b) => a - b).join("x");
  return ctx.alvos.filter((a) =>
    e.ts >= a.inicio - FOLGA_INICIO_MS && e.ts <= a.fim + FOLGA_FIM_MS &&
    [...a.placar].sort((x, y) => x - y).join("x") === par);
}

// ctx.casar troca o critério de candidato (coletar_sem_placar.cjs casa só pela
// janela, porque o store não tem o placar).
function registrarCandidatos(ctx, entradas, fonte) {
  let novos = 0;
  for (const e of entradas) {
    const casados = (ctx.casar || casarEntrada)(ctx, e);
    if (!casados.length) continue;
    const c = (ctx.estado.candidatos[e.uuid] ||= { uuid: e.uuid, ts: e.ts, placar: [e.ganhou, e.perdeu], alvos: [], fontes: [] });
    for (const a of casados) if (!c.alvos.includes(a.chave)) c.alvos.push(a.chave);
    if (!c.fontes.some((f) => f.fonte === fonte && f.quem === e.quem)) { c.fontes.push({ fonte, quem: e.quem }); novos++; }
  }
  return novos;
}

async function pagina(ctx, conta, n) {
  const reg = (ctx.estado.contas[conta] ||= { paginas: {} });
  if (reg.paginas[n]) return reg.paginas[n];
  const arquivo = path.join("lote", "indices", `${slug(conta)}-p${n}.json`);
  // Página válida já no disco (estado perdido ou execução interrompida) vale
  // como cache: não gasta requisição de novo.
  const noDisco = lerJson(path.join(ctx.op.pasta, arquivo), null, true);
  if (noDisco?.data?.matches) {
    const ents = entradasDoIndice(noDisco, conta);
    registrarCandidatos(ctx, ents, `indice:${conta}:p${n}`);
    const ts = ents.map((e) => e.ts);
    reg.paginas[n] = ents.length ? { arquivo, n: ents.length, maisNova: Math.max(...ts), maisAntiga: Math.min(...ts), doDisco: true } : { arquivo, n: 0, doDisco: true };
    return reg.paginas[n];
  }
  const url = `${API}riot/${encodeURIComponent(conta)}?platform=pc&type=custom${n ? `&next=${n}` : ""}`;
  const r = await buscarComRetentativa(ctx, url, "indice");
  gravarAtomico(path.join(ctx.op.pasta, arquivo), r.texto ?? "");
  let info;
  if (r.semDados) info = { semDados: true };
  else if (r.indisponivel) info = { indisponivel: true, status: r.status };
  else if (r.falha) info = { falha: r.falha, status: r.status };
  else {
    const ents = entradasDoIndice(r.json, conta);
    registrarCandidatos(ctx, ents, `indice:${conta}:p${n}`);
    const ts = ents.map((e) => e.ts);
    info = { arquivo, n: ents.length, maisNova: Math.max(...ts), maisAntiga: Math.min(...ts) };
  }
  reg.paginas[n] = info;
  salvarEstado(ctx);
  return info;
}

// Páginas vêm da mais nova para a mais antiga, 20 por página. Acha a primeira
// página cuja partida mais antiga é <= fim da janela e segue até passar do início.
async function percorrerJanela(ctx, conta, ini, fim) {
  const p0 = await pagina(ctx, conta, 0);
  if (p0.semDados || p0.falha || p0.indisponivel) return { indisponivel: true, status: p0.status ?? null };
  // Depois da última página o tracker devolve lista vazia, não NoData.
  const vazia = (p) => p.semDados || p.falha || p.indisponivel || p.n === 0;
  const tocaFim = (p) => !vazia(p) && p.maisAntiga <= fim;
  let alvo;
  if (tocaFim(p0)) alvo = 0;
  else {
    let lo = 0, hi = null;
    for (let n = 1; ; n *= 2) {
      const p = await pagina(ctx, conta, n);
      if (vazia(p) || tocaFim(p)) { hi = n; break; }
      lo = n;
      if (n > 4096) return { indisponivel: true };
    }
    while (hi - lo > 1) {
      const meio = Math.floor((lo + hi) / 2);
      const p = await pagina(ctx, conta, meio);
      if (vazia(p) || tocaFim(p)) hi = meio; else lo = meio;
    }
    alvo = hi;
    const ph = await pagina(ctx, conta, alvo);
    if (vazia(ph)) return { fimDoHistorico: true }; // o histórico acaba antes da janela
  }
  for (let n = alvo; ; n++) {
    const p = await pagina(ctx, conta, n);
    if (vazia(p) || p.maisAntiga < ini || p.n < 20) break;
  }
  return { ok: true };
}

// ---------- detalhe e conferência ----------

// Guarda só o que a conferência usa: um detalhe tem ~1 MB e é relido a cada
// reconciliação.
const DETALHES = new Map();
function lerDetalhe(ctx, uuid) {
  if (DETALHES.has(uuid)) return DETALHES.get(uuid);
  const f = path.join(ctx.op.pasta, "tracker", `${uuid}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    if (d?.data?.attributes?.id !== uuid) return null;
    const J = jogadoresDoDetalhe(d);
    DETALHES.set(uuid, J);
    return J;
  } catch {
    return null;
  }
}

async function baixarDetalhe(ctx, uuid) {
  if (lerDetalhe(ctx, uuid)) return true;
  const r = await buscarComRetentativa(ctx, API + uuid, "detalhe");
  if (r.falha) {
    ctx.estado.adiados[uuid] = { status: r.status, t: Date.now() };
    log("ADIADO", uuid, r.falha, r.status ?? "");
    return false;
  }
  if (r.json?.data?.attributes?.id !== uuid) throw new Parada(`resposta de detalhe com id inesperado para ${uuid}`);
  gravarAtomico(path.join(ctx.op.pasta, "tracker", `${uuid}.json`), r.texto);
  delete ctx.estado.adiados[uuid];
  return true;
}

function jogadoresDoDetalhe(d) {
  const segs = d.data.segments || [];
  const times = {};
  for (const s of segs.filter((s) => s.type === "player-summary")) {
    (times[s.metadata.teamId] ||= []).push(s.attributes.platformUserIdentifier);
  }
  const placar = {};
  for (const s of segs.filter((s) => s.type === "team-summary")) placar[s.attributes.teamId] = s.stats.roundsWon.value;
  return { times, placar, inicio: utc(d.data.metadata.dateStarted), duracao: d.data.metadata.duration, mapa: d.data.metadata.mapName };
}

// Casa os dois lados do arquivo com os dois lados do jogo. Devolve a melhor
// orientação, com os jogadores reconhecidos e os que sobraram.
function conferir(ctx, alvo, J) {
  const cores = Object.keys(J.times);
  if (cores.length !== 2) return null;
  const ladoCm = alvo.competidores.map((cs) => new Set(cs.map((c) => ctx.id.chave(c.riotId))));
  let melhor = null;
  for (const [ca, cb] of [[cores[0], cores[1]], [cores[1], cores[0]]]) {
    const r = [ca, cb].map((cor, i) => {
      const ks = J.times[cor].map((rid) => ({ rid, k: ctx.id.chave(rid) }));
      return {
        cor, placar: J.placar[cor],
        reconhecidos: ks.filter((x) => ladoCm[i].has(x.k)).map((x) => x.rid),
        sobra: ks.filter((x) => !ladoCm[i].has(x.k)).map((x) => x.rid),
      };
    });
    const total = r[0].reconhecidos.length + r[1].reconhecidos.length;
    if (!melhor || total > melhor.total) melhor = { total, lados: r };
  }
  const placarOk = melhor.lados[0].placar === alvo.placar[0] && melhor.lados[1].placar === alvo.placar[1];
  const dentro = J.inicio >= alvo.inicio - FOLGA_INICIO_MS && J.inicio <= alvo.fim + FOLGA_FIM_MS;
  const minimo = Math.min(melhor.lados[0].reconhecidos.length, melhor.lados[1].reconhecidos.length);
  const situacao = !placarOk || !dentro || minimo < MIN_CONFERE_LADO ? "rejeitado" : minimo === 5 ? "confirmado" : "parcial";
  return { situacao, placarOk, dentro, ...melhor, inicio: J.inicio, mapa: J.mapa };
}

function reconciliar(ctx) {
  const cobertura = {};
  for (const c of Object.values(ctx.estado.candidatos)) {
    const d = lerDetalhe(ctx, c.uuid);
    if (!d) continue;
    for (const chave of c.alvos) {
      const alvo = ctx.alvoPorChave.get(chave);
      const r = conferir(ctx, alvo, d);
      if (!r || r.situacao === "rejeitado") continue;
      const atual = cobertura[chave];
      if (!atual || r.total > atual.total) cobertura[chave] = { uuid: c.uuid, ...r };
      else if (atual.uuid !== c.uuid && r.total === atual.total) atual.conflito = c.uuid;
    }
  }
  ctx.cobertura = cobertura;
  return cobertura;
}

async function baixarCandidatosPendentes(ctx) {
  const cob = reconciliar(ctx);
  const faltam = new Set(ctx.alvos.filter((a) => !cob[a.chave]).map((a) => a.chave));
  const fila = Object.values(ctx.estado.candidatos)
    .filter((c) => !lerDetalhe(ctx, c.uuid) && !ctx.estado.adiados[c.uuid] && c.alvos.some((k) => faltam.has(k)))
    .sort((a, b) => b.fontes.length - a.fontes.length);
  for (const c of fila) {
    if (!c.alvos.some((k) => faltam.has(k))) continue;
    if (await baixarDetalhe(ctx, c.uuid)) {
      const cobAgora = reconciliar(ctx);
      for (const k of c.alvos) if (cobAgora[k]) faltam.delete(k);
    }
  }
  return reconciliar(ctx);
}

// ---------- escolha de contas ----------

// Jogo que três contas que jogaram não revelaram provavelmente não está no
// tracker; insistir só gasta requisição.
const MAX_CONTAS_POR_JOGO = 3;

function proximaConta(ctx) {
  const tent = ctx.estado.tentativas || {};
  const faltam = ctx.alvos.filter((a) => !ctx.cobertura[a.chave] && (tent[a.chave] || 0) < MAX_CONTAS_POR_JOGO);
  const pontos = new Map();
  for (const a of faltam) {
    for (const cs of a.competidores) {
      for (const c of cs) {
        if (c.papel !== 0) continue; // 0 jogou; 2 é coach sentado
        const atual = ctx.id.atual(c.riotId);
        if (!atual) continue; // Riot ID velho ou inexistente: não dá para consultar
        const reg = ctx.estado.contas[atual];
        if (reg?.esgotada) continue;
        const p = pontos.get(atual) || { conta: atual, alvos: [] };
        p.alvos.push(a);
        pontos.set(atual, p);
      }
    }
  }
  return [...pontos.values()].sort((x, y) => y.alvos.length - x.alvos.length)[0] || null;
}

// ---------- relatório ----------

function relatorio(ctx, outros) {
  const cob = reconciliar(ctx);
  const linhas = ctx.alvos.map((a) => ({ alvo: a, cob: cob[a.chave] || null }));
  const confirmados = linhas.filter((l) => l.cob?.situacao === "confirmado").length;
  const parciais = linhas.filter((l) => l.cob?.situacao === "parcial").length;
  const req = ctx.estado.requisicoes;
  const desta = req.filter((r) => r.t >= ctx.inicioMs);
  const md = [];
  md.push(`# ${ctx.cm.torneio.nome}`, "");
  md.push(`Atualizado em ${new Date().toISOString()}.`, "");
  md.push(`**${confirmados + parciais} de ${ctx.alvos.length} jogos com placar real têm arquivo**: ${confirmados} com os 10 jogadores reconhecidos e ${parciais} parciais (pelo menos ${MIN_CONFERE_LADO} de cada lado).`, "");
  md.push(`Requisições ao tracker: ${req.length} no total (${req.filter((r) => r.tipo === "indice").length} de índice, ${req.filter((r) => r.tipo === "detalhe").length} de detalhe); ${desta.length} nesta execução.`, "");
  md.push("| Série | Janela (UTC) | Equipes | Placar | Situação | Mapa | Arquivo |", "|---|---|---|---|---|---|---|");
  for (const { alvo: a, cob: c } of linhas) {
    const sit = !c ? "Faltante" : c.situacao === "confirmado" ? "10 de 10" : `${c.lados[0].reconhecidos.length + c.lados[1].reconhecidos.length} de 10`;
    md.push(`| ${a.serie} | ${new Date(a.inicio).toISOString().slice(5, 10)} ${hora(a.inicio)}-${hora(a.fim)} | ${a.equipes[0].nome} × ${a.equipes[1].nome} | ${a.placar.join("–")} | ${sit}${c?.conflito ? " (conflito)" : ""} | ${c?.mapa ?? ""} | ${c ? c.uuid : ""} |`);
  }
  md.push("", "## Jogos sem placar real no store", "");
  md.push("| Série | Equipes | Store | Resolução | Duração |", "|---|---|---|---|---|");
  for (const o of outros) {
    md.push(`| ${o.serie} | ${o.equipes[0].nome} × ${o.equipes[1].nome} | ${o.placar.join("x")} | causa ${o.resolucao.causa}, fonte ${o.resolucao.fonte} ${JSON.stringify(o.resolucao.detalhe)} | ${o.fim && o.inicio ? Math.round((o.fim - o.inicio) / 60_000) + " min" : "-"} |`);
  }
  const sobra = new Set();
  for (const c of Object.values(cob)) for (const l of c.lados) for (const rid of l.sobra) sobra.add(rid);
  md.push("", "## Jogadores do arquivo fora dos competidores do jogo", "");
  md.push([...sobra].sort().join(", ") || "nenhum");
  // Riot IDs do tracker sem PUUID ainda: entrada para resolver_puuid.py.
  const semPuuid = new Set();
  for (const c of Object.values(ctx.estado.candidatos)) {
    const J = lerDetalhe(ctx, c.uuid);
    if (!J) continue;
    for (const rids of Object.values(J.times)) for (const rid of rids) if (!ctx.id.registro(rid)) semPuuid.add(rid);
  }
  gravarAtomico(path.join(ctx.op.pasta, "lote", "ids_tracker.txt"), [...semPuuid].sort().join("\n") + "\n");
  gravarAtomico(path.join(ctx.op.pasta, "lote", "resumo.md"), md.join("\n") + "\n");
  gravarAtomico(path.join(ctx.op.pasta, "lote", "relatorio.json"), JSON.stringify({
    torneio: ctx.cm.torneio, geradoEm: new Date().toISOString(),
    alvos: linhas.map(({ alvo: a, cob: c }) => ({ serie: a.serie, chave: a.chave, jogoId: a.jogoId, inicio: a.inicio, fim: a.fim, equipes: a.equipes, placar: a.placar, arquivo: c })),
    outros, requisicoes: { total: req.length, nestaExecucao: desta.length },
  }, null, 1));
  return { confirmados, parciais, total: ctx.alvos.length };
}

// ---------- principal ----------

async function main() {
  const op = argumentos();
  LOG = path.join(op.pasta, "lote", "coleta.log");
  fs.mkdirSync(path.dirname(LOG), { recursive: true });

  const cm = lerJson(path.join(op.pasta, "cm.json"));
  const puuids = lerJson(path.join(op.pasta, "puuids.json"), {});
  const { alvos, outros } = montarAlvos(cm);
  const estado = lerJson(path.join(op.pasta, "lote", "estado.json"), { requisicoes: [], contas: {}, candidatos: {}, adiados: {} });
  for (const f of op.semear) {
    const e = lerJson(f, {});
    ritmo.semear([...(e.requests || []).map((r) => r.at), ...(e.requisicoes || []).map((r) => r.t)]);
  }
  ritmo.semear(estado.requisicoes.map((r) => r.t));
  const ctx = {
    op, cm, alvos, estado, id: identidades(puuids), feitas: 0, inicioMs: Date.now(),
    alvoPorChave: new Map(alvos.map((a) => [a.chave, a])),
  };
  log("INICIO", `${alvos.length} jogos com placar real, ${outros.length} sem; ${Object.keys(puuids).length} Riot IDs resolvidos`);

  for (const dir of op.reaproveitar) {
    let n = 0;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      n += registrarCandidatos(ctx, entradasDoIndice(lerJson(path.join(dir, f), {}, true), f), `reaproveitado:${path.basename(path.dirname(dir))}/${f}`);
    }
    log("REAPROVEITADO", dir, `${n} fontes de candidatos`);
  }
  salvarEstado(ctx);

  try {
    const { browser, context } = await conectar();
    ctx.browser = browser;
    ctx.page = await abaDo(context, "tracker.gg", "https://tracker.gg/valorant");
    await baixarCandidatosPendentes(ctx);
    for (;;) {
      const prox = proximaConta(ctx);
      if (!prox) break;
      const ini = Math.min(...prox.alvos.map((a) => a.inicio)) - FOLGA_INICIO_MS;
      const fim = Math.max(...prox.alvos.map((a) => a.fim)) + FOLGA_FIM_MS;
      log("CONTA", prox.conta, `joga ${prox.alvos.length} faltante(s): ${prox.alvos.map((a) => a.serie).join(", ")}`);
      const r = await percorrerJanela(ctx, prox.conta, ini, fim);
      ctx.estado.contas[prox.conta].esgotada = true;
      ctx.estado.contas[prox.conta].resultado = r;
      await baixarCandidatosPendentes(ctx);
      ctx.estado.tentativas ||= {};
      for (const a of prox.alvos) if (!ctx.cobertura[a.chave]) ctx.estado.tentativas[a.chave] = (ctx.estado.tentativas[a.chave] || 0) + 1;
      salvarEstado(ctx);
      const s = relatorio(ctx, outros);
      log("COBERTURA", `${s.confirmados + s.parciais}/${s.total} (${s.confirmados} confirmados)`);
    }
    // Uma nova tentativa para os detalhes adiados por 5xx.
    for (const uuid of Object.keys(ctx.estado.adiados)) await baixarDetalhe(ctx, uuid);
  } catch (e) {
    if (!(e instanceof Parada)) throw e;
    log("PARADA", e.message);
  } finally {
    const s = relatorio(ctx, outros);
    log("FIM", `${s.confirmados + s.parciais}/${s.total} jogos com arquivo (${s.confirmados} confirmados); ${ctx.feitas} requisições nesta execução`);
    if (ctx.browser) await ctx.browser.close();
  }
}

// Reaproveitado pelo coletar_sem_placar.cjs: transporte, índice, detalhe e
// identidade são os mesmos; muda só o que é alvo e o que confirma.
module.exports = {
  API, FOLGA_INICIO_MS, FOLGA_FIM_MS, MIN_CONFERE_LADO, Parada,
  definirLog: (f) => { LOG = f; }, log, lerJson, gravarAtomico, utc, hora, chaveId,
  identidades, entradasDoIndice, registrarCandidatos, percorrerJanela, lerDetalhe, baixarDetalhe, salvarEstado,
};

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
