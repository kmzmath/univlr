// Extrai um torneio do Challengermode pelo store do app (window._cm), não pelo
// texto da tela: o texto mostra o placar da série (um 14x16 em MD1 vira "1-0")
// e esconde equipes e partidas.
//
// Uso: node ferramentas/tracker-campeonato/extrair_cm.cjs <pasta-de-saida> <url-do-torneio>
//
// Grava <pasta>/cm.json com equipes, membros (Riot ID do avatar) e cada jogo:
// placar real, janela DateCreated-StopTime (UTC), resolução e quem jogou.

const fs = require("fs");
const path = require("path");
const { conectar, abaDo } = require("./cdp.cjs");

async function main() {
  const [saida, url] = process.argv.slice(2);
  if (!saida || !url) throw new Error("Uso: extrair_cm.cjs <pasta-de-saida> <url-do-torneio>");
  const m = url.match(/tournaments\/([0-9a-f-]{36})/i);
  if (!m) throw new Error("URL sem id de torneio.");
  const tid = m[1];
  const base = url.split("/tournaments/")[0] + "/tournaments/" + tid;

  const { browser, context } = await conectar();
  const page = await abaDo(context, "challengermode.com", base + "/brackets/1");
  // O _cm só existe em /participants e /brackets.
  await page.goto(base + "/brackets/1", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => window._cm && window._cm.store && window._cm.store._objects?.size > 0, null, { timeout: 60_000 });
  // Aba em segundo plano tem os temporizadores segurados, e o store carrega
  // em fila: cada loadObject passa a levar 1 s. Na frente, e em paralelo.
  await page.bringToFront();
  await page.waitForTimeout(4000);

  const dados = await page.evaluate(async (tid) => {
    const L = (ns, id) => window._cm.loadObject(ns, id);
    const todos = (ns, ids) => Promise.all(ids.map((id) => L(ns, id)));
    const objs = window._cm.store._objects;
    const T = await L("tournament", tid);

    const avatares = new Map();
    const usuarios = new Map();
    async function carregarAvatares(ids) {
      const novos = [...new Set(ids.filter((id) => id && !avatares.has(id)))];
      (await todos("avatar", novos)).forEach((a, i) => {
        const d = a?.Data || {};
        avatares.set(novos[i], d.InGameName ? `${d.InGameName}#${d.TagLine ?? ""}` : null);
      });
    }

    const teamIds = T.TeamIds || [];
    const times = await todos("tournament_team", teamIds);
    const membrosPorTime = await Promise.all(times.map((t) => todos("tournament_member", t?.MemberIds || [])));
    const userIds = [...new Set(membrosPorTime.flat().filter(Boolean).map((mb) => mb.UserId).filter(Boolean))];
    (await todos("user", userIds)).forEach((u, i) => usuarios.set(userIds[i], u?.UserName ?? null));
    await carregarAvatares(membrosPorTime.flat().filter(Boolean).map((mb) => mb.AvatarId));

    const equipes = times.map((t, i) => t && ({
      id: teamIds[i], nome: t.Name, seed: t.Seed ?? null,
      membros: membrosPorTime[i].filter(Boolean).map((mb) => ({
        userId: mb.UserId, avatarId: mb.AvatarId, papel: mb.Role, capitao: !!mb.IsCaptain,
        usuario: usuarios.get(mb.UserId) ?? null, riotId: avatares.get(mb.AvatarId) ?? null,
      })),
    })).filter(Boolean);

    // Todas as chaves do torneio (fase de grupos e playoffs podem ser chaves
    // diferentes, como na Univavá), mais as que já estiverem no store depois
    // de abrir /brackets. Match2Ids é um array aninhado por rodada.
    const estagios = [...(T.TopLevelBracketStages || []), ...(T.PlayingBracketStages || [])];
    const idsChave = new Set([
      ...(T.Bracket2Ids || []),
      ...estagios.flatMap((e) => [...(e.BracketIds || []), ...((e.InternalBrackets || []).flatMap((b) => b?.BracketIds || (b?.Id ? [b.Id] : [])))]),
      ...[...objs.keys()].filter((k) => k.startsWith("cm:tournament_bracket2:")).map((k) => k.split(":").pop()),
    ]);
    const chaves = (await todos("tournament_bracket2", [...idsChave]))
      .map((b, i) => b && { id: [...idsChave][i], ...b })
      .filter(Boolean);
    const avisos = [];
    if (chaves.some((b) => (b.GroupIds || []).length) || estagios.some((e) => e.Group || (e.InternalBrackets || []).length)) {
      avisos.push("torneio com fase de grupos: confira se o número de partidas extraídas bate com a página /matches");
    }
    const matchIds = [...new Set(chaves.flatMap((b) => (b.Match2Ids || []).flat(Infinity)))];

    const mts = await todos("tournament_match2", matchIds);
    const c2Ids = mts.flatMap((mt) => mt?.Challenge2Ids || []);
    const c2s = new Map((await todos("tournament_challenge2", c2Ids)).map((tc, i) => [c2Ids[i], tc]));
    const chIds = [...c2s.values()].map((tc) => tc?.ChallengeId).filter(Boolean);
    const chs = new Map((await todos("challenge", chIds)).map((ch, i) => [chIds[i], ch]));
    await carregarAvatares([...chs.values()].flatMap((ch) => (ch?.Competitors || []).map((c) => c.AvatarId)));

    const partidas = [];
    for (const [k, id] of matchIds.entries()) {
      const mt = mts[k];
      if (!mt) continue;
      const jogos = [];
      for (const c2 of mt.Challenge2Ids || []) {
        const tc = c2s.get(c2);
        const ch = chs.get(tc?.ChallengeId);
        if (!ch) {
          jogos.push({ id: null, challenge2: c2, semChallenge: true, bruto: tc ?? null });
          continue;
        }
        const competidores = (ch.Competitors || []).map((c) => ({
          userId: c.UserId, avatarId: c.AvatarId, lado: c.TeamNumber, papel: c.MemberRole, riotId: avatares.get(c.AvatarId) ?? null,
        }));
        jogos.push({
          id: ch.Id, nome: ch.Name, ordemNaSerie: ch.MatchGameOrdinal,
          criado: ch.DateCreated, fim: ch.StopTime,
          lados: (ch.Teams || []).map((t) => ({ lado: t.TeamNumber, equipeId: t.ExternalId, nome: t.TeamName, placar: t.Score })),
          resolucao: { causa: ch.ResolutionCause, fonte: ch.ResolutionSource, estado: ch.ResolutionState, detalhe: ch.Resolution, vencedor: ch.WinningTeamNumber },
          competidores,
        });
      }
      partidas.push({
        id, numero: mt.Ordinal, chave: mt.BracketId ?? null, estado: mt.State,
        melhorDe: mt.BestOf ?? null, agendada: mt.ScheduledStartTime ?? null, iniciada: mt.DateStarted ?? null,
        equipes: (mt.Teams || []).map((t) => ({ equipeId: t.Id, bye: !!t.IsBye, placar: t.Score, colocacao: t.Placement })),
        jogos,
      });
    }
    partidas.sort((a, b) => a.numero - b.numero);
    return {
      torneio: { id: tid, nome: T.Name, inicio: T.StartTime ?? T.ScheduledStartTime ?? null, fim: T.EndTime ?? null, chaves: chaves.map((b) => ({ id: b.id, tipo: b.Type, eliminacao: b.IsElimination, etapa: b.StageIndex, grupos: b.GroupIds || [] })) },
      equipes, partidas, avisos,
    };
  }, tid);

  dados.extraidoEm = new Date().toISOString();
  dados.fonte = base;
  fs.mkdirSync(saida, { recursive: true });
  fs.writeFileSync(path.join(saida, "cm.json"), JSON.stringify(dados, null, 1));

  const jogos = dados.partidas.flatMap((p) => p.jogos);
  console.log(`${dados.torneio.nome}`);
  console.log(`equipes ${dados.equipes.length} (com seed ${dados.equipes.filter((e) => e.seed !== null).length}), membros ${dados.equipes.reduce((s, e) => s + e.membros.length, 0)}`);
  console.log(`chaves ${dados.torneio.chaves.length}, partidas ${dados.partidas.length}, com jogo ${dados.partidas.filter((p) => p.jogos.length).length}, jogos ${jogos.length}`);
  for (const a of dados.avisos) console.log("AVISO", a);
  await browser.close(); // em connectOverCDP, só desconecta
}

main().catch((e) => { console.error(e); process.exit(1); });
