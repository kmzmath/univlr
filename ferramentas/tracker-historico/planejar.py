"""Planeja a coleta por cobertura da chave. Não faz requisições externas."""
import argparse
import functools
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse


def linked_handle(player):
    url = urlparse(player.get("trackerUrl") or "")
    match = re.match(r"^/valorant/profile/riot/([^/]+)", url.path)
    return unquote(match[1]) if url.hostname in ("tracker.gg", "www.tracker.gg") and match else player["handle"]


def minimum_team_cover(fixtures):
    seeds = sorted({x[k] for x in fixtures for k in ("teamA", "teamB")})
    index = {seed: i for i, seed in enumerate(seeds)}
    neighbors = [0] * len(seeds)
    for game in fixtures:
        a, b = index[game["teamA"]], index[game["teamB"]]
        neighbors[a] |= 1 << b
        neighbors[b] |= 1 << a

    @functools.lru_cache(None)
    def independent(mask):
        if not mask:
            return 0
        available = [i for i in range(len(seeds)) if mask >> i & 1]
        vertex = max(available, key=lambda i: (neighbors[i] & mask).bit_count())
        without = mask & ~(1 << vertex)
        skip = independent(without)
        take = (1 << vertex) | independent(without & ~neighbors[vertex])
        return skip if skip.bit_count() >= take.bit_count() else take

    chosen_independent = independent((1 << len(seeds)) - 1)
    result = [seed for i, seed in enumerate(seeds) if not (chosen_independent >> i & 1)]
    assert all(game["teamA"] in result or game["teamB"] in result for game in fixtures)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path, help="Pasta com manifesto.json e elencos-normalizados.json")
    parser.add_argument("--players-per-team", type=int, default=2)
    args = parser.parse_args()
    if args.players_per_team < 1:
        parser.error("--players-per-team deve ser positivo")
    root = args.folder.resolve()
    manifest = json.loads((root / "manifesto.json").read_text(encoding="utf-8"))
    teams = json.loads((root / "elencos-normalizados.json").read_text(encoding="utf-8"))
    by_seed = {x["seed"]: x for x in teams}
    fixtures = [x for x in manifest["slots"] if x["status"] == "placar_de_rounds"]
    timestamps = [datetime.fromisoformat(x[key]) for x in fixtures for key in ("scheduledAt", "reportedAt") if x.get(key)]
    if not timestamps and not manifest.get("window"):
        raise ValueError("Informe a janela do torneio ou datas nos confrontos.")
    window = manifest.get("window") or {
        "fromInclusive": min(timestamps).replace(hour=0, minute=0, second=0, microsecond=0).isoformat(),
        "toExclusive": (max(timestamps).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).isoformat(),
        "timezone": manifest.get("timezone"),
    }
    outstanding = [x for x in fixtures if not x["trackerMatches"]]
    full_cover = minimum_team_cover(fixtures)
    remaining_cover = minimum_team_cover(outstanding)
    selected = remaining_cover
    profiles = {}
    fallback = []
    for team in teams:
        starters = [x for x in team["members"] if x["role"] == "Lineup" and x.get("handle")]
        reserves = [x for x in team["members"] if x["role"] == "Substitutos" and x.get("handle")]
        seen = set()
        ordered = []
        for player in starters + reserves:
            player = {**player, "handleDisplay": player["handle"], "handle": linked_handle(player)}
            key = player["handle"].casefold()
            if key not in seen:
                seen.add(key)
                ordered.append(player)
        initial = ordered[:args.players_per_team] if team["seed"] in selected else []
        for player in initial:
            key = player["handle"].casefold()
            entry = profiles.setdefault(key, {"handle": player["handle"], "trackerUrl": player.get("trackerUrl"), "registrations": []})
            entry["registrations"].append({"seed": team["seed"], "team": team["name"]})
        fallback.append({"seed": team["seed"], "team": team["name"], "handles": [x["handle"] for x in ordered if x not in initial]})

    plan = {
        "schemaVersion": 1,
        "tournamentId": manifest["tournamentId"],
        "tournament": manifest["tournament"],
        "window": window,
        "discovery": {"playlist": "custom", "modeKey": "bomb", "playersPerSelectedTeam": args.players_per_team, "strategy": "indices_primeiro_cobertura_da_chave_e_expansao_por_faltantes", "pagination": "localizar_primeira_pagina_da_janela_por_busca_exponencial_e_binaria_depois_seguir_cursores_ate_fim_da_janela"},
        "coverage": {"totalRegistrations": len(teams), "roundScoreFixtures": len(fixtures), "minimumTeamsForFullBracket": full_cover, "profilesIfTwoPerFullCoverTeam": len(full_cover) * 2, "alreadyDownloadedFixtureNumbers": [x["number"] for x in fixtures if x["trackerMatches"]], "remainingRoundScoreFixtures": len(outstanding), "selectedTeamsForRemainingFixtures": selected, "initialUniqueProfiles": len(profiles), "note": "Minimiza equipes consultadas no grafo, não o tempo de rede. A presença de jogadores nos jogos e a disponibilidade do histórico devem ser verificadas; expandir somente para confrontos sem cobertura."},
        "profiles": list(profiles.values()),
        "fallbackProfilesByTeam": fallback,
        "expectedFixtures": [{**x, "teamAName": by_seed[x["teamA"]]["name"], "teamBName": by_seed[x["teamB"]]["name"]} for x in outstanding],
        "administrativeResultsToReview": [x for x in manifest["slots"] if x["status"] == "resultado_0_1_a_verificar"],
        "download": {"deduplicateBy": "matchId", "alreadyDownloadedIds": [x["matchId"] for x in manifest["trackerMatches"]], "preserveOriginalTrackerJson": True, "resumeFromValidatedFiles": True},
        "validation": {"requireTournamentWindow": True, "compareRegisteredOpponentsAndScore": True, "minimumKnownPlayersPerSideForCandidate": 3, "fullRosterMatchPlayersPerSide": 5, "keepUnresolvedPlayersExplicit": True, "neverClassifyByDateAlone": True, "allowCorroboratedLineups": False},
    }
    (root / "plano-coleta-lote.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(plan["coverage"], ensure_ascii=True))


if __name__ == "__main__":
    main()
