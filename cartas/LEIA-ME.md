# Página de revelação das cartinhas

A página pública fica em `/cartas/`. O calendário completo e os PNGs originais ficam em `outputs/cartinhas/publicacao-2026-minimo-200-rounds-12-partidas/`, fora do site publicado.

O arquivo `manifest.json` contém nomes, imagens, time, estatísticas, agentes e mapas recentes apenas dos jogadores já revelados. Os próximos dias mostram somente data e quantidade. A pasta `cards/` também contém apenas as cartinhas liberadas. A página mostra as 216 posições em sequência: perfil completo nas posições reveladas e cartinha preta com `?` nas bloqueadas. A busca encontra somente jogadores revelados; o menu de datas leva a qualquer dia. Cada perfil tem um contêiner com números, agentes e resumo dos três mapas mais recentes.

Para atualizar a página no dia da publicação, depois de revisar o calendário e as imagens exportadas:

```powershell
& 'C:\Users\mmora\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/build_card_reveal.py --ate 2026-10-23
```

No dia seguinte:

```powershell
& 'C:\Users\mmora\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/build_card_reveal.py --ate 2026-10-24
```

Troque a data a cada publicação. O comando recusa datas futuras. `--preview` prepara a edição em `outputs/cartinhas/preview-cartas/`, fora do site publicado. **A edição de 23/10 está nessa prévia local; a página pública de 22/10 mostra todas as datas bloqueadas.**

Depois dos jogos restantes, recalcule os overalls, atualize o CSV do calendário e reexporte as cartinhas afetadas antes de gerar a próxima edição. O publicador lê o banco atualizado para os perfis dos jogadores liberados e confere 216 entradas, ordem crescente, no máximo 10 por dia e o top 20 depois de 14/11. Se a elegibilidade final alterar o total, refaça o calendário e ajuste essas validações conscientemente.

O navegador busca o manifesto sem cache, mas a página só muda para o público quando os arquivos gerados são publicados no site. A atualização diária requer executar este comando e publicar a nova versão.
