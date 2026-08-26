# Baixa as bandeiras dos estados do Wikimedia Commons e grava a versão local em
# assets/state-flags/<sigla>.webp.
#
# Uso: python scripts/fetch_state_flags.py [--force]
#
# Por que existe: as 27 bandeiras eram *hotlink* para
# commons.wikimedia.org/wiki/Special:FilePath/... — imagem servida do servidor
# de terceiro a cada visita, contra ~145 assets locais. Se o Commons cair ou
# renomear o arquivo, a bandeira some da tabela suíça, da página de equipe e da
# busca.
#
# Por que WebP raster e não o SVG:
#   O maior render de bandeira na interface é 22x16 CSS px (.state-flag), então
#   o alvo é 2x = 44x32. Medido nas 27:
#     SVG original ..... 1.283.281 B (1,22 MB) - RJ sozinho tem 352 KB de brasão
#     PNG quantizado ...    36.727 B
#     WebP q92 .........    16.172 B
#     WebP lossless ....    26.506 B  <- escolhido
#   Vetor perde feio aqui porque o custo do SVG é a complexidade do brasão, não
#   o tamanho de exibição.
#
# Lossless e não q92, mesmo custando 10,3 KB a mais no total: bandeira é cor
# chapada com linha fina de brasão, o pior caso possível para WebP com perda.
# Medido no Piauí, o pior dos 27, q92 fica em 20,9 dB de PSNR contra a fonte —
# ringing na borda do brasão. Lossless custa 222 B a mais nesse arquivo e
# devolve o pixel exato; 10,3 KB é 0,3% do warm cache.
#
# LARGURA_ALVO = 48 e não 44: a bandeira mais "quadrada" tem razão 1,375 e as
# mais largas chegam a 1,5. Com 48 de largura toda bandeira fecha os 32px de
# altura que o object-fit: cover precisa, sem assar o corte no arquivo.
#
# O thumbnailer do Commons ignora ?width= exato e devolve em degraus (pediu 48,
# veio 60). O redimensionamento final é local, com LANCZOS.

import argparse
import io
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DESTINO = ROOT / "assets" / "state-flags"
BASE = "https://commons.wikimedia.org/wiki/Special:FilePath/"

# Tabela explícita, e não leitura do metadata.json: depois que
# scripts/rewrite_asset_paths.js troca as URLs pelos caminhos locais, não sobra
# de onde reler a origem. Cada linha é (sigla, nome do arquivo no Commons).
ORIGENS = [
    ("AC", "Bandeira_do_Acre.svg"),
    ("AL", "Bandeira_de_Alagoas.svg"),
    ("AP", "Bandeira_do_Amap%C3%A1.svg"),
    ("AM", "Bandeira_do_Amazonas.svg"),
    ("BA", "Bandeira_da_Bahia.svg"),
    ("CE", "Bandeira_do_Cear%C3%A1.svg"),
    ("DF", "Bandeira_do_Distrito_Federal_%28Brasil%29.svg"),
    ("ES", "Bandeira_do_Esp%C3%ADrito_Santo.svg"),
    ("GO", "Bandeira_de_Goi%C3%A1s.svg"),
    ("MA", "Bandeira_do_Maranh%C3%A3o.svg"),
    ("MT", "Bandeira_de_Mato_Grosso.svg"),
    ("MS", "Bandeira_de_Mato_Grosso_do_Sul.svg"),
    ("MG", "Bandeira_de_Minas_Gerais.svg"),
    ("PA", "Bandeira_do_Par%C3%A1.svg"),
    ("PB", "Bandeira_da_Para%C3%ADba.svg"),
    ("PR", "Bandeira_do_Paran%C3%A1.svg"),
    ("PE", "Bandeira_de_Pernambuco.svg"),
    ("PI", "Bandeira_do_Piau%C3%AD.svg"),
    ("RJ", "Bandeira_do_estado_do_Rio_de_Janeiro.svg"),
    ("RN", "Bandeira_do_Rio_Grande_do_Norte.svg"),
    ("RS", "Bandeira_do_Rio_Grande_do_Sul.svg"),
    ("RO", "Bandeira_de_Rond%C3%B4nia.svg"),
    ("RR", "Bandeira_de_Roraima.svg"),
    ("SC", "Bandeira_de_Santa_Catarina.svg"),
    ("SP", "Bandeira_do_estado_de_S%C3%A3o_Paulo.svg"),
    ("SE", "Bandeira_de_Sergipe.svg"),
    ("TO", "Bandeira_do_Tocantins.svg"),
]

LARGURA_ALVO = 48
QUALIDADE = 100   # so vale como esforco: a codificacao e lossless
UA = "UNIVLR/1.0 (importacao de bandeiras estaduais para site estatico)"
PAUSA = 1.2          # o Commons devolve 429 acima de ~1 req/s
TENTATIVAS = 5


def estados():
    """(sigla, url) de cada bandeira, da tabela ORIGENS."""
    return [(sigla, BASE + arquivo) for sigla, arquivo in ORIGENS]


def baixa(url):
    for tentativa in range(1, TENTATIVAS + 1):
        pedido = urllib.request.Request(f"{url}?width={LARGURA_ALVO}", headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(pedido, timeout=30) as resposta:
                return resposta.read()
        except urllib.error.HTTPError as erro:
            if erro.code == 429 and tentativa < TENTATIVAS:
                time.sleep(PAUSA * 2 * tentativa)
                continue
            raise
    raise RuntimeError(f"esgotou as tentativas: {url}")


def converte(bruto):
    imagem = Image.open(io.BytesIO(bruto)).convert("RGBA")
    altura = max(1, round(imagem.height * LARGURA_ALVO / imagem.width))
    imagem = imagem.resize((LARGURA_ALVO, altura), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    imagem.save(buffer, format="WEBP", lossless=True, quality=QUALIDADE, method=6)
    return buffer.getvalue(), (LARGURA_ALVO, altura)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="rebaixa mesmo o que já existe")
    args = parser.parse_args()

    lista = estados()
    if not lista:
        print("nenhum estado com icone remoto em database.json - nada a fazer")
        return

    DESTINO.mkdir(parents=True, exist_ok=True)
    total = 0
    escritos = 0
    for indice, (sigla, url) in enumerate(lista):
        alvo = DESTINO / f"{sigla.lower()}.webp"
        if alvo.exists() and not args.force:
            total += alvo.stat().st_size
            print(f"  = {sigla.lower()}.webp (ja existe)")
            continue
        if indice:
            time.sleep(PAUSA)
        dados, tamanho = converte(baixa(url))
        alvo.write_bytes(dados)
        total += len(dados)
        escritos += 1
        print(f"  + {sigla.lower()}.webp  {tamanho[0]}x{tamanho[1]}  {len(dados)} B")

    print(f"\n{len(lista)} bandeiras, {escritos} baixadas nesta rodada")
    print(f"total em disco: {total} B ({total / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
