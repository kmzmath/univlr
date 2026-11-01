# Gera a imagem do fundo do site a partir de assets/team-logos.
#
# Os escudos ficam em xadrez: as linhas impares andam meia coluna, e isso forma
# as diagonais por onde eles descem. A imagem tem o mesmo lado na largura e na
# altura, entao andar um lado para baixo e um para a esquerda fecha o ciclo sem
# salto (.vp-fundo no placar.css).
#
# Rodar de novo quando entrar logo novo: python scripts/gerar_fundo.py

import glob
import os
import random

import numpy as np
from PIL import Image

COLUNA = 216
LINHA = 108
LOGO = 96
COLUNAS = 8
LINHAS = 16
ESCALA = 1.25
SAIDA = "assets/fundo/escudos.webp"


def tons_do_logo(rgba):
    a = rgba[..., 3] / 255
    luz = (rgba[..., :3] @ np.array([0.299, 0.587, 0.114])) / 255
    return a * (0.45 + 0.55 * luz)


def carregar(arquivo, lado):
    imagem = Image.open(arquivo).convert("RGBA")
    imagem.thumbnail((lado, lado), Image.LANCZOS)
    quadro = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    quadro.alpha_composite(imagem, ((lado - imagem.width) // 2, (lado - imagem.height) // 2))
    return np.asarray(quadro, dtype=np.float32)


def main():
    arquivos = sorted(glob.glob("assets/team-logos/*.png"))
    random.Random(2026).shuffle(arquivos)
    lado_da_trama = round(COLUNAS * COLUNA * ESCALA)
    lado = round(LOGO * ESCALA)
    tons = np.zeros((lado_da_trama, lado_da_trama), dtype=np.float32)

    for n in range(COLUNAS * LINHAS):
        linha, coluna = divmod(n, COLUNAS)
        x0 = round((coluna + 0.5 * (linha % 2)) * COLUNA * ESCALA)
        y0 = round(linha * LINHA * ESCALA)
        ys = (np.arange(lado) + y0) % lado_da_trama
        xs = (np.arange(lado) + x0) % lado_da_trama
        tons[np.ix_(ys, xs)] = tons_do_logo(carregar(arquivos[n % len(arquivos)], lado))

    saida = np.full((lado_da_trama, lado_da_trama, 4), 255, dtype=np.uint8)
    saida[..., 3] = np.round(tons * 255).astype(np.uint8)
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    Image.fromarray(saida, "RGBA").save(SAIDA, quality=70, alpha_quality=55, method=6)


main()
