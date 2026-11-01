// A lógica de descoberta é independente do transporte (HTTP ou navegador).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');

const normalize = value => String(value || '').trim().normalize('NFC').toLowerCase();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value || '');
const stat = (segment, key) => segment?.stats?.[key]?.value ?? null;
const timestamp = match => Date.parse(match?.metadata?.timestamp || match?.metadata?.dateStarted);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function linkedHandle(player) {
  try {
    const url = new URL(player.trackerUrl);
    if (!['tracker.gg', 'www.tracker.gg'].includes(url.hostname)) return player.handle;
    const match = url.pathname.match(/^\/valorant\/profile\/riot\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : player.handle;
  } catch { return player.handle; }
}
const rosterHandles = player => [...new Set([player.handle, linkedHandle(player)].filter(Boolean).map(normalize))];
const isWinScore = fixture => fixture.status === 'resultado_0_1_a_verificar';
function scoreMatches(fixture, scoreA, scoreB) {
  if (isWinScore(fixture)) return scoreA !== null && scoreB !== null && scoreA !== scoreB && (scoreA > scoreB) === (fixture.scoreA > fixture.scoreB);
  return (scoreA === null || scoreA === fixture.scoreA) && (scoreB === null || scoreB === fixture.scoreB);
}
function fixtureDayMatches(fixture, time, allScores = false) {
  if ((!allScores && !isWinScore(fixture)) || !fixture.scheduledAt) return true;
  const offset = fixture.scheduledAt.match(/([+-])(\d\d):(\d\d)$/);
  if (!offset) return true;
  const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1);
  return new Date(time + minutes * 60000).toISOString().slice(0, 10) === fixture.scheduledAt.slice(0, 10);
}
function timingCompatible(fixture, data) {
  const start = timestamp(data);
  if (!fixtureDayMatches(fixture, start, true)) return false;
  if (fixture.reportedAt && Number.isFinite(Number(data.metadata.duration))) {
    return Math.abs(start + Number(data.metadata.duration) - Date.parse(fixture.reportedAt)) <= 90 * 60000;
  }
  return Boolean(fixture.scheduledAt) && Math.abs(start - Date.parse(fixture.scheduledAt)) <= 180 * 60000;
}
function write(file, value, raw = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, raw ? value : JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

function parsePage(doc, handle, page, aliases = []) {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Número de página inválido.');
  const data = doc?.data;
  if (!Array.isArray(data?.matches)) throw new Error('Resposta sem data.matches; índice não aceito.');
  const matches = data.matches;
  const times = matches.map(timestamp);
  if (times.some(t => !Number.isFinite(t))) throw new Error('Índice com data ausente ou inválida.');
  if (times.some((t, i) => i > 0 && t > times[i - 1])) throw new Error('Índice fora da ordem cronológica decrescente.');
  if (matches.some(m => !uuid(m?.attributes?.id))) throw new Error('Índice com UUID inválido.');
  const identities = matches.flatMap(m => (m.segments || []).filter(s => s.type === 'overview')
    .map(s => s.attributes?.platformUserIdentifier).filter(Boolean));
  const allowed = new Set([handle, ...aliases].filter(Boolean).map(normalize));
  if (identities.some(h => !allowed.has(normalize(h)))) throw new Error('Índice retornou outra conta. Rever o vínculo/nick.');
  const next = data.metadata?.next ?? null;
  if (next !== null && (!Number.isInteger(next) || next !== page + 1)) throw new Error('Cursor diferente da paginação numérica observada.');
  if (!matches.length && next !== null) throw new Error('Página vazia com cursor; possível resposta incompleta.');
  return { page, next, newest: times.length ? Math.max(...times) : null, oldest: times.length ? Math.min(...times) : null, matches };
}

// Procura a primeira página que contém algo anterior ao fim exclusivo da janela.
// Só depois segue os cursores: O(log páginas recentes + páginas no período).
function nextPage(pages, start, end, maxPage = 4096) {
  const has = p => Object.hasOwn(pages, p);
  if (!has(0)) return { page: 0, phase: 'inicio' };
  const crosses = p => pages[p].oldest === null || pages[p].oldest < end;
  let low = -1;
  let high = 0;
  if (!crosses(0)) {
    if (pages[0].next === null) return { done: true, reason: 'historico_termina_depois_da_janela' };
    low = 0; high = 1;
    while (true) {
      if (high > maxPage) return { error: 'limite_de_paginas', page: high };
      if (!has(high)) return { page: high, phase: 'exponencial' };
      if (crosses(high)) break;
      if (pages[high].next === null) return { done: true, reason: 'historico_termina_depois_da_janela' };
      low = high; high *= 2;
    }
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (!has(mid)) return { page: mid, phase: 'binaria' };
      if (crosses(mid)) high = mid;
      else low = mid;
    }
  }
  const visited = new Set();
  for (let p = high; ; p = pages[p].next) {
    if (p > maxPage || visited.has(p)) return { error: 'cursor_ciclico_ou_limite', page: p };
    visited.add(p);
    if (!has(p)) return { page: p, phase: 'janela' };
    if (pages[p].oldest === null || pages[p].oldest < start || pages[p].next === null) {
      return { done: true, reason: 'janela_percorrida', firstPage: high, lastPage: p };
    }
  }
}

function indexCandidate(match, seeds, fixtures, start, end) {
  const time = timestamp(match);
  if (!(start <= time && time < end)) return { keep: false, reason: 'fora_da_janela' };
  if (match.metadata?.modeKey !== 'bomb') return { keep: false, reason: 'outro_modo' };
  const overview = (match.segments || []).find(s => s.type === 'overview');
  const won = stat(overview, 'roundsWon'), lost = stat(overview, 'roundsLost');
  const possible = fixtures.filter(f => fixtureDayMatches(f, time) && seeds.some(seed =>
    (seed === f.teamA && scoreMatches(f, won, lost)) ||
    (seed === f.teamB && scoreMatches(f, lost, won))));
  return { keep: possible.length > 0, reason: possible.length ? 'candidato' : 'placar_incompativel',
    possibleFixtures: possible.map(f => f.number), score: [won, lost] };
}

function validateDetail(doc, matchId) {
  if (!uuid(matchId) || doc?.data?.attributes?.id !== matchId) throw new Error('UUID do arquivo não corresponde à resposta.');
  if (!Number.isFinite(timestamp(doc.data))) throw new Error('Detalhe sem data válida.');
  const segments = doc.data.segments;
  if (!Array.isArray(segments)) throw new Error('Detalhe sem segments.');
  const players = segments.filter(s => s.type === 'player-summary');
  const sides = segments.filter(s => s.type === 'team-summary');
  if (!players.length || sides.length !== 2 || sides.some(s => stat(s, 'roundsWon') === null)) throw new Error('Placar/participantes incompletos.');
  return doc.data;
}

function associate(doc, fixtures, rosters, start, end, minimum = 3) {
  const data = validateDetail(doc, doc?.data?.attributes?.id);
  const scores = {}, sides = {};
  for (const s of data.segments.filter(s => s.type === 'team-summary')) {
    const side = s.attributes.teamId;
    scores[side] = stat(s, 'roundsWon'); sides[side] = [];
  }
  for (const s of data.segments.filter(s => s.type === 'player-summary')) {
    const side = s.metadata?.teamId;
    if (!Object.hasOwn(sides, side)) throw new Error('Participante com lado desconhecido.');
    const handle = s.attributes?.platformUserIdentifier;
    if (!handle) throw new Error('Participante sem identificador.');
    sides[side].push(handle);
  }
  const handles = new Map(rosters.map(t => [t.seed, new Set(t.members.filter(p => p.role !== 'Treinadores' && p.handle).flatMap(rosterHandles))]));
  const colors = Object.keys(sides), candidates = [], nearCandidates = [];
  const time = timestamp(data);
  if (start <= time && time < end) for (const f of fixtures) {
    if (!fixtureDayMatches(f, time)) continue;
    for (const [a, b] of [colors, [...colors].reverse()]) {
      const matchedA = sides[a].filter(h => handles.get(f.teamA)?.has(normalize(h)));
      const matchedB = sides[b].filter(h => handles.get(f.teamB)?.has(normalize(h)));
      if (scoreMatches(f, scores[a], scores[b])) {
        const unmatchedA = sides[a].filter(h => !handles.get(f.teamA)?.has(normalize(h)));
        const unmatchedB = sides[b].filter(h => !handles.get(f.teamB)?.has(normalize(h)));
        const candidate = { number: f.number, teamAColor: a, teamBColor: b, matchedA, matchedB, unmatchedA, unmatchedB,
          scoreBasis: isWinScore(f) ? 'vencedor' : 'rounds', officialScore: [f.scoreA, f.scoreB], trackerScore: [scores[a], scores[b]],
          fullRostersMatched: new Set(matchedA.map(normalize)).size === 5 && new Set(matchedB.map(normalize)).size === 5 && sides[a].length === 5 && sides[b].length === 5 };
        if (matchedA.length >= minimum && matchedB.length >= minimum) candidates.push(candidate);
        else if (((matchedA.length === 2 && matchedB.length >= 4) || (matchedB.length === 2 && matchedA.length >= 4)) &&
          new Set(sides[a].map(normalize)).size === 5 && new Set(sides[b].map(normalize)).size === 5 && timingCompatible(f, data)) nearCandidates.push(candidate);
      }
    }
  }
  return { matchId: data.attributes.id, startedAt: data.metadata.dateStarted || data.metadata.timestamp,
    map: data.metadata.mapName, scores, sides, candidates, nearCandidates,
    status: candidates.length > 1 ? 'ambiguo' : !candidates.length ? 'nao_associado' : candidates[0].fullRostersMatched ? 'confirmado' : 'correspondencia_parcial' };
}

class Collector {
  constructor(folder) {
    this.root = path.resolve(folder);
    this.plan = read(path.join(this.root, 'plano-coleta-lote.json'));
    this.rosters = read(path.join(this.root, 'elencos-normalizados.json'));
    this.manifest = read(path.join(this.root, 'manifesto.json'));
    const evidenceFile = path.join(this.root, 'elencos-por-partida.json');
    const rosterEvidence = fs.existsSync(evidenceFile) ? read(evidenceFile) : { evidence: [] };
    if (rosterEvidence.tournamentId && rosterEvidence.tournamentId !== this.plan.tournamentId) throw new Error('Evidência de elenco pertence a outro campeonato.');
    this.rosterEvidence = rosterEvidence.evidence || [];
    const extraMembers = new Map();
    for (const evidence of this.rosterEvidence) {
      const fixture = this.manifest.slots.find(f => f.number === evidence.fixtureNumber);
      if (!fixture) throw new Error('Evidência de elenco sem confronto oficial correspondente.');
      for (const member of evidence.members || []) {
        if (member.role !== 'Lineup') continue;
        if (![fixture.teamA, fixture.teamB].includes(member.teamSeed)) throw new Error('Equipe da evidência difere do confronto.');
        if (!extraMembers.has(member.teamSeed)) extraMembers.set(member.teamSeed, []);
        extraMembers.get(member.teamSeed).push({ ...member, role: 'Lineup', handle: linkedHandle(member),
          identitySource: 'challengermode_lineup_da_partida', sourceFixtureNumber: evidence.fixtureNumber,
          sourceUrl: evidence.gameUrl || evidence.sourceUrl });
      }
    }
    this.matchingRosters = this.rosters.map(t => ({ ...t, members: [...t.members, ...(extraMembers.get(t.seed) || [])] }));
    this.roundFixtures = this.manifest.slots.filter(f => f.status === 'placar_de_rounds');
    this.winFixtures = this.manifest.slots.filter(isWinScore);
    this.fixtures = [...this.roundFixtures, ...this.winFixtures];
    this.start = Date.parse(this.plan.window.fromInclusive); this.end = Date.parse(this.plan.window.toExclusive);
    if (!Number.isFinite(this.start) || !(this.start < this.end)) throw new Error('Janela inválida.');
    fs.mkdirSync(path.join(this.root, 'tracker-bruto'), { recursive: true });
    this.stateFile = path.join(this.root, 'lote', 'estado.json');
    const signature = digest(JSON.stringify({ tournamentId: this.plan.tournamentId, window: this.plan.window,
      fixtures: this.roundFixtures.map(({ number, teamA, teamB, scoreA, scoreB }) => ({ number, teamA, teamB, scoreA, scoreB })), rosters: this.rosters }));
    this.state = fs.existsSync(this.stateFile) ? read(this.stateFile) : {
      version: 1, signature, createdAt: new Date().toISOString(), profiles: {}, candidates: {}, requests: [], failures: {}, stop: null };
    if (this.state.signature !== signature) throw new Error('Entradas alteradas; arquive lote/estado.json antes de replanejar.');
    const winSignature = digest(JSON.stringify(this.winFixtures.map(({ number, teamA, teamB, scoreA, scoreB }) => ({ number, teamA, teamB, scoreA, scoreB }))));
    if (this.state.winSignature && this.state.winSignature !== winSignature) throw new Error('Resultados 0–1 alterados; preserve o estado e replaneje.');
    this.state.winSignature = winSignature;
    this.state.processingVersion = 3;
    const appearances = {};
    for (const profile of this.plan.profiles) {
      const wave = Math.min(...profile.registrations.map(r => appearances[r.seed] || 0));
      for (const r of profile.registrations) appearances[r.seed] = (appearances[r.seed] || 0) + 1;
      this.addProfile(profile.handle, profile.registrations.map(r => r.seed), wave, linkedHandle(profile));
    }
    for (const [seed, members] of extraMembers) for (const member of members) {
      const registered = this.rosters.find(t => t.seed === seed)?.members.find(p => p.challengermodeUserUrl === member.challengermodeUserUrl);
      if (registered && normalize(linkedHandle(registered)) !== normalize(member.handle)) this.addProfile(member.handle, [seed], 1, member.handle);
    }
    // Páginas numéricas mudam quando entram partidas novas. Uma busca incompleta
    // antiga recomeça; UUIDs e detalhes já obtidos continuam preservados.
    for (const p of Object.values(this.state.profiles)) {
      const dates = Object.values(p.pages).map(page => Date.parse(page.collectedAt));
      let invalidCache = false;
      for (const page of Object.values(p.pages)) {
        try {
          const raw = fs.readFileSync(path.join(this.root, page.rawFile), 'utf8');
          if (digest(raw) !== page.sha256) throw new Error('Hash do índice difere do estado salvo.');
          const doc = JSON.parse(raw);
          if (page.noData) {
            if (!doc.errors?.length || doc.errors.some(e => e.code !== 'StandardApiV2::NoData')) throw new Error('Resposta NoData inválida.');
          } else parsePage(doc, p.handle, page.page, [p.queryHandle]);
        } catch (error) {
          invalidCache = true;
          this.state.failures[page.rawFile] = { type: 'indice_local_invalido', error: error.message };
        }
      }
      if (invalidCache || (['ativo', 'pendente'].includes(p.status) && dates.length && Date.now() - Math.min(...dates) > 6 * 3600000)) {
        p.generation++; p.pages = {}; p.status = 'pendente';
      }
    }
    this.results = {};
    for (const file of fs.readdirSync(path.join(this.root, 'tracker-bruto'))) {
      if (!file.endsWith('.json')) continue;
      try { this.loadDetail(file.slice(0, -5)); }
      catch (error) { this.state.failures[file] = { error: error.message, type: 'arquivo_local_invalido' }; }
    }
    this.save();
  }
  addProfile(handle, seeds, wave, queryHandle) {
    if (!queryHandle) {
      const member = this.rosters.flatMap(t => t.members).find(p => normalize(p.handle) === normalize(handle));
      queryHandle = member ? linkedHandle(member) : handle;
    }
    const key = normalize(handle);
    const existing = this.state.profiles[key] || Object.values(this.state.profiles).find(p => normalize(p.queryHandle || p.handle) === normalize(queryHandle));
    if (existing) { existing.queryHandle = queryHandle; existing.seeds = [...new Set([...existing.seeds, ...seeds])]; }
    else this.state.profiles[key] = { handle, queryHandle, seeds: [...new Set(seeds)], wave, pages: {}, generation: 0, status: 'pendente' };
  }
  loadDetail(id) {
    const file = path.join(this.root, 'tracker-bruto', id + '.json');
    const raw = fs.readFileSync(file, 'utf8');
    const doc = JSON.parse(raw);
    validateDetail(doc, id);
    this.results[id] = { ...associate(doc, this.fixtures, this.matchingRosters, this.start, this.end,
      this.plan.validation.minimumKnownPlayersPerSideForCandidate), rawFile: path.relative(this.root, file), sha256: digest(raw),
      sourceUrl: `https://tracker.gg/valorant/match/${id}`, apiUrl: `https://api.tracker.gg/api/v2/valorant/standard/matches/${id}`,
      durationMillis: doc.data.metadata.duration, scoreboardOnly: doc.data.metadata.scoreboardOnly,
      extendedDataAvailable: doc.data.metadata.extendedDataAvailable, extendedDataIncluded: doc.data.metadata.extendedDataIncluded,
      segmentCounts: doc.data.segments.reduce((counts, s) => { counts[s.type] = (counts[s.type] || 0) + 1; return counts; }, {}),
      players: doc.data.segments.filter(s => s.type === 'player-summary').map(s => ({ handle: s.attributes.platformUserIdentifier, teamId: s.metadata.teamId, agent: s.metadata.agentName })),
      collectedAt: this.state.candidates[id]?.collectedAt ?? null };
    delete this.state.failures[id];
    this.corroborateObservedLineups();
  }
  corroborateObservedLineups() {
    this.observedLineupEvidence = [];
    for (const result of Object.values(this.results)) if (result.observedLineupValidation) {
      result.candidates = []; result.status = 'nao_associado'; delete result.observedLineupValidation;
    }
    if (!this.plan.validation.allowCorroboratedLineups) return;
    const groups = new Map();
    for (const result of Object.values(this.results)) {
      if (result.candidates.length || result.nearCandidates?.length !== 1) continue;
      const c = result.nearCandidates[0], f = this.fixtures.find(f => f.number === c.number);
      const aNeedsEvidence = c.matchedA.length === 2;
      const seed = aNeedsEvidence ? f.teamA : f.teamB;
      const side = aNeedsEvidence ? c.teamAColor : c.teamBColor;
      const lineup = result.sides[side];
      const key = seed + ':' + JSON.stringify(lineup.map(normalize).sort());
      if (!groups.has(key)) groups.set(key, { seed, lineup, supports: [] });
      groups.get(key).supports.push({ matchId: result.matchId, fixtureNumber: f.number,
        opponentSeed: aNeedsEvidence ? f.teamB : f.teamA,
        opponentRegisteredPlayers: aNeedsEvidence ? c.matchedB.length : c.matchedA.length,
        registeredPlayers: 2, scoreBasis: c.scoreBasis });
    }
    for (const group of groups.values()) {
      const distinctOpponents = new Set(group.supports.map(s => s.opponentSeed));
      if (distinctOpponents.size < 2 || !group.supports.some(s => s.opponentRegisteredPlayers === 5) || !group.supports.some(s => s.scoreBasis === 'rounds')) continue;
      const evidence = { ...group, rule: 'dois_registrados_quinteto_identico_dois_adversarios_horarios_compativeis' };
      this.observedLineupEvidence.push(evidence);
      for (const support of group.supports) {
        const result = this.results[support.matchId];
        result.candidates = [{ ...result.nearCandidates[0], fullRostersMatched: false,
          validationRule: evidence.rule, observedTeamSeed: group.seed, corroboratingMatches: group.supports.map(s => s.matchId) }];
        result.status = 'correspondencia_parcial'; result.observedLineupValidation = true;
      }
    }
  }
  covered() {
    const byFixture = new Map();
    for (const result of Object.values(this.results)) if (result.candidates.length === 1) {
      const n = result.candidates[0].number;
      if (!byFixture.has(n)) byFixture.set(n, []);
      byFixture.get(n).push(result.matchId);
    }
    return new Set([...byFixture].filter(([, ids]) => ids.length === 1).map(([n]) => n));
  }
  outstanding() { const covered = this.covered(); return this.roundFixtures.filter(f => !covered.has(f.number)); }
  waitMs(now = Date.now()) {
    const times = this.state.requests.map(r => r.at);
    const limits = [[1, 24000], [68, 30 * 60000], [600, 6 * 3600000]];
    return Math.max(0, this.state.blockedUntil - now || 0, ...limits.map(([n, interval]) => times.length >= n ? times[times.length - n] + interval - now : 0));
  }
  next() {
    if (this.state.stop) return { stopped: this.state.stop };
    if (!this.outstanding().length) {
      const pending = Object.values(this.state.candidates).find(c => !this.results[c.matchId] && (!this.state.failures[c.matchId] || this.state.failures[c.matchId].retryable));
      if (pending) return this.task({ kind: 'detail', matchId: pending.matchId, key: pending.matchId, url: `https://api.tracker.gg/api/v2/valorant/standard/matches/${pending.matchId}` });
      return { done: true, reason: 'confrontos_com_placar_de_rounds_associados', results01StillToReview: this.winFixtures.filter(f => !this.covered().has(f.number)).map(f => f.number) };
    }
    // Termina a descoberta de uma conta antes de baixar seus candidatos.
    let active = Object.values(this.state.profiles).find(p => p.status === 'ativo');
    if (active && Object.values(this.state.profiles).some(p => p.status === 'pendente' && p.wave < active.wave &&
      this.outstanding().some(f => p.seeds.includes(f.teamA) || p.seeds.includes(f.teamB)))) {
      active.status = 'pendente'; active = null; this.save();
    }
    while (true) {
      if (active) {
        const decision = nextPage(active.pages, this.start, this.end);
        if (decision.error) { active.status = 'erro'; active.error = decision.error; active = null; this.save(); }
        else if (decision.done) { active.status = 'concluido'; active.finishedAt = new Date().toISOString(); active.completion = decision; active = null; this.save(); }
        else return this.task({ kind: 'index', handle: active.handle, page: decision.page, phase: decision.phase,
          key: normalize(active.handle) + '|' + decision.page,
          queryHandle: active.queryHandle,
          url: `https://api.tracker.gg/api/v2/valorant/standard/matches/riot/${encodeURIComponent(active.queryHandle || active.handle)}?platform=pc&type=custom${decision.page ? '&next=' + decision.page : ''}` });
      }
      const pending = Object.values(this.state.candidates).find(c => !this.results[c.matchId] && (!this.state.failures[c.matchId] || this.state.failures[c.matchId].retryable));
      if (pending) return this.task({ kind: 'detail', matchId: pending.matchId, key: pending.matchId,
        url: `https://api.tracker.gg/api/v2/valorant/standard/matches/${pending.matchId}` });
      const missing = this.outstanding();
      const degree = p => missing.filter(f => p.seeds.includes(f.teamA) || p.seeds.includes(f.teamB)).length;
      const pendingProfiles = Object.values(this.state.profiles).filter(p => p.status === 'pendente' && degree(p));
      pendingProfiles.sort((a, b) => a.wave - b.wave || degree(b) - degree(a) || a.handle.localeCompare(b.handle));
      active = pendingProfiles[0];
      if (!active) {
        // Expande uma conta de cada vez, apenas das inscrições ainda descobertas.
        const alternatives = this.plan.fallbackProfilesByTeam.flatMap(t => t.handles.map(handle => ({ handle, seeds: [t.seed], wave: 2 })));
        const useful = alternatives.filter(p => !this.state.profiles[normalize(p.handle)] && degree(p));
        const tried = p => Object.values(this.state.profiles).filter(done => done.status !== 'pendente' && done.seeds.some(seed => p.seeds.includes(seed))).length;
        // Se as duas primeiras contas não revelaram o jogo, favorece consultar
        // o adversário antes de repetir muitas contas da mesma inscrição.
        useful.sort((a, b) => degree(b) / (1 + tried(b)) - degree(a) / (1 + tried(a)) || tried(a) - tried(b) || degree(b) - degree(a));
        if (!useful.length) { this.save(); return { done: true, incomplete: true, reason: 'contas_esgotadas_com_lacunas', missing: missing.map(f => f.number) }; }
        const best = useful[0];
        // A mesma conta pode estar vinculada a mais de uma inscrição.
        best.seeds = this.rosters.filter(t => t.members.some(p => p.role !== 'Treinadores' && rosterHandles(p).includes(normalize(best.handle)))).map(t => t.seed);
        this.addProfile(best.handle, best.seeds, 2); active = this.state.profiles[normalize(best.handle)];
      }
      active.status = 'ativo'; this.save();
    }
  }
  task(task) { return { ...task, waitMs: this.waitMs() }; }
  begin(task) {
    if (this.waitMs() > 0) throw new Error('Aguardar o intervalo antes da próxima requisição.');
    this.state.requests.push({ at: Date.now(), key: task.key, url: task.url, kind: task.kind });
    this.save();
  }
  ingest(task, raw) {
    const doc = JSON.parse(raw);
    const collectedAt = new Date().toISOString();
    const noData = doc.errors?.length && doc.errors.every(e => e.code === 'StandardApiV2::NoData');
    if (noData) {
      const relative = `lote/erros/${digest(task.key).slice(0, 12)}.json`;
      write(path.join(this.root, relative), raw, true);
      if (task.kind === 'index' && task.page > 0) {
        // O servidor também usa NoData para páginas posteriores ao fim.
        const profile = this.state.profiles[normalize(task.handle)];
        profile.pages[task.page] = { page: task.page, next: null, newest: null, oldest: null,
          noData: true, rawFile: relative, sha256: digest(raw), collectedAt };
        delete this.state.failures[task.key]; this.save(); return;
      }
      this.fail(task, { status: 404, message: 'StandardApiV2::NoData — sem dados disponíveis nessa consulta; não prova ausência de participação.' });
      return;
    }
    if (doc.errors?.length) {
      const message = JSON.stringify(doc.errors);
      this.fail(task, { status: /rate|too many|limit/i.test(message) ? 429 : /private|forbidden/i.test(message) ? 403 : 0, message });
      return;
    }
    if (task.kind === 'index') {
      const profile = this.state.profiles[normalize(task.handle)];
      if (!profile) throw new Error('Conta fora da fila.');
      const parsed = parsePage(doc, task.handle, task.page, [profile.queryHandle]);
      const relative = `lote/indices/${digest(normalize(task.handle)).slice(0, 12)}-${profile.generation}-${task.page}.json`;
      write(path.join(this.root, relative), raw, true);
      profile.pages[task.page] = { ...parsed, matches: undefined, rawFile: relative, sha256: digest(raw), collectedAt };
      const filters = {};
      for (const match of parsed.matches) {
        const decision = indexCandidate(match, profile.seeds, this.fixtures, this.start, this.end);
        filters[decision.reason] = (filters[decision.reason] || 0) + 1;
        if (!decision.keep) continue;
        const id = match.attributes.id;
        const candidate = this.state.candidates[id] ||= { matchId: id, sources: [], possibleFixtures: [], startedAt: match.metadata.timestamp, map: match.metadata.mapName };
        if (!candidate.sources.some(s => normalize(s.handle) === normalize(task.handle))) candidate.sources.push({ handle: task.handle, seeds: profile.seeds, page: task.page, rawFile: relative, score: decision.score });
        candidate.possibleFixtures = [...new Set([...candidate.possibleFixtures, ...decision.possibleFixtures])];
      }
      profile.pages[task.page].filters = filters;
      delete this.state.failures[task.key];
    } else {
      validateDetail(doc, task.matchId);
      const file = path.join(this.root, 'tracker-bruto', task.matchId + '.json');
      if (fs.existsSync(file)) { this.loadDetail(task.matchId); return this.save(); }
      write(file, raw, true); this.loadDetail(task.matchId);
      this.results[task.matchId].collectedAt = collectedAt;
      this.state.candidates[task.matchId].collectedAt = collectedAt;
    }
    this.save();
  }
  fail(task, { status = 0, message = '', retryAfterMs = 0 } = {}) {
    const attempts = (this.state.failures[task.key]?.attempts || 0) + 1;
    const entry = { status, message: String(message).slice(0, 1000), attempts, at: new Date().toISOString() };
    this.state.failures[task.key] = entry;
    if (status === 403 || /captcha|security verification|just a moment|cloudflare/i.test(message)) {
      this.state.stop = { reason: 'verificacao_ou_acesso_bloqueado', key: task.key, ...entry };
    } else if (status === 429 || status >= 500 || status === 0) {
      this.state.blockedUntil = Date.now() + Math.max(retryAfterMs, 60000 * 2 ** (attempts - 1));
      if (attempts >= 3) this.state.stop = { reason: 'falhas_repetidas', key: task.key, ...entry };
      // Falhas transitórias permanecem elegíveis para retomada.
      if (task.kind === 'detail' && attempts < 3) this.state.failures[task.key].retryable = true;
    } else if (task.kind === 'index') {
      const profile = this.state.profiles[normalize(task.handle)]; profile.status = 'erro'; profile.error = entry;
    }
    this.save();
  }
  resume() {
    const stoppedKey = this.state.stop?.key;
    this.state.stop = null;
    for (const [key, failure] of Object.entries(this.state.failures)) {
      if (failure.retryable || key === stoppedKey || failure.status === 403) delete this.state.failures[key];
    }
    this.save();
  }
  refreshProfile(handle) {
    const p = this.state.profiles[normalize(handle)];
    if (!p) throw new Error('Conta desconhecida.');
    p.generation++; p.pages = {}; p.status = 'pendente'; delete p.error;
    this.save();
  }
  reprocess() {
    const pages = Object.values(this.state.profiles).flatMap(p => Object.values(p.pages).filter(page => !page.noData)
      .map(page => ({ handle: p.handle, page: page.page, rawFile: page.rawFile })));
    for (const page of pages) this.ingest({ kind: 'index', handle: page.handle, page: page.page, key: normalize(page.handle) + '|' + page.page }, fs.readFileSync(path.join(this.root, page.rawFile), 'utf8'));
    for (const id of Object.keys(this.results)) this.loadDetail(id);
    this.save();
    return { reprocessedPages: pages.length, ...this.report().stats };
  }
  exportManifest() {
    const report = this.report();
    const byNumber = new Map([...report.fixtures, ...report.administrativeResultsToReview].map(f => [f.number, f]));
    const manifest = { ...this.manifest, schemaVersion: 2, updatedAt: report.updatedAt, window: this.plan.window,
      slots: this.manifest.slots.map(slot => ({ ...slot, trackerMatches: byNumber.get(slot.number)?.trackerMatches || [] })), trackerMatches: report.matches };
    write(path.join(this.root, 'manifesto.json'), manifest);
    write(path.join(this.root, 'progresso.json'), { schemaVersion: 2, updatedAt: report.updatedAt, tournamentId: this.plan.tournamentId,
      teams: this.rosters.length, ...report.stats, coveredOfficialMatches: [...this.covered()].sort((a, b) => a - b),
      matchStatuses: report.matches.reduce((counts, m) => { counts[m.status] = (counts[m.status] || 0) + 1; return counts; }, {}) });
    this.manifest = manifest;
    return report.stats;
  }
  report() {
    const results = Object.values(this.results);
    const summarize = f => {
      const matches = results.filter(r => r.candidates.length === 1 && r.candidates[0].number === f.number);
      return { ...f, trackerMatches: matches.map(m => m.matchId), statusColeta: matches.length > 1 ? 'mais_de_um_uuid_revisar' : matches.length ? matches[0].status : 'faltante' };
    };
    const fixtures = this.roundFixtures.map(summarize);
    const winFixtures = this.winFixtures.map(summarize);
    const profiles = Object.values(this.state.profiles);
    const covered = this.covered();
    const stats = { expectedFixtures: fixtures.length, coveredFixtures: fixtures.filter(f => covered.has(f.number)).length,
      confirmedFixtures: fixtures.filter(f => f.statusColeta === 'confirmado').length,
      partialFixtures: fixtures.filter(f => f.statusColeta === 'correspondencia_parcial').length,
      corroboratedLineupFixtures: fixtures.filter(f => f.trackerMatches.some(id => this.results[id]?.observedLineupValidation)).map(f => f.number),
      missingFixtures: fixtures.filter(f => f.statusColeta === 'faltante').map(f => f.number),
      conflictedFixtures: fixtures.filter(f => f.statusColeta === 'mais_de_um_uuid_revisar').map(f => f.number),
      results01: winFixtures.length, results01WithFiles: winFixtures.filter(f => covered.has(f.number)).length,
      results01StillToReview: winFixtures.filter(f => !covered.has(f.number)).map(f => f.number),
      uniqueCandidates: Object.keys(this.state.candidates).length, validRawFiles: results.length,
      completedProfiles: profiles.filter(p => p.status === 'concluido').length,
      queriedProfiles: profiles.filter(p => Object.keys(p.pages).length).length,
      requests: this.state.requests.length, stop: this.state.stop };
    return { updatedAt: new Date().toISOString(), tournamentId: this.plan.tournamentId, window: this.plan.window, stats,
      fixtures, matches: results, candidates: Object.values(this.state.candidates),
      profiles: profiles.map(({ pages, ...p }) => ({ ...p, pages: Object.values(pages) })), failures: this.state.failures,
      administrativeResultsToReview: winFixtures, observedLineupEvidence: this.observedLineupEvidence || [],
      additionalRosterEvidence: this.rosterEvidence.map(e => ({ fixtureNumber: e.fixtureNumber, gameUrl: e.gameUrl, sourceUrl: e.sourceUrl, observedAt: e.observedAt, members: e.members })) };
  }
  save() {
    write(this.stateFile, this.state);
    if (this.results) {
      const report = this.report();
      write(path.join(this.root, 'lote', 'relatorio.json'), report);
      const names = new Map(this.rosters.map(t => [t.seed, t.name]));
      const escape = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
      const labels = { confirmado: '10 jogadores associados', correspondencia_parcial: 'Identidade pendente', faltante: 'Faltante', mais_de_um_uuid_revisar: 'Conflito de UUIDs' };
      const lines = [`# ${this.plan.tournament}`, '', `Atualizado em ${report.updatedAt}.`, '',
        `**${report.stats.coveredFixtures} de ${report.stats.expectedFixtures} confrontos com arquivo associado**: ${report.stats.confirmedFixtures} com cinco jogadores conhecidos de cada lado e ${report.stats.partialFixtures} com identidade pendente.`, '',
        `Além disso, ${report.stats.results01WithFiles} dos ${report.stats.results01} confrontos registrados como 0–1 têm arquivo associado pelo vencedor, elencos e dia. O placar real de rounds permanece no JSON.`, '',
        `Confrontos com quinteto observado corroborado por adversários independentes: ${report.stats.corroboratedLineupFixtures.join(', ') || 'nenhum'}. As identidades individuais pendentes continuam listadas.`, '',
        `Foram preservados ${report.stats.validRawFiles} arquivos válidos. Esta execução registrou ${report.stats.requests} requisições e concluiu a busca no período em ${report.stats.completedProfiles} contas.`, '',
        'Uma correspondência parcial já possui arquivo, mas requer conferir as identidades listadas abaixo. Um resultado 0–1 sem arquivo continua pendente; não é classificado automaticamente como W.O.', '',
        report.stats.stop ? `**Coleta interrompida:** ${escape(report.stats.stop.reason)} — ${escape(report.stats.stop.message)}.` : 'Estado: coleta retomável; consultar o estado salvo para a próxima tarefa.', '',
        '| Confronto | Equipes | Placar | Conferência | Arquivo no Tracker |', '|---|---|---|---|---|'];
      for (const f of report.fixtures) lines.push(`| ${f.number} | ${escape(names.get(f.teamA))} × ${escape(names.get(f.teamB))} | ${f.scoreA}–${f.scoreB} | ${labels[f.statusColeta]} | ${f.trackerMatches.map(id => `[Abrir](https://tracker.gg/valorant/match/${id})`).join(', ')} |`);
      lines.push('', '## Identidades pendentes', '');
      for (const m of report.matches.filter(m => m.status === 'correspondencia_parcial')) {
        const c = m.candidates[0];
        lines.push(`- Confronto ${c.number}: ${[...c.unmatchedA, ...c.unmatchedB].map(escape).join(', ')}.`);
      }
      if (report.observedLineupEvidence.length) {
        lines.push('', '## Elencos observados corroborados', '');
        for (const evidence of report.observedLineupEvidence) lines.push(`- ${escape(names.get(evidence.seed))}: o mesmo quinteto aparece nos confrontos ${evidence.supports.map(s => s.fixtureNumber).join(', ')}, contra adversários distintos; há dois jogadores registrados reconhecidos e pelo menos quatro adversários reconhecidos em cada jogo. Não há correspondência individual atribuída aos três nomes restantes.`);
      }
      lines.push('', '## Resultados 0–1', '', '| Confronto | Equipes | Registro | Conferência | Tracker |', '|---|---|---|---|---|');
      for (const f of report.administrativeResultsToReview) lines.push(`| ${f.number} | ${escape(names.get(f.teamA))} × ${escape(names.get(f.teamB))} | ${f.scoreA}–${f.scoreB} | ${labels[f.statusColeta]} | ${f.trackerMatches.map(id => `[Abrir](https://tracker.gg/valorant/match/${id})`).join(', ')} |`);
      lines.push('',
        'Os JSONs originais estão em `../tracker-bruto/`. O relatório completo com evidências e hashes está em `relatorio.json`.', '');
      write(path.join(this.root, 'lote', 'resumo.md'), lines.join('\n'), true);
    }
  }
}

async function runHttp(collector, limit) {
  let count = 0;
  while (count < limit) {
    let task = collector.next();
    if (task.done || task.stopped) { console.log(JSON.stringify(task)); break; }
    while (task.waitMs > 0) { await sleep(Math.min(task.waitMs, 30000)); task.waitMs = collector.waitMs(); }
    collector.begin(task); count++;
    try {
      const response = await fetch(task.url, { signal: AbortSignal.timeout(45000) });
      const raw = await response.text();
      let doc;
      try { doc = JSON.parse(raw); } catch { /* texto de erro ou página de acesso */ }
      const noData = doc?.errors?.length && doc.errors.every(e => e.code === 'StandardApiV2::NoData');
      if (!response.ok && !noData) {
        const header = response.headers.get('retry-after');
        const retryAfterMs = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now())) : 0;
        collector.fail(task, { status: response.status, message: raw, retryAfterMs });
      } else if (!/^\s*\{/.test(raw)) collector.fail(task, { status: 403, message: raw });
      else collector.ingest(task, raw);
    } catch (error) { collector.fail(task, { message: error.message }); }
    console.log(JSON.stringify({ request: count, kind: task.kind, handle: task.handle, page: task.page, matchId: task.matchId, ...collector.report().stats }));
    if (collector.state.stop) break;
    collector.save();
  }
}

if (require.main === module) (async () => {
  const [command = 'status', folder, arg, extra] = process.argv.slice(2);
  if (!folder) throw new Error('Uso: node coletor.cjs status|next|run|ingest|resume|refresh|reprocess|export PASTA [ARG]');
  const collector = new Collector(folder);
  if (command === 'status') console.log(JSON.stringify(collector.report().stats, null, 2));
  else if (command === 'next') console.log(JSON.stringify(collector.next(), null, 2));
  else if (command === 'run') {
    const limit = Number(arg || 100);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('O limite de requisições deve ser um inteiro positivo.');
    await runHttp(collector, limit);
  }
  else if (command === 'ingest') collector.ingest(read(arg), fs.readFileSync(extra, 'utf8'));
  else if (command === 'resume') collector.resume();
  else if (command === 'refresh') collector.refreshProfile(arg);
  else if (command === 'reprocess') console.log(JSON.stringify(collector.reprocess(), null, 2));
  else if (command === 'export') console.log(JSON.stringify(collector.exportManifest(), null, 2));
  else throw new Error('Comando desconhecido.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { Collector, parsePage, nextPage, indexCandidate, validateDetail, associate, normalize, linkedHandle, runHttp };
