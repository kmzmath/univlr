"""
PegaTournamentMatch.py

Baixa partidas jogadas no servidor de TORNEIO da Riot (rota "esports"), que o
PegaCustomMatch/PegaTeamMatch nao enxergam.

POR QUE UM SCRIPT A PARTE
-------------------------
No servidor de torneio cada jogador entra com uma conta de torneio (ex.:
"AZR greiN#epval"), com PUUID proprio. Essa conta nao tem matchlist publica
(a rota esports devolve 404 em matchlists/by-puuid), entao a busca por jogador
dos outros scripts nao acha nada. O unico caminho e a lista de partidas
recentes da fila de torneio:

  GET https://esports.api.riotgames.com/val/match/v1/recent-matches/by-queue/tournamentmode

que cobre so as ULTIMAS 12 HORAS e mistura todos os eventos do servidor (testes
da Riot, outras ligas). O script baixa cada uma e separa as das equipes pedidas.
Rode no mesmo dia da partida.

USO
---
  python PegaTournamentMatch.py
      -> lista as partidas de torneio das ultimas 12 h, com placar, mapa e as
         equipes reconhecidas. Nao grava nada.

  python PegaTournamentMatch.py azure_bears_golden ceub_octopus
      -> baixa os confrontos entre as duas equipes (1 equipe = todas as dela)
         em trabalho/out_torneio_esports/matches, com o nome de arquivo padrao.

  python PegaTournamentMatch.py golden ceub --vincular
      -> idem, e grava no players.xlsx as contas de torneio ainda desconhecidas
         que casaram pelo nick com um jogador do elenco: o PUUID numa coluna
         "puuid N" livre e o Riot ID numa "nick N". Depois rode
         scripts/build_metadata.py para o site reconhecer as contas.

RECONHECIMENTO DAS CONTAS
-------------------------
1. PUUID ja cadastrado (coluna "puuid" ou "puuid N"): reconhece direto.
2. Senao, pelo nick: tira o prefixo da equipe ("AZR greiN" -> "greiN") e
   compara, sem acento/maiuscula, com o nome do jogador e com os nicks das
   colunas "nick N" dos jogadores das equipes pedidas (ou de todos, sem equipe).
   So vale se casar com exatamente um jogador.
Sem --vincular, o casamento por nick serve so para nomear o arquivo: o site
ainda nao reconhece a conta, e o script avisa.

As regras de partida valida sao as do PegaCustomMatch: custom de bomba,
completa, 5x5 e vencedor com pelo menos 13 rounds (partida reiniciada ou
abortada sai na lista como rejeitada, com o motivo).
"""

import argparse
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from openpyxl import load_workbook

import config_hub

import PegaCustomMatch as pcm


ESPORTS_ROUTE = "esports"
TOURNAMENT_QUEUE = "tournamentmode"
OUTPUT_DIR_NAME = "out_torneio_esports"


def fold(value: Any) -> str:
    return pcm._fold_ascii(value).replace(" ", "")


def label_of(player_key: str) -> str:
    return player_key.rsplit("|row", 1)[0]


def strip_team_prefix(game_name: str) -> str:
    """'AZR greiN' -> 'greiN'. Contas de torneio vem com a sigla da equipe na frente."""
    parts = str(game_name or "").split(" ", 1)
    if len(parts) == 2 and parts[0].isupper() and 2 <= len(parts[0]) <= 5:
        return parts[1]
    return str(game_name or "")


def resolve_teams(raw: List[str], teams: List[str]) -> List[str]:
    by_fold = {pcm._fold_ascii(t): t for t in teams}
    out: List[str] = []
    for s in raw:
        f = pcm._fold_ascii(s)
        team = by_fold.get(f)
        if team is None:
            partial = sorted({t for k, t in by_fold.items() if f and f in k})
            # "ceub" -> ceub_octopus, e nao ceub_octopus_vulgaris: vale a equipe
            # cujo nome e o comeco do nome de todas as outras que casaram.
            base = [t for t in partial if all(o.startswith(t) for o in partial)]
            if len(base) == 1:
                partial = base
            if len(partial) != 1:
                raise SystemExit(
                    f"Equipe {s!r} {'ambigua: ' + ', '.join(partial) if partial else 'nao encontrada em current_team'}."
                )
            team = partial[0]
        if team not in out:
            out.append(team)
    if len(out) > 2:
        raise SystemExit("Informe no maximo 2 equipes.")
    return out


class Registry:
    """O que o players.xlsx sabe: conta -> jogador, e nick -> jogador."""

    def __init__(self) -> None:
        (
            self.teams_to_players,
            self.player_to_riotids,
            self.player_to_team,
            self.player_to_puuid,
            self.player_to_row,
            self.player_to_alt,
        ) = pcm.load_players_from_xlsx(Path(pcm.PLAYERS_XLSX_PATH))
        self.puuid_to_player: Dict[str, str] = {}
        for pk, puuid in self.player_to_puuid.items():
            if puuid:
                self.puuid_to_player[puuid] = pk
        for pk, alts in self.player_to_alt.items():
            for alt in alts:
                self.puuid_to_player.setdefault(alt, pk)

    def nick_candidates(self, game_name: str, pool: List[str]) -> List[str]:
        want = {fold(game_name), fold(strip_team_prefix(game_name))} - {""}
        hits = []
        for pk in pool:
            names = {fold(label_of(pk))}
            for rid in self.player_to_riotids.get(pk, []):
                names.add(fold(str(rid).split("#", 1)[0]))
                names.add(fold(strip_team_prefix(str(rid).split("#", 1)[0])))
            if want & names:
                hits.append(pk)
        return hits


def identify(match: Dict[str, Any], reg: Registry, pool: List[str]) -> Dict[str, Any]:
    """Reconhece cada jogador da partida e as equipes de cada lado."""
    sides: Dict[str, Dict[str, List[str]]] = {"Blue": defaultdict(list), "Red": defaultdict(list)}
    to_link: List[Tuple[str, Dict[str, Any]]] = []  # (player_key, player do payload)
    unknown: List[str] = []
    for p in match.get("players") or []:
        side = p.get("teamId")
        if p.get("isObserver") or side not in sides:
            continue
        riot_id = f'{p.get("gameName")}#{p.get("tagLine")}'
        pk = reg.puuid_to_player.get(p.get("puuid"))
        if pk is None:
            hits = reg.nick_candidates(p.get("gameName", ""), pool)
            if len(hits) == 1:
                pk = hits[0]
                to_link.append((pk, p))
            else:
                unknown.append(f"{riot_id} ({side}{', ambiguo: ' + ', '.join(map(label_of, hits)) if hits else ''})")
                continue
        team = reg.player_to_team.get(pk) or "?"
        sides[side][team].append(label_of(pk))

    detected = []
    for side, by_team in sides.items():
        for team, names in by_team.items():
            if team != "?" and len(names) >= pcm.MIN_TEAM_PLAYERS_TO_IDENTIFY:
                detected.append({"teamName": team, "teamId": side, "players": sorted(names), "playerCount": len(names)})
    return {"detected": detected, "to_link": to_link, "unknown": unknown}


def reject_reason(match: Dict[str, Any]) -> Optional[str]:
    mi = match.get("matchInfo") or {}
    if not pcm.is_custom_bomb_game(match):
        return f"nao e custom de bomba ({mi.get('provisioningFlowId')}, {str(mi.get('gameMode')).split('/')[-1]})"
    if not mi.get("isCompleted"):
        return "partida em andamento/incompleta"
    active = [p for p in match.get("players") or [] if not p.get("isObserver")]
    for side in ("Blue", "Red"):
        n = sum(1 for p in active if p.get("teamId") == side)
        if n < pcm.MIN_ACTIVE_PLAYERS_PER_SIDE:
            return f"{side} com {n} jogadores"
    won = pcm.get_winning_rounds(match)
    if won < pcm.MIN_WINNING_ROUNDS:
        return f"vencedor com {won} rounds (reiniciada ou abortada?)"
    return None


def link_accounts(reg: Registry, links: List[Tuple[str, Dict[str, Any]]]) -> int:
    """Grava as contas de torneio casadas por nick como 'puuid N' + 'nick N'."""
    seen: Set[str] = set()
    links = [(pk, p) for pk, p in links if not (p["puuid"] in seen or seen.add(p["puuid"]))]
    if not links:
        return 0
    xlsx = Path(pcm.PLAYERS_XLSX_PATH)
    backup = pcm.backup_xlsx(xlsx)
    wb = load_workbook(xlsx)
    ws = wb.active
    headers = pcm.build_headers(ws)
    for pk, p in links:
        row = reg.player_to_row[pk]
        puuid_cols = [headers["puuid"]] + [c for c, _h in pcm.get_alt_puuid_columns(headers)]
        if any(ws.cell(row, c).value == p["puuid"] for c in puuid_cols):
            continue
        free = next((c for c in puuid_cols if not ws.cell(row, c).value), None)
        if free is None:
            n = max([pcm.alt_puuid_index_from_key(h) or 1 for h in headers]) + 1
            free, _ = pcm.ensure_column(ws, headers, f"puuid{n}")
        config_hub.grava_texto(ws.cell(row, free), p["puuid"])

        riot_id = f'{p["gameName"]}#{p["tagLine"]}'
        nick_cols = [c for c, _h in pcm.get_nick_columns(headers)]
        if not any(str(ws.cell(row, c).value or "").lower() == riot_id.lower() for c in nick_cols):
            col = next((c for c in nick_cols if not ws.cell(row, c).value), None)
            if col is None:
                col, _ = pcm.create_next_nick_column(ws, headers)
            config_hub.grava_texto(ws.cell(row, col), riot_id)
        print(f"  vinculado: {riot_id} -> {label_of(pk)}")
    pcm.normalize_players_sheet_layout(ws, headers)
    wb.save(xlsx)
    print(f"players.xlsx atualizado (backup em {backup}).")
    print("Rode agora: python scripts/build_metadata.py  (na raiz do Hub)")
    return len(links)


def coletar(equipes: List[str], vincular: bool = False) -> List[Dict[str, Any]]:
    """
    Busca as partidas de torneio das ultimas 12 h e salva as validas das
    equipes pedidas. Devolve um registro por partida das equipes (ou por
    partida do servidor, sem equipes): matchId, start, map, rejeitada (motivo
    ou None), arquivo (Path salvo ou None) e contas_novas (quantas so casaram
    pelo nick e ainda nao estao no players.xlsx depois desta chamada).
    """
    reg = Registry()
    targets = resolve_teams(equipes, list(reg.teams_to_players)) if equipes else []
    pool = [pk for t in targets for pk in reg.teams_to_players.get(t, [])] or list(reg.player_to_team)

    client = pcm.RiotClient(pcm.RIOT_API_KEY, ESPORTS_ROUTE, pcm.RIOT_ROUTING)
    recent = client.get_json(f"{client.base_val}/val/match/v1/recent-matches/by-queue/{TOURNAMENT_QUEUE}")
    ids = recent.get("matchIds") or []
    print(f"Partidas de torneio nas ultimas 12 h: {len(ids)}")

    matches_dir = pcm._base_dir() / OUTPUT_DIR_NAME / "matches"
    found: List[Tuple[int, str, Dict[str, Any], Dict[str, Any]]] = []
    links: List[Tuple[str, Dict[str, Any]]] = []
    for mid in ids:
        try:
            match = client.get_json(f"{client.base_val}/val/match/v1/matches/{mid}")
        except pcm.RiotHttpError as e:
            print(f"\n{mid}: erro {e}")
            continue
        mi = match.get("matchInfo") or {}
        start = int(mi.get("gameStartMillis") or 0)
        ident = identify(match, reg, pool)
        detected = ident["detected"]
        names = {d["teamName"] for d in detected}
        wanted = bool(targets) and all(t in names for t in targets) and (
            len(targets) < 2 or len({d["teamId"] for d in detected if d["teamName"] in targets}) == 2
        )
        if targets and not wanted:
            continue
        found.append((start, mid, match, ident))

    found.sort(key=lambda x: x[0])
    saved = 0
    records: List[Dict[str, Any]] = []
    for start, mid, match, ident in found:
        mi = match.get("matchInfo") or {}
        rec: Dict[str, Any] = {
            "matchId": mid, "start": start, "map": pcm.normalize_map_name(mi.get("mapId")),
            "rejeitada": None, "arquivo": None, "contas_novas": 0,
        }
        records.append(rec)
        when = datetime.fromtimestamp(start / 1000, pcm.BRAZIL_TZ).strftime("%d/%m %H:%M")
        rounds = pcm.get_rounds_won_by_side(match)
        teams = " x ".join(f'{d["teamName"]} ({d["teamId"]})' for d in ident["detected"]) or "equipes nao reconhecidas"
        print(f"\n{when}  {pcm.normalize_map_name(mi.get('mapId'))}  Blue {rounds.get('Blue', 0)} x {rounds.get('Red', 0)} Red  [{mid}]")
        print(f"  {teams}")
        for pk, p in ident["to_link"]:
            print(f"  conta nova pelo nick: {p['gameName']}#{p['tagLine']} -> {label_of(pk)}")
        if ident["detected"] or ident["to_link"]:
            for u in ident["unknown"]:
                print(f"  nao reconhecido: {u}")
        elif ident["unknown"]:
            print(f"  {len(ident['unknown'])} contas fora do cadastro (outro evento?)")
        reason = reject_reason(match)
        if reason:
            print(f"  REJEITADA: {reason}")
            rec["rejeitada"] = reason
            continue
        if not targets:
            continue
        detected = sorted(ident["detected"], key=lambda d: targets.index(d["teamName"]) if d["teamName"] in targets else 9)
        score_a, score_b = pcm.extract_match_score(match=match, detected_teams=detected)
        saved += 1
        name = pcm.build_match_filename(
            order_num=saved, game_start_ms=start, detected_teams=detected,
            score_a=score_a, score_b=score_b, map_id=mi.get("mapId"), match_id=mid,
        )
        matches_dir.mkdir(parents=True, exist_ok=True)
        for old in matches_dir.glob("*.json"):  # mesma partida com outro numero de ordem
            if old.name != name and pcm.read_match_id_from_json_file(old) == mid:
                old.unlink()
        pcm.save_json(matches_dir / name, match)
        print(f"  salva: {matches_dir / name}")
        rec["arquivo"] = matches_dir / name
        rec["contas_novas"] = len(ident["to_link"])
        links.extend(ident["to_link"])

    if targets:
        print(f"\nSalvas: {saved}")
        if links and vincular:
            link_accounts(reg, links)
            for rec in records:
                rec["contas_novas"] = 0
        elif links:
            print(
                f"\nATENCAO: {len({p['puuid'] for _pk, p in links})} conta(s) de torneio ainda nao estao no players.xlsx;"
                " sem elas o site nao reconhece os jogadores. Rode de novo com --vincular."
            )
    return records


def main() -> None:
    ap = argparse.ArgumentParser(description="Partidas do servidor de torneio da Riot (ultimas 12 h).")
    ap.add_argument("equipes", nargs="*", help="0 = so listar; 1 = partidas da equipe; 2 = confronto direto.")
    ap.add_argument("--vincular", action="store_true", help="grava no players.xlsx as contas casadas por nick.")
    args = ap.parse_args()
    coletar(args.equipes, vincular=args.vincular)


if __name__ == "__main__":
    main()
