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
| 4.2 | `00000000-0001-0000-0000-000000000402` | Despesas operacionais |
| 5.1 | `00000000-0001-0000-0000-000000000501` | Ajustes |

## Partidas

| Fato | Débito | Crédito |
|------|--------|---------|
| Venda à vista | 1.1 | 3.1 (3.2 se taxa) |
| Venda a prazo | 1.2 | 3.1 |
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
