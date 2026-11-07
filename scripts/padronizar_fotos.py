# Padroniza o enquadramento das fotos de jogador: todo rosto do mesmo tamanho
# e a linha dos olhos na mesma altura.
#
# Uso: python scripts/padronizar_fotos.py            <- so mede e relata
#      python scripts/padronizar_fotos.py --aplicar  <- reescreve os PNGs
#      python scripts/padronizar_fotos.py --aplicar --forcar <- refaz ate as ja padronizadas
#
# Requer: pip install "opencv-python-headless<5" pillow numpy
#
# Por que existe: cada equipe fotografou de um jeito (close de ombro, meio
# corpo, de longe), e na faixa de fotos da equipe uns rostos saiam com o dobro
# do tamanho de outros. O caminho da foto nao muda, so o conteudo do arquivo,
# entao metadata.json, database.json e home.json nao precisam de rebuild.
#
# Como mede: o YuNet (detector de rosto do OpenCV, em scripts/vendor/yunet)
# devolve a caixa do rosto, os olhos e a boca. O tamanho e a media de tres
# reguas (largura e altura da caixa, distancia olhos-boca), porque cada uma
# sozinha erra em algum caso: a caixa varia com cabelo e barba, a distancia
# olhos-boca com a cabeca inclinada. Mascara de silhueta e Haar foram testados
# e descartados em 07/11: cabelo comprido e mao no rosto enganam a silhueta, e
# o Haar confundiu escudo de camisa com rosto e errou ate 30% no tamanho.
#
# Os alvos sao a mediana das 102 fotos em uso em 07/11/2026, fixos de proposito:
# recalcular a mediana a cada foto nova faria todas as outras andarem.
#
# A base: a foto sangra na borda de baixo da celula, entao o corpo tem que
# encostar no chao. O chao que conta e o visivel: o site nunca mostra os 14%
# de baixo da foto (perfil e home 14%, capa da equipe 18%, lista 20%, e o
# comparador de lineups da partida corta 14% desde 07/11), entao o corpo tem
# que chegar ate CHAO, um pouco abaixo dos 86% visiveis. Encostar na borda do
# arquivo afundava o close de ombro: os ombros caiam na parte escondida e
# sobrava so a cabeca. Quando o rosto no tamanho e na linha certos deixaria o
# corpo terminando acima da borda (foto tirada de perto, que encolhe), a foto
# desce ate encostar e a escala passa a ser pela largura dos ombros, igual a
# mediana: a pessoa fica da mesma largura das outras e so perde altura, com os
# olhos mais baixos. Decisao do dono em 07/11, depois de ver lopes e rype
# flutuando com a base esmaecida (a primeira versao) - flutuar e pior que ter
# a cabeca mais baixa.
#
# O ombro e a largura do recorte entre 1,3 e 1,7 alturas de rosto abaixo dos
# olhos. Medido em unidades de rosto ele quase nao varia (p25-p75 de 172 a
# 186 px nas 136 fotos), entao trocar de regua nao faz o rosto saltar: a escala
# pelo ombro fica presa a 10% da escala pelo rosto, para pose estranha (braco
# colado, corpo de lado) nao inflar a cabeca.
#
# Idempotente: scripts/padrao_fotos.json guarda o hash de cada arquivo ja
# padronizado (ou conferido e deixado intacto), e quem bate com o hash e pulado.
# Reamostrar de novo uma foto ja padronizada so perderia nitidez.

import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:
    sys.exit('Falta o OpenCV: pip install "opencv-python-headless<5"')

ROOT = Path(__file__).resolve().parents[1]
FOTOS = ROOT / "assets" / "player-photos"
MODELO = ROOT / "scripts" / "vendor" / "yunet" / "face_detection_yunet_2023mar.onnx"
REGISTRO = ROOT / "scripts" / "padrao_fotos.json"

LADO = 320            # toda foto e LADO x LADO (scripts/optimize_images.py)
ALVO_W = 57.5         # largura da caixa do rosto
ALVO_H = 74.77        # altura da caixa do rosto
ALVO_EM = 26.93       # distancia do meio dos olhos ao meio da boca
ALVO_OLHO = 62.69     # altura da linha dos olhos
TOL_ESCALA = 0.06     # abaixo disso e ruido do detector, nao diferenca de foto
TOL_OLHO = 6          # px
CHAO = 281            # px: o corpo tem que chegar ate aqui (0,86 x 320 = 275 visiveis)
ALVO_OMBRO = 178.0    # largura dos ombros, para a foto que desce ao chao
LIMITE_OMBRO = 0.10   # quanto a escala pelo ombro pode se afastar da do rosto
CORES = 256           # mesma paleta do optimize_images.py


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def detecta(img_rgba):
    # Fundo cinza neutro: o detector nao enxerga alfa, e preto ou branco puro
    # atras de cabelo escuro ou camisa clara apaga o contorno do rosto.
    fundo = Image.new("RGBA", img_rgba.size, (128, 128, 128, 255))
    fundo.alpha_composite(img_rgba)
    k = 2  # o YuNet acha melhor rosto de 60px+ que de 30px
    rgb = fundo.convert("RGB").resize((img_rgba.width * k, img_rgba.height * k), Image.LANCZOS)
    bgr = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2BGR)
    det = cv2.FaceDetectorYN.create(str(MODELO), "", (bgr.shape[1], bgr.shape[0]), 0.5, 0.3, 50)
    _, faces = det.detect(bgr)
    if faces is None:
        return None
    f = max(faces, key=lambda r: r[14]) / k
    olho_d, olho_e, boca_d, boca_e = f[4:6], f[6:8], f[10:12], f[12:14]
    olho = (olho_d + olho_e) / 2
    boca = (boca_d + boca_e) / 2
    alfa = np.array(img_rgba)[:, :, 3] > 40
    larguras = []
    for y in range(int(olho[1] + 1.3 * f[3]), min(img_rgba.height, int(olho[1] + 1.7 * f[3]))):
        xs = np.nonzero(alfa[y])[0]
        if len(xs):
            larguras.append(xs.max() - xs.min() + 1)
    return {
        "ombro": float(np.median(larguras)) if larguras else None,
        "w": float(f[2]),
        "h": float(f[3]),
        "em": float(np.linalg.norm(boca - olho)),
        "olho_x": float(olho[0]),
        "olho_y": float(olho[1]),
        "confianca": round(float(f[14] * k), 3),
    }


def planeja(rosto, alfa):
    tamanho = (rosto["w"] / ALVO_W + rosto["h"] / ALVO_H + rosto["em"] / ALVO_EM) / 3
    escala = 1 / tamanho
    if abs(escala - 1) < TOL_ESCALA:
        escala = 1.0
    linhas = np.nonzero((alfa > 20).any(1))[0]
    base = int(linhas.max())
    olho_alvo = ALVO_OLHO
    chao = False
    if base >= LADO - 2:  # o recorte sangra na borda de baixo
        fundo = olho_alvo + escala * (base + 1 - rosto["olho_y"])
        if fundo < CHAO:
            chao = True
            if rosto["ombro"]:
                pelo_ombro = ALVO_OMBRO / rosto["ombro"]
                escala = min(max(pelo_ombro, escala * (1 - LIMITE_OMBRO)), escala * (1 + LIMITE_OMBRO))
            # desce ate a base encostar no chao visivel
            # (so desce: se a escala pelo ombro ja leva o corpo ao chao com o olho
            # na linha, o olho fica na linha)
            olho_alvo = max(ALVO_OLHO, CHAO - escala * (base + 1 - rosto["olho_y"]))
    intacta = escala == 1.0 and abs(olho_alvo - rosto["olho_y"]) < TOL_OLHO
    return {"escala": escala, "olho_alvo": olho_alvo, "chao": chao, "intacta": intacta}


def transforma(img, rosto, plano):
    s = plano["escala"]
    lado = round(LADO * s)
    # RGBa (alfa pre-multiplicado) para a borda do recorte nao ganhar halo escuro
    grande = img.convert("RGBa").resize((lado, lado), Image.LANCZOS).convert("RGBA")
    dx = round(rosto["olho_x"] - s * rosto["olho_x"])  # o olho fica no mesmo x
    dy = round(plano["olho_alvo"] - s * rosto["olho_y"])
    saida = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    cx, cy = max(0, -dx), max(0, -dy)
    pedaco = grande.crop((cx, cy, cx + LADO - max(0, dx), cy + LADO - max(0, dy)))
    saida.alpha_composite(pedaco, (max(0, dx), max(0, dy)))
    return saida


def grava(img, path):
    buffer = io.BytesIO()
    img.quantize(colors=CORES, method=Image.Quantize.FASTOCTREE).save(buffer, format="PNG", optimize=True)
    path.write_bytes(buffer.getvalue())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--forcar", action="store_true")
    args = ap.parse_args()

    registro = json.loads(REGISTRO.read_text("utf8")) if REGISTRO.exists() else {}
    arquivos = sorted(p for p in FOTOS.rglob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    contagem = {"padronizada": 0, "intacta": 0, "ja no padrao": 0, "sem rosto": 0, "fora do tamanho": 0}

    for path in arquivos:
        rel = path.relative_to(FOTOS).as_posix()
        if not args.forcar and registro.get(rel, {}).get("sha") == sha(path):
            contagem["ja no padrao"] += 1
            continue
        img = Image.open(path).convert("RGBA")
        if img.size != (LADO, LADO):
            print(f"AVISO {rel}: {img.size[0]}x{img.size[1]}, rode scripts/optimize_images.py antes")
            contagem["fora do tamanho"] += 1
            continue
        rosto = detecta(img)
        if not rosto:
            print(f"AVISO {rel}: nenhum rosto encontrado, foto deixada como esta")
            contagem["sem rosto"] += 1
            continue
        plano = planeja(rosto, np.array(img)[:, :, 3])
        nota = f"escala {plano['escala']:.3f}, olho {rosto['olho_y']:.0f} -> {plano['olho_alvo']:.0f}"
        if plano["chao"]:
            nota += ", descida ao chao (escala pelo ombro)"
        if plano["intacta"]:
            contagem["intacta"] += 1
        else:
            contagem["padronizada"] += 1
            print(f"{rel}: {nota}")
            if args.aplicar:
                grava(transforma(img, rosto, plano), path)
        if args.aplicar:
            registro[rel] = {"sha": sha(path), "escala": round(plano["escala"], 3),
                             "intacta": plano["intacta"], "chao": plano["chao"]}

    if args.aplicar:
        REGISTRO.write_text(json.dumps(dict(sorted(registro.items())), indent=1, ensure_ascii=False) + "\n", "utf8")
    print(", ".join(f"{k}: {v}" for k, v in contagem.items()))
    if not args.aplicar and contagem["padronizada"]:
        print("Nada foi gravado. Rode com --aplicar para reescrever os PNGs.")


if __name__ == "__main__":
    main()
