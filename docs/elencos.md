# Funções no elenco

`dados_excel/teams.xlsx` continua sendo o cadastro dos membros atuais. As colunas `player1` a `player14` identificam as pessoas; `role1` a `role14` registram a função atual da pessoa na mesma posição. Use `Titular`, `Reserva` ou `Comissão` apenas com evidência atual. Célula vazia significa função a confirmar. Uma pessoa reserva permanece no cadastro da equipe e mantém seu histórico em `players.xlsx`.

Para atualizar o site, salve a planilha e rode `scripts/build_metadata.py` e `scripts/build_database.js`. O gerador copia a função para `metadata.json`. O site mostra titulares confirmados, reservas confirmados e os demais integrantes separadamente. Até uma função ser confirmada, a formação em destaque usa as cinco séries mais recentes.

## Decisão aplicada em 21 de outubro de 2026

A revisão foi aplicada somente às equipes com pelo menos três séries nos 60 dias anteriores à data de corte. Para cada uma, as cinco séries mais recentes definiram a frequência de participação. Os cinco jogadores mais frequentes foram ordenados por séries, depois por mapas históricos pela equipe e, no empate, pela posição anterior na planilha.

- **Remover:** sem estreia registrada pela equipe; ou cinco séries perdidas em pelo menos duas datas e 60 dias sem jogar; ou cinco séries perdidas em pelo menos duas datas, 30 dias sem jogar e pelo menos uma série por outra equipe após a última atuação.
- **Titular:** entre os cinco mais frequentes e presente em pelo menos duas das cinco séries recentes.
- **Reserva:** já jogou pela equipe e não atende aos critérios acima, inclusive quando apareceu em uma das cinco séries recentes.
- **Ignorar:** equipe com menos de três séries nos 60 dias; o cadastro atual ficou sem alterações nesta rodada.

O relatório completo está em `outputs/aplicacao-elencos-2026-10-21/relatorio.xlsx`. As colunas históricas `team N` de `players.xlsx` foram preservadas; a remoção afetou o elenco atual e, quando cabível, `current_team`. Uma ausência de estreia nos arquivos locais não comprova que o jogador nunca foi inscrito ou atuou fora da cobertura disponível, portanto essa decisão pode ser revista com documentos do torneio.

Na revisão periódica, confira cada participação do time em campeonatos, especialmente a aba **Teams** do torneio no Challengermode. Registre a data, o link, os cinco da **Lineup**, os **Substitutes** e os **Coaches**. Uma inscrição antiga comprova a função naquele campeonato; sozinha, não comprova a função atual. Compare com as partidas mais recentes e só então preencha `roleN`. Para retirar alguém do elenco atual, remova o nome de `teams.xlsx` e atualize `current_team` em `players.xlsx` conforme a decisão humana; preserve o histórico de equipes e partidas.

## Evidência inicial: CAAP Hellhounds

- Nas cinco séries mais recentes registradas localmente (19 de setembro a 18 de outubro de 2026), jogaram Burrito, Medina, Metal, sobrunin e SuperPedrin. Lopes não aparece nessas cinco séries. Esta evidência corrige a escolha visual feita antes pelo total histórico de mapas, sem determinar quem ainda pertence ao elenco.
- Na [inscrição da CAAP no LPE, em maio de 2026](https://www.challengermode.com/s/Thinkgameshub/tournaments/a880743a-3f64-461f-33ef-08de95af1b37/participants), a plataforma mostra Metal, Lopes, Burrito, sobrunin e Coutinho na **Lineup**, Medina em **Substitutes** e nenhum **Coach**. Esse registro demonstra que Medina era reserva naquele campeonato, embora tenha jogado as cinco séries mais recentes da equipe.
- O [perfil de membros de uma conta CAAP Hellhounds](https://www.challengermode.com/teams/97981902-5ef4-4738-a64a-08dc377db250/members) inclui Lopes e Kaos, mas não informa se são titulares, reservas ou membros desatualizados. O LPE usa [outra conta de equipe na plataforma](https://www.challengermode.com/teams/a219db9a-9191-44b7-82a0-08de8e44aee3). Por isso, um único perfil da equipe não basta para reconstruir a cronologia.
- Kaos não tem mapas competitivos pela equipe nos dados locais; aparece como observador em dois mapas do Uni Kick-OFF Inters. Pela regra decidida nesta revisão, saiu do elenco atual. A inscrição anterior permanece no histórico para uma eventual reavaliação.

As demais inscrições em campeonatos ainda precisam de verificação individual em fontes de torneio. A planilha de auditoria anterior cobre sinais de partida de todas as equipes, mas não contém o cadastro histórico completo de cada torneio.
