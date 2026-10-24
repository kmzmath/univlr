// Recebe PUUIDs pela entrada padrão e devolve apenas os perfis solicitados.
const fs = require("node:fs");
const { decode } = require("../db-codec.js");

const requested = JSON.parse(fs.readFileSync(0, "utf8"));
const db = decode(JSON.parse(fs.readFileSync("database.json", "utf8")));
const playerById = new Map(db.players.map((player) => [player.puuid, player]));
const matchById = new Map(db.matches.map((match) => [match.id, match]));
const eventById = new Map(db.tournaments.map((event) => [event.id, event]));
const teamById = new Map((db.metadata.teams || []).map((team) => [team.id, team]));

function publicAsset(value) {
  return value ? `/${String(value).replace(/^\/+/, "")}` : "";
}

// A cor da linha de cada equipe, a mesma conta do teamChartInk do app.js: a
// cor mais viva das duas, clareada ate fechar 4,5:1 contra o painel #0b0b10.
// Equipe sem cor cadastrada fica cinza.
const SEM_COR = "#8a8d98";
const hexToRgb = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (rgb) => {
  const canal = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
};
const contrast = (a, b) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const toHsl = (rgb) => {
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) % 360 + 360) % 360;
  return [h, l > 0.5 ? d / (2 - max - min) : d / (max + min), l];
};
const fromHsl = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((canal) => Math.round((canal + m) * 255));
};
function teamLineColor(team) {
  const candidatos = (team?.colors || []).slice(0, 2).map(hexToRgb).filter(Boolean);
  if (!candidatos.length) return SEM_COR;
  const base = candidatos.find((cor) => (Math.max(...cor) - Math.min(...cor)) / 255 >= 0.12) || candidatos[0];
  const [h, s] = toHsl(base);
  for (let l = 42; l <= 92; l += 2) {
    const tom = fromHsl(h, Math.min(s, 0.82), l / 100);
    if (contrast(tom, [11, 11, 16]) >= 4.5) return `#${tom.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return "#f5f1f2";
}

function recentMatches(player) {
  return (player.recent || []).slice(-5).reverse().flatMap((recent) => {
    const match = matchById.get(recent.matchId);
    if (!match) return [];
    const appearance = (match.players || []).find((row) => row.puuid === player.puuid || row.id === player.id);
    if (!appearance) return [];
    const isA = appearance.currentTeam === match.teamA.id
      || (appearance.currentTeam !== match.teamB.id && appearance.teamColor === match.teamA.color);
    const own = isA ? match.teamA : match.teamB;
    const opponent = isA ? match.teamB : match.teamA;
    return [{
      date: new Date(match.startedAt || match.date).toISOString(),
      event: eventById.get(match.eventId)?.name || match.eventId,
      map: match.mapName,
      opponent: opponent.name,
      opponentLogo: publicAsset(teamById.get(opponent.id)?.logo),
      score: `${own.score}-${opponent.score}`,
      result: own.score > opponent.score ? "V" : own.score < opponent.score ? "D" : "E",
      rating: Number(recent.rating),
      kills: appearance.kills,
      deaths: appearance.deaths,
      assists: appearance.assists,
      agent: appearance.agent,
      agentIcon: publicAsset(appearance.agentIcon),
      href: `/#/matches/${match.id}`,
    }];
  });
}

const details = {};
for (const puuid of requested) {
  const player = playerById.get(puuid);
  if (!player) throw new Error(`Jogador não encontrado no banco: ${puuid}`);
  const team = teamById.get(player.teamId || player.currentTeam);
  const agents = (player.agentStats || []).slice(0, 5).map((agent) => ({
    name: agent.name,
    icon: publicAsset(agent.icon),
    role: agent.role,
    maps: agent.picks,
    rounds: agent.rounds,
    share: player.matches ? agent.picks / player.matches : 0,
  }));
  details[puuid] = {
    teamLogo: publicAsset(team?.logo),
    teamColor: teamLineColor(team),
    role: agents[0]?.role || "",
    profileHref: `/#/players/${player.routeSlug || player.id}`,
    stats: {
      raating: player.raating_3,
      acs: player.acs,
      adr: player.adr,
      kd: player.kd,
      kast: player.kast,
      kpr: player.kpr,
      apr: player.apr,
      hs: player.hs,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      rounds: player.rounds,
      maps: player.matches,
    },
    agents,
    recentMatches: recentMatches(player),
  };
}

process.stdout.write(JSON.stringify(details));
