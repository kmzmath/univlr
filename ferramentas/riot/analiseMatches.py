import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter


# ---- CONFIG PARA RODAR DIRETO NO VS CODE (sem argumentos) ----
import config_hub

# A pasta de trabalho fica fora do repo: e la que estao os JSONs brutos e as
# saidas de analise. Ver config_hub.
BASE_DIR = config_hub.TRABALHO_DIR
DEFAULT_INPUT_DIR = str(BASE_DIR / "Finalizados" / "Válidos")
DEFAULT_OUTPUT_XLSX = ""  # vazio = gera analiseMatches_<nome_da_pasta>.xlsx automaticamente
DEFAULT_RECURSIVE = True

SITE_PIPELINE_HELPER = Path(__file__).resolve().with_name("export_site_match_stats.js")

# Mantido apenas para a implementacao legada abaixo. A execucao principal usa
# diretamente o pipeline do site, cujo trade window oficial e 5 segundos.
DEFAULT_TRADE_WINDOW_MS = 5000


def _strip_quotes(value: str) -> str:
    s = str(value or "").strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1].strip()
    return s


def resolve_user_path(raw: str, base_dir: Path = BASE_DIR) -> Path:
    """Aceita caminho absoluto ou relativo à pasta do script."""
    raw = _strip_quotes(raw).strip()
    raw = raw.replace("/", "\\") if sys.platform.startswith("win") else raw
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = base_dir / p
    return p.resolve()


def build_default_output_path(input_dir: Path) -> Path:
    folder_name = input_dir.name.strip() or "campeonato"
    safe_name = re.sub(r'[^A-Za-z0-9À-ÿ._ -]+', '_', folder_name).strip(' ._-') or "campeonato"
    safe_name = re.sub(r'\s+', '_', safe_name)
    return BASE_DIR / f"analiseMatches_{safe_name}.xlsx"


DEFAULT_TEAMS_XLSX = str(config_hub.TEAMS_XLSX)
DEFAULT_PLAYERS_XLSX = str(config_hub.PLAYERS_XLSX)
DEFAULT_STATE_WINRATES_XLSX = str(config_hub.ROUND_STATE_WINRATES_XLSX)





# ---- FUNÇÃO (ROLE) POR AGENTE ----
AGENT_TO_ROLE = {
    "Brimstone": "Controlador",
    "Viper": "Controlador",
    "Omen": "Controlador",
    "Astra": "Controlador",
    "Harbor": "Controlador",
    "Clove": "Controlador",
    "Miks": "Controlador",
    "Phoenix": "Duelista",
    "Jett": "Duelista",
    "Reyna": "Duelista",
    "Raze": "Duelista",
    "Yoru": "Duelista",
    "Neon": "Duelista",
    "Iso": "Duelista",
    "Waylay": "Duelista",
    "Hush": "Duelista",
    "Sova": "Iniciador",
    "Breach": "Iniciador",
    "Skye": "Iniciador",
    "KAY/O": "Iniciador",
    "Fade": "Iniciador",
    "Gekko": "Iniciador",
    "Tejo": "Iniciador",
    "Killjoy": "Sentinela",
    "Cypher": "Sentinela",
    "Sage": "Sentinela",
    "Chamber": "Sentinela",
    "Deadlock": "Sentinela",
    "Vyse": "Sentinela",
    "Veto": "Sentinela",
}


HEADERS = [
    "Player",
    "Agente",
    "Mapa",
    "KAST",
    "Rounds",
    "R.Ganhos",
    "R.Perdidos",
    "R.KAST",
    "ACS",
    "Kills",
    "Deaths",
    "Assists",
    "KPR",
    "DPR",
    "APR",
    "ADR",
    "FK",
    "FD",
    "1K",
    "2K",
    "3K",
    "4K",
    "5K",
    "Clutches",
    "Imp.Total (pp)",
    "Imp/Round (pp)",
    "rAAting 3.1",
    "rAAting 1.0",
    "Partidas",
]



TOTAL_HEADERS = HEADERS.copy()
TOTAL_HEADERS[2] = "Equipe"


def safe_div(n: float, d: float) -> float:
    return (n / d) if d else 0.0


def riot_id(game_name: Optional[str], tag_line: Optional[str]) -> str:
    gn = (game_name or "").strip()
    tl = (tag_line or "").strip()
    if gn and tl:
        return f"{gn}#{tl}"
    return gn or ""


@dataclass(frozen=True)
class RowRecord:
    team_key: str
    cells: List[Any]
    player_key: str = ""
    current_team: str = ""
    aggregate: Dict[str, float] = field(default_factory=dict)


def iter_json_files(input_dir: Path, recursive: bool) -> Iterable[Path]:
    pattern = "**/*.json" if recursive else "*.json"
    yield from sorted(input_dir.glob(pattern))

def load_match(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        if "matchInfo" not in data or "players" not in data or "roundResults" not in data:
            return None
        return data
    except Exception:
        return None


SITE_AGGREGATE_FIELDS = (
    "rounds",
    "roundWins",
    "roundLosses",
    "score",
    "kills",
    "deaths",
    "assists",
    "damage",
    "kastRounds",
    "kastLegacyRounds",
    "impactTotal",
    "impactTotalLegacy",
    "adjustedRoundSwingTotalPp",
    "eKillPoints",
    "eDeathPoints",
    "eDamageTotal",
    "eKastPoints",
    "tradedDeaths",
    "failedTradeDeaths",
    "tradeKills",
    "tradeDenials",
    "savedLossRounds",
    "survivedWinRounds",
    "multiKillPoints",
    "firstKills",
    "firstDeaths",
    "oneKills",
    "twoKills",
    "threeKills",
    "fourKills",
    "fiveKills",
    "clutches",
)


def run_site_pipeline(input_dir: Path, recursive: bool) -> Dict[str, Any]:
    """Executa o mesmo parser/normalizador usado para gerar o site."""
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js nao encontrado. Ele e necessario para usar o mesmo pipeline do site.")
    if not SITE_PIPELINE_HELPER.exists():
        raise SystemExit(f"Helper do pipeline do site nao encontrado: {SITE_PIPELINE_HELPER}")

    result = subprocess.run(
        [node, str(SITE_PIPELINE_HELPER), str(input_dir), "true" if recursive else "false"],
        cwd=str(config_hub.REPO_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "erro desconhecido").strip()
        raise SystemExit(f"Falha ao executar o pipeline do site:\n{detail}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Saida invalida do pipeline do site: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("Saida invalida do pipeline do site: objeto JSON esperado.")
    global RAATING_CENTER
    RAATING_CENTER = payload.get("raatingCenter")
    return payload


def _numeric_fields(player: Dict[str, Any]) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for name in SITE_AGGREGATE_FIELDS:
        raw = player.get(name, 0)
        try:
            values[name] = float(raw) if raw is not None else 0.0
        except (TypeError, ValueError):
            values[name] = 0.0
    return values


def build_records_from_site_pipeline(payload: Dict[str, Any]) -> List[RowRecord]:
    """Converte as linhas normalizadas do site para o layout historico do XLSX."""
    records: List[RowRecord] = []
    # Mesma ordem do site (app.js: matches.sort por startedAt decrescente). A conta sem
    # cadastro leva o nome da partida mais recente; na ordem dos arquivos, a Aliança 2023.2
    # vinha antes de 2024 e o relatório saía com o nome de hoje (rigas) e o site com o
    # da época (R1645).
    partidas = sorted(payload.get("matches") or [], key=lambda m: -float(m.get("startedAt") or 0))
    for match in partidas:
        filename = str(match.get("fileName") or match.get("sourcePath") or "")
        map_name = str(match.get("mapName") or "")
        for player in match.get("players") or []:
            rounds = int(float(player.get("rounds") or 0))
            if rounds <= 0:
                continue
            aggregate = _numeric_fields(player)
            records.append(
                RowRecord(
                    team_key=str(player.get("teamId") or "").strip(),
                    player_key=str(player.get("id") or player.get("puuid") or player.get("handle") or "").strip(),
                    current_team=str(player.get("currentTeam") or "").strip(),
                    aggregate=aggregate,
                    cells=[
                        str(player.get("nick") or player.get("handle") or "Jogador"),
                        str(player.get("agent") or ""),
                        map_name,
                        float(player.get("kastFrac") or 0),
                        rounds,
                        int(float(player.get("roundWins") or 0)),
                        int(float(player.get("roundLosses") or 0)),
                        int(float(player.get("kastRounds") or 0)),
                        float(player.get("acs") or 0),
                        int(float(player.get("kills") or 0)),
                        int(float(player.get("deaths") or 0)),
                        int(float(player.get("assists") or 0)),
                        float(player.get("kpr") or 0),
                        float(player.get("dpr") or 0),
                        float(player.get("apr") or 0),
                        float(player.get("adr") or 0),
                        int(float(player.get("firstKills") or 0)),
                        int(float(player.get("firstDeaths") or 0)),
                        int(float(player.get("oneKills") or 0)),
                        int(float(player.get("twoKills") or 0)),
                        int(float(player.get("threeKills") or 0)),
                        int(float(player.get("fourKills") or 0)),
                        int(float(player.get("fiveKills") or 0)),
                        int(float(player.get("clutches") or 0)),
                        float(player.get("adjustedRoundSwingTotalPp") or player.get("impactTotal") or 0),
                        float(player.get("impactRound") or 0),
                        float(player.get("raating_3") or player.get("rating") or 0),
                        float(player.get("raating_1") or 0),
                        filename,
                    ],
                )
            )
    return records


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def rAAting_1_0_value(
    kast_frac: float,
    kpr: float,
    dpr: float,
    apr: float,
    adr: float,
    imp_round_pp: float,
) -> float:
    """
    rAAting 1.0 fixo calibrado na base analiseMatches_Todas.

    Escala:
      - mediana da base de calibração = 1.00
      - usa KAST como fração, ex.: 0.6923 para 69,23%
      - usa Imp/Round em pontos percentuais, ex.: 2.50 para +2,50 pp
    """
    z_kpr = clamp((kpr - 0.6941176471) / 0.1941309654, -3.0, 3.0)
    z_adr = clamp((adr - 104.4644808743) / 28.3082643335, -3.0, 3.0)
    z_kast = clamp((kast_frac - 0.6923076923) / 0.0802383950, -3.0, 3.0)
    z_imp = clamp((imp_round_pp + 0.4159106155) / 4.4510585893, -3.0, 3.0)
    z_dpr_inv = -clamp((dpr - 0.7136563877) / 0.0969349482, -3.0, 3.0)
    z_apr = clamp((apr - 0.2588235294) / 0.1203522890, -3.0, 3.0)

    score_wr = (
        0.22 * z_kpr
        + 0.18 * z_adr
        + 0.18 * z_kast
        + 0.17 * z_imp
        + 0.15 * z_dpr_inv
        + 0.10 * z_apr
    )

    rating = 1 + 0.2883448104 * (score_wr - 0.0853107262)
    return clamp(rating, 0.30, 1.80)


# rAAting 3.1 (especificacao de 21/11/2026), igual ao calculateRaating3 do
# raating-core.js: a formula estimada da HLTV com o beta do dano dividido por 1,5,
# e a nota e 1 + soma de beta * (taxa - media do grupo). A media do grupo vem do
# pipeline do site (campo raatingCenter do export_site_match_stats.js), a mesma do build.
RAATING_3_1_BETAS = {
    "abate": 0.4941,
    "sobrevivencia": 0.3795,
    "dano": 0.428 / 1.5,
    "kast": 0.2602,
    "swing": 0.03748,
    "multikill": 0.0241,
}

RAATING_CENTER: Optional[Dict[str, float]] = None


def raating_center() -> Optional[Dict[str, float]]:
    """A media do grupo do ultimo pipeline do site lido (run_site_pipeline)."""
    return RAATING_CENTER


def raating_3_1_value(values: Dict[str, float], center: Optional[Dict[str, float]]) -> float:
    """Porta a nota do raating-core.js (rAAting 3.1). Sem media do grupo, NaN."""
    if not center:
        return float("nan")
    rounds = max(0.0, float(values.get("rounds", 0)))
    if rounds:
        x = {
            "abate": float(values.get("eKillPoints", values.get("kills", 0))) / rounds,
            "sobrevivencia": 1.0 - float(values.get("eDeathPoints", values.get("deaths", 0))) / rounds,
            "dano": float(values.get("eDamageTotal", values.get("damage", 0))) / rounds / 100.0,
            "kast": float(values.get("eKastPoints", values.get("kastRounds", 0))) / rounds,
            "swing": float(values.get("adjustedRoundSwingTotalPp", values.get("impactTotal", 0))) / rounds,
            "multikill": float(values.get("multiKillPoints", 0)) / rounds,
        }
    else:
        x = {parte: 0.0 for parte in RAATING_3_1_BETAS}
    nota = 1.0
    for parte, beta in RAATING_3_1_BETAS.items():
        nota += beta * (x[parte] - float(center[parte]))
    return nota


def sheet_name_safe(name: str) -> str:
    cleaned = re.sub(r"[\[\]\:\*\?\/\\]+", "_", (name or "").strip())
    cleaned = cleaned[:31] if cleaned else "sheet"
    return cleaned


def normalize_team(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == "-":
        return None
    return s


def get_current_team(*team_values: Any) -> Optional[str]:
    """
    Retorna a equipe atual usando a última coluna team N preenchida.

    Compatível com:
      get_current_team(team1, team2)
      get_current_team([team1, team2, team3, ...])
    """
    if len(team_values) == 1 and isinstance(team_values[0], (list, tuple)):
        values = list(team_values[0])
    else:
        values = list(team_values)

    for value in reversed(values):
        team = normalize_team(value)
        if team is not None:
            return team

    return None


def infer_team_for_player(recs: List[RowRecord]) -> str:
    counts: Dict[str, int] = defaultdict(int)
    for r in recs:
        t = (r.current_team or "").strip()
        if t:
            counts[t] += 1
    if not counts:
        return "-"
    return max(counts.items(), key=lambda kv: kv[1])[0]


# ---------- Escrita do Excel ----------

def _write_headers(ws, row_idx: int, headers: List[str] = HEADERS) -> None:
    header_font = Font(bold=True)
    for col_idx, h in enumerate(headers, start=1):
        c = ws.cell(row=row_idx, column=col_idx, value=h)
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")


def _apply_number_formats(ws, start_row: int, end_row: int) -> None:
    # 4  KAST (%)
    # 9  ACS (2dp)
    # 13-16 KPR/DPR/APR/ADR (2dp)
    # 25-26 Impact (2dp)
    # 27 rAAting 3.1 (3dp)
    # 28 rAAting 1.0 (3dp)
    for r in range(start_row, end_row + 1):
        ws.cell(row=r, column=4).number_format = "0.0%"
        ws.cell(row=r, column=9).number_format = "0.00"
        for c in (13, 14, 15, 16):
            ws.cell(row=r, column=c).number_format = "0.00"
        for c in (25, 26):
            ws.cell(row=r, column=c).number_format = "0.00"
        ws.cell(row=r, column=27).number_format = "0.000"
        ws.cell(row=r, column=28).number_format = "0.000"


def _auto_width(ws) -> None:
    max_col = len(HEADERS)
    max_row = ws.max_row
    for col in range(1, max_col + 1):
        max_len = 0
        for row in range(1, max_row + 1):
            v = ws.cell(row=row, column=col).value
            if v is None:
                continue
            max_len = max(max_len, len(str(v)))
        ws.column_dimensions[get_column_letter(col)].width = min(max(10, max_len + 2), 45)


def _to_int(v: Any) -> int:
    try:
        if v is None or (isinstance(v, str) and not v.strip()):
            return 0
        return int(float(v))
    except Exception:
        return 0


def compute_player_summary_cells(player_name: str, recs: List[RowRecord]) -> List[Any]:
    totals = {name: 0.0 for name in SITE_AGGREGATE_FIELDS}
    for rec in recs:
        for name in SITE_AGGREGATE_FIELDS:
            totals[name] += float(rec.aggregate.get(name, 0) or 0)

    total_rounds = int(totals["rounds"])
    total_wins = int(totals["roundWins"])
    total_losses = int(totals["roundLosses"])
    total_rkast = int(totals["kastRounds"])
    total_kills = int(totals["kills"])
    total_deaths = int(totals["deaths"])
    total_assists = int(totals["assists"])
    total_fk = int(totals["firstKills"])
    total_fd = int(totals["firstDeaths"])
    kast_frac = safe_div(float(total_rkast), float(total_rounds))
    acs = safe_div(totals["score"], float(total_rounds))
    kpr = safe_div(float(total_kills), float(total_rounds))
    dpr = safe_div(float(total_deaths), float(total_rounds))
    apr = safe_div(float(total_assists), float(total_rounds))
    adr = safe_div(totals["damage"], float(total_rounds))
    total_imp = totals["adjustedRoundSwingTotalPp"]
    imp_per_round = safe_div(total_imp, float(total_rounds))

    role_rounds: Dict[str, int] = defaultdict(int)
    for rec in recs:
        agent = str(rec.cells[1] or "").strip()
        role = AGENT_TO_ROLE.get(agent, "")
        if role:
            role_rounds[role] += _to_int(rec.cells[4])
    if total_rounds > 0 and role_rounds:
        top_role, top_rounds = max(role_rounds.items(), key=lambda item: item[1])
        main_role = top_role if (top_rounds / total_rounds) > 0.5 else "Flex"
    else:
        main_role = "Flex"

    legacy_kast = safe_div(totals["kastLegacyRounds"], float(total_rounds))
    legacy_impact = safe_div(totals["impactTotalLegacy"], float(total_rounds))
    raa1 = rAAting_1_0_value(legacy_kast, kpr, dpr, apr, adr, legacy_impact)
    raa3 = raating_3_1_value(totals, RAATING_CENTER)

    return [
        player_name,
        main_role,
        "-",
        kast_frac,
        total_rounds,
        total_wins,
        total_losses,
        total_rkast,
        acs,
        total_kills,
        total_deaths,
        total_assists,
        kpr,
        dpr,
        apr,
        adr,
        total_fk,
        total_fd,
        int(totals["oneKills"]),
        int(totals["twoKills"]),
        int(totals["threeKills"]),
        int(totals["fourKills"]),
        int(totals["fiveKills"]),
        int(totals["clutches"]),
        total_imp,
        imp_per_round,
        raa3,
        raa1,
        len(recs),
    ]


def write_all_matches_sheet(ws, records: List[RowRecord]) -> None:
    ws.title = "all_matches"
    _write_headers(ws, 1)
    for rec in records:
        ws.append([config_hub.texto_seguro(c) for c in rec.cells])

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(HEADERS))}{len(records) + 1}"

    if records:
        _apply_number_formats(ws, start_row=2, end_row=len(records) + 1)
    _auto_width(ws)


def write_totals_all_players_sheet(ws, records: List[RowRecord]) -> None:
    ws.title = "stats_total_all_players"
    _write_headers(ws, 1, headers=TOTAL_HEADERS)

    by_player: Dict[str, List[RowRecord]] = defaultdict(list)
    for r in records:
        player_key = (r.player_key or str(r.cells[0] or "")).strip() or "SEM_NOME"
        by_player[player_key].append(r)

    players_sorted = sorted(
        by_player.keys(),
        key=lambda key: str(by_player[key][0].cells[0] or key).casefold(),
    )

    row_cursor = 2
    bold_font = Font(bold=True)

    for player_key in players_sorted:
        recs = by_player[player_key]
        player = str(recs[0].cells[0] or player_key).strip() or "SEM_NOME"
        team = infer_team_for_player(recs)

        summary = compute_player_summary_cells(player, recs)
        summary[2] = team  # coluna 3 agora é Equipe

        for col_idx, v in enumerate(summary, start=1):
            c = ws.cell(row=row_cursor, column=col_idx, value=v)
            c.font = bold_font

        row_cursor += 1

    if row_cursor > 2:
        _apply_number_formats(ws, start_row=2, end_row=row_cursor - 1)
    _auto_width(ws)


def write_team_sheet_per_player(ws, team_name: str, records: List[RowRecord]) -> None:
    ws.title = sheet_name_safe(team_name)

    by_player: Dict[str, List[RowRecord]] = defaultdict(list)
    for r in records:
        player_key = (r.player_key or str(r.cells[0] or "")).strip() or "SEM_NOME"
        by_player[player_key].append(r)

    players_sorted = sorted(
        by_player.keys(),
        key=lambda key: str(by_player[key][0].cells[0] or key).casefold(),
    )

    title_font = Font(bold=True, size=14)
    title_align = Alignment(horizontal="left", vertical="center")
    total_font = Font(bold=True)

    row_cursor = 1
    for player_key in players_sorted:
        recs = by_player[player_key]
        player = str(recs[0].cells[0] or player_key).strip() or "SEM_NOME"

        # título do jogador
        ws.merge_cells(start_row=row_cursor, start_column=1, end_row=row_cursor, end_column=len(HEADERS))
        tc = ws.cell(row=row_cursor, column=1, value=player)
        tc.font = title_font
        tc.alignment = title_align
        row_cursor += 1

        # headers
        _write_headers(ws, row_cursor)
        row_cursor += 1

        # dados
        start_data = row_cursor
        for rec in recs:
            for col_idx, v in enumerate(rec.cells, start=1):
                ws.cell(row=row_cursor, column=col_idx, value=v)
            row_cursor += 1
        end_data = row_cursor - 1

        if end_data >= start_data:
            _apply_number_formats(ws, start_row=start_data, end_row=end_data)

        # TOTAL
        summary_cells = compute_player_summary_cells(player, recs)
        for col_idx, v in enumerate(summary_cells, start=1):
            c = ws.cell(row=row_cursor, column=col_idx, value=v)
            c.font = total_font
        _apply_number_formats(ws, start_row=row_cursor, end_row=row_cursor)
        row_cursor += 1

        row_cursor += 2  # espaço entre tabelas

    _auto_width(ws)


def write_workbook(all_records: List[RowRecord], team_order: List[str], output_path: Path) -> None:
    wb = Workbook()

    # 1) all_matches
    ws_all = wb.active
    write_all_matches_sheet(ws_all, all_records)

    # 2) stats_total_all_players
    ws_tot = wb.create_sheet(title="stats_total_all_players")
    write_totals_all_players_sheet(ws_tot, all_records)

    # 3) Abas de times: cria SOMENTE para times que apareceram nos JSONs analisados.
    #
    # team_order vem de players.xlsx/teams.xlsx e pode conter todos os times cadastrados.
    # Se iterarmos direto nele, o Excel fica cheio de abas vazias.
    # Aqui filtramos pelo team_key presente em pelo menos uma linha gerada a partir dos JSONs.
    teams_with_records: Set[str] = {
        str(r.team_key or "").strip()
        for r in all_records
        if str(r.team_key or "").strip()
    }

    ordered_teams: List[str] = []
    seen_team_keys: Set[str] = set()

    # Mantém a ordem/base vinda dos cadastros quando o time apareceu.
    for team in team_order:
        clean_team = str(team or "").strip()
        if not clean_team or clean_team not in teams_with_records:
            continue
        if clean_team in seen_team_keys:
            continue
        ordered_teams.append(clean_team)
        seen_team_keys.add(clean_team)

    # Inclui qualquer time que apareceu nos JSONs, mas não estava em team_order.
    for team in sorted(teams_with_records - seen_team_keys, key=lambda s: s.casefold()):
        ordered_teams.append(team)

    for team in sorted(ordered_teams, key=lambda s: s.casefold()):
        team_recs = [r for r in all_records if str(r.team_key or "").strip() == team]
        if not team_recs:
            continue

        ws = wb.create_sheet(title=sheet_name_safe(team))
        write_team_sheet_per_player(ws, team, team_recs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)


def open_file_after_save(path: Path) -> None:
    p = str(path)
    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", p], check=False)
        else:
            subprocess.run(["xdg-open", p], check=False)
    except Exception as e:
        print(f"Não foi possível abrir o arquivo automaticamente: {e}")


def main() -> int:
    input_dir = resolve_user_path(DEFAULT_INPUT_DIR)
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Pasta inválida em DEFAULT_INPUT_DIR: {input_dir}")

    if str(DEFAULT_OUTPUT_XLSX or "").strip():
        output_xlsx = resolve_user_path(DEFAULT_OUTPUT_XLSX)
    else:
        output_xlsx = build_default_output_path(input_dir).resolve()

    print("Pasta analisada:", input_dir)
    print("Recursivo:", bool(DEFAULT_RECURSIVE))

    payload = run_site_pipeline(input_dir, recursive=DEFAULT_RECURSIVE)
    json_file_count = int(payload.get("jsonFileCount") or 0)
    if not json_file_count:
        raise SystemExit(f"Nenhum .json encontrado em DEFAULT_INPUT_DIR: {input_dir}")

    print("JSONs encontrados:", json_file_count)
    print("Partidas unicas processadas:", int(payload.get("uniqueMatchCount") or 0))
    print("Kills observadas no modelo economico:", int(payload.get("ecoObservedKills") or 0))

    all_records = build_records_from_site_pipeline(payload)
    if not all_records:
        raise SystemExit("Nenhuma linha de jogador foi gerada pelo pipeline do site.")
    team_order = [str(team) for team in payload.get("teamOrder") or [] if str(team).strip()]
    invalid_files = payload.get("invalidFiles") or []
    duplicate_files = payload.get("duplicateFiles") or []

    write_workbook(all_records, team_order, output_xlsx)
    print(f"Arquivos invalidos/ignorados: {len(invalid_files)}")
    print(f"Partidas duplicadas ignoradas: {len(duplicate_files)}")
    print(f"OK: {len(all_records)} linhas geradas em: {output_xlsx}")

    open_file_after_save(output_xlsx)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
