import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter


# ---- CONFIG PARA RODAR DIRETO NO VS CODE ----
import config_hub
from analiseMatches import SITE_AGGREGATE_FIELDS, raating_3_1_value, raating_center, run_site_pipeline

# A pasta de trabalho fica fora do repo: e la que estao os JSONs brutos e as
# saidas de analise. Ver config_hub.
BASE_DIR = config_hub.TRABALHO_DIR

# Edite esta pasta para o campeonato que você quer analisar.
# Exemplos:
# DEFAULT_INPUT_DIR = str(BASE_DIR / "Finalizados" / "Válidos" / "CIA 2026")
# DEFAULT_INPUT_DIR = str(BASE_DIR / "Finalizados" / "Válidos" / "UNI Ascension")
DEFAULT_INPUT_DIR = str(BASE_DIR / "Finalizados" / "Válidos")

# Se vazio, gera automaticamente: analiseAgentes_<nome_da_pasta>.xlsx
DEFAULT_OUTPUT_XLSX = ""
DEFAULT_RECURSIVE = True
DEFAULT_TRADE_WINDOW_MS = 5000
DEFAULT_STATE_WINRATES_XLSX = str(config_hub.ROUND_STATE_WINRATES_XLSX)
OPEN_FILE_AFTER_SAVE = True





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


SUMMARY_HEADERS = [
    "Agente",
    "Função",
    "Picks",
    "Pickrate",
    "Map Win%",
    "Round Win%",
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
    "FK-FD",
    "1K",
    "2K",
    "3K",
    "4K",
    "5K",
    "Clutches",
    "Imp.Total (pp)",
    "Imp/Round (pp)",
    "rAAting 3.1",
]

MAP_HEADERS = ["Mapa"] + SUMMARY_HEADERS

DETAIL_HEADERS = [
    "Arquivo",
    "Player",
    "Riot ID",
    "Side",
    "Agente",
    "Função",
    "Mapa",
    "Map Win",
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
]


def safe_div(n: float, d: float) -> float:
    return (n / d) if d else 0.0


def resolve_user_path(raw: str, base_dir: Path = BASE_DIR) -> Path:
    s = str(raw or "").strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1].strip()
    p = Path(s).expanduser()
    if not p.is_absolute():
        p = base_dir / p
    return p.resolve()


def build_default_output_path(input_dir: Path) -> Path:
    folder_name = input_dir.name.strip() or "campeonato"
    safe_name = re.sub(r"[^A-Za-z0-9À-ÿ._ -]+", "_", folder_name).strip(" ._-") or "campeonato"
    safe_name = re.sub(r"\s+", "_", safe_name)
    return BASE_DIR / f"analiseAgentes_{safe_name}.xlsx"


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


def riot_id(game_name: Optional[str], tag_line: Optional[str]) -> str:
    gn = (game_name or "").strip()
    tl = (tag_line or "").strip()
    if gn and tl:
        return f"{gn}#{tl}"
    return gn or ""


@dataclass
class AgentPickRecord:
    file_name: str
    player: str
    riot_id: str
    side: str
    agent: str
    role: str
    map_name: str
    map_win: int
    rounds: int
    rounds_won: int
    rounds_lost: int
    kast_rounds: int
    acs: float
    kills: int
    deaths: int
    assists: int
    kpr: float
    dpr: float
    apr: float
    adr: float
    fk: int
    fd: int
    k1: int
    k2: int
    k3: int
    k4: int
    k5: int
    clutches: int
    impact_total: float
    impact_per_round: float
    rating: float
    aggregate: Dict[str, float] = field(default_factory=dict)

    @property
    def kast(self) -> float:
        return safe_div(self.kast_rounds, self.rounds)

    def detail_row(self) -> List[Any]:
        return [
            self.file_name,
            self.player,
            self.riot_id,
            self.side,
            self.agent,
            self.role,
            self.map_name,
            self.map_win,
            self.kast,
            self.rounds,
            self.rounds_won,
            self.rounds_lost,
            self.kast_rounds,
            self.acs,
            self.kills,
            self.deaths,
            self.assists,
            self.kpr,
            self.dpr,
            self.apr,
            self.adr,
            self.fk,
            self.fd,
            self.k1,
            self.k2,
            self.k3,
            self.k4,
            self.k5,
            self.clutches,
            self.impact_total,
            self.impact_per_round,
            self.rating,
        ]


def _site_numeric_fields(player: Dict[str, Any]) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for name in SITE_AGGREGATE_FIELDS:
        raw = player.get(name, 0)
        try:
            values[name] = float(raw) if raw is not None else 0.0
        except (TypeError, ValueError):
            values[name] = 0.0
    return values


def build_agent_records_from_site_pipeline(payload: Dict[str, Any]) -> List[AgentPickRecord]:
    records: List[AgentPickRecord] = []
    for match in payload.get("matches") or []:
        filename = str(match.get("fileName") or match.get("sourcePath") or "")
        map_name = str(match.get("mapName") or "")
        winner_id = str(match.get("winnerId") or "")
        for player in match.get("players") or []:
            rounds = int(float(player.get("rounds") or 0))
            if rounds <= 0:
                continue
            impact_total = float(
                player.get("adjustedRoundSwingTotalPp")
                or player.get("impactTotal")
                or 0
            )
            records.append(
                AgentPickRecord(
                    file_name=filename,
                    player=str(player.get("nick") or player.get("handle") or "Jogador"),
                    riot_id=str(player.get("handle") or ""),
                    side=str(player.get("teamColor") or ""),
                    agent=str(player.get("agent") or ""),
                    role=str(player.get("agentClass") or "DESCONHECIDO"),
                    map_name=map_name,
                    map_win=int(bool(winner_id) and str(player.get("teamId") or "") == winner_id),
                    rounds=rounds,
                    rounds_won=int(float(player.get("roundWins") or 0)),
                    rounds_lost=int(float(player.get("roundLosses") or 0)),
                    kast_rounds=int(float(player.get("kastRounds") or 0)),
                    acs=float(player.get("acs") or 0),
                    kills=int(float(player.get("kills") or 0)),
                    deaths=int(float(player.get("deaths") or 0)),
                    assists=int(float(player.get("assists") or 0)),
                    kpr=float(player.get("kpr") or 0),
                    dpr=float(player.get("dpr") or 0),
                    apr=float(player.get("apr") or 0),
                    adr=float(player.get("adr") or 0),
                    fk=int(float(player.get("firstKills") or 0)),
                    fd=int(float(player.get("firstDeaths") or 0)),
                    k1=int(float(player.get("oneKills") or 0)),
                    k2=int(float(player.get("twoKills") or 0)),
                    k3=int(float(player.get("threeKills") or 0)),
                    k4=int(float(player.get("fourKills") or 0)),
                    k5=int(float(player.get("fiveKills") or 0)),
                    clutches=int(float(player.get("clutches") or 0)),
                    impact_total=impact_total,
                    impact_per_round=safe_div(impact_total, rounds),
                    rating=float(player.get("raating_3") or player.get("rating") or 0),
                    aggregate=_site_numeric_fields(player),
                )
            )
    return records


# ---------------- Agregação ----------------

def aggregate_records(records: List[AgentPickRecord], pickrate_denominator: int, agent_name: str, role: str) -> List[Any]:
    picks = len(records)
    totals = {name: 0.0 for name in SITE_AGGREGATE_FIELDS}
    for record in records:
        for name in SITE_AGGREGATE_FIELDS:
            totals[name] += float(record.aggregate.get(name, 0) or 0)

    total_rounds = int(totals["rounds"])
    total_wins = int(totals["roundWins"])
    total_losses = int(totals["roundLosses"])
    total_kast = int(totals["kastRounds"])
    total_kills = int(totals["kills"])
    total_deaths = int(totals["deaths"])
    total_assists = int(totals["assists"])
    total_fk = int(totals["firstKills"])
    total_fd = int(totals["firstDeaths"])
    total_1k = int(totals["oneKills"])
    total_2k = int(totals["twoKills"])
    total_3k = int(totals["threeKills"])
    total_4k = int(totals["fourKills"])
    total_5k = int(totals["fiveKills"])
    total_clutches = int(totals["clutches"])
    total_impact = totals["adjustedRoundSwingTotalPp"]
    map_wins = sum(r.map_win for r in records)

    acs = safe_div(totals["score"], total_rounds)
    adr = safe_div(totals["damage"], total_rounds)
    kast = safe_div(total_kast, total_rounds)
    kpr = safe_div(total_kills, total_rounds)
    dpr = safe_div(total_deaths, total_rounds)
    apr = safe_div(total_assists, total_rounds)
    imp_pr = safe_div(total_impact, total_rounds)
    rtg = raating_3_1_value(totals, raating_center())

    return [
        agent_name,
        role,
        picks,
        safe_div(picks, pickrate_denominator),
        safe_div(map_wins, picks),
        safe_div(total_wins, total_rounds),
        kast,
        total_rounds,
        total_wins,
        total_losses,
        total_kast,
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
        total_fk - total_fd,
        total_1k,
        total_2k,
        total_3k,
        total_4k,
        total_5k,
        total_clutches,
        total_impact,
        imp_pr,
        rtg,
    ]


def aggregate_role_records(records: List[AgentPickRecord], pickrate_denominator: int, role_name: str) -> List[Any]:
    # Reutiliza formato de summary; coluna Agente recebe nome da função.
    return aggregate_records(records, pickrate_denominator, role_name, role_name)


# ---------------- Excel ----------------

def write_headers(ws, headers: List[str]) -> None:
    header_font = Font(bold=True)
    for col_idx, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=col_idx, value=h)
        c.font = header_font
        c.alignment = Alignment(horizontal="center", vertical="center")


def apply_summary_formats(ws, start_row: int, end_row: int, offset: int = 0) -> None:
    if end_row < start_row:
        return
    # SUMMARY_HEADERS columns, with optional offset for Map in agent_by_map.
    pct_cols = [4, 5, 6, 7]
    decimal_2_cols = [12, 16, 17, 18, 19, 29, 30]
    rating_col = 31

    for r in range(start_row, end_row + 1):
        for c in pct_cols:
            ws.cell(row=r, column=c + offset).number_format = "0.0%"
        for c in decimal_2_cols:
            ws.cell(row=r, column=c + offset).number_format = "0.00"
        ws.cell(row=r, column=rating_col + offset).number_format = "0.000"


def apply_detail_formats(ws, start_row: int, end_row: int) -> None:
    if end_row < start_row:
        return
    for r in range(start_row, end_row + 1):
        ws.cell(row=r, column=9).number_format = "0.0%"   # KAST
        ws.cell(row=r, column=14).number_format = "0.00"  # ACS
        for c in (18, 19, 20, 21, 30, 31):
            ws.cell(row=r, column=c).number_format = "0.00"
        ws.cell(row=r, column=32).number_format = "0.000"


def auto_width(ws) -> None:
    for col in range(1, ws.max_column + 1):
        max_len = 0
        for row in range(1, ws.max_row + 1):
            v = ws.cell(row=row, column=col).value
            if v is None:
                continue
            max_len = max(max_len, len(str(v)))
        ws.column_dimensions[get_column_letter(col)].width = min(max(10, max_len + 2), 45)


def write_workbook(records: List[AgentPickRecord], output_path: Path) -> None:
    wb = Workbook()
    total_picks = len(records)

    # 1) agent_summary
    ws = wb.active
    ws.title = "agent_summary"
    write_headers(ws, SUMMARY_HEADERS)

    by_agent: Dict[str, List[AgentPickRecord]] = defaultdict(list)
    for r in records:
        by_agent[r.agent].append(r)

    rows = []
    for agent, recs in by_agent.items():
        role = AGENT_TO_ROLE.get(agent, recs[0].role if recs else "DESCONHECIDO")
        rows.append(aggregate_records(recs, total_picks, agent, role))
    rows.sort(key=lambda row: (-row[2], row[0].casefold()))
    for row in rows:
        ws.append(row)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(SUMMARY_HEADERS))}{ws.max_row}"
    apply_summary_formats(ws, 2, ws.max_row)
    auto_width(ws)

    # 2) agent_by_map
    ws_map = wb.create_sheet("agent_by_map")
    write_headers(ws_map, MAP_HEADERS)
    by_agent_map: Dict[Tuple[str, str], List[AgentPickRecord]] = defaultdict(list)
    for r in records:
        by_agent_map[(r.map_name, r.agent)].append(r)
    map_rows = []
    for (map_name, agent), recs in by_agent_map.items():
        role = AGENT_TO_ROLE.get(agent, recs[0].role if recs else "DESCONHECIDO")
        map_rows.append([map_name] + aggregate_records(recs, total_picks, agent, role))
    map_rows.sort(key=lambda row: (str(row[0]).casefold(), -row[3], str(row[1]).casefold()))
    for row in map_rows:
        ws_map.append(row)
    ws_map.freeze_panes = "A2"
    ws_map.auto_filter.ref = f"A1:{get_column_letter(len(MAP_HEADERS))}{ws_map.max_row}"
    apply_summary_formats(ws_map, 2, ws_map.max_row, offset=1)
    auto_width(ws_map)

    # 3) role_summary
    ws_role = wb.create_sheet("role_summary")
    write_headers(ws_role, SUMMARY_HEADERS)
    by_role: Dict[str, List[AgentPickRecord]] = defaultdict(list)
    for r in records:
        by_role[r.role].append(r)
    role_rows = []
    for role, recs in by_role.items():
        role_rows.append(aggregate_role_records(recs, total_picks, role))
    role_rows.sort(key=lambda row: (-row[2], row[0].casefold()))
    for row in role_rows:
        ws_role.append(row)
    ws_role.freeze_panes = "A2"
    ws_role.auto_filter.ref = f"A1:{get_column_letter(len(SUMMARY_HEADERS))}{ws_role.max_row}"
    apply_summary_formats(ws_role, 2, ws_role.max_row)
    auto_width(ws_role)

    # 4) raw_picks
    ws_raw = wb.create_sheet("raw_picks")
    write_headers(ws_raw, DETAIL_HEADERS)
    for r in sorted(records, key=lambda x: (x.file_name.casefold(), x.agent.casefold(), x.player.casefold())):
        ws_raw.append([config_hub.texto_seguro(v) for v in r.detail_row()])
    ws_raw.freeze_panes = "A2"
    ws_raw.auto_filter.ref = f"A1:{get_column_letter(len(DETAIL_HEADERS))}{ws_raw.max_row}"
    apply_detail_formats(ws_raw, 2, ws_raw.max_row)
    auto_width(ws_raw)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)


def open_file_after_save(path: Path) -> None:
    if not OPEN_FILE_AFTER_SAVE:
        return
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
        raise SystemExit(f"Pasta inválida: {input_dir}")

    output_xlsx = resolve_user_path(DEFAULT_OUTPUT_XLSX) if DEFAULT_OUTPUT_XLSX else build_default_output_path(input_dir)
    payload = run_site_pipeline(input_dir, recursive=DEFAULT_RECURSIVE)
    all_records = build_agent_records_from_site_pipeline(payload)

    if not all_records:
        raise SystemExit(f"Nenhuma linha de agente foi gerada. Verifique a pasta: {input_dir}")

    write_workbook(all_records, output_xlsx)

    unique_agents = len({r.agent for r in all_records})
    unique_maps = len({r.map_name for r in all_records})
    print("Input:", input_dir)
    print("JSONs encontrados:", int(payload.get("jsonFileCount") or 0))
    print("Partidas unicas processadas:", int(payload.get("uniqueMatchCount") or 0))
    print("JSONs invalidos/ignorados:", len(payload.get("invalidFiles") or []))
    print("Partidas duplicadas ignoradas:", len(payload.get("duplicateFiles") or []))
    print("Picks analisados:", len(all_records))
    print("Agentes encontrados:", unique_agents)
    print("Mapas encontrados:", unique_maps)
    print("Output:", output_xlsx)

    open_file_after_save(output_xlsx)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
