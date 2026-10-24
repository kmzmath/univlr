# Página de revelação das cartinhas

A página pública fica em `/cartas/`. O calendário completo e os PNGs originais ficam em `outputs/cartinhas/publicacao-2026-minimo-200-rounds-12-partidas/`, fora do site publicado.

O arquivo `manifest.json` traz o calendário inteiro (data e quantidade de cada dia) e o perfil completo só dos jogadores já revelados: nome, imagem, equipe com a cor da linha, estatísticas, força média de adversário, agentes, os jogos mais recentes e o identificador da conversa da cartinha. A pasta `cards/` também contém apenas as cartinhas liberadas.

## Numeração e revelação

É revelado um lote por dia, do menor para o maior overall. A posição na coleção é o inverso da ordem de revelação: o primeiro dia revelou da #216 à #207, e a #1, o melhor jogador, sai por último, em 24 de novembro. O arquivo de cada imagem leva a posição (`cards/216.webp`).

A revelação é às **21:30 de Brasília** (UTC-3, sem horário de verão). O topo mostra quantas já saíram e uma contagem regressiva até a próxima, com a data e a faixa de posições do lote. A edição do dia é publicada à mão, um pouco antes das 21:30, e nenhuma cartinha futura fica no site antes disso. Se a edição chega antes da hora, ela fica no manifesto, mas a página só a mostra quando a contagem zera (a busca, o calendário e a contagem também a ignoram até lá). Se a edição atrasa, a página busca o manifesto de novo a cada 30 segundos, por até 20 minutos depois das 21:30, e se refaz quando ele chega. Quem já está com a página aberta vê a revelação sem recarregar.

## A página

Cada dia revelado é uma lista, o dia mais recente primeiro: uma linha por jogador com a miniatura da cartinha, equipe, overall, rAAting, ACS, K/D, KAST e agentes. Clicar na linha abre o perfil com a cartinha grande, os números (incluindo a força média de adversário), os últimos jogos e a conversa da cartinha. Os dias que ainda não saíram aparecem só no calendário ao lado, com a quantidade e a faixa de posições de cada dia. A busca encontra somente jogadores revelados.

A **força média de adversário** é o `nivelAdversarios` do gerador (`ferramentas/cartinhas/ajuste-overall.js`): quanto, em rAAting, os times enfrentados costumam tirar de quem joga contra eles, pesado pelos rounds. Zero é o adversário típico; positivo, adversários mais fortes; negativo, mais fracos.

Endereços: `#carta-12` abre o perfil da posição 12; `#jogador-<puuid>` abre o perfil daquele jogador (é o que os links de comentário usam, porque a posição pode mudar se os overalls forem recalculados); `#dia-2026-10-23` leva ao dia; `#comentarios` leva à conversa da coleção.

## Comentários

Quem tem conta no UNIVLR comenta em dois lugares: na coleção, no fim da página, e em cada cartinha, na conversa que aparece quando ela é aberta na lista. A página usa os mesmos `community-core.js`, `comments.js` e `auth.js` do site, com o espaço da conta no topo. As conversas são do tipo `card` no Supabase: `2026` é a coleção e `2026:<puuid>` uma cartinha.

A linha de uma cartinha com pelo menos um comentário mostra um selo com o número de comentários, à esquerda do overall. O atalho abaixo do calendário leva à conversa da coleção e mostra quantos comentários ela tem.

O banco só aceita o tipo `card` depois da migração `supabase/migrations/0007_cartinhas.sql`, que o administrador do banco roda no SQL Editor (ver `supabase/README.md`). Antes dela, as conversas aparecem vazias e publicar devolve erro de restrição.

## Publicar um dia

Depois de revisar o calendário e as imagens exportadas (o Python precisa do Pillow):

```powershell
python scripts/build_card_reveal.py --ate 2026-10-24
```

Troque a data a cada publicação. O comando recusa datas futuras. `--preview` prepara a edição em `outputs/cartinhas/preview-cartas/`, fora do site publicado. A página pública está revelada até 23/10.

Depois dos jogos restantes, recalcule os overalls, atualize o CSV do calendário e reexporte as cartinhas afetadas antes de gerar a próxima edição. O publicador lê o banco atualizado para os perfis dos jogadores liberados e confere 216 entradas, ordem crescente, no máximo 10 por dia e o top 20 depois de 14/11. Se a elegibilidade final alterar o total, refaça o calendário e ajuste essas validações conscientemente.

O navegador busca o manifesto sem cache, mas a página só muda para o público quando os arquivos gerados são publicados no site. A atualização diária requer executar este comando e publicar a nova versão antes das 21:30.

## Testes

```sh
node scripts/test_cartinhas.js
node scripts/test_cartinhas_navegador.cjs
```

O primeiro roda só com o Node e confere o manifesto (numeração, imagens, formato das conversas), a liberação às 21:30, o texto, a força de adversário e os links dos comentários. O segundo precisa do Playwright com o Chromium e abre a página num navegador de verdade, com o Supabase trocado por `scripts/fake_supabase.js`: nada chega ao banco.
