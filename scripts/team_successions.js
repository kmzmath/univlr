// Confere a sucessao de equipe contra as partidas: acha os pares que parecem
// sucessao e nao foram declarados na coluna `sucede` de teams_infos.xlsx, e os
// declarados que as partidas desmentem.
//
// Uso: require("./team_successions.js").checkTeamSuccessions(db.matches, db.teams)
// (build_database.js chama no fim e imprime os avisos).
//
// O criterio e o que achou sozinho os 6 casos do acervo em out/2026, sem
// nenhum falso positivo:
// - nucleo = quem jogou pelo menos metade dos mapas da janela (6 mapas);
// - o nucleo das ultimas partidas da antiga divide 3 ou mais jogadores com o
//   nucleo das primeiras da nova;
// - a antiga quase nao joga depois que a nova estreia (ate 2 mapas). Se segue
//   jogando, as duas so conviveram, como as lines irmas que trocam jogadores;
// - as duas sao da mesma faculdade (o `org` da planilha), quando as duas tem.

const CORE_WINDOW = 6;
const MIN_SHARED = 3;
const MAX_LATER_MAPS = 2;

function mapsByTeam(matches) {
  const byTeam = new Map();
  for (const match of matches || []) {
    const startedAt = Number(match.startedAt || 0);
    if (!startedAt) continue;
    for (const side of [match.teamA, match.teamB]) {
      if (!side?.id) continue;
      const players = (match.players || []).filter((player) => player.teamId === side.id && player.id);
      if (!byTeam.has(side.id)) byTeam.set(side.id, []);
      byTeam.get(side.id).push({ startedAt, opponentId: side === match.teamA ? match.teamB?.id : match.teamA?.id, players });
    }
  }
  for (const rows of byTeam.values()) rows.sort((a, b) => a.startedAt - b.startedAt);
  return byTeam;
}

function coreOf(maps) {
  const counts = new Map();
  const names = new Map();
  for (const map of maps) {
    for (const player of map.players) {
      counts.set(player.id, (counts.get(player.id) || 0) + 1);
      names.set(player.id, player.nick || player.name || player.id);
    }
  }
  const minimum = Math.max(1, Math.ceil(maps.length / 2));
  return new Map([...counts].filter(([, count]) => count >= minimum).map(([id]) => [id, names.get(id)]));
}

function checkTeamSuccessions(matches, teams) {
  const byTeam = mapsByTeam(matches);
  const teamsById = new Map((teams || []).map((team) => [team.id, team]));
  const declaredChain = (id) => {
    const chain = new Set();
    let current = teamsById.get(id)?.succeeds;
    while (current && !chain.has(current)) {
      chain.add(current);
      current = teamsById.get(current)?.succeeds;
    }
    return chain;
  };

  const earlyCores = new Map([...byTeam].map(([id, maps]) => [id, coreOf(maps.slice(0, CORE_WINDOW))]));
  const undeclared = [];
  for (const [oldId, oldMaps] of byTeam) {
    const lateCore = coreOf(oldMaps.slice(-CORE_WINDOW));
    for (const [newId, newMaps] of byTeam) {
      if (oldId === newId || newMaps[0].startedAt <= oldMaps[0].startedAt) continue;
      const shared = [...earlyCores.get(newId)].filter(([id]) => lateCore.has(id));
      if (shared.length < MIN_SHARED) continue;
      const debut = newMaps[0].startedAt;
      if (oldMaps.filter((map) => map.startedAt >= debut).length > MAX_LATER_MAPS) continue;
      const orgOld = teamsById.get(oldId)?.org || "";
      const orgNew = teamsById.get(newId)?.org || "";
      if (orgOld && orgNew && orgOld !== orgNew) continue;
      if (declaredChain(newId).has(oldId)) continue;
      undeclared.push({ from: oldId, to: newId, debut, players: shared.map(([, name]) => name) });
    }
  }

  const contradicted = [];
  for (const team of teams || []) {
    const from = team.succeeds;
    if (!from) continue;
    const newMaps = byTeam.get(team.id) || [];
    const oldMaps = byTeam.get(from) || [];
    if (!newMaps.length || !oldMaps.length) continue;
    const debut = newMaps[0].startedAt;
    const later = oldMaps.filter((map) => map.startedAt >= debut);
    const headToHead = later.filter((map) => map.opponentId === team.id).length;
    if (later.length > MAX_LATER_MAPS || headToHead) contradicted.push({ from, to: team.id, debut, laterMaps: later.length, headToHead });
  }
  return { undeclared, contradicted };
}

module.exports = { checkTeamSuccessions, CORE_WINDOW, MIN_SHARED, MAX_LATER_MAPS };
