"""
PegaPlayerMatch.py

Versão direcionada do PegaCustomMatch: em vez de resolver e buscar a matchlist
de TODOS os jogadores do players.xlsx, consulta a API apenas para os
jogadores-alvo informados. Muito mais rápido quando você já sabe quem procurar.

Como usar:
  python PegaPlayerMatch.py "Fulano" "nick#TAG"
  python PegaPlayerMatch.py "Fulano" --inicio 2026-07-01 --fim 2026-07-18
  (ou preencha TARGET_PLAYERS abaixo e rode sem argumentos)

Cada alvo pode ser:
  - um nome da coluna Jogador do players.xlsx (não diferencia acento/maiúscula);
  - um Riot ID no formato nome#tag (mesmo que não esteja na planilha);
  - um PUUID (78 caracteres).

Os demais jogadores da planilha NÃO geram chamadas à API: apenas os PUUIDs já
salvos na coluna puuid são usados para reconhecer e nomear os times nas
partidas encontradas. Se muitos jogadores estiverem sem PUUID salvo, rode o
PegaCustomMatch uma vez para preencher a coluna.

O players.xlsx nunca é alterado por este script.
"""

import argparse
import json
import shutil
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Set, Tuple

import PegaCustomMatch as pcm
import config_hub


# =========================
# CONFIG
# =========================
# Alvos padrão quando o script roda sem argumentos na linha de comando.
TARGET_PLAYERS: List[str] = [
    # Exemplos:
    
    # "Fulano",        # nome da coluna Jogador do players.xlsx
    # "nick#BR1",      # Riot ID direto (não precisa estar na planilha)
]

OUTPUT_DIR_NAME = "out_player_search"

# Filtro de data ("YYYY-MM-DD", inclusivo). None = sem limite.
# Pode ser sobrescrito com --inicio / --fim na linha de comando.
FILTER_START_DATE: Optional[str] = None
FILTER_END_DATE: Optional[str] = None

LOOKBACK_PER_PLAYER = 120
MAX_MATCHES_TO_FETCH = 800

# Uma partida vira candidata se aparecer na matchlist de pelo menos N alvos.
# Com alvos escolhidos a dedo, 1 já basta.
MIN_TARGET_PLAYERS_IN_MATCHLIST = 1

# Depois de baixar o payload, exige pelo menos N alvos jogando na partida.
MIN_TARGET_PLAYERS_IN_MATCH_PAYLOAD = 1

# Mesmos filtros de qualidade do PegaCustomMatch.
REQUIRE_CUSTOM_BOMB_GAME = True
REQUIRE_COMPLETED_MATCH = True
MIN_ACTIVE_PLAYERS_PER_SIDE = 5
REQUIRE_WINNER_MIN_ROUNDS = True
MIN_WINNING_ROUNDS = 13

# Identificação de time para o nome do arquivo (>= N jogadores conhecidos do
# mesmo time no mesmo lado). Lados sem time identificado viram "unknown".
MIN_TEAM_PLAYERS_TO_IDENTIFY = 3


# =========================
# Helpers
# =========================
def player_label_from_key(player_key: str) -> str:
    """Extrai o nome legível de um player_key no formato 'Nome|rowN'."""
    return player_key.rsplit("|row", 1)[0]


def parse_date_or_none(value: Optional[str], flag_name: str) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ("none", "sem", "-"):
        return None
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise SystemExit(f"Data inválida em {flag_name}: {s!r}. Use o formato YYYY-MM-DD.")
    return s


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Coleta partidas custom (mesmos filtros do PegaCustomMatch) buscando "
            "a matchlist apenas dos jogadores-alvo informados."
        )
    )
    parser.add_argument(
        "players",
        nargs="*",
        help="Alvos: nome da coluna Jogador, Riot ID (nome#tag) ou PUUID. "
             "Se omitido, usa TARGET_PLAYERS do topo do script.",
    )
    parser.add_argument("--inicio", default=None, help="Data inicial YYYY-MM-DD (inclusivo).")
    parser.add_argument("--fim", default=None, help="Data final YYYY-MM-DD (inclusivo).")
    parser.add_argument(
        "--min-matchlist", type=int, default=None,
        help=f"Mínimo de alvos com a partida na matchlist (padrão: {MIN_TARGET_PLAYERS_IN_MATCHLIST}).",
    )
    parser.add_argument(
        "--min-na-partida", type=int, default=None,
        help=f"Mínimo de alvos jogando na partida baixada (padrão: {MIN_TARGET_PLAYERS_IN_MATCH_PAYLOAD}).",
    )
    parser.add_argument(
        "--lookback", type=int, default=None,
        help=f"Quantas entradas de matchlist considerar por alvo (padrão: {LOOKBACK_PER_PLAYER}).",
    )
    parser.add_argument(
        "--max-partidas", type=int, default=None,
        help=f"Máximo de partidas para baixar por execução (padrão: {MAX_MATCHES_TO_FETCH}).",
    )
    return parser.parse_args()


# =========================
# Resolução dos alvos
# =========================
def resolve_targets(
    raw_targets: List[str],
    player_to_riotids: Dict[str, List[str]],
    player_to_current_team: Dict[str, Optional[str]],
    player_to_existing_puuid: Dict[str, Optional[str]],
    client: "pcm.RiotClient",
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Converte cada alvo (nome, Riot ID ou PUUID) em PUUID.

    Só chama a API quando necessário:
      - linha da planilha com PUUID salvo -> usa o salvo, sem API;
      - linha sem PUUID salvo -> resolve pelos nicks da linha;
      - Riot ID fora da planilha -> resolve direto na API;
      - PUUID -> usa como está.

    Retorna:
      - resolved: puuid -> {label, source, playerKey, currentTeam}
      - unresolved: lista de alvos que falharam, com motivo
    """
    name_lookup: Dict[str, List[str]] = defaultdict(list)
    for pk in player_to_riotids:
        name_lookup[pcm._fold_ascii(player_label_from_key(pk))].append(pk)

    riotid_to_player_key: Dict[str, str] = {}
    for pk, riotids in player_to_riotids.items():
        for rid in riotids:
            norm = pcm.normalize_riot_id_for_compare(rid)
            if norm:
                riotid_to_player_key.setdefault(norm, pk)

    stored_puuid_to_player_key = {
        puuid: pk for pk, puuid in player_to_existing_puuid.items() if puuid
    }

    resolved: Dict[str, Dict[str, Any]] = {}
    unresolved: List[Dict[str, Any]] = []

    def add_resolved(puuid: str, label: str, source: str, player_key: Optional[str]):
        if puuid in resolved:
            print(f"[INFO] Alvo repetido ignorado: {label} (mesmo PUUID de {resolved[puuid]['label']})")
            return
        resolved[puuid] = {
            "label": label,
            "source": source,
            "playerKey": player_key,
            "currentTeam": player_to_current_team.get(player_key) if player_key else None,
        }

    def resolve_row_puuid(pk: str) -> Optional[str]:
        stored = player_to_existing_puuid.get(pk)
        if stored:
            return stored
        for rid in player_to_riotids.get(pk, []):
            gn, tg = pcm.parse_riot_id(rid)
            try:
                acc = client.get_account_by_riot_id(gn, tg)
            except pcm.RiotHttpError as e:
                if e.status_code == 404:
                    continue
                raise
            puuid = pcm.normalize_puuid(acc.get("puuid"))
            if puuid:
                return puuid
        return None

    for raw in raw_targets:
        s = str(raw).strip()
        if not s:
            continue

        # 1) PUUID direto
        if pcm.is_probably_puuid(s):
            pk = stored_puuid_to_player_key.get(s)
            label = player_label_from_key(pk) if pk else f"{s[:12]}..."
            add_resolved(s, label, "puuid_direto", pk)
            continue

        # 2) Riot ID (nome#tag)
        if "#" in s:
            norm = pcm.normalize_riot_id_for_compare(s)
            pk = riotid_to_player_key.get(norm) if norm else None
            if pk:
                puuid = resolve_row_puuid(pk)
                if puuid:
                    add_resolved(puuid, player_label_from_key(pk), "riot_id_na_planilha", pk)
                else:
                    unresolved.append({
                        "target": s,
                        "reason": "linha encontrada na planilha, mas sem PUUID resolvível",
                        "riotIdsTentados": player_to_riotids.get(pk, []),
                    })
                continue

            try:
                gn, tg = pcm.parse_riot_id(s)
            except ValueError as e:
                unresolved.append({"target": s, "reason": f"Riot ID inválido: {e}"})
                continue

            try:
                acc = client.get_account_by_riot_id(gn, tg)
            except pcm.RiotHttpError as e:
                if e.status_code == 404:
                    unresolved.append({"target": s, "reason": "Riot ID não encontrado na API (404)"})
                    continue
                raise

            puuid = pcm.normalize_puuid(acc.get("puuid"))
            if puuid:
                add_resolved(puuid, pcm.account_to_riot_id(acc) or s, "riot_id_api", None)
            else:
                unresolved.append({"target": s, "reason": "API não retornou PUUID para o Riot ID"})
            continue

        # 3) Nome da coluna Jogador
        folded = pcm._fold_ascii(s)
        pks = list(name_lookup.get(folded, []))

        if not pks and folded:
            partial = sorted({
                pk
                for key, keys in name_lookup.items()
                if folded in key
                for pk in keys
            })
            if len(partial) == 1:
                pks = partial
                print(f"[INFO] Alvo {s!r} casou por aproximação com {player_label_from_key(partial[0])!r}.")
            elif partial:
                unresolved.append({
                    "target": s,
                    "reason": "nome ambíguo na planilha",
                    "candidatos": sorted({player_label_from_key(pk) for pk in partial}),
                })
                continue

        if not pks:
            unresolved.append({"target": s, "reason": "nome não encontrado na coluna Jogador"})
            continue

        for pk in pks:
            puuid = resolve_row_puuid(pk)
            if puuid:
                add_resolved(puuid, player_label_from_key(pk), "nome_na_planilha", pk)
            else:
                unresolved.append({
                    "target": s,
                    "reason": f"não consegui resolver PUUID de {pk}",
                    "riotIdsTentados": player_to_riotids.get(pk, []),
                })

    return resolved, unresolved


# =========================
# Main
# =========================
def main():
    args = parse_args()

    raw_targets = [str(p) for p in (args.players if args.players else TARGET_PLAYERS)]
    raw_targets = [t for t in raw_targets if str(t).strip()]
    if not raw_targets:
        raise SystemExit(
            "Nenhum alvo informado. Passe jogadores na linha de comando "
            "(ex.: python PegaPlayerMatch.py \"Fulano\" \"nick#TAG\") "
            "ou preencha TARGET_PLAYERS no topo do script."
        )

    start_date = parse_date_or_none(args.inicio, "--inicio") if args.inicio is not None else FILTER_START_DATE
    end_date = parse_date_or_none(args.fim, "--fim") if args.fim is not None else FILTER_END_DATE

    # O filtro de data do PegaCustomMatch é lido de globais do módulo;
    # sobrescreve com o período desta execução.
    pcm.FILTER_START_MS = pcm._date_to_epoch_ms(start_date, end_of_day=False)
    pcm.FILTER_END_MS_EXCLUSIVE = pcm._date_to_epoch_ms(end_date, end_of_day=True)

    min_matchlist = args.min_matchlist if args.min_matchlist is not None else MIN_TARGET_PLAYERS_IN_MATCHLIST
    min_in_payload = args.min_na_partida if args.min_na_partida is not None else MIN_TARGET_PLAYERS_IN_MATCH_PAYLOAD
    lookback = args.lookback if args.lookback is not None else LOOKBACK_PER_PLAYER
    max_matches = args.max_partidas if args.max_partidas is not None else MAX_MATCHES_TO_FETCH

    base_dir = pcm._base_dir()
    output_dir = base_dir / OUTPUT_DIR_NAME
    pcm.ensure_dirs(output_dir)

    matches_dir = output_dir / "matches"
    history_dir = base_dir / "Finalizados"
    history_dir.mkdir(parents=True, exist_ok=True)

    xlsx_path = config_hub.PLAYERS_XLSX
    (
        _teams_to_players,
        player_to_riotids,
        player_to_current_team,
        player_to_existing_puuid,
        _player_key_to_row,
        player_to_alt_puuids,
    ) = pcm.load_players_from_xlsx(xlsx_path)

    print("Base dir:", base_dir)
    print("Output dir:", output_dir)
    print("Filtro de data:", start_date or "sem limite", "->", end_date or "sem limite")
    print("Alvos informados:", len(raw_targets))
    print("Jogadores carregados do Excel:", len(player_to_riotids))

    client = pcm.RiotClient(pcm.RIOT_API_KEY, pcm.VAL_REGION, pcm.RIOT_ROUTING)

    # 1) Resolve os alvos (API apenas quando necessário)
    targets, unresolved_targets = resolve_targets(
        raw_targets=raw_targets,
        player_to_riotids=player_to_riotids,
        player_to_current_team=player_to_current_team,
        player_to_existing_puuid=player_to_existing_puuid,
        client=client,
    )

    for item in unresolved_targets:
        print(f"[WARNING] Alvo não resolvido: {item['target']} ({item['reason']})")
        if item.get("candidatos"):
            print("          Candidatos na planilha:", ", ".join(item["candidatos"]))

    if not targets:
        pcm.save_json(output_dir / "unresolved_targets.json", unresolved_targets)
        raise SystemExit("Nenhum alvo foi resolvido para PUUID. Não é possível continuar.")

    target_puuid_set: Set[str] = set(targets.keys())
    print("Alvos resolvidos:", ", ".join(sorted(t["label"] for t in targets.values())))

    # 2) Pool de jogadores conhecidos: PUUIDs já salvos na planilha + alvos.
    # Nenhuma chamada à API é feita para os não-alvos.
    puuid_to_player_key: Dict[str, str] = {
        puuid: pk for pk, puuid in player_to_existing_puuid.items() if puuid
    }
    for puuid, info in targets.items():
        if info.get("playerKey"):
            puuid_to_player_key.setdefault(puuid, info["playerKey"])

    # Contas alternativas ("puuid N") apontam para o mesmo dono, para que quem
    # entra de conta secundaria continue contando na deteccao de equipe.
    for pk, alt_puuids in player_to_alt_puuids.items():
        for alt_puuid in alt_puuids:
            puuid_to_player_key.setdefault(alt_puuid, pk)

    known_puuid_set: Set[str] = set(puuid_to_player_key.keys()) | target_puuid_set

    puuid_to_team: Dict[str, str] = {}
    for puuid, pk in puuid_to_player_key.items():
        team = player_to_current_team.get(pk)
        if team is not None:
            puuid_to_team[puuid] = team

    rows_without_stored_puuid = sum(
        1 for pk in player_to_riotids if not player_to_existing_puuid.get(pk)
    )
    print("Jogadores conhecidos (PUUID salvo na planilha + alvos):", len(known_puuid_set))
    if rows_without_stored_puuid:
        print(
            f"[INFO] {rows_without_stored_puuid} jogador(es) da planilha sem PUUID salvo "
            f"não serão reconhecidos nas partidas. Rode o PegaCustomMatch para preencher a coluna puuid."
        )

    pcm.save_json(output_dir / "resolved_targets.json", {
        "targets": {puuid: info for puuid, info in targets.items()},
        "unresolvedTargets": unresolved_targets,
        "filterStartDate": start_date,
        "filterEndDate": end_date,
    })

    # 3) Matchlists apenas dos alvos
    match_to_targets_seen: Dict[str, Set[str]] = defaultdict(set)

    def fetch_matchlist(puuid: str) -> Tuple[str, List[Dict[str, Any]]]:
        ml = client.get_matchlist_by_puuid(puuid)
        hist = ml.get("history") or []
        if not isinstance(hist, list):
            hist = []
        hist = [h for h in hist if pcm.is_in_date_range(h.get("gameStartTimeMillis"))]
        return puuid, hist[:lookback]

    with ThreadPoolExecutor(max_workers=max(1, min(pcm.MAX_WORKERS, len(target_puuid_set)))) as ex:
        futures = [ex.submit(fetch_matchlist, p) for p in target_puuid_set]
        for f in as_completed(futures):
            puuid, hist = f.result()
            pcm.save_json(output_dir / "matchlists" / f"{puuid}.json", {"puuid": puuid, "history": hist})
            for h in hist:
                mid = h.get("matchId")
                if isinstance(mid, str) and mid:
                    match_to_targets_seen[mid].add(puuid)

    # 4) Candidatas por sobreposição de matchlist dos alvos
    candidates = sorted(
        [(mid, len(puuids)) for mid, puuids in match_to_targets_seen.items() if len(puuids) >= min_matchlist],
        key=lambda x: x[1],
        reverse=True,
    )

    pcm.save_json(
        output_dir / "candidates_by_target_matchlist.json",
        [{"matchId": mid, "targetsWithMatch": cnt} for mid, cnt in candidates],
    )

    # Dedupe contra o histórico (Finalizados, recursivo) e limpeza de duplicatas locais.
    history_index = pcm.load_existing_match_index_all_history(history_dir)
    duplicate_backup_dir = output_dir / pcm.DUPLICATE_MATCHES_DIR_NAME
    local_match_index, initial_duplicate_report = pcm.dedupe_matches_dir_by_match_id(matches_dir, duplicate_backup_dir)
    existing_lock = Lock()

    candidate_match_ids = [mid for mid, _ in candidates][:max_matches]
    candidate_match_ids = [
        mid for mid in candidate_match_ids
        if mid not in history_index or mid in local_match_index
    ]

    print("Já existentes em /Finalizados:", len(history_index))
    print("Já existentes em /" + OUTPUT_DIR_NAME + "/matches:", len(local_match_index))
    print(f"Candidatas (em >= {min_matchlist} matchlist(s) de alvo):", len(candidates))
    print("Candidatas após dedupe com o histórico:", len(candidate_match_ids))

    # 5) Baixa, valida e salva cada candidata
    report: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    def detect_teams_in_match(match: Dict[str, Any]) -> List[Dict[str, Any]]:
        players = match.get("players") or []
        if not isinstance(players, list):
            return []

        active_players = [
            p for p in players
            if isinstance(p, dict) and not bool(p.get("isObserver", False))
        ]

        group: Dict[Tuple[str, str], List[str]] = defaultdict(list)
        for p in active_players:
            puuid = p.get("puuid")
            team_id = p.get("teamId")

            if not isinstance(puuid, str) or puuid not in known_puuid_set:
                continue
            if not isinstance(team_id, str):
                continue

            tname = puuid_to_team.get(puuid)
            if not tname:
                continue

            group[(tname, team_id)].append(puuid)

        detected: List[Dict[str, Any]] = []
        for (tname, team_id), puuids in group.items():
            unique = sorted(set(puuids))
            if len(unique) >= MIN_TEAM_PLAYERS_TO_IDENTIFY:
                players_readable = [
                    player_label_from_key(puuid_to_player_key[p]) if p in puuid_to_player_key else p
                    for p in unique
                ]
                detected.append({
                    "teamName": tname,
                    "teamId": team_id,
                    "players": sorted(players_readable),
                    "playerCount": len(unique),
                })

        return sorted(detected, key=lambda x: (x["teamName"], -x["playerCount"]))

    def build_match_record(
        mid: str,
        match: Dict[str, Any],
        source: str,
        current_file_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        mi = match.get("matchInfo") or {}
        if not pcm.is_in_date_range(mi.get("gameStartMillis")):
            return {
                "matchId": mid,
                "saved": False,
                "source": source,
                "currentFileName": current_file_name,
                "reason": "outside_date_range",
                **pcm.match_type_info(match),
            }

        if REQUIRE_CUSTOM_BOMB_GAME and not pcm.is_custom_bomb_game(match):
            return pcm.reject_non_custom_bomb_record(
                mid=mid,
                match=match,
                source=source,
                current_file_name=current_file_name,
            )

        players = match.get("players") or []
        if not isinstance(players, list):
            players = []

        active = [
            p for p in players
            if isinstance(p, dict) and not bool(p.get("isObserver", False))
        ]

        active_players_by_side = {"Blue": 0, "Red": 0}
        for p in active:
            side = p.get("teamId")
            if side in active_players_by_side:
                active_players_by_side[str(side)] += 1

        is_completed = bool(mi.get("isCompleted", False))
        blue_active_count = active_players_by_side["Blue"]
        red_active_count = active_players_by_side["Red"]

        if (
            REQUIRE_COMPLETED_MATCH
            and (
                not is_completed
                or blue_active_count < MIN_ACTIVE_PLAYERS_PER_SIDE
                or red_active_count < MIN_ACTIVE_PLAYERS_PER_SIDE
            )
        ):
            return {
                "matchId": mid,
                "saved": False,
                "source": source,
                "currentFileName": current_file_name,
                "reason": (
                    f"incomplete_match("
                    f"isCompleted={is_completed},"
                    f"Blue={blue_active_count},Red={red_active_count},"
                    f"minimum={MIN_ACTIVE_PLAYERS_PER_SIDE})"
                ),
                "isCompleted": mi.get("isCompleted"),
                "activePlayersBySide": {
                    "Blue": blue_active_count,
                    "Red": red_active_count,
                },
                **pcm.match_type_info(match),
            }

        rounds_won_by_side = pcm.get_rounds_won_by_side(match)
        winning_rounds = pcm.get_winning_rounds(match)
        if REQUIRE_WINNER_MIN_ROUNDS and winning_rounds < MIN_WINNING_ROUNDS:
            return {
                "matchId": mid,
                "saved": False,
                "source": source,
                "currentFileName": current_file_name,
                "reason": (
                    f"winner_below_min_rounds("
                    f"winnerRounds={winning_rounds},"
                    f"minimum={MIN_WINNING_ROUNDS},"
                    f"roundsBySide={rounds_won_by_side})"
                ),
                "roundsWonBySide": rounds_won_by_side,
                "winningRounds": winning_rounds,
                "minimumWinningRounds": MIN_WINNING_ROUNDS,
                **pcm.match_type_info(match),
            }

        target_puuids_in_match = {
            p.get("puuid") for p in active
            if isinstance(p.get("puuid"), str) and p.get("puuid") in target_puuid_set
        }
        if len(target_puuids_in_match) < min_in_payload:
            return {
                "matchId": mid,
                "saved": False,
                "source": source,
                "currentFileName": current_file_name,
                "reason": f"payload_has_{len(target_puuids_in_match)}_target_players(minimum={min_in_payload})",
            }

        known_puuids_in_match = {
            p.get("puuid") for p in active
            if isinstance(p.get("puuid"), str) and p.get("puuid") in known_puuid_set
        }

        detected_teams = detect_teams_in_match(match)

        return {
            "matchId": mid,
            "saved": True,
            "source": source,
            "currentFileName": current_file_name,
            "targetPlayersInMatch": sorted(
                targets[p]["label"] for p in target_puuids_in_match if p in targets
            ),
            "targetPlayersInMatchCount": len(target_puuids_in_match),
            "knownPlayersInMatchCount": len(known_puuids_in_match),
            "activePlayersBySide": {
                "Blue": blue_active_count,
                "Red": red_active_count,
            },
            "gameStartMillis": mi.get("gameStartMillis"),
            "mapId": mi.get("mapId"),
            "provisioningFlowId": mi.get("provisioningFlowId"),
            "queueId": mi.get("queueId"),
            "gameMode": mi.get("gameMode"),
            "isCompleted": mi.get("isCompleted"),
            "customGameName": mi.get("customGameName"),
            "roundsWonBySide": rounds_won_by_side,
            "winningRounds": winning_rounds,
            "detectedTeams": detected_teams,
        }

    def process_match(mid: str) -> Dict[str, Any]:
        with existing_lock:
            local_file_name = local_match_index.get(mid)

        if local_file_name:
            local_path = matches_dir / local_file_name
            try:
                local_match = json.loads(local_path.read_text(encoding="utf-8"))
            except Exception as e:
                return {
                    "matchId": mid,
                    "saved": False,
                    "reason": f"failed_to_read_existing_local_file({local_file_name}): {e}",
                }

            return build_match_record(
                mid=mid,
                match=local_match,
                source="existing_local",
                current_file_name=local_file_name,
            )

        with existing_lock:
            if mid in history_index:
                return {
                    "matchId": mid,
                    "saved": False,
                    "skipped": True,
                    "reason": f"already_in_history({history_index[mid]})",
                }

        out_path = matches_dir / f"{mid}.json"
        if out_path.exists():
            try:
                existing_match = json.loads(out_path.read_text(encoding="utf-8"))
            except Exception as e:
                return {
                    "matchId": mid,
                    "saved": False,
                    "reason": f"failed_to_read_existing_matchid_file({out_path.name}): {e}",
                }

            with existing_lock:
                local_match_index[mid] = out_path.name

            return build_match_record(
                mid=mid,
                match=existing_match,
                source="existing_local",
                current_file_name=out_path.name,
            )

        match = client.get_match(mid)
        rec = build_match_record(
            mid=mid,
            match=match,
            source="downloaded_new",
            current_file_name=out_path.name,
        )

        if rec.get("saved"):
            pcm.save_json(out_path, match)
            with existing_lock:
                local_match_index[mid] = out_path.name

        return rec

    with ThreadPoolExecutor(max_workers=max(1, min(pcm.MAX_WORKERS, max(1, len(candidate_match_ids))))) as ex:
        futures = [ex.submit(process_match, mid) for mid in candidate_match_ids]
        for f in as_completed(futures):
            rec = f.result()
            if rec.get("skipped"):
                continue
            if rec.get("saved"):
                report.append(rec)
            else:
                rejected.append(rec)

    # mais antigo -> mais recente
    report_sorted = sorted(report, key=lambda r: (r.get("gameStartMillis") or 0))

    # 6) Renomeia os arquivos aceitos (mesmo formato do PegaCustomMatch)
    rename_report: List[Dict[str, Any]] = []

    for idx, rec in enumerate(report_sorted, start=1):
        mid = rec.get("matchId")
        if not mid:
            continue

        current_file_name = rec.get("currentFileName") or f"{mid}.json"
        old_path = matches_dir / str(current_file_name)
        if not old_path.exists():
            rejected.append({
                "matchId": mid,
                "saved": False,
                "reason": f"file_to_rename_not_found({current_file_name})",
            })
            continue

        try:
            match_obj = json.loads(old_path.read_text(encoding="utf-8"))
        except Exception:
            match_obj = {}

        score_a, score_b = pcm.extract_match_score(
            match=match_obj,
            detected_teams=rec.get("detectedTeams") or [],
        )

        new_name = pcm.build_match_filename(
            order_num=idx,
            game_start_ms=rec.get("gameStartMillis"),
            detected_teams=rec.get("detectedTeams") or [],
            score_a=score_a,
            score_b=score_b,
            map_id=rec.get("mapId"),
            match_id=mid,
        )
        new_path = matches_dir / new_name

        if new_path.exists() and new_path.resolve() != old_path.resolve():
            existing_mid_at_target = pcm.read_match_id_from_json_file(new_path)

            if existing_mid_at_target == mid:
                initial_duplicate_report.append(
                    pcm.remove_duplicate_file(
                        new_path,
                        duplicate_backup_dir,
                        reason=f"duplicate_matchId({mid}) during_rename; kept({old_path.name})",
                    )
                )
            else:
                stem = new_path.stem
                suffix = new_path.suffix
                counter = 2
                while True:
                    candidate = matches_dir / f"{stem}_{counter}{suffix}"
                    if not candidate.exists():
                        new_path = candidate
                        break
                    counter += 1

        if new_path.resolve() != old_path.resolve():
            shutil.move(str(old_path), str(new_path))

        with existing_lock:
            local_match_index[str(mid)] = new_path.name

        rec["fileName"] = new_path.name
        rec["matchDate"] = pcm.format_match_date_for_filename(rec.get("gameStartMillis"))
        rec["scoreA"] = score_a
        rec["scoreB"] = score_b

        rename_report.append({
            "matchId": mid,
            "source": rec.get("source"),
            "oldFileName": old_path.name,
            "newFileName": new_path.name,
            "matchDate": rec["matchDate"],
            "scoreA": score_a,
            "scoreB": score_b,
        })

    pcm.save_json(output_dir / "report.json", report_sorted)
    pcm.save_json(output_dir / "rejected.json", rejected)
    pcm.save_json(output_dir / "renamed_matches.json", rename_report)
    pcm.save_json(output_dir / "duplicate_matches_removed.json", initial_duplicate_report)

    rejected_not_custom_bomb = sum(
        1 for r in rejected
        if str(r.get("reason") or "").startswith("not_custom_bomb_game")
    )
    rejected_incomplete = sum(
        1 for r in rejected
        if str(r.get("reason") or "").startswith("incomplete_match")
    )
    rejected_winner_below_min_rounds = sum(
        1 for r in rejected
        if str(r.get("reason") or "").startswith("winner_below_min_rounds")
    )

    print("Collected matches:", len(report_sorted))
    print("Rejected candidates:", len(rejected))
    print("Rejected non-custom/non-bomb:", rejected_not_custom_bomb)
    print("Rejected incomplete/under-5v5:", rejected_incomplete)
    print("Rejected winner below 13 rounds:", rejected_winner_below_min_rounds)
    print("Renamed matches:", len(rename_report))
    print("Duplicate files removed from matches:", len(initial_duplicate_report))
    print("Output:", str(output_dir))


if __name__ == "__main__":
    main()
