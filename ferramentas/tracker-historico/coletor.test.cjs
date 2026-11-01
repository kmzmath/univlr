const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Collector, parsePage, nextPage, indexCandidate, associate, linkedHandle, normalize } = require('./coletor.cjs');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-fixtures/piloto.json'), 'utf8'));
const inputs = { 'plano-coleta-lote.json': sample.plan, 'manifesto.json': sample.manifest, 'elencos-normalizados.json': sample.rosters,
  'indices-tracker/astro-pagina-2.json': sample.index,
  ...Object.fromEntries(Object.entries(sample.details).map(([id, doc]) => ['tracker-bruto/' + id + '.json', doc])) };
const read = name => structuredClone(inputs[name]);
function writeInputs(dir) {
  for (const name of ['plano-coleta-lote.json', 'manifesto.json', 'elencos-normalizados.json']) fs.writeFileSync(path.join(dir, name), JSON.stringify(read(name)));
  fs.mkdirSync(path.join(dir, 'tracker-bruto'));
}
const plan = read('plano-coleta-lote.json');
const manifest = read('manifesto.json');
const rosters = read('elencos-normalizados.json');
const fixtures = manifest.slots.filter(f => f.status === 'placar_de_rounds');
const start = Date.parse(plan.window.fromInclusive), end = Date.parse(plan.window.toExclusive);
const id = 'd66ff1c3-7d44-45c5-a61e-23a973ed698d';
function temporaryFolder(t, prefix) {
  const base = path.resolve(__dirname, '../../outputs/tracker-testes');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, prefix));
  t.after(() => {
    assert(path.resolve(dir).startsWith(base + path.sep));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('busca salta 100 páginas recentes sem omitir a janela nem varrer todas', () => {
  const pages = {}, requested = [];
  // Datas artificiais: cada página contém dois jogos, em ordem decrescente.
  for (let guard = 0; guard < 30; guard++) {
    const task = nextPage(pages, 790, 801);
    if (task.done) {
      assert.equal(task.firstPage, 100); assert.equal(task.lastPage, 105);
      assert(requested.length < 22); assert(requested.includes(101)); return;
    }
    const p = task.page; requested.push(p);
    pages[p] = { newest: 1000 - p * 2, oldest: 999 - p * 2, next: p + 1 };
  }
  assert.fail('Busca não terminou.');
});

test('trata fim de histórico vazio e fronteiras exatas sem pular páginas', () => {
  assert.deepEqual(nextPage({ 0: { oldest: null, newest: null, next: null } }, start, end).done, true);
  const pages = { 0: { oldest: end, newest: end + 100, next: 1 }, 1: { oldest: start, newest: end - 1, next: 2 } };
  assert.equal(nextPage(pages, start, end).page, 2); // início é inclusivo
  pages[2] = { oldest: start - 1, newest: start - 1, next: null };
  assert.equal(nextPage(pages, start, end).done, true);
});

test('aceita os índices reais, rejeita resposta truncada, cursor estranho e outra conta', () => {
  const doc = read('indices-tracker/astro-pagina-2.json');
  assert.equal(parsePage(doc, 'ASTRO#2277', 2).matches.length, 20);
  assert.throws(() => parsePage({}, 'ASTRO#2277', 2));
  const bad = structuredClone(doc); bad.data.metadata.next = '3';
  assert.throws(() => parsePage(bad, 'ASTRO#2277', 2));
  assert.throws(() => parsePage(doc, 'OUTRA#CONTA', 2));
});

test('acha dois jogos reais no índice e descarta partidas de julho antes do download', () => {
  const doc = read('indices-tracker/astro-pagina-2.json');
  const candidates = doc.data.matches.filter(m => indexCandidate(m, [13], fixtures, start, end).keep);
  assert.equal(candidates.length, 2);
  assert(candidates.some(m => m.attributes.id === id));
  assert.equal(indexCandidate(doc.data.matches[0], [13], fixtures, start, end).reason, 'fora_da_janela');
});

test('cruza os dez participantes; mantém jogador sem vínculo explícito no caso parcial', () => {
  const full = associate(read('tracker-bruto/' + id + '.json'), fixtures, rosters, start, end);
  assert.equal(full.status, 'confirmado'); assert.equal(full.candidates[0].number, 51);
  const partial = associate(read('tracker-bruto/69cdf76e-82a0-4695-a15f-05602f4719e6.json'), fixtures, rosters, start, end);
  assert.equal(partial.status, 'correspondencia_parcial'); assert.equal(partial.candidates[0].number, 38);
  assert.equal(partial.candidates[0].unmatchedA.length + partial.candidates[0].unmatchedB.length, 1);
  const wrong = structuredClone(fixtures); wrong.find(f => f.number === 51).scoreA++;
  assert.equal(associate(read('tracker-bruto/' + id + '.json'), wrong, rosters, start, end).status, 'nao_associado');
});

test('mesma data e placar com outro adversário não confirma; confrontos indistinguíveis ficam ambíguos', () => {
  const otherOpponent = read('tracker-bruto/' + id + '.json');
  for (const s of otherOpponent.data.segments) if (s.type === 'player-summary' && s.metadata.teamId === 'Blue') s.attributes.platformUserIdentifier = 'Outro ' + s.attributes.platformUserIdentifier;
  assert.equal(associate(otherOpponent, fixtures, rosters, start, end).status, 'nao_associado');
  const duplicateFixture = { ...fixtures.find(f => f.number === 51), number: 999 };
  assert.equal(associate(read('tracker-bruto/' + id + '.json'), [...fixtures, duplicateFixture], rosters, start, end).status, 'ambiguo');
});

test('preserva os espaços do link: três jogadores associados sem fundir nomes parecidos', () => {
  const team = rosters.find(t => t.seed === 33);
  assert.equal(linkedHandle(team.members[0]), 'K  I  R  A#SDM');
  assert.notEqual(normalize('K I R A#SDM'), normalize('K  I  R  A#SDM'));
  const doc = read('tracker-bruto/d4e25f74-e92d-4465-b108-a46b3bbda795.json');
  const result = associate(doc, fixtures, rosters, start, end);
  assert.equal(result.status, 'correspondencia_parcial');
  assert.equal(result.candidates[0].number, 33);
  assert.equal(result.candidates[0].matchedB.length, 3);
  const withoutLinks = structuredClone(rosters);
  for (const t of withoutLinks) for (const p of t.members) delete p.trackerUrl;
  assert.equal(associate(doc, fixtures, withoutLinks, start, end).status, 'nao_associado');
});

test('jogo real com resultado oficial 1–0 usa vencedor, elencos e dia; não vira W.O.', () => {
  const all = manifest.slots;
  const doc = read('tracker-bruto/eaf96c7b-3fd9-4199-9624-02a018e20a92.json');
  const result = associate(doc, all, rosters, start, end);
  assert.equal(result.status, 'confirmado');
  assert.equal(result.candidates[0].number, 121);
  assert.equal(result.candidates[0].scoreBasis, 'vencedor');
  assert.deepEqual(result.candidates[0].trackerScore, [13, 4]);
  assert.deepEqual(result.candidates[0].officialScore, [1, 0]);
  assert(indexCandidate(sample.winIndexMatch, [16], all, start, end).possibleFixtures.includes(121));
  const wrongWinner = structuredClone(all);
  Object.assign(wrongWinner.find(f => f.number === 121), { scoreA: 0, scoreB: 1 });
  assert.equal(associate(doc, wrongWinner, rosters, start, end).status, 'nao_associado');
  doc.data.metadata.dateStarted = '2025-05-24T19:49:24.445+00:00';
  assert.equal(associate(doc, all, rosters, start, end).status, 'nao_associado');
});

test('corrobora o mesmo quinteto contra dois adversários e mantém três identidades pendentes', t => {
  const dir = temporaryFolder(t, 'elenco-observado-');
  writeInputs(dir);
  const explicitPlan = read('plano-coleta-lote.json');
  explicitPlan.validation.allowCorroboratedLineups = true;
  fs.writeFileSync(path.join(dir, 'plano-coleta-lote.json'), JSON.stringify(explicitPlan));
  const firstId = 'b7723b7e-11c8-4652-aecb-2fbd532dafb7';
  const secondId = '0a713bb8-4127-4301-9e34-bd62be931573';
  const put = (id, doc) => fs.writeFileSync(path.join(dir, 'tracker-bruto', id + '.json'), JSON.stringify(doc));
  put(firstId, read('tracker-bruto/' + firstId + '.json'));
  let c = new Collector(dir);
  assert.equal(c.results[firstId].status, 'nao_associado');
  const duplicateId = 'b7723b7e-11c8-4652-aecb-2fbd532dafb8';
  const duplicate = read('tracker-bruto/' + firstId + '.json');
  duplicate.data.attributes.id = duplicateId;
  put(duplicateId, duplicate);
  c = new Collector(dir);
  assert.equal(c.observedLineupEvidence.length, 0); // repetir o mesmo adversário não basta
  fs.unlinkSync(path.join(dir, 'tracker-bruto', duplicateId + '.json'));
  put(secondId, read('tracker-bruto/' + secondId + '.json'));
  c = new Collector(dir);
  assert(c.covered().has(40)); assert(c.covered().has(116));
  assert.equal(c.results[firstId].status, 'correspondencia_parcial');
  assert.equal(c.results[firstId].candidates[0].matchedB.length, 2);
  assert.equal(c.results[firstId].candidates[0].unmatchedB.length, 3);
  assert.equal(c.observedLineupEvidence[0].supports.length, 2);
  c.plan.validation.allowCorroboratedLineups = false;
  c.corroborateObservedLineups();
  assert(!c.covered().has(40)); // a exceção depende de opção explícita no plano
});

test('elenco oficial da partida complementa os vínculos sem reescrever a inscrição', t => {
  const dir = temporaryFolder(t, 'elenco-oficial-');
  writeInputs(dir);
  fs.writeFileSync(path.join(dir, 'elencos-por-partida.json'), JSON.stringify(sample.gameRosterEvidence));
  const id = 'b7723b7e-11c8-4652-aecb-2fbd532dafb7';
  fs.writeFileSync(path.join(dir, 'tracker-bruto', id + '.json'), JSON.stringify(read('tracker-bruto/' + id + '.json')));
  const c = new Collector(dir);
  assert(c.covered().has(40));
  assert.equal(c.results[id].candidates[0].matchedB.length, 4);
  assert.equal(c.results[id].observedLineupValidation, undefined);
  assert(!c.rosters.find(t => t.seed === 21).members.some(p => p.handle === 'nan zk#mari'));
  assert(c.matchingRosters.find(t => t.seed === 21).members.some(p => p.handle === 'nan zk#mari'));
});

test('retomada deduplica fontes e preserva JSON original; não baixa novamente arquivo válido', t => {
  const dir = temporaryFolder(t, 'retomada-');
  writeInputs(dir);
  fs.writeFileSync(path.join(dir, 'tracker-bruto', id + '.json'), JSON.stringify(read('tracker-bruto/' + id + '.json')));
  const collector = new Collector(dir);
  collector.addProfile('ASTRO#2277', [13], 0);
  const raw = JSON.stringify(read('indices-tracker/astro-pagina-2.json'));
  const task = { kind: 'index', handle: 'ASTRO#2277', page: 2, key: 'astro#2277|2' };
  collector.ingest(task, raw); collector.ingest(task, raw);
  assert.equal(collector.state.candidates[id].sources.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, collector.state.profiles['astro#2277'].pages[2].rawFile), 'utf8'), raw);
  const resumed = new Collector(dir);
  assert.equal(Object.keys(resumed.results).length, 1); assert(resumed.covered().has(51));
  assert.equal(resumed.state.candidates[id].sources.length, 1);
  const cache = resumed.state.profiles['astro#2277'].pages[2].rawFile;
  fs.writeFileSync(path.join(dir, cache), '{}');
  const repaired = new Collector(dir);
  assert.equal(Object.keys(repaired.state.profiles['astro#2277'].pages).length, 0);
  assert.equal(repaired.state.failures[cache].type, 'indice_local_invalido');
  assert(repaired.covered().has(51)); // o detalhe válido continua preservado
});

test('429 respeita Retry-After e para após três falhas; 403 interrompe imediatamente', t => {
  const dir = temporaryFolder(t, 'limites-');
  writeInputs(dir);
  const c = new Collector(dir), task = c.next();
  c.fail(task, { status: 429, retryAfterMs: 180000 });
  assert(c.waitMs() > 179000);
  c.fail(task, { status: 429 }); c.fail(task, { status: 429 });
  assert.equal(c.next().stopped.reason, 'falhas_repetidas');
  c.resume(); c.fail(task, { status: 403 });
  assert.equal(c.next().stopped.reason, 'verificacao_ou_acesso_bloqueado');
  c.resume();
  for (const p of Object.values(c.state.profiles)) p.status = 'concluido';
  c.state.candidates[id] = { matchId: id };
  const detailTask = c.next();
  assert.equal(detailTask.kind, 'detail');
  c.fail(detailTask, { status: 403 });
  c.resume();
  assert.equal(c.next().matchId, id); // liberar acesso não abandona o download bloqueado
});

test('NoData pula conta sem dados; página vazia posterior permite buscar páginas anteriores', t => {
  const dir = temporaryFolder(t, 'sem-dados-');
  writeInputs(dir);
  const c = new Collector(dir), task = c.next();
  const raw = JSON.stringify({ errors: [{ code: 'StandardApiV2::NoData', message: 'No data.', data: {} }] });
  c.ingest(task, raw);
  assert.equal(c.state.profiles[task.handle.toLowerCase()].status, 'erro');
  assert.notEqual(c.next().handle, task.handle);
  c.addProfile('ASTRO#2277', [13], 0);
  c.ingest({ kind: 'index', handle: 'ASTRO#2277', page: 8, key: 'astro#2277|8' }, raw);
  const pages = c.state.profiles['astro#2277'].pages;
  assert.equal(pages[8].noData, true);
  pages[0] = { oldest: end + 20, next: 1 };
  pages[1] = { oldest: end + 10, next: 2 };
  pages[2] = { oldest: end + 5, next: 3 };
  pages[4] = { oldest: end + 1, next: 5 };
  assert.equal(nextPage(pages, start, end).page, 6);
});
