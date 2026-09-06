"""
PegaTeamMatch.py

Versão direcionada do PegaCustomMatch: em vez de resolver e buscar a matchlist
de TODOS os jogadores do players.xlsx, consulta a API apenas para os jogadores
das equipes-alvo (1 ou 2). Muito mais rápido quando você já sabe quem procurar.

MODO JANELA (padrão)
--------------------
Basta rodar sem argumentos:

  python PegaTeamMatch.py

Abre uma janela onde você escolhe a equipe pela lista (com campo de busca por
nome), define o período opcional e acompanha o log da execução na própria tela.
Selecione 1 equipe para pegar todas as partidas dela, ou 2 equipes para pegar
apenas os confrontos diretos entre elas.

MODO LINHA DE COMANDO
---------------------
Continua funcionando como antes, basta passar as equipes como argumento:

  python PegaTeamMatch.py caap_hellhounds
      -> todas as partidas da caap_hellhounds (contra qualquer adversário)

  python PegaTeamMatch.py caap_hellhounds ufu_saints
      -> apenas confrontos diretos caap_hellhounds x ufu_saints

  python PegaTeamMatch.py caap_hellhounds --inicio 2026-07-01 --fim 2026-07-18
  python PegaTeamMatch.py --cli   (usa as equipes de TARGET_TEAMS, sem janela)

Os nomes das equipes são os da coluna current_team do players.xlsx (não
diferencia acento/maiúscula e aceita nome parcial, ex.: "caap").

Os demais jogadores da planilha NÃO geram chamadas à API: apenas os PUUIDs já
salvos na coluna puuid são usados para reconhecer e nomear os times adversários
nas partidas encontradas. Se muitos jogadores estiverem sem PUUID salvo, rode o
PegaCustomMatch uma vez para preencher a coluna.

O players.xlsx nunca é alterado por este script.
"""

import argparse
import contextlib
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import traceback
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import config_hub

import PegaCustomMatch as pcm


# =========================
# CONFIG
# =========================
# Equipes padrão quando o script roda em modo --cli sem argumentos.
# 1 equipe = todas as partidas dela; 2 equipes = apenas confrontos diretos.
TARGET_TEAMS: List[str] = [
    # Exemplos:
    "caap_momentum",
    "axis_anteaters",
]

OUTPUT_DIR_NAME = "out_team_search"

# Filtro de data ("YYYY-MM-DD", inclusivo). None = sem limite.
# Pode ser sobrescrito com --inicio / --fim na linha de comando ou pela janela.
FILTER_START_DATE: Optional[str] = None
FILTER_END_DATE: Optional[str] = None

LOOKBACK_PER_PLAYER = 120
MAX_MATCHES_TO_FETCH = 800

# Uma partida vira candidata se aparecer na matchlist de pelo menos N jogadores
# das equipes-alvo (somando as duas equipes, no modo de confronto direto).
MIN_TARGET_PLAYERS_IN_MATCHLIST = 3

# No modo com 2 equipes, exige que a partida apareça na matchlist de pelo menos
# N jogadores de CADA equipe. Isso evita baixar jogos da equipe A contra outros
# adversários que não a equipe B.
MIN_TARGET_PLAYERS_PER_TEAM_IN_MATCHLIST = 1

# Mesmos filtros de qualidade do PegaCustomMatch.
REQUIRE_CUSTOM_BOMB_GAME = True
REQUIRE_COMPLETED_MATCH = True
MIN_ACTIVE_PLAYERS_PER_SIDE = 5
REQUIRE_WINNER_MIN_ROUNDS = True
MIN_WINNING_ROUNDS = 13

# Identificação de time (>= N jogadores conhecidos do mesmo time no mesmo lado).
# Cada equipe-alvo precisa ser identificada assim na partida para ela ser aceita.
# Lados adversários sem time identificado viram "unknown" no nome do arquivo.
MIN_TEAM_PLAYERS_TO_IDENTIFY = 3


class SearchError(Exception):
    """Erro previsível de uso (equipe inválida, data inválida, etc.).

    Vira mensagem na janela no modo gráfico e SystemExit no modo terminal.
    """


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
        raise SearchError(f"Data inválida em {flag_name}: {s!r}. Use o formato YYYY-MM-DD.")
    return s


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Coleta partidas custom (mesmos filtros do PegaCustomMatch) buscando "
            "a matchlist apenas dos jogadores das equipes-alvo. "
            "1 equipe = todas as partidas dela; 2 equipes = apenas confrontos diretos. "
            "Sem argumentos, abre a janela de seleção de equipes."
        )
    )
    parser.add_argument(
        "teams",
        nargs="*",
        help="1 ou 2 equipes (nomes da coluna current_team do players.xlsx; aceita nome parcial). "
             "Se omitido, abre a janela de seleção.",
    )
    parser.add_argument("--inicio", default=None, help="Data inicial YYYY-MM-DD (inclusivo).")
    parser.add_argument("--fim", default=None, help="Data final YYYY-MM-DD (inclusivo).")
    parser.add_argument(
        "--min-matchlist", type=int, default=None,
        help=f"Mínimo de jogadores-alvo com a partida na matchlist (padrão: {MIN_TARGET_PLAYERS_IN_MATCHLIST}).",
    )
    parser.add_argument(
        "--lookback", type=int, default=None,
        help=f"Quantas entradas de matchlist considerar por jogador (padrão: {LOOKBACK_PER_PLAYER}).",
    )
    parser.add_argument(
        "--max-partidas", type=int, default=None,
        help=f"Máximo de partidas para baixar por execução (padrão: {MAX_MATCHES_TO_FETCH}).",
    )
    parser.add_argument(
        "--cli", action="store_true",
        help="Não abre a janela: roda no terminal usando TARGET_TEAMS quando nenhuma equipe é passada.",
    )
    return parser.parse_args()


# =========================
# Leitura da planilha para a interface
# =========================
def load_teams_overview() -> List[Tuple[str, int]]:
    """Lista (nome da equipe, nº de jogadores) da coluna current_team do players.xlsx."""
    xlsx_path = config_hub.PLAYERS_XLSX
    if not Path(xlsx_path).exists():
        raise SearchError(
            f"Planilha não encontrada: {xlsx_path}\n"
            "Confira o HUB_DIR em config_hub.py."
        )
    teams_to_players, *_ = pcm.load_players_from_xlsx(xlsx_path)
    return sorted(
        ((team, len(players)) for team, players in teams_to_players.items()),
        key=lambda item: pcm._fold_ascii(item[0]),
    )


# =========================
# Resolução das equipes e seus jogadores
# =========================
def resolve_target_teams(raw_teams: List[str], teams_to_players: Dict[str, List[str]]) -> List[str]:
    """
    Converte cada nome informado no nome exato da equipe na coluna current_team.
    Aceita variações de acento/maiúscula e nome parcial não-ambíguo.
    """
    available: Dict[str, str] = {}
    for team in teams_to_players:
        available[pcm._fold_ascii(team)] = team

    resolved: List[str] = []
    for raw in raw_teams:
        s = str(raw).strip()
        if not s:
            continue

        folded = pcm._fold_ascii(s)
        team = available.get(folded)

        if team is None and folded:
            partial = sorted({t for f, t in available.items() if folded in f})
            if len(partial) == 1:
                team = partial[0]
                print(f"[INFO] Equipe {s!r} casou por aproximação com {team!r}.")
            elif partial:
                raise SearchError(
                    f"Equipe ambígua: {s!r} casa com mais de uma equipe da planilha: "
                    + ", ".join(partial)
                )

        if team is None:
            raise SearchError(
                f"Equipe não encontrada na coluna current_team: {s!r}.\n"
                "Equipes disponíveis: " + ", ".join(sorted(teams_to_players))
            )

        if team not in resolved:
            resolved.append(team)

    if not resolved:
        raise SearchError("Nenhuma equipe válida informada.")
    if len(resolved) > 2:
        raise SearchError("Informe no máximo 2 equipes (1 = todas as partidas; 2 = confronto direto).")

    return resolved


def resolve_players_of_team(
    team: str,
    teams_to_players: Dict[str, List[str]],
    player_to_riotids: Dict[str, List[str]],
    player_to_existing_puuid: Dict[str, Optional[str]],
    client: "pcm.RiotClient",
) -> Tuple[Dict[str, str], List[Dict[str, Any]]]:
    """
    Resolve os PUUIDs dos jogadores de uma equipe-alvo.

    Só chama a API para linhas SEM PUUID salvo na planilha; as demais usam o
    valor salvo direto.

    Retorna:
      - puuid -> nome legível do jogador
      - lista de jogadores não resolvidos, com os Riot IDs tentados
    """
    rows = teams_to_players.get(team, [])
    result: Dict[str, str] = {}
    unresolved: List[Dict[str, Any]] = []

    def resolve_pk(pk: str) -> Tuple[str, Optional[str]]:
        stored = player_to_existing_puuid.get(pk)
        if stored:
            return pk, stored
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
                return pk, puuid
        return pk, None

    if not rows:
        return result, unresolved

    with ThreadPoolExecutor(max_workers=max(1, min(pcm.MAX_WORKERS, len(rows)))) as ex:
        futures = [ex.submit(resolve_pk, pk) for pk in rows]
        for f in as_completed(futures):
            pk, puuid = f.result()
            if puuid:
                result[puuid] = player_label_from_key(pk)
            else:
                unresolved.append({
                    "playerKey": pk,
                    "team": team,
                    "riotIdsTentados": player_to_riotids.get(pk, []),
                })

    return result, unresolved


# =========================
# Execução da busca
# =========================
def run_search(
    raw_teams: List[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    min_matchlist: Optional[int] = None,
    lookback: Optional[int] = None,
    max_matches: Optional[int] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """
    Roda a coleta completa para 1 ou 2 equipes.

    Todo o progresso é impresso com print(), para que tanto o terminal quanto a
    janela (que redireciona a saída padrão) mostrem o mesmo log.

    Retorna um resumo com os contadores e a pasta de saída.
    """
    raw_teams = [str(t) for t in raw_teams if str(t).strip()]
    if not raw_teams:
        raise SearchError("Nenhuma equipe informada.")

    start_date = parse_date_or_none(start_date, "início")
    end_date = parse_date_or_none(end_date, "fim")
    if start_date and end_date and start_date > end_date:
        raise SearchError(f"A data inicial ({start_date}) é posterior à data final ({end_date}).")

    # O filtro de data do PegaCustomMatch é lido de globais do módulo;
    # sobrescreve com o período desta execução.
    pcm.FILTER_START_MS = pcm._date_to_epoch_ms(start_date, end_of_day=False)
    pcm.FILTER_END_MS_EXCLUSIVE = pcm._date_to_epoch_ms(end_date, end_of_day=True)

    min_matchlist = MIN_TARGET_PLAYERS_IN_MATCHLIST if min_matchlist is None else min_matchlist
    lookback = LOOKBACK_PER_PLAYER if lookback is None else lookback
    max_matches = MAX_MATCHES_TO_FETCH if max_matches is None else max_matches

    def stopped() -> bool:
        return bool(should_stop and should_stop())

    base_dir = pcm._base_dir()
    output_dir = base_dir / OUTPUT_DIR_NAME
    pcm.ensure_dirs(output_dir)

    matches_dir = output_dir / "matches"
    history_dir = base_dir / "Finalizados"
    history_dir.mkdir(parents=True, exist_ok=True)

    xlsx_path = config_hub.PLAYERS_XLSX
    (
        teams_to_players,
        player_to_riotids,
        player_to_current_team,
        player_to_existing_puuid,
        _player_key_to_row,
        player_to_alt_puuids,
    ) = pcm.load_players_from_xlsx(xlsx_path)

    print("Base dir:", base_dir)
    print("Output dir:", output_dir)
    print("Filtro de data:", start_date or "sem limite", "->", end_date or "sem limite")
    print("Jogadores carregados do Excel:", len(player_to_riotids))
    print("Equipes na planilha (current_team):", len(teams_to_players))

    target_teams = resolve_target_teams(raw_teams, teams_to_players)
    direct_confrontation = len(target_teams) == 2
    target_folds = [pcm._fold_ascii(t) for t in target_teams]

    if direct_confrontation:
        print(f"Modo: confronto direto {target_teams[0]} x {target_teams[1]}")
    else:
        print(f"Modo: todas as partidas de {target_teams[0]}")

    client = pcm.RiotClient(pcm.RIOT_API_KEY, pcm.VAL_REGION, pcm.RIOT_ROUTING)

    # 1) Resolve os jogadores das equipes-alvo (API apenas para quem está sem PUUID salvo)
    team_to_target_puuids: Dict[str, Set[str]] = {}
    target_puuid_to_label: Dict[str, str] = {}
    unresolved_players: List[Dict[str, Any]] = []

    for team in target_teams:
        if stopped():
            raise SearchError("Execução cancelada pelo usuário.")

        resolved, unresolved = resolve_players_of_team(
            team=team,
            teams_to_players=teams_to_players,
            player_to_riotids=player_to_riotids,
            player_to_existing_puuid=player_to_existing_puuid,
            client=client,
        )
        unresolved_players.extend(unresolved)

        for item in unresolved:
            print(f"[WARNING] Jogador sem PUUID resolvível em {team}: {item['playerKey']}")

        if not resolved:
            raise SearchError(f"Nenhum jogador da equipe {team!r} teve PUUID resolvido. Não é possível continuar.")

        team_to_target_puuids[team] = set(resolved)
        target_puuid_to_label.update(resolved)
        print(f"Equipe {team}: {len(resolved)} jogador(es) -> {', '.join(sorted(resolved.values()))}")

    target_puuid_set: Set[str] = set().union(*team_to_target_puuids.values())

    # 2) Pool de jogadores conhecidos: PUUIDs já salvos na planilha + alvos resolvidos.
    # Nenhuma chamada à API é feita para os não-alvos.
    puuid_to_label: Dict[str, str] = {}
    puuid_to_team: Dict[str, str] = {}

    for pk, puuid in player_to_existing_puuid.items():
        if not puuid:
            continue
        puuid_to_label.setdefault(puuid, player_label_from_key(pk))
        team = player_to_current_team.get(pk)
        if team is not None:
            puuid_to_team.setdefault(puuid, team)

    for team, puuids in team_to_target_puuids.items():
        for puuid in puuids:
            puuid_to_label.setdefault(puuid, target_puuid_to_label.get(puuid, puuid))
            puuid_to_team.setdefault(puuid, team)

    # Contas alternativas ("puuid N"): reconhecem o dono quando ele entra de
    # conta secundaria. Sem isto a equipe dele nao alcanca
    # MIN_TEAM_PLAYERS_TO_IDENTIFY e sai como "unknown" no nome do arquivo.
    for pk, alt_puuids in player_to_alt_puuids.items():
        team = player_to_current_team.get(pk)
        for alt_puuid in alt_puuids:
            puuid_to_label.setdefault(alt_puuid, player_label_from_key(pk))
            if team is not None:
                puuid_to_team.setdefault(alt_puuid, team)

    known_puuid_set: Set[str] = set(puuid_to_label.keys())

    rows_without_stored_puuid = sum(
        1 for pk in player_to_riotids if not player_to_existing_puuid.get(pk)
    )
    print("Jogadores conhecidos (PUUID salvo na planilha + alvos):", len(known_puuid_set))
    if rows_without_stored_puuid:
        print(
            f"[INFO] {rows_without_stored_puuid} jogador(es) da planilha sem PUUID salvo "
            f"não serão reconhecidos nas partidas. Rode o PegaCustomMatch para preencher a coluna puuid."
        )

    pcm.save_json(output_dir / "resolved_teams.json", {
        "targetTeams": target_teams,
        "directConfrontation": direct_confrontation,
        "teamPlayers": {
            team: sorted(target_puuid_to_label[p] for p in puuids)
            for team, puuids in team_to_target_puuids.items()
        },
        "unresolvedPlayers": unresolved_players,
        "filterStartDate": start_date,
        "filterEndDate": end_date,
    })

    # 3) Matchlists apenas dos jogadores das equipes-alvo
    match_to_targets_seen: Dict[str, Set[str]] = defaultdict(set)

    def fetch_matchlist(puuid: str) -> Tuple[str, List[Dict[str, Any]], Optional[str]]:
        try:
            ml = client.get_matchlist_by_puuid(puuid)
        except pcm.RiotHttpError as e:
            if e.status_code not in (400, 404):
                raise
            label = target_puuid_to_label.get(puuid, puuid)
            return puuid, [], (
                f"[WARNING] Matchlist indisponível (HTTP {e.status_code}) para {label}: "
                f"PUUID salvo provavelmente inválido. Corrija a coluna puuid no players.xlsx."
            )
        hist = ml.get("history") or []
        if not isinstance(hist, list):
            hist = []
        hist = [h for h in hist if pcm.is_in_date_range(h.get("gameStartTimeMillis"))]
        return puuid, hist[:lookback], None

    print(f"Buscando matchlist de {len(target_puuid_set)} jogador(es)-alvo...")

    with ThreadPoolExecutor(max_workers=max(1, min(pcm.MAX_WORKERS, len(target_puuid_set)))) as ex:
        futures = [ex.submit(fetch_matchlist, p) for p in target_puuid_set]
        for f in as_completed(futures):
            puuid, hist, warning = f.result()
            if warning:
                print(warning)
            pcm.save_json(output_dir / "matchlists" / f"{puuid}.json", {"puuid": puuid, "history": hist})
            for h in hist:
                mid = h.get("matchId")
                if isinstance(mid, str) and mid:
                    match_to_targets_seen[mid].add(puuid)

    if stopped():
        raise SearchError("Execução cancelada pelo usuário.")

    # 4) Candidatas por sobreposição de matchlist
    # Se a equipe tiver menos jogadores resolvidos que o mínimo, usa o que houver.
    effective_min_matchlist = max(1, min(min_matchlist, len(target_puuid_set)))

    candidates: List[Tuple[str, int]] = []
    for mid, seen in match_to_targets_seen.items():
        if len(seen) < effective_min_matchlist:
            continue

        if direct_confrontation:
            # Exige presença na matchlist de jogadores das DUAS equipes,
            # senão é jogo da equipe A contra outro adversário.
            ok = all(
                len(seen & team_to_target_puuids[team]) >= MIN_TARGET_PLAYERS_PER_TEAM_IN_MATCHLIST
                for team in target_teams
            )
            if not ok:
                continue

        candidates.append((mid, len(seen)))

    candidates.sort(key=lambda x: x[1], reverse=True)

    pcm.save_json(
        output_dir / "candidates_by_target_matchlist.json",
        [
            {
                "matchId": mid,
                "targetsWithMatch": cnt,
                "targetsPerTeam": {
                    team: len(match_to_targets_seen[mid] & team_to_target_puuids[team])
                    for team in target_teams
                },
            }
            for mid, cnt in candidates
        ],
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
    print(f"Candidatas (em >= {effective_min_matchlist} matchlist(s) de alvo):", len(candidates))
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
                detected.append({
                    "teamName": tname,
                    "teamId": team_id,
                    "players": sorted(puuid_to_label.get(p, p) for p in unique),
                    "playerCount": len(unique),
                })

        # Equipes-alvo primeiro (na ordem informada), para o nome do arquivo
        # sair como "equipeA_x_equipeB".
        def rank(d: Dict[str, Any]) -> Tuple[int, int, str]:
            folded = pcm._fold_ascii(d["teamName"])
            idx = target_folds.index(folded) if folded in target_folds else len(target_folds)
            return (idx, -int(d["playerCount"]), str(d["teamName"]))

        return sorted(detected, key=rank)

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

        detected_teams = detect_teams_in_match(match)

        # Cada equipe-alvo precisa ter sido identificada na partida
        # (>= MIN_TEAM_PLAYERS_TO_IDENTIFY jogadores dela no mesmo lado).
        entries_by_target: Dict[str, List[Dict[str, Any]]] = {}
        for team, folded in zip(target_teams, target_folds):
            entries = [d for d in detected_teams if pcm._fold_ascii(d["teamName"]) == folded]
            if not entries:
                return {
                    "matchId": mid,
                    "saved": False,
                    "source": source,
                    "currentFileName": current_file_name,
                    "reason": (
                        f"target_team_not_detected({team},"
                        f"minimum={MIN_TEAM_PLAYERS_TO_IDENTIFY})"
                    ),
                    "detectedTeams": detected_teams,
                }
            entries_by_target[team] = entries

        if direct_confrontation:
            sides_a = {d["teamId"] for d in entries_by_target[target_teams[0]]}
            sides_b = {d["teamId"] for d in entries_by_target[target_teams[1]]}
            if not any(a != b for a in sides_a for b in sides_b):
                return {
                    "matchId": mid,
                    "saved": False,
                    "source": source,
                    "currentFileName": current_file_name,
                    "reason": "target_teams_not_on_opposite_sides",
                    "detectedTeams": detected_teams,
                }

        target_puuids_in_match = {
            p.get("puuid") for p in active
            if isinstance(p.get("puuid"), str) and p.get("puuid") in target_puuid_set
        }
        known_puuids_in_match = {
            p.get("puuid") for p in active
            if isinstance(p.get("puuid"), str) and p.get("puuid") in known_puuid_set
        }

        # Placar extraído aqui, com o payload já em memória, para a etapa de
        # renomeação não precisar reler o arquivo do disco.
        score_a, score_b = pcm.extract_match_score(match=match, detected_teams=detected_teams)

        return {
            "matchId": mid,
            "saved": True,
            "scoreA": score_a,
            "scoreB": score_b,
            "source": source,
            "currentFileName": current_file_name,
            "targetPlayersInMatch": sorted(
                target_puuid_to_label.get(p, p) for p in target_puuids_in_match
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
        if stopped():
            return {"matchId": mid, "saved": False, "skipped": True, "reason": "cancelled"}

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

    processed = 0
    total_candidates = len(candidate_match_ids)

    with ThreadPoolExecutor(max_workers=max(1, min(pcm.MAX_WORKERS, max(1, total_candidates)))) as ex:
        futures = [ex.submit(process_match, mid) for mid in candidate_match_ids]
        for f in as_completed(futures):
            rec = f.result()
            processed += 1
            if total_candidates and (processed % 25 == 0 or processed == total_candidates):
                print(f"  ... {processed}/{total_candidates} candidatas processadas")
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

        score_a = rec.get("scoreA")
        score_b = rec.get("scoreB")

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
    rejected_target_team_not_detected = sum(
        1 for r in rejected
        if str(r.get("reason") or "").startswith("target_team_not_detected")
    )
    rejected_not_opposite_sides = sum(
        1 for r in rejected
        if str(r.get("reason") or "").startswith("target_teams_not_on_opposite_sides")
    )

    print("Collected matches:", len(report_sorted))
    print("Rejected candidates:", len(rejected))
    print("Rejected non-custom/non-bomb:", rejected_not_custom_bomb)
    print("Rejected incomplete/under-5v5:", rejected_incomplete)
    print("Rejected winner below 13 rounds:", rejected_winner_below_min_rounds)
    print("Rejected sem equipe-alvo identificada:", rejected_target_team_not_detected)
    if direct_confrontation:
        print("Rejected equipes-alvo no mesmo lado:", rejected_not_opposite_sides)
    print("Renamed matches:", len(rename_report))
    print("Duplicate files removed from matches:", len(initial_duplicate_report))
    print("Output:", str(output_dir))

    return {
        "targetTeams": target_teams,
        "directConfrontation": direct_confrontation,
        "outputDir": str(output_dir),
        "collected": len(report_sorted),
        "rejected": len(rejected),
        "renamed": len(rename_report),
        "candidates": len(candidates),
    }


# =========================
# Interface gráfica (Tkinter)
# =========================
def open_output_dir(path: str) -> None:
    """Abre a pasta de saída no explorador de arquivos do sistema."""
    p = Path(path)
    if not p.exists():
        return
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(p))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(p)])
        else:
            subprocess.Popen(["xdg-open", str(p)])
    except Exception as e:
        print(f"[WARNING] Não foi possível abrir a pasta: {e}")


class _QueueWriter:
    """Arquivo-texto que empurra tudo que é escrito para a fila da interface."""

    def __init__(self, out_queue: "queue.Queue") -> None:
        self._queue = out_queue

    def write(self, text: str) -> int:
        if text:
            self._queue.put(("log", text))
        return len(text)

    def flush(self) -> None:
        pass

    def isatty(self) -> bool:
        return False


class TeamMatchApp:
    """Janela de seleção de equipes e execução da coleta."""

    MAX_SELECTED = 2

    def __init__(self, initial_start: Optional[str] = None, initial_end: Optional[str] = None) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk

        self.queue: "queue.Queue" = queue.Queue()
        self.worker: Optional[threading.Thread] = None
        self.cancel_flag = threading.Event()
        self.all_teams: List[Tuple[str, int]] = []
        self.visible_teams: List[Tuple[str, int]] = []
        self.selected_teams: List[str] = []
        self.last_output_dir: Optional[str] = None

        self.root = tk.Tk()
        self.root.title("PegaTeamMatch - buscar partidas por equipe")
        self.root.geometry("980x680")
        self.root.minsize(820, 560)

        self._build_widgets(initial_start, initial_end)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(80, self._drain_queue)
        self.root.after(120, self._load_teams)

    # ---------- construção da janela ----------
    def _build_widgets(self, initial_start: Optional[str], initial_end: Optional[str]) -> None:
        tk, ttk = self.tk, self.ttk

        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        top = ttk.Frame(self.root, padding=10)
        top.grid(row=0, column=0, sticky="nsew")
        top.columnconfigure(0, weight=3)
        top.columnconfigure(1, weight=2)
        top.rowconfigure(1, weight=1)

        # --- coluna esquerda: busca + lista de equipes ---
        left = ttk.LabelFrame(top, text="Equipes da planilha (coluna current_team)", padding=8)
        left.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(0, 8))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(2, weight=1)

        search_row = ttk.Frame(left)
        search_row.grid(row=0, column=0, sticky="ew")
        search_row.columnconfigure(1, weight=1)

        ttk.Label(search_row, text="Buscar:").grid(row=0, column=0, padx=(0, 6))
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", lambda *_: self._apply_filter())
        self.search_entry = ttk.Entry(search_row, textvariable=self.search_var)
        self.search_entry.grid(row=0, column=1, sticky="ew")
        self.search_entry.bind("<Return>", self._on_search_enter)
        self.search_entry.bind("<Down>", self._focus_list)
        ttk.Button(search_row, text="Limpar", width=8,
                   command=lambda: self.search_var.set("")).grid(row=0, column=2, padx=(6, 0))

        self.count_label = ttk.Label(left, text="Carregando equipes...")
        self.count_label.grid(row=1, column=0, sticky="w", pady=(6, 2))

        list_frame = ttk.Frame(left)
        list_frame.grid(row=2, column=0, sticky="nsew")
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)

        self.team_list = tk.Listbox(list_frame, activestyle="dotbox", exportselection=False)
        self.team_list.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.team_list.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.team_list.configure(yscrollcommand=scroll.set)
        self.team_list.bind("<Double-Button-1>", lambda _e: self._add_selected())
        self.team_list.bind("<Return>", lambda _e: self._add_selected())

        ttk.Button(left, text="Adicionar equipe  ▶", command=self._add_selected).grid(
            row=3, column=0, sticky="ew", pady=(8, 0)
        )

        # --- coluna direita: selecionadas + período ---
        right = ttk.Frame(top)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)

        sel = ttk.LabelFrame(right, text="Equipes selecionadas (máx. 2)", padding=8)
        sel.grid(row=0, column=0, sticky="ew")
        sel.columnconfigure(0, weight=1)

        self.selected_list = tk.Listbox(sel, height=2, exportselection=False)
        self.selected_list.grid(row=0, column=0, columnspan=2, sticky="ew")
        self.selected_list.bind("<Double-Button-1>", lambda _e: self._remove_selected())

        ttk.Button(sel, text="Remover", command=self._remove_selected).grid(
            row=1, column=0, sticky="ew", pady=(6, 0), padx=(0, 3)
        )
        ttk.Button(sel, text="Limpar", command=self._clear_selected).grid(
            row=1, column=1, sticky="ew", pady=(6, 0), padx=(3, 0)
        )

        self.mode_label = ttk.Label(sel, text="Selecione 1 equipe (todas as partidas) ou 2 (confronto direto).",
                                    wraplength=320, foreground="#555555")
        self.mode_label.grid(row=2, column=0, columnspan=2, sticky="w", pady=(8, 0))

        period = ttk.LabelFrame(right, text="Período (opcional, YYYY-MM-DD)", padding=8)
        period.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        period.columnconfigure(1, weight=1)

        self.start_var = tk.StringVar(value=initial_start or "")
        self.end_var = tk.StringVar(value=initial_end or "")

        ttk.Label(period, text="Início:").grid(row=0, column=0, sticky="w")
        ttk.Entry(period, textvariable=self.start_var).grid(row=0, column=1, sticky="ew", padx=(6, 0))
        ttk.Label(period, text="Fim:").grid(row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Entry(period, textvariable=self.end_var).grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=(6, 0))
        ttk.Label(period, text="Deixe em branco para não filtrar por data.",
                  foreground="#555555").grid(row=2, column=0, columnspan=2, sticky="w", pady=(6, 0))

        actions = ttk.Frame(right, padding=(0, 10, 0, 0))
        actions.grid(row=2, column=0, sticky="ew")
        actions.columnconfigure(0, weight=1)

        self.run_button = ttk.Button(actions, text="Buscar partidas", command=self._start_search)
        self.run_button.grid(row=0, column=0, sticky="ew")

        self.cancel_button = ttk.Button(actions, text="Cancelar", command=self._cancel_search, state="disabled")
        self.cancel_button.grid(row=1, column=0, sticky="ew", pady=(6, 0))

        self.open_button = ttk.Button(actions, text="Abrir pasta de saída", command=self._open_output, state="disabled")
        self.open_button.grid(row=2, column=0, sticky="ew", pady=(6, 0))

        self.reload_button = ttk.Button(actions, text="Recarregar planilha", command=self._load_teams)
        self.reload_button.grid(row=3, column=0, sticky="ew", pady=(6, 0))

        # --- log ---
        log_frame = ttk.LabelFrame(self.root, text="Log da execução", padding=8)
        log_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 6))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        from tkinter.scrolledtext import ScrolledText
        self.log_text = ScrolledText(log_frame, height=12, wrap="word", state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")

        self.status_var = tk.StringVar(value="Pronto.")
        ttk.Label(self.root, textvariable=self.status_var, anchor="w", padding=(12, 0, 12, 8)).grid(
            row=2, column=0, sticky="ew"
        )

    # ---------- dados ----------
    def _load_teams(self) -> None:
        try:
            self.all_teams = load_teams_overview()
        except SearchError as e:
            self._show_error(str(e))
            self.all_teams = []
        except Exception:
            self._show_error(traceback.format_exc())
            self.all_teams = []

        self._apply_filter()
        self._log(f"{len(self.all_teams)} equipe(s) carregada(s) da planilha.\n")

    def _apply_filter(self) -> None:
        term = pcm._fold_ascii(self.search_var.get().strip())
        if term:
            self.visible_teams = [t for t in self.all_teams if term in pcm._fold_ascii(t[0])]
        else:
            self.visible_teams = list(self.all_teams)

        self.team_list.delete(0, "end")
        for team, n_players in self.visible_teams:
            self.team_list.insert("end", f"{team}   ({n_players} jogador(es))")

        if self.visible_teams:
            self.team_list.selection_clear(0, "end")
            self.team_list.selection_set(0)
            self.team_list.activate(0)

        total = len(self.all_teams)
        shown = len(self.visible_teams)
        self.count_label.config(
            text=f"{shown} de {total} equipe(s)" + ("" if shown == total else " (filtradas)")
        )

    # ---------- seleção ----------
    def _on_search_enter(self, _event=None) -> None:
        if self.visible_teams:
            self._add_team(self.visible_teams[0][0])

    def _focus_list(self, _event=None) -> None:
        self.team_list.focus_set()

    def _add_selected(self) -> None:
        idxs = self.team_list.curselection()
        if not idxs:
            return
        self._add_team(self.visible_teams[idxs[0]][0])

    def _add_team(self, team: str) -> None:
        if team in self.selected_teams:
            self.status_var.set(f"{team} já está selecionada.")
            return
        if len(self.selected_teams) >= self.MAX_SELECTED:
            self.status_var.set("Máximo de 2 equipes. Remova uma antes de adicionar outra.")
            return
        self.selected_teams.append(team)
        self._refresh_selected()
        self.search_var.set("")
        self.search_entry.focus_set()

    def _remove_selected(self) -> None:
        idxs = self.selected_list.curselection()
        if idxs:
            del self.selected_teams[idxs[0]]
        elif self.selected_teams:
            self.selected_teams.pop()
        self._refresh_selected()

    def _clear_selected(self) -> None:
        self.selected_teams = []
        self._refresh_selected()

    def _refresh_selected(self) -> None:
        self.selected_list.delete(0, "end")
        for team in self.selected_teams:
            self.selected_list.insert("end", team)

        if not self.selected_teams:
            self.mode_label.config(text="Selecione 1 equipe (todas as partidas) ou 2 (confronto direto).")
        elif len(self.selected_teams) == 1:
            self.mode_label.config(text=f"Modo: todas as partidas de {self.selected_teams[0]}.")
        else:
            self.mode_label.config(
                text=f"Modo: confronto direto {self.selected_teams[0]} x {self.selected_teams[1]}."
            )

    # ---------- execução ----------
    def _start_search(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        if not self.selected_teams:
            self._show_error("Selecione pelo menos uma equipe na lista.")
            return

        params = {
            "raw_teams": list(self.selected_teams),
            "start_date": self.start_var.get().strip() or None,
            "end_date": self.end_var.get().strip() or None,
        }

        self.cancel_flag.clear()
        self._clear_log()
        self.run_button.config(state="disabled")
        self.reload_button.config(state="disabled")
        self.cancel_button.config(state="normal")
        self.status_var.set("Buscando... (isso pode levar alguns minutos)")

        self.worker = threading.Thread(target=self._worker_main, args=(params,), daemon=True)
        self.worker.start()

    def _worker_main(self, params: Dict[str, Any]) -> None:
        writer = _QueueWriter(self.queue)
        try:
            with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
                summary = run_search(should_stop=self.cancel_flag.is_set, **params)
            self.queue.put(("done", summary))
        except SearchError as e:
            self.queue.put(("error", str(e)))
        except Exception:
            self.queue.put(("error", traceback.format_exc()))

    def _cancel_search(self) -> None:
        if self.worker and self.worker.is_alive():
            self.cancel_flag.set()
            self.status_var.set("Cancelando... aguardando as requisições em andamento terminarem.")
            self.cancel_button.config(state="disabled")

    def _drain_queue(self) -> None:
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "log":
                    self._log(payload)
                elif kind == "done":
                    self._on_finished(payload)
                elif kind == "error":
                    self._log("\n[ERRO] " + str(payload) + "\n")
                    self._on_failed(str(payload))
        except queue.Empty:
            pass
        self.root.after(80, self._drain_queue)

    def _on_finished(self, summary: Dict[str, Any]) -> None:
        self.last_output_dir = summary.get("outputDir")
        self.run_button.config(state="normal")
        self.reload_button.config(state="normal")
        self.cancel_button.config(state="disabled")
        self.open_button.config(state="normal" if self.last_output_dir else "disabled")
        self.status_var.set(
            f"Concluído: {summary.get('collected', 0)} partida(s) coletada(s), "
            f"{summary.get('rejected', 0)} descartada(s)."
        )

    def _on_failed(self, message: str) -> None:
        self.run_button.config(state="normal")
        self.reload_button.config(state="normal")
        self.cancel_button.config(state="disabled")
        self.status_var.set("Falhou. Veja o log.")
        self._show_error(message.strip().splitlines()[-1] if message.strip() else "Erro desconhecido.")

    def _open_output(self) -> None:
        if self.last_output_dir:
            open_output_dir(self.last_output_dir)

    # ---------- utilidades ----------
    def _log(self, text: str) -> None:
        self.log_text.config(state="normal")
        self.log_text.insert("end", text)
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    def _clear_log(self) -> None:
        self.log_text.config(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.config(state="disabled")

    def _show_error(self, message: str) -> None:
        from tkinter import messagebox
        messagebox.showerror("PegaTeamMatch", message, parent=self.root)

    def _on_close(self) -> None:
        if self.worker and self.worker.is_alive():
            from tkinter import messagebox
            if not messagebox.askokcancel(
                "PegaTeamMatch",
                "A busca ainda está rodando. Fechar mesmo assim?",
                parent=self.root,
            ):
                return
            self.cancel_flag.set()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def launch_gui(initial_start: Optional[str] = None, initial_end: Optional[str] = None) -> None:
    try:
        import tkinter  # noqa: F401
    except Exception:
        raise SystemExit(
            "Tkinter não está disponível nesta instalação do Python, então a janela não pode abrir.\n"
            "Rode pela linha de comando, ex.: python PegaTeamMatch.py caap_hellhounds\n"
            "(no Linux, o pacote costuma se chamar python3-tk)."
        )
    TeamMatchApp(initial_start=initial_start, initial_end=initial_end).run()


# =========================
# Main
# =========================
def main():
    args = parse_args()

    raw_teams = [str(t) for t in args.teams if str(t).strip()]

    # Sem equipes na linha de comando -> abre a janela (a menos que --cli).
    if not raw_teams and not args.cli:
        launch_gui(initial_start=args.inicio or FILTER_START_DATE,
                   initial_end=args.fim or FILTER_END_DATE)
        return

    if not raw_teams:
        raw_teams = [str(t) for t in TARGET_TEAMS if str(t).strip()]

    if not raw_teams:
        raise SystemExit(
            "Nenhuma equipe informada. Rode sem argumentos para abrir a janela de seleção, "
            "passe 1 ou 2 equipes (ex.: python PegaTeamMatch.py caap_hellhounds ufu_saints) "
            "ou preencha TARGET_TEAMS no topo do script."
        )

    start_date = args.inicio if args.inicio is not None else FILTER_START_DATE
    end_date = args.fim if args.fim is not None else FILTER_END_DATE

    try:
        run_search(
            raw_teams=raw_teams,
            start_date=start_date,
            end_date=end_date,
            min_matchlist=args.min_matchlist,
            lookback=args.lookback,
            max_matches=args.max_partidas,
        )
    except SearchError as e:
        raise SystemExit(str(e))


if __name__ == "__main__":
    main()