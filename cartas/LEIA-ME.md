# Página de revelação das cartinhas

A página pública fica em `/cartas/`. O calendário completo e os PNGs originais ficam em `outputs/cartinhas/publicacao-2026-minimo-200-rounds-12-partidas/`, fora do site publicado.

O arquivo `manifest.json` traz o calendário inteiro (data e quantidade de cada dia) e o perfil completo só dos jogadores já revelados: nome, imagem, equipe com a cor da linha, estatísticas, agentes e os três jogos mais recentes. A pasta `cards/` também contém apenas as cartinhas liberadas.

A página mostra cada dia revelado como uma lista, o dia mais recente primeiro: uma linha por jogador com a miniatura da cartinha, equipe, overall, rAAting, ACS, K/D, KAST e agentes. Clicar na linha abre o perfil com a cartinha grande e os últimos jogos. Os dias que ainda não saíram aparecem só no calendário ao lado, com a quantidade e a faixa de posições de cada dia. A busca encontra somente jogadores revelados, e `#carta-12` no endereço abre o perfil da posição 12.

Para atualizar a página no dia da publicação, depois de revisar o calendário e as imagens exportadas (o Python precisa do Pillow):

```powershell
python scripts/build_card_reveal.py --ate 2026-10-24
```

Troque a data a cada publicação. O comando recusa datas futuras. `--preview` prepara a edição em `outputs/cartinhas/preview-cartas/`, fora do site publicado. A página pública está revelada até 23/10.

Depois dos jogos restantes, recalcule os overalls, atualize o CSV do calendário e reexporte as cartinhas afetadas antes de gerar a próxima edição. O publicador lê o banco atualizado para os perfis dos jogadores liberados e confere 216 entradas, ordem crescente, no máximo 10 por dia e o top 20 depois de 14/11. Se a elegibilidade final alterar o total, refaça o calendário e ajuste essas validações conscientemente.

O navegador busca o manifesto sem cache, mas a página só muda para o público quando os arquivos gerados são publicados no site. A atualização diária requer executar este comando e publicar a nova versão.
