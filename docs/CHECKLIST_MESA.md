# Checklist — Mesa (ADR 0017)

Data: 2026-11-24. Contrato: [`ADR/0017-mesa-consumo-recebimento-divisao.md`](ADR/0017-mesa-consumo-recebimento-divisao.md).

Implementar nesta ordem. Não marcar item sem a verificação indicada. Não implementar divisão igual. Comanda liberada pelo garçom não reabre. O garçom não grava journal. O caixa não segura a mesa: a fila do PDV só lança o financeiro.

## 1. Schema e RPCs

- [x] Status `consuming` em `orders_status_check`. Pedido `consuming` fora da fila de aprovação de pedido, da receita e do kanban de entrega.
- [x] `table_sessions.status` com `open`, `released`, `closed`, `cancelled`. Mesa `occupied` só em `open`. Em `released` a mesa já está `free`.
- [x] `table_session_payments` (`amount > 0`, `payment_method` em `cash|pix|debit|card`, `draft|posted`), RLS `FORCE` + policy `service_role` only, `REVOKE` de `anon` e `authenticated`, índice em `company_id` e `session_id`.
- [x] Unique da confirmação do caixa por sessão (`mesa:{sessionId}`).
- [x] `rpc_mesa_open_session` cria o pedido `consuming` já amarrado à sessão.
- [x] `rpc_mesa_add_item` / `set_item_qty` / `remove_item` gravam `order_items`. Preço só por `fn_expand_sale_lines`. Combo estoura como no ADR 0015. Recusa sem saldo quando não pode vender zerado. Idempotência do clique no lançamento.
- [x] `rpc_mesa_release_table` (`mesa.access`): soma das partes = total devido (itens + taxa `service` ativa, sem entrega), partes `draft`, sessão `released`, mesa `free`. Sem journal. Sem caixa aberto não bloqueia a liberação.
- [x] `rpc_mesa_confirm_payment` (`pdv.access`): só `released`, sem parte `posted`, soma conferida de novo, caixa aberto obrigatório, journals origem `table_service`, partes `posted`, pedido `finalized` + `confirmed`, sessão `closed`. Não chama `rpc_finalize_pdv_order`. Sem caixa aberto, a conta continua na fila.
- [x] Não existe `rpc_mesa_reopen_session`. Sessão `released` não volta para `open`.
- [x] `rpc_mesa_release_table` grava o código da mesa no pedido, para a fila do PDV não depender do número ao vivo.
- [x] `rpc_mesa_cancel_session` só com sessão `open`. Apaga `order_items`, pedido `canceled`, mesa `free`. Sem journal. Sessão `released` recusa.
- [x] `rpc_mesa_transfer_session` só em `open`. Move sessão, pedido, itens, cliente e observação para mesa destino `free`. Origem fica `free`.
- [x] Prazo recusado dentro da RPC de confirmar.
- [x] Funções novas: `SECURITY DEFINER`, `search_path = public, pg_temp`, `REVOKE` de `PUBLIC`, `EXECUTE` só para `service_role`.
- [x] Drop de `table_session_items` e da rota que ainda a usa, no mesmo passo. `rpc_mesa_mark_session_closed` sai do fechar.
- [x] Migration aplicada no remoto e objetos conferidos (`execute_sql`: coluna, RPC, policy única, grants sem `anon`/`authenticated`).

## 2. API

- [ ] Rotas em `app/api/admin/mesa/**` finas: gate + um use case em `src/mesa/`.
- [ ] `GET /api/admin/mesa/catalog` com `mesa.access` (nome, código interno, EAN, combo). Sem `pdv.access`.
- [ ] `POST` liberar, cancelar, transferir. Sem rota de reabrir. `company_id` só da sessão. Liberar não exige caixa aberto.
- [ ] Fila do PDV lista sessões `released` (`source = table_service`, ainda sem journal). Confirmar chama `rpc_mesa_confirm_payment` com `pdv.access`.
- [ ] Criar, editar e desativar mesa continua `owner`/`admin`.
- [ ] Menu Mesas exige `mesa.access` e a feature `table_service`.

## 3. UI

- [ ] Salão + comanda (`app/(admin)/mesa/`): Livre, Em consumo, Inativa. Mesa liberada aparece livre. Realtime da empresa.
- [ ] Lançador: foco de volta, Enter lança hit exato, setas na lista, sigla, volume, preço, estoque, selo de combo, quantidade no mouse, mais vendidos com o campo vazio, erro no campo.
- [ ] **Liberar mesa** com a folha de divisão (valor em branco + dinheiro / pix / débito / crédito). Sem dividir igual. Sem lançar financeiro. Sem botão de reabrir.
- [ ] **Cancelar comanda** só em consumo, e **Trocar mesa** (só livres, só em consumo).
- [ ] PDV: conta da mesa na fila, com o número gravado na liberação, partes editáveis, **Confirmar**. Sem caixa aberto, a confirmação não segue. A mesa no salão já está livre.
- [ ] **Gerir mesas** para dono e admin. Sessão em consumo não desativa.
- [ ] Celular: salão em lista, comanda em tela cheia, busca no topo, liberar grudado embaixo.

## 4. Cascata

- [x] Lançar item baixa `product_volumes.estoque_atual`. Remover devolve. Liberar e confirmar não baixam de novo.
- [x] Journal só na confirmação do caixa, origem `table_service`, um por parte, no caixa aberto.
- [ ] Estorno da conta paga segue `reverseOrderSale` e não reabre a mesa.
- [x] Dashboard, pedidos e fila de aprovação ignoram `consuming`. A fila do PDV mostra `released`.

## 5. Testes

- [x] Soma diferente do total recusa a liberação. Soma certa libera a mesa, deixa a sessão `released` e não cria journal.
- [x] Confirmar na fila grava um journal por parte e passa o pedido a `finalized`.
- [x] Sem caixa aberto, a confirmação recusa e a sessão continua `released`. A liberação da mesa, essa, segue.
- [x] Sessão `released` não volta para `open`. Abrir a mesma mesa de novo cria outra comanda, e a conta anterior continua na fila com o número antigo.
- [x] Cancelar comanda não paga devolve estoque e não cria journal.
- [x] Transferir para mesa livre move itens. Transferir sessão `released`, ocupada ou desativada recusa.
- [ ] Garçom busca catálogo e libera a mesa sem `pdv.access`. Garçom não confirma o pagamento. `pdv.access` sozinho não abre a API de mesa.
- [ ] Combo lançado na mesa grava os componentes com o preço da RPC.
- [x] Prazo na confirmação recusa.
- [x] `npm test` verde nos testes novos (suíte compilada: 1916 passou; o único fail foi o arquivo `.ts` cru anexado ao comando). Smoke manual do salão e da fila do PDV fica para o browser.

## 6. Docs no fim da implementação

- [x] `.cursorrules` alinhado a este ADR (pedido `consuming`, garçom libera e a comanda fecha, caixa lança o financeiro, divisão livre).
- [x] Frase do ADR 0015 que ainda cita `table_session_items` como linha da mesa aponta para este ADR.
