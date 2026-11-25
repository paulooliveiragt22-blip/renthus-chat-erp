# ADR 0017 — Mesa: consumo real, fila no PDV e divisão livre

**Status:** aceito (2026-11-24) — banco e rotas aplicados em 2026-11-25. Smoke de tela ainda aberto. Checklist: [`CHECKLIST_MESA.md`](../CHECKLIST_MESA.md)
**Data:** 2026-11-24
**Emenda:** 2026-11-24 — o garçom só libera a mesa. O journal nasce quando o caixa confirma a conta na fila do PDV. A mesa não espera essa confirmação para ficar livre.
**Emenda:** 2026-11-25 — depois que o garçom recebeu e liberou, a comanda está fechada. Não reabre, mesmo com o caixa ainda por confirmar. Novo consumo na mesma mesa é outra comanda.
**Aprovação do dono:** 2026-11-24 (estrutura completa; divisão em valor livre; garçom libera a mesa; caixa do PDV lança o financeiro). Emenda 2026-11-25: também dá para dividir por item — o garçom marca a quantidade de cada linha para cada pessoa, a soma tem de bater com a linha, e a taxa `service` ativa entra proporcional ao subtotal da parte. O botão da comanda passa a se chamar Finalizar.
**Escopo técnico:** a mesa aberta é um pedido `consuming`. Lançar produto grava `order_items` e baixa estoque na hora. O garçom registra a divisão, libera o número e a conta entra na fila do PDV. O caixa confirma e aí o Postgres grava o journal. Transferir mesa leva a sessão inteira.
**Escopo comercial:** não cria taxa nova, não liga a prazo na mesa, não faz divisão igual automática e não inclui QR de autoatendimento.
**Relacionados:** [`ADR/0015`](./0015-combo-e-promocao-catalogo.md) (preço e combo no Postgres; a linha da mesa passa a ser `order_items`, não `table_session_items`), [`FINANCEIRO.md`](../FINANCEIRO.md), [`CHECKLIST_TAXAS_SERVICO.md`](../CHECKLIST_TAXAS_SERVICO.md), [`BILLING_PLANS.md`](../BILLING_PLANS.md) (`table_service` no Market)
**Governança:** `governanca-seguranca-negocio.mdc` (preço, soma da conta e journal no Postgres), `supabase-migrations-seguranca.mdc`, `projeto-pre-producao-radical.mdc` (sem comanda paralela), `decisoes-negocio-antes-codigo.mdc`

---

## Contexto

O MVP em `/mesa` guarda a comanda em `table_session_items` e só cria pedido, estoque e journal no fechar, em duas RPCs (`rpc_finalize_pdv_order` e depois `rpc_mesa_mark_session_closed`). A busca de produto usa a API do PDV (`pdv.access`). O perfil garçom tem `mesa.access` e não tem `pdv.access`. Não há transferência, reabertura, cancelamento de comanda nem divisão.

O dono rejeitou tratar a comanda como rascunho. A divisão igual (total ÷ pessoas) também foi rejeitada: cada pessoa paga um valor digitado, com a forma, porque o garçom recebe na mesa na maquininha (crédito, débito, Pix ou dinheiro).

O garçom libera a mesa sem esperar o caixa. Quem lança no financeiro é o caixa, na fila do PDV. Depois desse recebimento a comanda não reabre: a mesa fica livre e um novo consumo abre outra sessão.

---

## Decisão

### D1 — A mesa aberta é um pedido

Abrir a mesa cria `orders` com `source = table_service`, `channel = mesa` e status `consuming`, e amarra `table_sessions.order_id` nele. `consuming` entra no `CHECK` de `orders`.

Enquanto o caixa não confirma, o pedido continua `consuming`. Esse status não entra na fila de aprovação de pedido, não conta como receita e não aparece no kanban de entrega. Receita continua em `finalized`, e `finalized` só acontece na confirmação do caixa.

### D2 — Estoque na hora do lançamento

Lançar, alterar quantidade ou remover grava `order_items`. O trigger `fn_debitar_estoque_embalagem` baixa ou devolve. Não há reserva paralela e não se mexe no trigger.

`table_session_items` deixa de ser a linha da venda. A migration dropa a tabela depois de não haver sessão aberta dependente dela. Combo continua estourando em uma linha por componente, como no ADR 0015, com preço de `fn_expand_sale_lines` no lançamento.

Sem saldo e sem `vender_com_estoque_zero`, a RPC recusa o lançamento.

### D3 — Preço e total saem do banco

O app manda `produto_embalagem_id` ou `combo_id` e a quantidade. A RPC grava `unit_price`. O browser não define o preço da linha.

O total devido é a soma das linhas mais a taxa `system_key = service` já ativa na empresa. Taxa de entrega não entra. Não se inventa percentual. Sem definição `service` ativa, a conta é só a soma dos itens. O total é calculado de novo na liberação da mesa e outra vez na confirmação do caixa.

### D4 — Dois atos: garçom libera, caixa lança

Lançar produto não gera journal, venda nem movimento de caixa.

**Liberar mesa** (`rpc_mesa_release_table`, `mesa.access`):

1. Recalcula o total devido.
2. Exige que a soma das partes digitadas feche esse total em `numeric(15,2)`.
3. Grava as partes como `draft`.
4. Grava no pedido o código da mesa nesse instante (a fila continua mostrando “Mesa 12” mesmo depois que outra comanda ocupar o número).
5. Põe a sessão em `released` e a mesa em `free`. A comanda está fechada.
6. Não grava journal e não muda o pedido de `consuming`.

A conta passa a aparecer na fila do PDV. O caixa não precisa confirmar antes da mesa ficar livre. Não existe volta para `open`.

**Confirmar no PDV** (`rpc_mesa_confirm_payment`, `pdv.access`):

1. Só sessão `released`, ainda sem parte `posted`.
2. Recalcula o total. A soma das partes tem de fechar de novo.
3. Exige caixa aberto. Sem caixa aberto, recusa e a conta continua na fila.
4. Grava os pagamentos e os journals com origem `table_service` e `channel = mesa`.
5. Marca as partes `posted`, o pedido `finalized` com `confirmation_status = confirmed`, e a sessão `closed`.

Não usa `rpc_finalize_pdv_order`: essa RPC cria pedido e itens de novo e baixaria o estoque duas vezes.

A prazo (`credit_installment`, boleto, promissória, cheque) continua proibido. A RPC de confirmar recusa essas formas.

### D5 — Divisão livre

A folha abre em **Conta inteira**: um pagador já com o valor da conta e a forma. **Dividir conta** zera a folha. Cada pagador novo entra por **valor**, com o que ainda falta, e pode mudar o próprio marcador para **item**. Na mesma conta os dois convivem. Formas da mesa, as imediatas aceitas pela loja:

| Forma na tela | `payment_method` |
|---|---|
| Dinheiro | `cash` |
| Pix | `pix` |
| Cartão de débito | `debit` |
| Cartão de crédito | `card` |

O banco não reparte o total digitado. Ele calcula o devido, soma as partes com valor `> 0` e recusa finalizar se a soma for diferente. O restante que a tela mostra vem dessa conta. Parte com valor vazio não entra na soma e não pode ser enviada.

A tela abre com um pagador e o valor da conta. Dividir zera isso. Cada pagador novo entra por valor, com o que ainda falta.

Divisão por item, no pagador que marcar **item**: quantidade de cada `order_items`. Se todo mundo está por item, a soma tem de bater com a linha (`qty_mismatch`). Se alguém paga por valor, a quantidade marcada não pode passar da linha; o que sobrou entra no valor digitado. O valor da parte por item é o das linhas dela. A taxa `service` ativa entra proporcional ao subtotal dessa parte. Sem pagador por valor, a última parte por item absorve o centavo. Com pagador por valor, esse centavo fica no restante que ele digita. O app não manda o valor do item: `fn_mesa_replace_parts` calcula. A soma de todas as partes tem de fechar o devido.

Na fila do PDV o caixa vê essas partes. Pode corrigir valor ou forma antes de confirmar. A confirmação recalcula o total e recusa se a soma não fechar.

As partes ficam em `table_session_payments` (`amount`, `payment_method`, `status` `draft` ou `posted`), com RLS `service_role` only, no padrão do projeto. Idempotência da confirmação: uma por sessão (`mesa:{sessionId}`), unique de verdade. Um journal por parte.

### D6 — Comanda liberada não reabre

Depois que o garçom recebeu e liberou, a sessão `released` está fechada. Não há `rpc_mesa_reopen_session`. O caixa ainda não ter confirmado os valores não devolve a comanda ao salão.

A mesa fica `free`. Quem for consumir de novo abre outra sessão, com outro pedido. A conta anterior segue na fila do PDV até o caixa confirmar, identificada pelo código da mesa gravado na liberação.

Desfazer a conta depois que o caixa lançou o journal é `reverseOrderSale`: estorna o journal e devolve o estoque pelo trigger. Isso não reabre a comanda. Ocupar a mesa de novo continua sendo outra sessão.

### D7 — Cancelar comanda não paga

`rpc_mesa_cancel_session` vale só com a sessão `open` (o garçom ainda não recebeu). Apaga os `order_items` (o estoque volta), marca o pedido `canceled`, a sessão `cancelled` e a mesa `free`. Sem journal. Sessão `released` não cancela por essa RPC: a comanda já está fechada e a fila do PDV é o caminho dela.

### D8 — Transferir leva a sessão inteira

`rpc_mesa_transfer_session` vale com a sessão `open` e a mesa de origem `occupied`. O destino está `free` e não `disabled`. Vão juntos o pedido, os itens, o cliente e a observação. Estoque não se move de novo: já está nas linhas. O código da mesa de origem entra em `table_sessions.previous_table_codes` e permanece no nome do pedido (`Mesa 8 · antes Mesa 5`), inclusive na fila do PDV e na venda.

A origem fica `free`. O destino fica `occupied`. Sessão `released`, `closed` ou `cancelled` não transfere.

### D9 — Quem opera

| Ação | Quem |
|---|---|
| Ver salão, abrir, lançar, dividir, liberar a mesa, cancelar comanda ainda em consumo, transferir | `mesa.access` (garçom incluso) |
| Confirmar a conta na fila do PDV e lançar o financeiro | `pdv.access` (caixa) |
| Criar, renomear, lugares, desativar mesa | `owner` ou `admin` |
| Busca de produto na mesa | API de mesa, com `mesa.access` |

O garçom não ganha `pdv.access` e não chama a RPC que grava journal. O menu Mesas exige `mesa.access` além do plano Market (`table_service`).

### D10 — Tela

Desktop: salão à esquerda, comanda à direita. No celular, o salão é a lista e a comanda abre em tela cheia. O salão assina o Realtime da empresa.

Cartão da mesa: número, estado (**Livre**, **Em consumo**, **Inativa**), tempo aberta, total e quantidade de itens. Mesa liberada pelo garçom aparece livre. A conta fechada não ocupa o cartão: ela só existe na fila do PDV, com o número gravado na hora da liberação.

Filtro Todas / Livres / Em consumo. Mesa livre abre no clique e cria outra comanda. Dono e admin têm **Gerir mesas**. Mesa com sessão `open` não desativa.

Comanda em consumo:

- Cabeçalho com mesa, tempo, cliente opcional, observação, **Trocar mesa** e **Cancelar comanda**.
- Lançador focado de novo depois de cada item. Placeholder: “Nome, código ou EAN — Enter lança”.
- Um hit exato (EAN, código interno ou nome único) lança quantidade 1, limpa o campo e destaca a linha nova.
- Vários hits: lista com setas e Enter. Cada linha mostra nome, sigla (UN/CX), volume, preço e estoque. Combo tem selo e segue como `combo_id`.
- Quantidade ao lado do resultado para o mouse. Bipagem continua em 1.
- Campo vazio não lista produto. A busca só aparece depois de nome, código ou EAN.
- Erro no próprio campo (“sem estoque”, “código não encontrado”).
- Itens lançados abaixo, o mais recente em cima, com +/− e remover.
- **Finalizar** abre a folha já com o valor da conta num pagador. **Dividir conta** começa limpa; cada pagador entra por valor e pode marcar item. Finalizar só segue quando a soma fecha. A mesa fica livre, a comanda fecha e a conta entra na fila do PDV. Não há botão de reabrir.

No PDV, o controle **Mesas** (ao lado de Venda e Pedidos) lista as mesas em aberto, só leitura, e as contas já fechadas pelo garçom. A fechada mostra o número gravado na liberação e as partes (valor e forma). O caixa corrige se precisar e **Confirmar**. Sem caixa aberto, confirmar recusa e a conta permanece na fila. A mesa, no salão, já está livre. Impressão na confirmação permanece desmarcada (`auto_print` igual ao de hoje).

**Trocar mesa** lista só mesas livres e só com a sessão em consumo.

---

## Efeito em cascata

| Momento | Estoque | Financeiro | Mesa |
|---|---|---|---|
| Abrir | — | — | `occupied`, sessão `open`, pedido `consuming` |
| Lançar / qty / remover | trigger em `order_items` | — | continua |
| Liberar mesa | não reinsere item | nada; partes ficam `draft` | `free`, sessão `released`, comanda fechada, conta na fila do PDV |
| Transferir (só em consumo) | — | — | origem `free`, destino `occupied` |
| Cancelar não paga | trigger devolve | — | `free`, pedido `canceled`, sai da fila |
| Caixa confirma | não reinsere item | journals `table_service`, um por parte | continua `free`, pedido `finalized`, sessão `closed` |
| Estorno da conta paga | trigger devolve | `reverseOrderSale` | não reabre |

Leituras que contam venda (`finalized` / `delivered`) ignoram `consuming`. A origem do journal continua `table_service`.

---

## Fora deste ADR

QR para o cliente pedir, divisão igual automática, reabrir comanda depois que o garçom liberou, repasse de gorjeta ao garçom, taxa que não seja a definição `service` já ativa, e reserva de estoque separada da baixa.

A fila do PDV desta conta não é a fila de aprovação de pedido. O pedido da mesa não espera aceite de cozinha nem de entregador.

---

## Consequências

- `rpc_mesa_add_item`, `rpc_mesa_set_item_qty` e `rpc_mesa_remove_item` passam a escrever `order_items`.
- Entram `rpc_mesa_release_table`, `rpc_mesa_confirm_payment`, `rpc_mesa_cancel_session` e `rpc_mesa_transfer_session`. Não entra RPC de reabrir.
- `rpc_mesa_mark_session_closed` e o fechar em duas chamadas saem do caminho.
- A busca de produto da mesa sai de `/api/admin/pdv/products`. A confirmação financeira fica numa rota do PDV, com `pdv.access`.
- O lançamento de item leva chave de idempotência do clique, para um toque duplo não duplicar a linha.
