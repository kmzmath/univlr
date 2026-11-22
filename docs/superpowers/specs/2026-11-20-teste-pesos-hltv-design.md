# Teste dos pesos β da HLTV no rAAting (estudo)

Data: 20/11/2026. Estudo, sem mudar nada no site. Continua o estudo de `outputs/estudo-raating-hltv-2026-11-20/RELATORIO.md`.

## Por que

- **A decisão em aberto:** a mudança 4 é trocar os pesos de hoje (.25/.33/.15/.15/.08/.04, com 1 + 0,28·z) pelos β da fórmula estimada da HLTV.
- **O que já se sabe:**
  - os β foram estimados no CS;
  - no Valorant, eles fazem o dano decidir 27% da ordem dentro do campeonato (hoje decide 16%), e sobrevivência, KAST e multi-kill quase somem;
  - não se sabe se é isso que a HLTV faz no CS.
- **O que o dono quer:** testar antes de dar o veredito, usando a HLTV como referência.
- **As mudanças 1, 2 e 3** fazem sentido para o dono e terão especificação própria.

## Objetivo

Responder com números a duas perguntas:

- **A.** Os β fazem no Valorant o que fazem no CS?
- **B.** Qual conjunto de pesos mede melhor nas partidas do univlr?

A entrega é um relatório com uma recomendação de veredito para a mudança 4.

## Fora do objetivo

- Mudar o site, regenerar `database.json`, `home.json` ou `metadata.json`, ou fazer commit sem o dono pedir.
- Coletar dados de Valorant profissional (VLR.gg, o teste C). Fica para depois, se o A mostrar uma diferença grande e for preciso separar jogo de nível.
- Estimar pesos próprios do zero pela vitória no round.

## Abordagens consideradas

- **A (escolhida):** comparar a HLTV com o univlr.
- **B (escolhida):** validar os pesos nas nossas partidas.
- **C (fora por enquanto):** Valorant profissional no VLR.gg. Separaria o efeito do jogo do efeito do nível, mas o VLR não tem swing nem ajuste de economia.

## A. HLTV x univlr

### Coleta

- **Fonte:** a página de estatística de cada jogador na HLTV (Overview), lida no Chrome do dono, uma página por vez, com pausa de alguns segundos entre elas.
  - A HLTV não tem API.
  - Se aparecer captcha ou bloqueio, paro e aviso; não contorno.
- **Período:** 1º/05/2026 a 20/11/2026, CS2, com todos os eventos (o filtro padrão).
- **Amostra:**
  - todos os jogadores com 40+ mapas no período, tirados da lista de jogadores da HLTV com esse filtro;
  - se passarem de 150, sorteio 150 com semente fixa, para não ficar só com quem joga mais (que costuma ser de time melhor).
- **Por jogador:** mapas, nota 3.0, swing (%), KPR, DPR, ADR, KAST e multi-kill (% de rounds com 2+ abates).
  - Leio com o ajuste de economia ligado e desligado.
- **Onde ficam os dados:** os da HLTV ficam em `outputs/` (fora do repositório). Não vão para o site.

### Medidas

1. **Os β ainda reproduzem a nota oficial?** Comparo a nota pela fórmula estimada com a nota 3.0 da HLTV (erro médio e correlação).
   - A unidade do multi-kill no β é incerta, então testo duas leituras: a % da HLTV como fração, e sem o termo.
2. **Quanto cada parte decide a ordem no CS:** é a participação de cada parte na variação da nota, a mesma medida do relatório anterior.
   - Calculo com os β e também contra a nota oficial.
3. **A mesma participação no univlr,** com os β, em duas amostras:
   - a carreira de quem tem 500+ rounds (290 jogadores). É a amostra mais parecida com a da HLTV, que tem uns 1.000 rounds por jogador; com amostra pequena, as partes mais ruidosas parecem pesar mais;
   - dentro do campeonato, como antes.
4. **A escala de cada entrada:** o desvio entre jogadores de KPR, DPR, ADR, KAST, swing e multi-kill no CS e no Valorant. É isso que faz o mesmo β pesar diferente.
5. **"β convertidos":** cada β multiplicado pelo desvio da entrada no CS e dividido pelo desvio no Valorant.
   - Assim cada parte fica com o mesmo peso padronizado que tem na HLTV.
   - Origem: estimativa (os β) mais medido (as escalas).
   - Meço o efeito deles como o das outras mudanças: Spearman, líderes, notas que mudam e escala.

### Limite conhecido

A HLTV é profissional e o univlr é universitário: parte da diferença pode ser de nível, e não de jogo. O relatório diz isso ao lado dos números.

## B. Validade nas partidas do univlr

- **Pesos comparados:** os de hoje, os β (escala B do Hub CS2) e os β convertidos.
- **Contagens usadas:** as de 1 + 2 + 3, como recomendado (dano cru, salto do plantio dividido entre os vivos do ataque, economia sem ajustes). As de hoje entram como conferência.
- **Estabilidade:**
  - para jogadores com 200+ rounds, separo os mapas em duas metades (alternando pela data) e meço a correlação entre as notas das metades;
  - nota que se repete mede algo do jogador, e não sorte.
- **Previsão:**
  - antes de cada mapa, calculo a nota de cada jogador só com os mapas anteriores (mínimo de 100 rounds) e faço a média da equipe;
  - meço se a diferença entre as equipes prevê quem vence o mapa (acerto e Spearman com o saldo de rounds).
  - Não uso a nota do próprio mapa, porque o swing já carrega o resultado do round e a comparação ficaria circular.

## Critério para o veredito (proposta)

- **Levar os β:** se a participação de cada parte com os β no univlr (carreira com 500+ rounds) ficar parecida com a da HLTV, até uns 5 pontos por parte, e o B não piorar.
- **Levar os β convertidos:** se a participação diferir, os β convertidos reproduzirem a da HLTV e o B não piorar.
- **Manter os pesos de hoje:** se eles forem claramente melhores no B. Ficam registrados como escolha, sem fonte.
- Os 5 pontos são uma escolha minha, para o dono ajustar.

## Entrega

- Relatório em pt-BR, sem travessão, em `outputs/estudo-raating-hltv-2026-11-20/`, com uma tabela por medida e a recomendação.
- Scripts em `scripts/estudos/`, fora do build.
- Nada vai para o site, e não há commit sem o dono pedir.

## Deixado para quem executa

- Como ligar o "Eco-adjust stats" na página (é um botão da própria página).
- Os nomes dos arquivos e o formato do CSV da coleta.
