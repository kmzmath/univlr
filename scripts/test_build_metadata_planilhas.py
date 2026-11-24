"""Sem uma das planilhas obrigatorias, o build_metadata para sem gravar nada.

Roda o main() de verdade sobre uma copia do dados_excel/, com a gravacao
trocada por um registro: nenhum arquivo do repositorio e tocado.
"""

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_metadata  # noqa: E402

OBRIGATORIAS = [
    "agents.xlsx", "estados.xlsx", "maps.xlsx", "players.xlsx",
    "round_state_winrates.xlsx", "teams.xlsx", "teams_infos.xlsx", "tournaments.xlsx",
]

gravados = []
build_metadata.escreve_json = lambda caminho, dados: gravados.append(Path(caminho).name)
original = build_metadata.DATA_ROOT


def roda(pasta):
    gravados.clear()
    build_metadata.DATA_ROOT = pasta
    try:
        build_metadata.main()
        return None
    except SystemExit as erro:
        return str(erro)
    finally:
        build_metadata.DATA_ROOT = original


with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as base:
    # Controle: com tudo no lugar, grava os dois arquivos.
    completa = Path(base) / "completa"
    shutil.copytree(original, completa)
    assert roda(completa) is None
    assert gravados == ["metadata.json", "data-sources.json"], gravados

    for nome in OBRIGATORIAS:
        pasta = Path(base) / nome
        shutil.copytree(original, pasta)
        (pasta / nome).unlink()
        erro = roda(pasta)
        assert erro and nome in erro, (nome, erro)
        assert gravados == [], (nome, gravados)

print(f"ok: {len(OBRIGATORIAS)} planilhas obrigatorias, nenhuma gravacao quando falta uma")
