# Financeiro — contrato de domínio

Fonte: `docs/CHECKLIST_FINANCEIRO_LEDGER.md` (crítica 2026-08-14).
Status do pedido **não é dinheiro**. Canônico no Postgres (RPC). TypeScript só chama RPC/view.

## Decisões travadas

1. Journal **sem CMV**. Custo vive em `sale_items.unit_cost` / `line_cost`.
2. Unique de dinheiro: `(company_id, idempotency_key)` parcial. Chave **do client**. Retry devolve o mesmo `journal_id`.
3. KPI **Recebido** (home, todos os planos) = conta **1.1** posted, fontes de liquidação (`sale_payment`, `recognize`, `bill_settlement` + estornos desses). Sangria/opex **não** entram nesse KPI.
4. A Receber / DRE / CMV = competência sobre `sales` + items. Não somar `orders.total_amount`.
5. Mutação: `financeiro.write`. PDV finalize: `pdv.access`.
6. `payment_method`: `cash|pix|debit|card|credit_installment|boleto|promissoria|cheque`.
7. Origin: `pdv|chatbot|web_menu|ui_order|ai_chat|table_service|marketplace|manual`.

## Contas sistema

| Código | UUID estável | Nome |
|--------|----------------|------|
| 1.1 | `00000000-0001-0000-0000-000000000101` | Caixa e equivalentes |
| 1.2 | `00000000-0001-0000-0000-000000000102` | Contas a receber |
| 2.1 | `00000000-0001-0000-0000-000000000201` | Contas a pagar |
| 3.1 | `00000000-0001-0000-0000-000000000301` | Receita de vendas |
| 3.2 | `00000000-0001-0000-0000-000000000302` | Taxa de entrega |
| 3.3 | `00000000-0001-0000-0000-000000000303` | Taxas de serviço |
| 4.2 | `00000000-0001-0000-0000-000000000402` | Despesas operacionais |
| 5.1 | `00000000-0001-0000-0000-000000000501` | Ajustes |

## Partidas

| Fato | Débito | Crédito |
|------|--------|---------|
| Venda à vista | 1.1 | 3.1 (+ 3.2 entrega + 3.3 serviço) |
| Venda a prazo | 1.2 | 3.1 (+ 3.2 + 3.3) |
| Baixa AR | 1.1 | 1.2 |
| Opex pago | 4.2 | 1.1 |
| Opex a pagar | 4.2 | 2.1 |
| Baixa AP | 2.1 | 1.1 |
| Sangria | 5.1 | 1.1 |
| Suprimento | 1.1 | 5.1 |
| Estorno | inverso | |

À vista: `cash`, `pix`, `debit`, `card`. A prazo: `credit_installment`, `boleto`, `promissoria`, `cheque`.

## Idempotency (formato)

- Venda PDV payment i: `sale:{sale_id}:pay:{i}`
- Recognize pedido: `order:{order_id}:recognize`
- Baixa título: `bill:{bill_id}:settle:{seq}` (ou chave do client)
- Opex: `opex:{client_nonce}`
- Sangria/suprimento: `cash:{register_id}:{tipo}:{client_nonce}`
- Backfill: `backfill:fe:{financial_entry_id}` / `backfill:exp:{expense_id}`

## Home (M7)

| Card | Fonte |
|------|--------|
| Recebido hoje | `rpc_fin_cash_revenue` / `rpc_fin_dashboard` dia civil da loja |
| A receber | `rpc_fin_dashboard.ar_open` (bills receivable abertos) |
| Pedidos ativos | `orders` operacional |
| Ticket | recebido / vendas liquidadas no dia (`sale_payment`/`recognize` com `sale_id`) |

Fuso: `company_settings.timezone` (default `America/Cuiaba`). UI: `queryHomeStats` + `DashboardClient`.
Drill Pro: `/financeiro?from={day}&to={day}`.

## Preço, custo e taxas — como entram no financeiro

| Conceito | Onde mora | O que o ledger faz |
|----------|-----------|---------------------|
| **Preço de venda** | `produto_embalagens.preco_venda` → `order_items.unit_price` / carrinho PDV → `sale_items.unit_price` | Não vira linha de journal item a item. O **pagamento** (`sale_payments.amount` / total liquidado) posta **CR 3.1** (e **CR 3.2** se houver taxa). |
| **Preço de custo** | `products.preco_custo_unitario` × `produto_embalagens.fator_conversao` | Snapshot em `sale_items.unit_cost` / `line_cost` na liquidação. **Não entra no journal** (opção A). Alimenta CMV do `rpc_fin_dashboard` / DRE / “Resultado gerencial”. |
| **Taxa de entrega** | Config: `service_fee_definitions` (`system_key=delivery`). Pedido: `order_fees` delivery → espelho `orders.delivery_fee` → `sales.delivery_fee` | Liquidação: **CR 3.2**. Cotação/bairro usa a definição (fixed) como base; override por bairro na policy. Sem `companies.default_delivery_fee`. |
| **Taxas de serviço** (garçom, couvert, …) | `service_fee_definitions` + `order_fees` (`system_key` ≠ delivery); espelho `orders.service_fees_total` | Liquidação: **CR 3.3**. `%` sobre subtotal de itens. `total_amount = total + delivery_fee + service_fees_total`. |

Idempotency de liquidação **não muda** (`order:{id}:recognize`, `sale:{id}:pay:{i}`): o split 3.1/3.2/3.3 é determinístico a partir de `order_fees` no post.

KPI **Recebido** (home) = só caixa **1.1** de liquidações (`sale_payment` / `recognize` / `bill_settlement`). Taxas **entram** nesse KPI quando pagas à vista (fazem parte do débito 1.1); no extrato/DRE a parcela fica em **3.2** ou **3.3**.

## Estorno (operacional unificado — Fase F)

**Modelo:** para pedidos/PDV/mesa, estorno = **storno integral** do(s) journal(s) `posted` do pedido + **reemissão** do que sobrou (parcial) **ou** cancelamento sem reemissão (full). Estoque via `DELETE`/`UPDATE` em `order_items` (trigger).

| Ação | RPC / API | Estoque | Reemissão |
|------|-----------|---------|-----------|
| Cancelar pedido / estorno completo | `rpc_admin_reverse_order_operation` `mode=full` · `POST /api/admin/financeiro/reverse-order` · cancel em Pedidos | Sim | Não |
| Estorno parcial (itens ± taxas) | mesma RPC `mode=partial` · Extrato `JournalEntryModal` | Sim | Sim (novo journal) |
| Opex / sangria **sem** pedido | `rpc_reverse_journal` / `rpc_reverse_journal_partial` · `POST …/journals/{id}/reverse` | Não | Não |

**UI Extrato (com `order_id`):** checkbox por item + taxa entrega/serviço; botões “Estornar seleção” e “Estornar pedido completo”. Journal reverse com `order_id` → **409** `use_order_reverse`.

**Extrato:** journals com `status=reversed` **não** aparecem (só o filho `reversal` e, se parcial, o journal reemitido).

**Idempotência:** `order:{order_id}:reverse:{nonce}` · journals `reversal:op:{nonce}:{journal_id}` · reemissão `…:restate`.

**Restrições v1:** partial a prazo → `prazo_partial_blocked`; caixa fechado → `settlement_conflict`. Auditoria: `order_events`.

Detalhe: `docs/PLANO_FINANCEIRO_ORIGEM_ESTORNO.md` §9.

---

## Resultado gerencial

Recebido (caixa) − CMV snapshot das sales ligadas aos journals do período − opex pago (conta 4.2) no período.
Não chamar de “lucro real” na UI se CMV = 0.

## Backfill CMV

`sale_items.unit_cost = 0` (23 linhas em 2026-08-14) recebem custo **atual** do cadastro uma vez. Não é o custo histórico da venda.

## Segurança

Tabelas journal: FORCE RLS, policy `service_role_only`.
RPCs: `REVOKE ALL FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE TO service_role`.
Views: `security_invoker`, GRANT só `service_role`.
Lines: sem UPDATE/DELETE para `service_role` (estorno = insert).
