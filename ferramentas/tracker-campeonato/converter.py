"""Converte o JSON de partida do tracker.gg para o formato da Riot (match-v1).

Uso: python ferramentas/tracker-campeonato/converter.py <puuids.json> <saida> <entrada>...

Cada entrada é um arquivo do tracker, uma pasta deles, ou o lote/relatorio.json
de uma coleta (coletar.cjs): neste caso só entram os arquivos que casaram com
um jogo, lidos de <pasta>/tracker/.

O tracker guarda o mesmo dado da Riot com outro esquema (medido em 25/10/2026:
na UNIVAVA_P_006a, abates, dano, economia e rounds deram hash idêntico). O que
ele não tem, e como sai aqui:

- PUUID: o tracker identifica pelo Riot ID atual. O PUUID vem de puuids.json
  (resolver_puuid.py, account-v1 com a nossa chave). Sem PUUID, a conta recebe
  "sem-puuid:<riot id>" e entra em conversao.semPuuid.
- Nome: gameName/tagLine são o Riot ID ATUAL, não o da época da partida.
- Colete: desconhecido. Sai COLETE_DESCONHECIDO, que o app.js e o Python já
  tratam como +50 (pesado) pela regra "id desconhecido -> 50". É escolha do
  dono, medida em comparar_site.cjs.
- Arma comprada, patch (gameVersion), cerimônia do round, party, card e título:
  vazios. Nenhum deles entra em estatística; o patch só aparece como rótulo.
- Coach e observador: o tracker só traz os 10 jogadores.
- Duração: o tracker arredonda para segundos.

O bloco "conversao" no topo do arquivo registra a origem e essas suposições;
os consumidores ignoram chaves que não conhecem.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

COLETE_DESCONHECIDO = "TRACKER-COLETE-DESCONHECIDO"

# UUID do mapa no tracker -> caminho da Riot. Tirado das páginas de índice do
# tracker, que trazem os dois (attributes.mapId e metadata.map).
MAPAS = {
    "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319": "/Game/Maps/Ascent/Ascent",
    "2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba": "/Game/Maps/Duality/Duality",
    "2fb9a4fd-47b8-4e7d-a969-74b4046ebd53": "/Game/Maps/Foxtrot/Foxtrot",
    "b529448b-4d60-346e-e89e-00a4c527a405": "/Game/Maps/Canyon/Canyon",
    "2bee0dc9-4ffe-519b-1cbd-7fbe763a6047": "/Game/Maps/Triad/Triad",
    "e2ad5c54-4114-a870-9641-8ea21279579a": "/Game/Maps/Port/Port",
    "2fe4ed3a-450a-948b-6d6b-e89a78e680a9": "/Game/Maps/Jam/Jam",
    "fd267378-4d1d-484f-ff52-77821ed10dc2": "/Game/Maps/Pitt/Pitt",
    "d960549e-485c-e861-8d71-aa9d1aed12a2": "/Game/Maps/Bonsai/Bonsai",
    "92584fbe-486a-b1b2-9faa-39b0f486b498": "/Game/Maps/Juliett/Juliett",
    "224b0a95-48b9-f703-1bd8-67aca101a61f": "/Game/Maps/Infinity/Infinity",
    "1c18ab1f-420d-0d8b-71d0-77ad3c439115": "/Game/Maps/Rook/Rook",
    "756da597-416b-c0f2-f47b-afbdf28670bc": "/Game/Maps/Plummet/Plummet",
}

# roundResult do tracker é o código da Riot; o texto vem desta tabela, que é a
# do nosso acervo (pares observados em 7.846 rounds).
RESULTADOS = {
    "Elimination": ("Elimination", "Eliminated"),
    "Defuse": ("Defuse", "Bomb defused"),
    "Detonate": ("Detonate", "Bomb detonated"),
    "Time": ("", "Round timer expired"),
    "Surrendered": ("Surrendered", "Surrendered"),
}

MODO_BOMBA = "/Game/GameModes/Bomb/BombGameMode.BombGameMode_C"


def valor(seg: dict, chave: str, padrao=0):
    v = ((seg.get("stats") or {}).get(chave) or {}).get("value", padrao)
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).astimezone(timezone.utc).timestamp() * 1000)


class Identidades:
    def __init__(self, puuids: dict):
        self.por_id = {str(r["riotId"]).strip().lower(): r for r in puuids.values()}
        self.sem_puuid: set[str] = set()

    def puuid(self, rid: str) -> str:
        r = self.por_id.get(str(rid or "").strip().lower())
        if r and r.get("puuid"):
            return r["puuid"]
        self.sem_puuid.add(rid)
        return f"sem-puuid:{str(rid).strip().lower()}"


def locais(lista, ident: Identidades):
    if not lista:
        return None
    return [{"puuid": ident.puuid(p["platformUserIdentifier"]), "viewRadians": p.get("viewRadians"),
             "location": p.get("location")} for p in lista]


def converter(doc: dict, ident: Identidades) -> dict:
    d = doc["data"]
    md = d["metadata"]
    if md.get("modeKey") != "bomb":
        raise ValueError(f"modo {md.get('modeKey')!r} não é bomba")
    if md.get("scoreboardOnly") or not md.get("extendedDataIncluded"):
        raise ValueError("partida sem dados por round no tracker")
    if md["map"] not in MAPAS:
        raise ValueError(f"mapa {md['map']} ({md.get('mapName')}) fora da tabela MAPAS")

    seg = defaultdict(list)
    for s in d["segments"]:
        seg[s["type"]].append(s)
    rid = lambda s: s["attributes"]["platformUserIdentifier"]  # noqa: E731
    adv = lambda s: s["attributes"]["opponentPlatformUserIdentifier"]  # noqa: E731

    duracao = int(md["duration"])
    rounds_por_jogador = Counter(rid(s) for s in seg["player-round"])
    resumo = seg["player-summary"]

    players = []
    for s in resumo:
        r = rid(s)
        nome, _, tag = r.rpartition("#")
        players.append({
            "puuid": ident.puuid(r), "gameName": nome, "tagLine": tag,
            "teamId": s["metadata"]["teamId"], "partyId": "",
            "characterId": s["metadata"]["agentKey"],
            "stats": {
                "score": valor(s, "score"), "roundsPlayed": rounds_por_jogador[r],
                "kills": valor(s, "kills"), "deaths": valor(s, "deaths"), "assists": valor(s, "assists"),
                "playtimeMillis": duracao,
                "abilityCasts": {k: valor(s, k) for k in ("grenadeCasts", "ability1Casts", "ability2Casts", "ultimateCasts")},
            },
            "competitiveTier": 0, "isObserver": False, "playerCard": "", "playerTitle": "",
            "accountLevel": s["metadata"].get("accountLevel") or 0,
        })
    ordem = [rid(s) for s in resumo]

    times = []
    for s in seg["team-summary"]:
        ganhos, perdidos = valor(s, "roundsWon"), valor(s, "roundsLost")
        venceu = bool(s["metadata"].get("hasWon"))
        times.append({"teamId": s["attributes"]["teamId"], "won": venceu, "rank": 1 if venceu else 2,
                      "roundsPlayed": ganhos + perdidos, "roundsWon": ganhos, "numPoints": ganhos})

    por_round = lambda tipo: {  # noqa: E731
        n: [s for s in seg[tipo] if s["attributes"]["round"] == n]
        for n in {s["attributes"]["round"] for s in seg[tipo]}
    }
    rodadas, abates, danos = por_round("player-round"), por_round("player-round-kills"), por_round("player-round-damage")
    resumos = {s["attributes"]["round"]: s for s in seg["round-summary"]}

    rounds = []
    for n in range(1, int(md["rounds"]) + 1):
        rs = resumos[n]
        vencedor = valor(rs, "winningTeam", "")
        codigo, texto = RESULTADOS[valor(rs, "roundResult", "")]
        lado = {s["metadata"]["teamId"]: s["metadata"].get("teamSide") for s in rodadas.get(n, [])}
        plant, defuse = rs["metadata"].get("plant"), rs["metadata"].get("defuse")
        linhas = sorted(rodadas.get(n, []), key=lambda s: ordem.index(rid(s)) if rid(s) in ordem else 99)
        player_stats = []
        for s in linhas:
            r = rid(s)
            kills = sorted((k for k in abates.get(n, []) if rid(k) == r), key=lambda k: k["metadata"]["gameTime"])
            player_stats.append({
                "puuid": ident.puuid(r),
                "kills": [{
                    "timeSinceGameStartMillis": k["metadata"]["gameTime"],
                    "timeSinceRoundStartMillis": k["metadata"]["roundTime"],
                    "killer": ident.puuid(r), "victim": ident.puuid(adv(k)),
                    "victimLocation": k["metadata"].get("opponentLocation"),
                    "assistants": [ident.puuid(a["platformUserIdentifier"]) for a in k["metadata"].get("assistants") or []],
                    "playerLocations": locais(k["metadata"].get("playerLocations"), ident) or [],
                    "finishingDamage": k["metadata"].get("finishingDamage"),
                } for k in kills],
                "damage": [{
                    "receiver": ident.puuid(adv(g)), "damage": valor(g, "damage"),
                    "legshots": valor(g, "legshots"), "bodyshots": valor(g, "bodyshots"), "headshots": valor(g, "headshots"),
                } for g in danos.get(n, []) if rid(g) == r],
                "score": valor(s, "score"),
                "economy": {"loadoutValue": valor(s, "loadoutValue"), "weapon": "", "armor": COLETE_DESCONHECIDO,
                            "remaining": valor(s, "remainingCredits"), "spent": valor(s, "spentCredits")},
                "ability": {"grenadeEffects": None, "ability1Effects": None, "ability2Effects": None, "ultimateEffects": None},
            })
        rounds.append({
            "roundNum": n - 1, "roundResult": texto, "roundCeremony": "",
            "winningTeam": vencedor, "winningTeamRole": str(lado.get(vencedor) or "").capitalize(),
            "bombPlanter": ident.puuid(plant["platformUserIdentifier"]) if plant else None,
            "bombDefuser": ident.puuid(defuse["platformUserIdentifier"]) if defuse else None,
            "plantRoundTime": plant["roundTime"] if plant else 0,
            "plantPlayerLocations": locais(plant.get("playerLocations"), ident) if plant else None,
            "plantLocation": plant["location"] if plant else {"x": 0, "y": 0},
            "plantSite": plant.get("site", "") if plant else "",
            "defuseRoundTime": defuse["roundTime"] if defuse else 0,
            "defusePlayerLocations": locais(defuse.get("playerLocations"), ident) if defuse else None,
            "defuseLocation": defuse["location"] if defuse else {"x": 0, "y": 0},
            "playerStats": player_stats,
            "roundResultCode": codigo,
        })

    return {
        "matchInfo": {
            "matchId": d["attributes"]["id"], "mapId": MAPAS[md["map"]], "gameVersion": "",
            "gameLengthMillis": duracao, "region": "br", "gameStartMillis": ms(md["dateStarted"]),
            "provisioningFlowId": "CustomGame", "isCompleted": True, "customGameName": "", "queueId": "",
            "gameMode": MODO_BOMBA, "isRanked": False, "seasonId": md.get("seasonId") or "", "premierMatchInfo": {},
        },
        "players": players,
        "coaches": [],
        "teams": times,
        "roundResults": rounds,
        "conversao": {
            "fonte": "tracker.gg",
            "url": f"https://tracker.gg/valorant/match/{d['attributes']['id']}",
            "conversor": "ferramentas/tracker-campeonato/converter.py",
            "convertidoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "suposicoes": {
                "colete": f"desconhecido ({COLETE_DESCONHECIDO}); app.js e Python assumem +50",
                "nomes": "Riot ID atual da conta, não o da época da partida",
                "vazios": "arma comprada, gameVersion, roundCeremony, partyId, playerCard, playerTitle",
                "ausentes": "coaches e observadores",
                "duracao": "arredondada para segundos pelo tracker",
            },
            "semPuuid": sorted(ident.sem_puuid),
        },
    }


def main() -> None:
    puuids_json, saida, *entradas = sys.argv[1:]
    puuids = json.loads(Path(puuids_json).read_text(encoding="utf-8"))
    destino = Path(saida)
    destino.mkdir(parents=True, exist_ok=True)
    arquivos = []
    for e in map(Path, entradas):
        if e.is_dir():
            arquivos += sorted(e.glob("*.json"))
        elif e.name == "relatorio.json":
            rel = json.loads(e.read_text(encoding="utf-8"))
            pasta = e.parent.parent / "tracker"
            arquivos += [pasta / f"{a['arquivo']['uuid']}.json" for a in rel["alvos"] if a.get("arquivo")]
        else:
            arquivos.append(e)

    ok, falhas, sem = 0, [], Counter()
    for f in arquivos:
        ident = Identidades(puuids)
        try:
            riot = converter(json.loads(f.read_text(encoding="utf-8")), ident)
        except Exception as exc:  # noqa: BLE001 - relata e segue
            falhas.append((f.name, str(exc)))
            continue
        (destino / f"{riot['matchInfo']['matchId']}.json").write_text(json.dumps(riot, ensure_ascii=False), encoding="utf-8")
        sem.update(riot["conversao"]["semPuuid"])
        ok += 1
    print(f"convertidos {ok}/{len(arquivos)}; contas sem PUUID: {len(sem)} {sorted(sem)}")
    for nome, erro in falhas:
        print(f"  FALHA {nome}: {erro}")


if __name__ == "__main__":
    main()
