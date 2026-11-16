# Recordes numa série e aba Troféus

16/11/2026. Pedido do dono: os Recordes de Estatísticas > Jogadores só olham um mapa; ele quer também por série. E um hall de troféus no estilo quadro olímpico: quem tem mais primeiros, segundos e terceiros.

## Medidas que guiaram o desenho

- 1.930 séries no banco, 68% MD1 (série = mapa). Com 2 mapas ou mais: 612 MD3 (448 em 2-0, 153 em três mapas) e 9 MD5. 11 MD3 têm um mapa só no banco.
- Maior número de abates numa série: khianh 101 (MD5, 4 mapas), Tazyg 99 (MD5, 5 mapas); em MD3, Catioro 84.
- Zé Gotas lidera assistências por série (91) por causa dos 68 de um mapa só, que já é uma decisão de dado pendente com o dono.
- 34 campeonatos visíveis e encerrados dão pódio (tier S 8, A 9, B 10, C 7). 297 jogadores com medalha, 120 com ouro. Topo: André e greinzera 4-4-5, taek 4-4-4.
- Calcular os troféus de todos os jogadores com `playerTrophyAchievements` leva 2 segundos; precisa de um índice.

## Abordagens

Recordes por série
- **Seletor na aba Recordes (escolhido, minha proposta, sem objeção dele):** "Num mapa | Numa série", com as mesmas sete categorias. Mantém um lugar só para recorde.
- Aba separada "Séries": duplica filtros e categorias sem ganho.
- Contar MD1 como série: repete o recorde por mapa em 68% das linhas.

Hall de troféus (visual escolhido por ele em 16/11, com print de dados reais)
- A, tabela olímpica só com números; C, prateleira com as taças; B, líder em destaque (o 1º hoje é empate).
- Ele pediu meio A e meio C. Entre "prateleira ao lado dos números" e "taças nas colunas", **escolheu taças nas colunas**.

## Decisões dele

- Visual da aba Troféus: cada cor é uma coluna com o número e as taças daquela cor.
- Off Season e Practice do LBEU 2025 contam medalha igual ao Championship (como no perfil).

## Desenho

### Recordes numa série
- URL: `?por=serie` em `#/stats/jogadores/recordes`. Seletor "Num mapa | Numa série" na aba, antes das categorias.
- Unidade: um jogador numa série, só quando ele jogou 2 mapas ou mais nela.
- Abates, assistências, first kills e 4K ou mais somados; ACS, ADR e rAAting pela soma dos mapas da série (`aggregateMatchPlayers`, a convenção de Estatísticas).
- Linha: posição, número, jogador com K/D/A da série, ícones dos agentes de cada mapa, os mapas e o placar da série contra o adversário (link para a série inteira), campeonato e data.
- Filtros de mapa (Mapa, Agente, Função, Patch) não valem para série: ao trocar para "Numa série" eles saem da URL e somem da barra. Formato oferece só MD3 e MD5; MD1 e Mapa decisivo saem da URL na troca.
- Empate divide a posição; desempate de ordem pela data mais recente (igual ao por mapa).

### Aba Troféus
- Rota `#/stats/jogadores/trofeus`, depois de Recordes.
- Quem leva: a regra do perfil. Jogador que jogou pela equipe no campeonato, pela equipe com mais séries dele ali (`principal`). 3º/4º lugar conta bronze. MVP fica fora (só 2 no banco).
- Ordem olímpica: ouro, depois prata, depois bronze; empate divide a posição; empate em ordem alfabética.
- Linha: posição, jogador (logo da equipe, foto, nick e nome da equipe; pedido dele em 16/11), Ouro, Prata e Bronze cada um com o número na cor da medalha e as taças daquela cor (mais recente primeiro, cada taça leva ao campeonato e tem o nome no balão), Total.
- Foto solta, sem moldura, apoiada no chão da linha e com os 14% de baixo cortados, como no resto do site; quem não tem foto leva a silhueta (`playerFigure`). 90 dos 297 medalhistas têm foto, e os 12 primeiros todos têm.
- Filtros: Ano, De, Até (data do fim do campeonato), Tier e Equipe (a equipe com que a medalha foi ganha). O número de cada opção conta medalhas.
- 25 por página, paginação igual à de Recordes. Na tela estreita a linha empilha, sem rolagem lateral.
- Índice próprio calculado uma vez por banco, conferido contra `playerTrophyAchievements` para todos os perfis.

## Fora do escopo
- Quadro de medalhas de equipes.
- "Recordes numa série" na ficha do trilho da Visão Geral.
- Mexer no pódio do perfil ou nas divisões do LBEU.
