"""Consulta o Riot ID atual de toda conta conhecida e atualiza o cadastro.

Tres grupos de conta, todos consultados na Riot:

1. as contas da planilha (colunas `puuid`, `puuid 2`, `puuid 3`...): o Riot ID
   de hoje vai para `dados_excel/riot_ids_atuais.json` e, se for novo, para a
   proxima coluna `nick N` vazia da linha (mesma funcao e mesma regra de
   conflito do PegaCustomMatch, com backup ao lado);
2. as contas que jogaram partidas em `campeonatos/` e nao tem linha na
   planilha (perfis "sem cadastro" do site): so entram no JSON;
3. as linhas sem PUUID: o Riot ID das colunas `nick N`, do mais novo para o
   mais antigo, vai para account-v1 by-riot-id. O PUUID achado so e gravado
   na coluna `puuid` se nao pertencer a outra linha; o resto sai no relatorio.

O site mostra o nome do JSON como "nick atual" do perfil. A coluna `Jogador`
nunca e tocada: o nome de exibicao e editorial.

Uso:  python ferramentas/riot/AtualizaNicks.py [--refazer] [--sem-gravar]

As respostas ficam em `trabalho/riot_ids_atuais_cache.json` e a consulta
retoma de onde parou; respostas com mais de 24 h sao refeitas. `--refazer`
ignora o cache; `--sem-gravar` so consulta e relata. O teto da chave de
desenvolvimento e o do aplicativo, 100 chamadas a cada 2 minutos (os limites
por metodo da account-v1 sao bem maiores): ~1.500 contas levam uns 30 min.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import time
from pathlib import Path

import config_hub
import PegaCustomMatch as P
from openpyxl import load_workbook

SAIDA = config_hub.DADOS_EXCEL / "riot_ids_atuais.json"
CACHE = config_hub.TRABALHO_DIR / "riot_ids_atuais_cache.json"
CAMPEONATOS = config_hub.REPO_DIR / "campeonatos"
VALIDADE_DO_CACHE_S = 24 * 3600
TAMANHO_DO_PUUID = 78


def le_planilha(caminho: Path) -> tuple[list[dict], list[dict]]:
    """Devolve (contas com PUUID, linhas sem PUUID com os nicks a tentar)."""
    ws = load_workbook(caminho, read_only=True).active
    linhas = list(ws.iter_rows(values_only=True))
    cab = [str(c or "").strip() for c in linhas[0]]
    colunas_nick = sorted(
        (c for c in cab if c.lower().startswith("nick ")),
        key=lambda c: int(c.split()[-1]) if c.split()[-1].isdigit() else 0,
    )
    contas, sem_puuid = [], []
    for numero, valores in enumerate(linhas[1:], start=2):
        linha = dict(zip(cab, valores))
        if not linha.get("Jogador"):
            continue
        jogador = str(linha["Jogador"])
        for coluna in cab:
            if coluna.lower().startswith("puuid") and linha.get(coluna):
                contas.append({"linha": numero, "jogador": jogador, "coluna": coluna,
                               "puuid": str(linha[coluna]).strip()})
        if not linha.get("puuid"):
            nicks = [str(linha[c]).strip() for c in reversed(colunas_nick) if linha.get(c)]
            sem_puuid.append({"linha": numero, "jogador": jogador, "nicks": nicks})
    return contas, sem_puuid


def contas_das_partidas(cadastradas: set[str]) -> dict[str, str]:
    """PUUID -> ultimo Riot ID com que jogou, para quem nao esta na planilha."""
    vistas: dict[str, tuple[int, str]] = {}
    for arquivo in CAMPEONATOS.rglob("*.json"):
        try:
            partida = json.loads(arquivo.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(partida, dict) or not partida.get("players"):
            continue
        inicio = (partida.get("matchInfo") or {}).get("gameStartMillis") or 0
        for jogador in partida["players"]:
            puuid = str(jogador.get("puuid") or "")
            if len(puuid) != TAMANHO_DO_PUUID or puuid in cadastradas:
                continue
            if inicio >= vistas.get(puuid, (-1, ""))[0]:
                vistas[puuid] = (inicio, f'{jogador.get("gameName", "")}#{jogador.get("tagLine", "")}')
    return {puuid: nome for puuid, (_, nome) in vistas.items()}


def consulta(chaves: list[str], cache: dict, cliente: "P.RiotClient") -> None:
    """Preenche o cache. Chave = PUUID, ou 'riotid:<nome#tag>' para a busca inversa."""
    agora = time.time()
    pendentes = [c for c in dict.fromkeys(chaves) if agora - cache.get(c, {}).get("em", 0) > VALIDADE_DO_CACHE_S]
    print(f"consultas: {len(set(chaves))} | no cache: {len(set(chaves)) - len(pendentes)} | a fazer: {len(pendentes)}", flush=True)
    for n, chave in enumerate(pendentes, start=1):
        try:
            if chave.startswith("riotid:"):
                nome, tag = P.parse_riot_id(chave[len("riotid:"):])
                acc = cliente.get_account_by_riot_id(nome, tag)
                cache[chave] = {"em": time.time(), "puuid": acc.get("puuid"), "riotId": P.account_to_riot_id(acc)}
            else:
                acc = cliente.get_account_by_puuid(chave)
                cache[chave] = {"em": time.time(), "riotId": P.account_to_riot_id(acc)}
        except P.RiotHttpError as erro:
            cache[chave] = {"em": time.time(), "erro": erro.status_code}
        except ValueError:
            cache[chave] = {"em": time.time(), "erro": "riot id malformado"}
        if n % 50 == 0 or n == len(pendentes):
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  {n}/{len(pendentes)}", flush=True)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    refazer = "--refazer" in sys.argv[1:]
    gravar = "--sem-gravar" not in sys.argv[1:]
    planilha = config_hub.PLAYERS_XLSX

    contas, sem_puuid = le_planilha(planilha)
    cadastradas = {c["puuid"] for c in contas}
    soltas = contas_das_partidas(cadastradas)
    print(f"planilha: {len(contas)} contas, {len(sem_puuid)} linhas sem PUUID | so nas partidas: {len(soltas)} contas")

    cache = {} if refazer or not CACHE.exists() else json.loads(CACHE.read_text(encoding="utf-8"))
    cliente = P.RiotClient(P.RIOT_API_KEY, P.VAL_REGION, P.RIOT_ROUTING)
    buscas_inversas = [f"riotid:{nick}" for linha in sem_puuid for nick in linha["nicks"]]
    consulta([*cadastradas, *soltas, *buscas_inversas], cache, cliente)

    def riot_id(puuid):
        return cache.get(puuid, {}).get("riotId")

    # 3. Linhas sem PUUID: o primeiro nick (do mais novo ao mais antigo) que
    # a Riot reconhece da o PUUID, se ele nao for de outra linha.
    puuid_para_gravar, chave_para_linha = {}, {}
    relato_sem_puuid = []
    for linha in sem_puuid:
        achado = next(((n, cache[f"riotid:{n}"]) for n in linha["nicks"] if cache.get(f"riotid:{n}", {}).get("puuid")), None)
        if not achado:
            relato_sem_puuid.append(f"  {linha['jogador']} (linha {linha['linha']}): nenhum nick resolve "
                                    f"({', '.join(linha['nicks']) or 'sem nick'})")
            continue
        nick, resposta = achado
        dono = next((c for c in contas if c["puuid"] == resposta["puuid"]), None)
        if dono:
            relato_sem_puuid.append(f"  {linha['jogador']} (linha {linha['linha']}): {nick} e hoje a conta de "
                                    f"{dono['jogador']} (linha {dono['linha']}) - nao gravado")
            continue
        chave = f"{linha['linha']}:puuid"
        puuid_para_gravar[chave] = resposta["puuid"]
        chave_para_linha[chave] = linha["linha"]
        jogou = " (jogou partidas registradas)" if resposta["puuid"] in soltas else ""
        relato_sem_puuid.append(f"  {linha['jogador']} (linha {linha['linha']}): PUUID achado por {nick}{jogou}")
        cadastradas.add(resposta["puuid"])
        cache[resposta["puuid"]] = {"em": time.time(), "riotId": resposta["riotId"]}

    atuais = {p: riot_id(p) for p in [*cadastradas, *soltas] if riot_id(p)}
    erros = [c for c in contas if not riot_id(c["puuid"])]
    erros_soltas = [p for p in soltas if not riot_id(p)]

    # Uma chave por conta, todas apontando para a linha da pessoa: quem tem
    # `puuid 2` ganha o Riot ID atual das duas contas nas colunas `nick N`.
    chave_para_riot_id = {}
    for conta in contas:
        if conta["puuid"] in atuais:
            chave = f'{conta["linha"]}:{conta["coluna"]}'
            chave_para_linha[chave] = conta["linha"]
            chave_para_riot_id[chave] = atuais[conta["puuid"]]
    for chave, puuid in puuid_para_gravar.items():
        chave_para_riot_id[chave] = atuais[puuid]

    renomeadas_soltas = sum(1 for p, nome in soltas.items() if atuais.get(p) and atuais[p] != nome)
    da_planilha = sum(1 for p in cadastradas if p in atuais and p not in soltas)
    print(f"\nRiot ID atual: {len(atuais)} contas ({da_planilha} da planilha, "
          f"{len(atuais) - da_planilha} so das partidas, {renomeadas_soltas} destas com nome novo)")
    print("linhas sem PUUID:")
    print("\n".join(relato_sem_puuid) or "  nenhuma")
    for erro in erros:
        print(f"  SEM RESPOSTA {erro['jogador']} ({erro['coluna']}): {cache.get(erro['puuid'], {}).get('erro')}")
    for puuid in erros_soltas:
        print(f"  SEM RESPOSTA conta sem cadastro {soltas[puuid]}: {cache.get(puuid, {}).get('erro')}")

    if not gravar:
        print("\n--sem-gravar: nada foi escrito.")
        return 0

    SAIDA.write_text(json.dumps({
        "consultadoEm": dt.date.today().isoformat(),
        "contas": dict(sorted(atuais.items())),
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    relatorio = P.write_resolved_puuids_to_xlsx(planilha, chave_para_linha, puuid_para_gravar, chave_para_riot_id)
    print(f"\n{SAIDA.name} gravado | PUUIDs gravados: {relatorio['updatedPuuidRows']} | "
          f"nicks novos na planilha: {relatorio['updatedNickRows']}")
    if relatorio.get("layoutChanged"):
        print("AVISO: a ordem das colunas da planilha foi padronizada pelo PegaCustomMatch")
    if relatorio.get("createdNickColumns"):
        print("colunas criadas:", ", ".join(relatorio["createdNickColumns"]))
    if relatorio.get("backupPath"):
        print("backup:", relatorio["backupPath"])
    for conflito in relatorio.get("nickConflicts", []):
        linhas = sorted({loc["row"] for loc in conflito["existingLocations"]})
        print(f"  CONFLITO linha {conflito['row']}: {conflito['riotId']} ja esta na(s) linha(s) {linhas}")
    for conflito in relatorio.get("puuidConflicts", []):
        print(f"  CONFLITO de PUUID na linha {conflito['row']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
