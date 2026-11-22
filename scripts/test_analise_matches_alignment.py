"""Confere se o relatorio agrega exatamente os mesmos numeros do site."""

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ferramentas" / "riot"))

import analiseMatches as analysis  # noqa: E402
import analiseAgentes as agent_analysis  # noqa: E402
import analiseMapas as map_analysis  # noqa: E402
import analiseWinSituations as state_analysis  # noqa: E402
import AuditaNicksPartidas as nick_audit  # noqa: E402


def decoded_site_players():
    script = r"""
const fs = require("fs");
const codec = require("./db-codec.js");
const db = codec.decode(JSON.parse(fs.readFileSync("database.json", "utf8")));
process.stdout.write(JSON.stringify(db.players.filter((player) => player.matches > 0)));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(result.stdout)


def assert_close(actual, expected, label, tolerance=1e-9):
    if abs(float(actual) - float(expected)) > tolerance:
        raise AssertionError(f"{label}: {actual} != {expected}")


def check_raating_3_1_formula():
    """A formula do rAAting 3.1 no Python, sem depender do banco: tres linhas, a
    media delas e as notas fixadas pela conta do estudo (scripts/estudos/nota_beta.js)."""
    linhas = [
        {"rounds": 20, "eKillPoints": 16, "eDeathPoints": 14, "eDamageTotal": 2400, "eKastPoints": 14, "adjustedRoundSwingTotalPp": 60, "multiKillPoints": 5},
        {"rounds": 24, "eKillPoints": 12, "eDeathPoints": 19, "eDamageTotal": 2100, "eKastPoints": 15, "adjustedRoundSwingTotalPp": -80, "multiKillPoints": 2},
        {"rounds": 13, "eKillPoints": 14, "eDeathPoints": 6, "eDamageTotal": 2300, "eKastPoints": 11, "adjustedRoundSwingTotalPp": 95, "multiKillPoints": 6},
    ]
    rounds = sum(linha["rounds"] for linha in linhas)
    soma = {campo: sum(linha[campo] for linha in linhas) for campo in linhas[0] if campo != "rounds"}
    center = {
        "abate": soma["eKillPoints"] / rounds,
        "sobrevivencia": 1 - soma["eDeathPoints"] / rounds,
        "dano": soma["eDamageTotal"] / rounds / 100,
        "kast": soma["eKastPoints"] / rounds,
        "swing": soma["adjustedRoundSwingTotalPp"] / rounds,
        "multikill": soma["multiKillPoints"] / rounds,
    }
    for linha, esperado in zip(linhas, (1.09041277777778, 0.553756944444444, 1.68473675213675)):
        assert_close(analysis.raating_3_1_value(linha, center), esperado, "formula do rAAting 3.1", tolerance=1e-12)


def main():
    check_raating_3_1_formula()
    payload = analysis.run_site_pipeline(ROOT / "campeonatos", recursive=True)
    unexpected_invalid = [
        row for row in payload.get("invalidFiles") or []
        if Path(row.get("path") or "").name.casefold() != "campeonato.json"
    ]
    if unexpected_invalid:
        raise AssertionError(f"Arquivos invalidos: {unexpected_invalid[:3]}")
    if payload.get("duplicateFiles"):
        raise AssertionError(f"Partidas duplicadas: {payload['duplicateFiles'][:3]}")

    records = analysis.build_records_from_site_pipeline(payload)
    records_by_player = defaultdict(list)
    for record in records:
        records_by_player[record.player_key].append(record)

    expected_by_id = {player["id"]: player for player in decoded_site_players()}
    if set(records_by_player) != set(expected_by_id):
        missing = sorted(set(expected_by_id) - set(records_by_player))[:3]
        extra = sorted(set(records_by_player) - set(expected_by_id))[:3]
        raise AssertionError(f"Identidades diferentes. Ausentes={missing}; extras={extra}")

    for player_id, player_records in records_by_player.items():
        expected = expected_by_id[player_id]
        summary = analysis.compute_player_summary_cells(player_records[0].cells[0], player_records)
        if summary[0] != expected["nick"]:
            raise AssertionError(f"Nick de {player_id}: {summary[0]} != {expected['nick']}")
        for index, field in ((28, "matches"), (4, "rounds"), (9, "kills"), (10, "deaths"), (11, "assists")):
            if int(summary[index]) != int(expected[field]):
                raise AssertionError(f"{expected['nick']} {field}: {summary[index]} != {expected[field]}")
        for index, field in ((8, "acs"), (15, "adr"), (3, "kastFrac"), (27, "raating_1"), (26, "raating_3")):
            assert_close(summary[index], expected[field], f"{expected['nick']} {field}")

    agent_records = agent_analysis.build_agent_records_from_site_pipeline(payload)
    if len(agent_records) != len(records):
        raise AssertionError(f"Atuacoes por agente: {len(agent_records)} != {len(records)}")
    omen_records = [record for record in agent_records if record.agent == "Omen"]
    omen_summary = agent_analysis.aggregate_records(omen_records, len(agent_records), "Omen", "Controlador")
    omen_totals = {name: 0.0 for name in analysis.SITE_AGGREGATE_FIELDS}
    for record in omen_records:
        for name in analysis.SITE_AGGREGATE_FIELDS:
            omen_totals[name] += float(record.aggregate.get(name, 0) or 0)
    assert_close(omen_summary[30], analysis.raating_3_1_value(omen_totals, payload["raatingCenter"]), "Omen rAAting 3.1")

    map_rows = map_analysis.analyze_maps(ROOT / "campeonatos", recursive=True)
    if sum(row.matches for row in map_rows.values()) != payload["uniqueMatchCount"]:
        raise AssertionError("analiseMapas nao preservou a contagem de partidas unicas")
    # O esperado sai dos proprios JSONs (Plummet e o codinome da Riot para Summit),
    # e nao de um numero fixo: cada campeonato novo com Summit mudaria a conta.
    plummet_ids = set()
    for json_path in (ROOT / "campeonatos").rglob("*.json"):
        try:
            info = json.loads(json_path.read_text(encoding="utf-8")).get("matchInfo") or {}
        except (ValueError, AttributeError):
            continue
        if "Plummet" in str(info.get("mapId") or ""):
            plummet_ids.add(info.get("matchId"))
    if not plummet_ids:
        raise AssertionError("nenhum mapa Plummet no acervo: o teste de normalizacao ficou sem controle")
    if map_rows.get("Summit") is None or map_rows["Summit"].matches != len(plummet_ids):
        raise AssertionError(f"analiseMapas nao normalizou Plummet como Summit ({len(plummet_ids)} esperados)")

    state_rows = state_analysis.analyze_all_round_states(ROOT / "campeonatos", recursive=True)
    if len(state_rows) != 25:
        raise AssertionError(f"Estados de round esperados: 25; recebidos: {len(state_rows)}")
    metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    metadata_states = {row["state"]: row for row in metadata.get("stateWinrates") or []}
    if set(metadata_states) != set(state_rows):
        raise AssertionError("metadata.json nao contem os mesmos estados calculados das partidas")
    for state, totals in state_rows.items():
        expected = metadata_states[state]
        if int(expected["occurrences"]) != totals["occ"] or int(expected["wins"]) != totals["win"]:
            raise AssertionError(f"{state}: metadata.json diverge das partidas")
        assert_close(expected["winRate"], totals["win"] / totals["occ"], f"{state} winRate")

    player_data = nick_audit.load_players_xlsx(ROOT / "dados_excel" / "players.xlsx")
    accounts = list(nick_audit.SHARED_ACCOUNT_RULES[0])
    borrowed_match = {
        "players": [
            {"puuid": accounts[0], "teamId": "Blue"},
            {"puuid": accounts[1], "teamId": "Blue"},
        ]
    }
    overrides = nick_audit.shared_account_overrides(borrowed_match)
    borrowed_names = [
        nick_audit.find_player_record(player, player_data, overrides).jogador
        for player in borrowed_match["players"]
    ]
    if borrowed_names != ["Laves", "Mendes"]:
        raise AssertionError(f"Contas compartilhadas: {borrowed_names}")

    print(
        "Ferramentas Riot alinhadas ao site: "
        f"{payload['uniqueMatchCount']} partidas, {len(records)} atuacoes, "
        f"{len(records_by_player)} jogadores"
    )


if __name__ == "__main__":
    main()
