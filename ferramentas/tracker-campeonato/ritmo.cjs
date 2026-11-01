// Ritmo das requisições ao tracker, comum a todos os scripts desta pasta: o
// tracker conta por IP, então uma coleta tem que enxergar as anteriores.
//
// Os instantes ficam em outputs/tracker-ritmo.json (TRACKER_RITMO troca o
// caminho), relido a cada espera. Limites herdados do coletor pessoal, onde
// 150/h sustentado não deu bloqueio e 200/h deu (não são limites oficiais):
// 24 s entre requisições, 68 por 30 min, 600 por 6 h.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const ARQUIVO = process.env.TRACKER_RITMO || path.join(ROOT, "outputs", "tracker-ritmo.json");
const RITMO = { intervaloMs: 24_000, janelaCurtaMs: 30 * 60_000, maxCurta: 68, janelaLongaMs: 6 * 3600_000, maxLonga: 600 };

function ler() {
  if (!fs.existsSync(ARQUIVO)) return [];
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8")).eventos || [];
  } catch (e) {
    // Arquivo corrompido não pode virar "nenhuma requisição recente".
    throw new Error(`${ARQUIVO} está corrompido (${e.message}). Reconstrua com os estado.json das coletas recentes antes de seguir.`);
  }
}

function gravar(eventos) {
  const agora = Date.now();
  const vivos = [...new Set(eventos)].filter((t) => Number.isFinite(t) && agora - t < RITMO.janelaLongaMs).sort((a, b) => a - b);
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const fd = fs.openSync(ARQUIVO + ".tmp", "w");
  try {
    fs.writeSync(fd, JSON.stringify({ eventos: vivos }));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(ARQUIVO + ".tmp", ARQUIVO);
}

// Acrescenta instantes de outra fonte (ex.: estado de uma coleta antiga).
function semear(instantes) {
  gravar([...ler(), ...instantes]);
}

async function esperar(log = () => {}) {
  for (;;) {
    const agora = Date.now();
    const eventos = ler();
    const curta = eventos.filter((t) => agora - t < RITMO.janelaCurtaMs);
    const longa = eventos.filter((t) => agora - t < RITMO.janelaLongaMs);
    let ate = (eventos.length ? eventos[eventos.length - 1] : 0) + RITMO.intervaloMs;
    if (curta.length >= RITMO.maxCurta) ate = Math.max(ate, curta[curta.length - RITMO.maxCurta] + RITMO.janelaCurtaMs);
    if (longa.length >= RITMO.maxLonga) ate = Math.max(ate, longa[longa.length - RITMO.maxLonga] + RITMO.janelaLongaMs);
    if (ate <= agora) return;
    const ms = ate - agora;
    if (ms > 60_000) log("RITMO", `aguardando ${Math.round(ms / 60_000)} min (curta ${curta.length}/${RITMO.maxCurta}, longa ${longa.length}/${RITMO.maxLonga})`);
    await new Promise((r) => setTimeout(r, Math.min(ms, 60_000)));
  }
}

function marcar() {
  gravar([...ler(), Date.now()]);
}

module.exports = { ARQUIVO, RITMO, esperar, marcar, semear };
