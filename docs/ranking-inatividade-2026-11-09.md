# Revisão da inatividade — 09/11/2026

Aplicada à base e às 120 semanas oficiais, de 23/07/2024 a 03/11/2026.

## Regra aplicada

- Limite geral: mais de 150 dias contáveis sem jogar.
- Elenco conhecido com menos de cinco jogadores disponíveis: mais de 60 dias contáveis sem jogar. Reservas contam; comissão não conta.
- Dezembro a abril ficam fora dos dois contadores. Também ficam fora as paradas gerais de pelo menos 30 dias sem jogo de ninguém, inclusive quando ainda estão em andamento no corte da semana.
- Os intervalos são unidos antes do desconto. Sobreposições não duplicam dias. Meses seguem Brasília; jogos futuros não entram na decisão de uma semana anterior.
- Partidas durante o recesso contam normalmente e atualizam o último jogo. O recesso não zera tempo já acumulado, nem altera o decaimento das notas e das conquistas.
- Nas semanas antigas vale o elenco observado nas partidas até o corte. Saídas e dissoluções cadastradas hoje não são aplicadas retroativamente. Equipes sucedidas continuam fora; dissolvidas explicitamente também ficam fora da semana atual.

O cadastro distingue uma linha de elenco vazia de uma equipe sem linha cadastrada. Foram identificadas 132 linhas de elenco, sendo 28 vazias. Sem cadastro conhecido, vale o prazo geral. Não há data confiável para a saída do quinto jogador: a condição combina o elenco atual incompleto com o tempo desde a última partida, sem iniciar um novo contador na saída.

## Resultado da comparação

| Verificação | Resultado |
| --- | --- |
| Semanas recalculadas | 120 |
| Ocorrências anteriores de inatividade indevida corrigidas | 451, em 51 equipes |
| Total de retornos ao ranking válido com a regra combinada | 644 ocorrências de equipe/semana, em 58 equipes |
| Equipes anteriormente válidas que passaram a inativas | Nenhuma |
| Semana atual, 03/11/2026 | Mesmas 63 equipes válidas |
| Notas, modelos e demais componentes comparados | 23.400 linhas de equipe/semana, todas preservadas |
| Partidas, séries e perfis preservados integralmente | 2.244 mapas, 1.644 séries e 1.489 jogadores |

Azure Bears Golden permanece ativa de 18/03 a 13/05/2025, inclusive nos sete cortes de 25/03 a 06/05 antes marcados como inativos. Sua posição continua variando com as notas da semana: primeiro lugar até 22/04, segundo em 29/04, terceiro em 06/05 e primeiro em 13/05.

Na semana atual, cinco equipes provisórias antigas passam a receber corretamente a marca de inatividade pelo prazo geral: sixA Eaters, Grifo UFMG, Lunática UFMS, AAEU Cerberus e XXII Setembro FATEC. Isso afeta a visualização “Todos”; nenhuma delas fazia parte do ranking válido. Equipes sem estreia continuam sem aparecer, mesmo quando seu prazo de inatividade não começou.

## Validação

Passaram os testes de ranking, sucessões, identidades compartilhadas e a nova suíte de atividade. Esta cobre limites de 60/150 dias, sobreposição de pausas, meses e ano bissexto, horário de Brasília, parada em andamento, ausência de informação de elenco, reservas/comissão, dissoluções e preservação de notas. A reaplicação da regra no banco, duas vezes, manteve exatamente os mesmos snapshots. A geração da home e a decodificação do banco também passaram.

Comparação reproduzível e dados completos em `outputs/ranking-recesso-implementacao-2026-11-09/validar.cjs` e `validacao.json`; as cópias anteriores estão na mesma pasta. As regras editáveis e o comportamento permanente estão em `ranking-weights.json` e `docs/ranking.md`.
