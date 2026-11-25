# Roteiro — loops da landpage

Quatro vídeos mudos, de 8 a 12 segundos, gravados numa loja fictícia. A página já aponta para os arquivos. Enquanto eles não existirem, o hero mostra o simulador e os capítulos mostram o texto de cada tomada.

Colocar os arquivos em `public/marketing/loops/`:

| Arquivo | Rota | Onde entra na página |
|---|---|---|
| `whatsapp.mp4` | `/whatsapp` | Hero |
| `cardapio.mp4` | `/c/[slug]` | Capítulo cardápio |
| `pdv.mp4` | `/pdv` | Capítulo balcão |
| `pedido-caixa.mp4` | `/pedidos`, `/estoque`, `/financeiro` | Capítulo cozinha e caixa |

Depois do JPG de capa, acrescentar `poster: "/marketing/loops/<nome>.jpg"` no loop correspondente em `lib/marketing/loops.ts`.

## Conta demo

- Hamburgueria fictícia, cerca de 12 produtos com foto, preço e estoque folgado.
- Três pedidos já na lista, com nomes inventados e telefone mascarado.
- Confirmação de pedido automática. A fila (`/fila`) fica de fora.
- Nada de loja, cliente ou telefone real.

## Como gravar

1. Chrome em zoom 100%, tema claro, barra de favoritos oculta.
2. Admin em janela 1440×900, sidebar recolhida. A câmera pega só a área de conteúdo.
3. Cardápio numa janela de 390×844, sem moldura de celular.
4. Gravar com a Game Bar (Win+G) ou OBS. Mouse calmo, um gesto por batida.
5. Sem áudio. O primeiro e o último frame mostram o mesmo recorte, para o loop fechar.
6. Exportar H.264, mudo, com faststart. Meta de até 1,5 MB por arquivo.

```text
ffmpeg -i captura.mp4 -an -vf "scale=1280:-2" -movflags +faststart -c:v libx264 -crf 28 whatsapp.mp4
```

No cardápio, trocar `1280` por `720`.

Quem prefere menos movimento no sistema vê o quadro estático. O vídeo entra com `autoPlay`, `muted`, `loop` e `playsInline`.

## Tomadas

### 1. `whatsapp.mp4` — hero

Inbox em `/whatsapp`, 8–12 segundos.

1. A mensagem do cliente entra na conversa.
2. O agente responde com itens e total.
3. O pedido fica visível na mesma thread.

O chat do celular é a tela da Meta. Gravar o inbox da loja.

### 2. `cardapio.mp4`

Cardápio público `/c/[slug]`, 8–12 segundos.

1. A lista abre com foto e preço.
2. O cliente escolhe o lanche.
3. O checkout abre e o total aparece.

### 3. `pdv.mp4`

`/pdv`, 8–12 segundos.

1. A busca encontra o produto pelo nome.
2. O item entra no cupom.
3. F2 abre o pagamento. PIX e dinheiro dividem o valor.

### 4. `pedido-caixa.mp4`

Três cortes no mesmo arquivo, 10–12 segundos. Não navegar ao vivo entre as telas: a sidebar no meio do plano quebra o loop.

1. `/pedidos`: o status passa a confirmado. Cerca de 4 segundos.
2. `/estoque`: a quantidade da unidade desce. Cerca de 3 segundos.
3. `/financeiro`, aba Caixa: o valor entra. Cerca de 4 segundos.

Juntar com o concat do ffmpeg, na ordem acima:

```text
ffmpeg -f concat -safe 0 -i lista.txt -c copy pedido-caixa.mp4
```

`lista.txt` aponta para os três cortes já exportados, um por linha, no formato `file 'pedidos.mp4'`.

## Fora do filme

Login, configurações, impressoras, plano, mesa, lista de produtos, clientes, relatórios e campanhas. Campanha, se entrar depois, é uma foto parada, não um quinto vídeo.
