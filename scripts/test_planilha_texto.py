"""PUUID e Riot ID gravados na planilha voltam iguais, e nunca viram formula.

O texto_seguro poe apostrofo na frente de "-", "+", "@" para o CSV. Na
planilha o apostrofo virava parte do valor: o PUUID "-abc..." voltava como
"'-abc..." e o jogador perdia as partidas. A planilha grava por grava_texto.
"""

import sys
import tempfile
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ferramentas" / "riot"))
sys.path.insert(0, str(ROOT / "scripts"))

import config_hub  # noqa: E402
import build_metadata  # noqa: E402

VALORES = ["-abcDEF_123", "=1+1", "+x", "@y", "comum#br1"]

# O load_rows abre a planilha em modo de leitura e nao fecha: no Windows a
# pasta temporaria fica presa, e isso nao e falha do teste.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as pasta:
    caminho = Path(pasta) / "players.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.cell(1, 1).value = "puuid"
    for linha, valor in enumerate(VALORES, start=2):
        config_hub.grava_texto(ws.cell(linha, 1), valor)
    wb.save(caminho)

    # O leitor do build devolve o valor exato, sem apostrofo.
    lidos = [row["puuid"] for row in build_metadata.load_rows(caminho)]
    assert lidos == VALORES, lidos

    # E nenhuma celula foi gravada como formula.
    from openpyxl import load_workbook

    ws = load_workbook(caminho).active
    tipos = [ws.cell(linha, 1).data_type for linha in range(2, len(VALORES) + 2)]
    assert tipos == ["s"] * len(VALORES), tipos

# O CSV segue protegido como antes.
assert config_hub.texto_seguro("-x") == "'-x"
assert config_hub.texto_seguro("=x") == "'=x"
assert config_hub.texto_seguro("ok") == "ok"

print("ok: planilha guarda o texto exato e o CSV segue protegido")
