const feed = document.getElementById("feed");
const search = document.getElementById("player-search");
const searchResults = document.getElementById("search-results");
const dateMenu = document.getElementById("date-menu");
const dateOptions = document.getElementById("date-options");
const currentDate = document.getElementById("current-date");
let manifest;
let cards = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function number(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function dateOnly(value, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function matchDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })
    .format(new Date(value));
}

function smallMetric(label, value) {
  return '<span class="small-metric"><small>' + label + '</small><strong>' + value + '</strong></span>';
}

function agentsHtml(card) {
  if (!card.agents?.length) return '<span class="empty-inline">—</span>';
  const shown = card.agents.slice(0, 3).map((agent) =>
    '<span class="agent-chip">' +
      (agent.icon ? '<img src="' + escapeHtml(agent.icon) + '" alt="" loading="lazy" />' : '') +
      '<strong>' + escapeHtml(agent.name) + '</strong><em>' + number(agent.share * 100) + '%</em>' +
    '</span>'
  ).join('');
  const remainder = card.agents.length > 3
    ? '<span class="agent-more">+' + (card.agents.length - 3) + '</span>'
    : '';
  return shown + remainder;
}

function matchesHtml(card) {
  if (!card.recentMatches?.length) return '<div class="empty-inline">Sem jogos registrados</div>';
  return card.recentMatches.slice(0, 3).map((match) =>
    '<a class="game-row" href="' + escapeHtml(match.href) + '">' +
      '<time>' + matchDate(match.date) + '</time>' +
      '<span class="game-main">' +
        '<strong>' +
          (match.opponentLogo ? '<img src="' + escapeHtml(match.opponentLogo) + '" alt="" loading="lazy" />' : '') +
          '<span>' + escapeHtml(match.opponent) + '</span>' +
        '</strong>' +
        '<small>' + escapeHtml(match.event) + ' · ' + escapeHtml(match.map) + '</small>' +
      '</span>' +
      '<span class="game-result">' +
        '<strong class="' + (match.result === 'V' ? 'win' : 'loss') + '">' + escapeHtml(match.result) + ' ' + escapeHtml(match.score) + '</strong>' +
        '<small>' + number(match.kills) + '/' + number(match.deaths) + '/' + number(match.assists) + ' · ' + number(match.rating, 2) + ' rAAting</small>' +
      '</span>' +
    '</a>'
  ).join('');
}

function profileHtml(card) {
  const stat = card.stats || {};
  return [
    '<div class="card-top">',
      '<div class="team-id">',
        card.teamLogo ? '<img src="' + escapeHtml(card.teamLogo) + '" alt="" loading="lazy" />' : '',
        '<span>' + escapeHtml(card.team) + '</span>',
      '</div>',
      '<span class="rank-tag">#' + String(card.rank).padStart(3, '0') + ' / ' + manifest.total + '</span>',
    '</div>',
    '<div class="card-main">',
      '<a class="card-art" href="' + escapeHtml(card.image) + '" target="_blank" rel="noopener" aria-label="Abrir cartinha de ' + escapeHtml(card.name) + ' em tamanho original">',
        '<img src="' + escapeHtml(card.image) + '" alt="Cartinha de ' + escapeHtml(card.name) + '" loading="lazy" />',
      '</a>',
      '<div class="card-data">',
        '<div class="player-head"><h2>' + escapeHtml(card.name) + '</h2>',
          card.role ? '<span>' + escapeHtml(card.role) + '</span>' : '',
        '</div>',
        '<div class="quick-stats">',
          smallMetric('Overall', number(card.overall)),
          smallMetric('rAAting 3.0', number(stat.raating, 2)),
          smallMetric('ACS', number(stat.acs)),
          smallMetric('K/D', number(stat.kd, 2)),
        '</div>',
        '<div class="sample-line">' + number(stat.maps) + ' mapas · ' + number(stat.rounds) + ' rounds · ' +
          number(stat.kills) + '/' + number(stat.deaths) + '/' + number(stat.assists) + ' K/D/A</div>',
        '<div class="stat-strip">',
          smallMetric('KAST', number(stat.kast) + '%'),
          smallMetric('ADR', number(stat.adr)),
          smallMetric('HS', number(stat.hs) + '%'),
          smallMetric('Ajustado', number(card.adjustedRating, 2)),
        '</div>',
        '<div class="agents-line"><span class="mini-label">Agentes</span><div class="agent-chips">' + agentsHtml(card) + '</div></div>',
        '<div class="profile-links">',
          '<a href="' + escapeHtml(card.profileHref) + '">Perfil completo ↗</a>',
          '<a href="' + escapeHtml(card.image) + '" target="_blank" rel="noopener">Abrir cartinha ↗</a>',
        '</div>',
      '</div>',
    '</div>',
    '<div class="recent-games"><div class="section-label">Últimos jogos <span>' + Math.min(3, card.recentMatches?.length || 0) + ' mapas</span></div>',
      '<div class="game-list">' + matchesHtml(card) + '</div>',
    '</div>',
  ].join('');
}
function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function renderDates() {
  dateOptions.innerHTML = manifest.days.map((day) => {
    const label = dateOnly(day.date, { day: '2-digit', month: '2-digit' });
    const status = day.cards?.length ? day.count + ' reveladas' : day.count + ' bloqueadas';
    return '<a href="#dia-' + day.date + '" data-date="' + day.date + '" class="date-option ' +
      (day.cards?.length ? 'released' : 'locked') + '"><strong>' + label + '</strong><small>' + status + '</small></a>';
  }).join('');
}

function renderLocked(rank) {
  return '<article class="locked-card" id="carta-' + rank + '" aria-label="Cartinha ' + rank + ' bloqueada">' +
    '<div class="mystery-card" aria-hidden="true"><span>?</span></div>' +
    '<div class="locked-caption"><strong>#' + String(rank).padStart(3, '0') + '</strong><span>Bloqueada</span></div>' +
  '</article>';
}

function renderFeed() {
  let rank = 1;
  feed.innerHTML = manifest.days.map((day) => {
    const firstRank = rank;
    const dayCards = new Map((day.cards || []).map((card) => [card.rank, card]));
    let revealed = '';
    let locked = '';
    for (let index = 0; index < day.count; index++, rank++) {
      const card = dayCards.get(rank);
      if (card) {
        revealed += '<article class="player-card panel" id="carta-' + rank + '">' + profileHtml(card) + '</article>';
      } else {
        locked += renderLocked(rank);
      }
    }
    const countLabel = day.cards?.length
      ? day.count + (day.count === 1 ? ' cartinha revelada' : ' cartinhas reveladas')
      : day.count + (day.count === 1 ? ' cartinha bloqueada' : ' cartinhas bloqueadas');
    return '<section class="day-section" id="dia-' + day.date + '" data-date="' + day.date + '">' +
      '<div class="day-divider"><div><strong>' + dateOnly(day.date) + '</strong><span>' + countLabel + '</span></div>' +
      '<small>#' + String(firstRank).padStart(3, '0') + '–#' + String(rank - 1).padStart(3, '0') + '</small></div>' +
      revealed + (locked ? '<div class="locked-grid">' + locked + '</div>' : '') +
    '</section>';
  }).join('');
}

function syncCurrentDate() {
  const sections = feed.querySelectorAll('.day-section');
  let active = sections[0];
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
    active = sections[sections.length - 1];
  } else {
    for (const section of sections) {
      if (section.getBoundingClientRect().top > 150) break;
      active = section;
    }
  }
  if (!active) return;
  const date = active.dataset.date;
  currentDate.textContent = dateOnly(date, { day: '2-digit', month: '2-digit' });
  dateOptions.querySelectorAll('.date-option').forEach((option) => {
    option.classList.toggle('active', option.dataset.date === date);
  });
}

function scrollToHash() {
  if (!/^#(?:carta-\d+|dia-\d{4}-\d{2}-\d{2})$/.test(location.hash)) return;
  requestAnimationFrame(() => {
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
    syncCurrentDate();
  });
}

function showSearchResults() {
  const query = normalize(search.value);
  if (!query) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    return;
  }
  const found = cards.filter((card) => normalize(card.name).includes(query)).slice(0, 8);
  searchResults.innerHTML = found.length
    ? found.map((card) => '<a href="#carta-' + card.rank + '" class="search-result"><span>' +
        escapeHtml(card.name) + '</span><small>#' + String(card.rank).padStart(3, '0') + ' · ' + escapeHtml(card.team) + '</small></a>').join('')
    : '<div class="search-empty">Nenhum jogador revelado</div>';
  searchResults.hidden = false;
}

function render(data) {
  manifest = data;
  cards = data.days.flatMap((day) => day.cards || []);
  document.getElementById('revealed-count').textContent = number(cards.length);
  document.getElementById('total-count').textContent = '/ ' + number(data.total) + ' reveladas';
  renderDates();
  renderFeed();
  scrollToHash();
  syncCurrentDate();
}

search.addEventListener('input', showSearchResults);
search.addEventListener('focus', showSearchResults);
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') searchResults.hidden = true;
  if (event.key === 'Enter' && !searchResults.hidden) {
    const first = searchResults.querySelector('a');
    if (first) {
      event.preventDefault();
      first.click();
    }
  }
});
searchResults.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    searchResults.hidden = true;
    search.blur();
  }
});
dateOptions.addEventListener('click', (event) => {
  if (event.target.closest('a')) dateMenu.open = false;
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-control')) searchResults.hidden = true;
  if (!event.target.closest('.date-menu')) dateMenu.open = false;
});
let scrollPending = false;
window.addEventListener('scroll', () => {
  if (scrollPending || !manifest) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    syncCurrentDate();
    scrollPending = false;
  });
}, { passive: true });
window.addEventListener('hashchange', () => {
  if (manifest) scrollToHash();
});

fetch('manifest.json?v=' + Date.now(), { cache: 'no-store' })
  .then((response) => {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  })
  .then(render)
  .catch(() => { feed.innerHTML = '<div class="panel load-error">Não foi possível carregar as cartinhas.</div>'; });
