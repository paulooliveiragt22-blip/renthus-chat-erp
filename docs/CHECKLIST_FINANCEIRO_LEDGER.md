# Checklist — Financeiro profissional (ledger)

Origem: análise do módulo (2026-08-14) + estrutura aprovada + **crítica 2026-08-14**
(partidas, idempotência, dashboard, segurança). Este arquivo é a fonte de contexto
entre sessões. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir cada item.

**Não há clientes SaaS em produção**, mas a loja de teste (Disk Bebidas) já opera
(32 lançamentos, dezenas de pedidos). Postura radical no *modelo*
(`.cursor/rules/projeto-pre-producao-radical.mdc`): sem dual-path, sem flag
`financeiro_v2`. **Corte no banco = um apply** que deixa home + PDV + Financeiro
de pé no mesmo commit. F1 sozinha (DROP sem writers/readers) é proibida.

**Processo:** F0 (contrato) → F1 (cutover SQL + call sites mínimos) → F2 (writers
completos) → F3 (dashboard) → F4 (UI Financeiro) → F5 (mata-legado).
Cada fatia com código: `apply_migration` MCP + `execute_sql` de prova + `npm test`.

Mutação só RPC; leitura só view/RPC; `FORCE RLS` + `service_role_only`;
`search_path = public, pg_temp`; `REVOKE` de `anon`/`authenticated` em tabela,
view e função de dinheiro.

TS hexagonal é **cliente da RPC**, não uma segunda matriz de partidas.

---

## Resumo

| # | Fatia | O que entrega | Estado |
|---|--------|----------------|--------|
| F0 | Contrato | `docs/FINANCEIRO.md` com as regras desta crítica | [x] 2026-08-14 |
| F1 | Cutover | 1 migration: journal + RPCs + views + backfill + REVOKE + swap das APIs que hoje leem `financial_entries` | [x] 2026-08-14 |
| F2 | Writers | Pedidos: status ≠ dinheiro; liquidação explícita; `financeiro.write`; sangria idempotente | [x] 2026-08-14 |
| F3 | Dashboard | Home = contrato M7: recebido / a receber / ativos; gráfico de caixa; drill | [x] 2026-08-14 |
| F4 | UI Financeiro | Tabs; A Pagar = bills; Caixa com esperado | [x] 2026-08-14 |
| F5 | Mata-legado | Apaga `lib/server/financeiro` residual, `expenses` API, `v_daily_sales` como faturamento | [x] 2026-08-14 |

M7 (R$ da home = caixa **posted** no fuso da loja) vale em **todos** os planos.
A home **é** o financeiro do Essencial. `financeiro_full` = extrato / DRE / opex /
abas (Pro/Market).

---

## Decisões travadas (crítica 2026-08-14) — não reabrir na implementação

1. **Opção A — journal sem CMV.** CMV não entra no razão. Snapshot em
   `sale_items.unit_cost` / `line_cost`. DRE lê documento `sales` + items, não conta 4.1.
   Partida de venda à vista: `DR 1.1 / CR 3.1` (e `CR 3.2` se houver taxa no pagamento).
   Híbrido “+ DR 4.1 CMV” é **proibido** (não fecha).
2. **Unique de dinheiro = só** `(company_id, idempotency_key)` parcial
   (`WHERE idempotency_key IS NOT NULL`). **Não** unique em `order_id` nem em
   `(source_type, source_id)`.
3. A chave **vem do client** (PDV já manda; Pedidos / opex / sangria / baixa passam
   a mandar). Retry: `ON CONFLICT` devolve o **mesmo** `journal_id` (contrato Stripe),
   não 500.
4. **Uma** migration de cutover. Call sites de leitura M7 (`dashboard/stats`,
   `receivedIncome`, financeiro dashboard/extrato) trocam no mesmo commit.
5. Dashboard é fatia própria (F3), mas **não pode ficar com número velho** depois da F1:
   o card R$ já sai de `rpc_fin_cash_revenue` na F1. F3 enriquece KPIs/UX.
6. Mutação exige `financeiro.write` (hoje as rotas usam `.read` — letra morta).
7. Reusar `v_aging_receivables` (já tem 0–30–60–90). `v_daily_sales` **não** é
   faturamento (soma `orders`).
8. Sem `domain/posting.ts` duplicando SQL. TS: enums, erros, money, accounts IDs.
9. Rastreio: `entry_seq` por empresa, `posted_by`, `reason` no estorno.
10. `payment_method` = CHECK atual de `sale_payments`
    (`cash|pix|debit|card|credit_installment|boleto|promissoria|cheque`).
    **Não** inventar `credit_card`. Origin inclui `table_service` e marketplace.

Fora de escopo: centro de custo editável, SPED, conciliação, webhook PIX, MDR,
inventário valorado, impostos.

---

## Regras de domínio (copiar para `docs/FINANCEIRO.md` na F0)

1. Status do pedido (`preparing` / `delivered` / `finalized`) **não é dinheiro**.
   Liquidação é RPC própria, na mesma request do clique quando o operador
   “finaliza e recebe”.
2. KPI **Recebido** (home, todos os planos) = soma de journals **posted** na conta
   1.1 no dia civil da loja (`posted_at` + `company_settings.timezone`).
3. **A Receber** / DRE / CMV = competência sobre `sales` (+ `sale_items.line_cost`),
   não `orders.total_amount`.
4. Chatbot / cardápio / mesa delivery-bot **nunca** a prazo (constraint no banco).
5. À vista (`cash`, `pix`, `debit`, `card`) → caixa na hora.
   A prazo (`credit_installment`, `boleto`, `promissoria`, `cheque`) → `bills` AR;
   caixa só na baixa.
6. Estorno = contra-lançamento. `REVOKE UPDATE, DELETE` em `finance_journal_lines`.
   Nunca alterar `amount` postado.
7. CMV = snapshot no post da venda a partir de **`produto_embalagens.preco_custo`**
   (`fn_fin_snapshot_pack_cost`; fallback `products.preco_custo_unitario * fator`).
   Cadastro atual não reescreve histórico; backfill pré-prod usa custo atual.
8. Uma despesa = um `bills` payable. Tabela `expenses` some.
9. Grão = **1 pagamento / 1 baixa / 1 sangria / 1 estorno**. Unique só
   `(company_id, idempotency_key)`.
10. SELECT só view/RPC; mutação só RPC. Toda RPC de dinheiro:
    `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`.
11. Home e Financeiro no mesmo intervalo civil → o mesmo R$ de caixa.
12. “Resultado gerencial” ≠ lucro contábil. UI não chama de “lucro real” se CMV=0
    ou opex incompleto; rótulo: **Resultado gerencial** (recebido − CMV snapshot −
    opex pago no período).

---

## Contas sistema (7 — sem 4.1 CMV)

| Código | Nome | Uso |
|--------|------|-----|
| 1.1 | Caixa e equivalentes | Dinheiro, PIX, débito, cartão à vista. Mix = `payment_method` na linha, não conta extra |
| 1.2 | Contas a receber | A prazo / título |
| 2.1 | Contas a pagar | Opex a pagar |
| 3.1 | Receita de vendas | Contrapartida da venda (competência) |
| 3.2 | Taxa de entrega | Se o pagamento incluir taxa |
| 4.2 | Despesas operacionais | Opex |
| 5.1 | Ajustes | Sangria, suprimento, diferença de caixa |

`chart_of_accounts` fica; reseed dessas 7 (IDs estáveis em `domain/accounts.ts`).
Antes de apagar as 24 seed: atualizar `sales.chart_account_id` DEFAULT para 3.1.

**Partidas (SQL only):**

| Fato | Débito | Crédito |
|------|--------|---------|
| Venda à vista | 1.1 (valor pago) | 3.1 (+ 3.2 se taxa) |
| Venda a prazo | 1.2 | 3.1 (+ 3.2) |
| Baixa AR | 1.1 | 1.2 |
| Opex já pago | 4.2 | 1.1 |
| Opex a pagar | 4.2 | 2.1 |
| Baixa AP | 2.1 | 1.1 |
| Sangria | 5.1 | 1.1 |
| Suprimento | 1.1 | 5.1 |
| Estorno | inverso do original | |

Trigger: `sum(debit) = sum(credit)` por journal.

---

## DROP / objetos que deixam de existir (dentro da migration F1)

| Objeto | Motivo |
|--------|--------|
| Tabela `financial_entries` | Vira `finance_journals` + `finance_journal_lines` |
| Tabela `expenses` | Vira `bills` payable |
| Tabela `vendas_a_prazo` | 0 linhas |
| Tabela `cost_centers` | 0 linhas; **primeiro** `DROP` FKs em `bills`/`sales` |
| Unique `financial_entries_order_income_uq` | Impede misto e baixa |
| `fn_create_financial_entry_on_finalize` + `trg_financial_entry_on_finalize` | Acopla cozinha a caixa |
| `fn_bill_paid_to_financial_entry` + trigger | INSERT órfão (R$ 58 pago / FE pending) |
| `fn_prazo_to_financial` | Função morta no remoto; não esquecer |
| View `v_dre` (definição atual) | Recriada: `sales` + `sale_items` + opex journal |
| `v_daily_sales` como fonte de R$ | Soma `orders`; DROP ou deixa sem GRANT e sem call site |
| RPC `rpc_company_received_income` | Vira `rpc_fin_cash_revenue` / `rpc_fin_dashboard` |
| RPC `rpc_upsert_expense` | Vira `rpc_post_opex` |
| RPC `rpc_pay_bill` | Vira `rpc_settle_bill` |

Manter e **endurecer**: `v_aging_receivables` (REVOKE anon/authenticated; leitura via RPC).

---

## Mapa de pastas (alvo)

```
src/financeiro/
  domain/            money.ts, accounts.ts, paymentMethod.ts, origin.ts, errors.ts
                     (SEM posting.ts / matriz de partidas)
  application/       use cases: chamam ports; sem regra de débito/crédito
  ports/             financeCommand.port.ts, financeQuery.port.ts, clock.port.ts
  adapters/supabase/ só rpc() / from(view)
  adapters/clock.companySettings.ts

app/api/admin/financeiro/
app/api/dashboard/stats/     M7 via rpc_fin_cash_revenue (+ F3: aging, ticket)
app/api/reports/             mesma RPC/view de caixa

app/(admin)/financeiro/      F4
components/DashboardClient.tsx  F3 (obrigatório)

docs/FINANCEIRO.md
docs/CHECKLIST_FINANCEIRO_LEDGER.md
tests/financeiro/
```

---

## Inventário de arquivos

Legenda: **C** criar · **T** tocar · **A** apagar · **M** migration

### Criar — domínio / application (sem posting)

| Ação | Path |
|------|------|
| C | `src/financeiro/domain/money.ts` |
| C | `src/financeiro/domain/accounts.ts` |
| C | `src/financeiro/domain/paymentMethod.ts` |
| C | `src/financeiro/domain/origin.ts` |
| C | `src/financeiro/domain/errors.ts` |
| C | `src/financeiro/application/recognizeOrderSale.ts` |
| C | `src/financeiro/application/finalizePdvSale.ts` |
| C | `src/financeiro/application/settleBill.ts` |
| C | `src/financeiro/application/postOpex.ts` |
| C | `src/financeiro/application/reverseJournal.ts` |
| C | `src/financeiro/application/postCashMovement.ts` |
| C | `src/financeiro/application/queryDashboard.ts` |
| C | `src/financeiro/application/queryExtrato.ts` |
| C | `src/financeiro/application/queryDre.ts` |
| C | `src/financeiro/application/queryAging.ts` |
| C | `src/financeiro/application/queryCashSession.ts` |
| C | `src/financeiro/application/queryHomeStats.ts` |
| C | `src/financeiro/ports/financeCommand.port.ts` |
| C | `src/financeiro/ports/financeQuery.port.ts` |
| C | `src/financeiro/ports/clock.port.ts` |
| C | `src/financeiro/adapters/supabase/financeCommand.supabase.ts` |
| C | `src/financeiro/adapters/supabase/financeQuery.supabase.ts` |
| C | `src/financeiro/adapters/clock.companySettings.ts` |
| C | `src/financeiro/index.ts` |

### Criar — UI (F4) + docs/testes

| Ação | Path |
|------|------|
| C | `app/(admin)/financeiro/components/DashboardTab.tsx` |
| C | `app/(admin)/financeiro/components/ExtratoTab.tsx` |
| C | `app/(admin)/financeiro/components/ReceberTab.tsx` |
| C | `app/(admin)/financeiro/components/PagarTab.tsx` |
| C | `app/(admin)/financeiro/components/CaixaTab.tsx` |
| C | `app/(admin)/financeiro/components/DreTab.tsx` |
| C | `app/(admin)/financeiro/hooks/useFinancePeriod.ts` |
| C | `app/api/admin/financeiro/opex/route.ts` |
| C | `docs/FINANCEIRO.md` |
| C | `tests/financeiro/postingMatrix.test.ts` |
| C | `tests/financeiro/dashboardAgreesWithExtrato.test.ts` |
| C | `tests/financeiro/reportsUseCashRevenue.test.ts` |
| C | `tests/financeiro/idempotencyRetry.test.ts` |
| C | `tests/financeiro/rpcContracts.test.ts` |

### Migration (um arquivo)

| Ação | Path |
|------|------|
| M | `supabase/migrations/YYYYMMDDHHMMSS_finance_ledger_v1.sql` |

Conteúdo lógico na ordem **dentro do mesmo SQL**: contas → tabelas journal → RPCs
(writers + `rpc_fin_cash_revenue` + dashboard + extrato + settle + opex + reverse)
→ views (`v_fin_extrato`, `v_fin_dre`, `v_fin_cash_session`; `v_aging_receivables`
inalterada na lógica, só GRANT) → backfill → DROP legado → `REVOKE` amplo.

### Tocar — APIs (F1 = swap mínimo para não quebrar; F2/F3 completam)

| Ação | Path | Fatia |
|------|------|--------|
| T | `app/api/dashboard/stats/route.ts` | F1 card R$; F3 KPIs extras |
| T | `lib/server/financeiro/receivedIncome.ts` | F1: passa a RPC nova **ou** some se o stats já chama o adapter |
| T | `app/api/admin/financeiro/dashboard/route.ts` | F1 |
| T | `app/api/admin/financeiro/extrato/route.ts` | F1 |
| T | `app/api/admin/financeiro/dre/route.ts` | F1 |
| T | `app/api/admin/financeiro/bills/route.ts` | F1 GET; F2 PATCH write + settle |
| T | `app/api/admin/financeiro/cash-registers/route.ts` | F1/F4 esperado |
| T | `app/api/admin/financeiro/cash-movements/route.ts` | F2 idempotency |
| T | `app/api/admin/financeiro/finalize-order/route.ts` | F2 recognize |
| T | `app/api/admin/pdv/finalize/route.ts` | F1 (RPC reescrita, mesma assinatura se possível) |
| T | `app/api/admin/pdv/cash-register/route.ts` | F1 esperado via journal 1.1 |
| T | `app/api/admin/pdv/cash-movements/route.ts` | F2 chave client |
| T | `app/api/admin/mesa/sessions/[sessionId]/close/route.ts` | F1 mesmo RPC PDV |
| T | `app/api/admin/orders/route.ts` | F2 liquidação explícita |
| T | `app/api/reports/summary/route.ts` | F1 caixa, não `orders` |
| T | `app/api/reports/daily/route.ts` | F1 |
| T | `app/api/admin/customers/[id]/route.ts` | F1 aging view/RPC |

### Tocar — UI

| Ação | Path | Fatia |
|------|------|--------|
| T | `components/DashboardClient.tsx` | **F3 obrigatório** |
| T | `app/(admin)/financeiro/page.tsx` | F4 |
| T | `app/(admin)/pedidos/PedidosClient.tsx` | F2 |
| T | `app/(admin)/clientes/page.tsx` | F2 contrato bills |
| T | `app/(admin)/relatorios/page.tsx` | F1/F3 mesmo R$ |
| T | `app/(admin)/pdv/page.tsx` | F1 se payload mudar (custo no servidor) |

### Tocar — testes / docs

| Ação | Path |
|------|------|
| T | `tests/mvp/checklistAcceptance.test.ts` |
| T | `tests/mvp/e2eRemoteAndUiContracts.test.ts` |
| T | `tests/workspace/rbacPermissions.test.ts` (`financeiro.write` nas mutações; `opex`) |
| T | `tests/financeiro/dayBounds.test.ts` |
| T | `docs/CHECKLIST_MVP_LANCAMENTO.md` (registro) |
| T | `docs/DB_UI_MIGRATION_TARGETS.md` |
| T | `docs/DB_CURRENT_STATE.md` |

### Apagar (F5)

| Ação | Path |
|------|------|
| A | `lib/server/financeiro/dashboardPayload.ts` |
| A | `lib/server/financeiro/extratoPayload.ts` |
| A | `lib/server/financeiro/receivedIncome.ts` (se já fluiu para adapter) |
| A | `lib/server/financeiro/dayBounds.ts` (se movido) |
| A | `app/api/admin/financeiro/expenses/route.ts` |
| A | `scripts/_apply_raw_1_finance.json` |

Não apagar migrations históricas.

---

## F0 — Contrato escrito

**Estado:** [x] 2026-08-14

- [ ] Criar `docs/FINANCEIRO.md` com: decisões travadas, 12 regras, 7 contas,
      tabela de partidas, vocabulário `payment_method` / `origin`, “status ≠ dinheiro”,
      definição dos 3 números da home, rótulo **Resultado gerencial**.
- [ ] Origin fechado: `pdv | chatbot | web_menu | ui_order | ai_chat | table_service | marketplace | manual`.
- [ ] Idempotency: formato sugerido `sale:{sale_id}:pay:{n}`, `bill:{id}:settle:{seq}`,
      `order:{id}:recognize`, `cash:{register_id}:{sangria|suprimento}:{client_nonce}`.
- [ ] Registrar data neste checklist.

Arquivos: **C** `docs/FINANCEIRO.md` · **T** este arquivo.

---

## F1 — Cutover (schema + RPCs + views + backfill + swap M7)

**Estado:** [x] 2026-08-14

Um arquivo SQL. Um commit. Depois do apply, `GET /api/dashboard/stats` e o
Financeiro dashboard/extrato respondem no journal. PDV continua fechando venda.

### Tabelas

- [ ] `finance_journals`
      - `company_id`, `entry_seq` (bigint, unique por empresa — número humano)
      - `idempotency_key` text NULL
      - UNIQUE `(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
      - `source_type`: `sale_payment | bill_settlement | cash_movement | opex | reversal | recognize`
      - `source_id` uuid NULL (sem unique)
      - FKs nullable: `sale_id`, `order_id`, `bill_id`, `cash_register_id`, `sale_payment_id`
      - `origin` (CHECK da lista F0)
      - `payment_method` (CHECK do `sale_payments` atual, nullable em opex/ajuste)
      - `posted_at`, `occurred_at`
      - `status`: `posted | reversed` (reversed = o original; o contra tem `source_type=reversal`)
      - `reverses_id`, `posted_by` (uuid, `company_users` ou `auth.users`), `reason` text
      - `created_at`
- [ ] `finance_journal_lines`
      - `journal_id`, `account_id`, `direction` `debit|credit`, `amount numeric(14,2) > 0`
      - `payment_method` nullable (mix PIX+cash no mesmo journal? preferir **1 journal por payment** — método no header)
- [ ] Trigger balanceado; `REVOKE UPDATE, DELETE` on lines (e journals, salvo `status`/`reversed_by` via RPC).
- [ ] Índices: `(company_id, posted_at DESC)`, `(company_id, sale_id)`, `(company_id, bill_id)`, `(company_id, entry_seq)`.
- [ ] RLS ENABLE + FORCE; 1 policy `rls_*_service_role_only`; REVOKE anon/authenticated.

### Sequência `entry_seq`

- [ ] `bigint` por `company_id` (`MAX+1` com `FOR UPDATE` numa row de counter, ou sequence por tenant). Não gapless rigoroso se a transação abortar — aceitável; não pode repetir.

### Contas e FKs

- [ ] Reseed 7 contas; DEFAULT `sales.chart_account_id` → 3.1.
- [ ] `ALTER` `sales.origin` CHECK para o enum F0 (ou mapear na RPC e manter CHECK antigo + map). Preferir alargar o CHECK no mesmo cutover.
- [ ] DROP FKs `cost_center_id` em `bills`/`sales` → DROP `cost_centers`.

### RPCs (GRANT só `service_role`; `search_path = public, pg_temp`)

- [ ] `rpc_finalize_pdv_order` — DROP+CREATE. Snapshot `unit_cost`. **1 journal por `sale_payment`**. À vista DR 1.1 CR 3.1; a prazo DR 1.2 CR 3.1 + bill. Idempotency da venda já existe; cada payment: chave derivada estável `sale:{id}:pay:{i}`.
- [ ] `rpc_recognize_order_sale` — cria `sales`+items+payment+journal. Recusa a prazo. Chave `order:{id}:recognize`. `ON CONFLICT` retorna sale/journal existentes.
- [ ] `rpc_settle_bill` — `FOR UPDATE` bill; parcial ok (N journals). Chave client obrigatória.
- [ ] `rpc_post_opex` — payable ± pago. Chave client.
- [ ] `rpc_reverse_journal` — contra-partida; `reason` NOT NULL; chave client.
- [ ] `rpc_post_cash_movement` — sangria/suprimento + journal 5.1. Chave client. Substitui insert cru.
- [ ] `rpc_fin_cash_revenue(p_company_id, p_from, p_to)` — soma 1.1 posted. Substitui `rpc_company_received_income`.
- [ ] `rpc_fin_dashboard` — jsonb: total caixa, count sales, by_day, by_method, by_origin, cogs do período (de `sale_items` das sales ligadas), opex pago, aging total. **Uma ida.** Fuso = parâmetro ou lê `company_settings`.
- [ ] `rpc_fin_extrato` — cursor `(posted_at, id)`.
- [ ] `rpc_open_cash_register` / `rpc_close_cash_register` — REVOKE anon; esperado = 1.1 da sessão ± 5.1.

Retry: todas as RPCs de insert com chave: `INSERT … ON CONFLICT (company_id, idempotency_key) DO NOTHING` + `SELECT` do existente; retorno igual ao primeiro (Stripe).

### Views

- [ ] `v_fin_extrato`, `v_fin_dre` (competência: receita `sales` + taxa − CMV items − opex 4.2 no mês), `v_fin_cash_session`.
- [ ] `v_aging_receivables` permanece; **REVOKE** ALL de `anon`/`authenticated`.
- [ ] `v_dre` antiga: DROP e não deixar GRANT ALL para anon (hoje vaza).
- [ ] `v_daily_sales`: REVOKE; nenhum reader de faturamento. DROP na F5 se ninguém mais usar.
- [ ] Toda view nova: GRANT SELECT só `service_role`.

### Segurança extra na mesma migration

- [ ] `REVOKE ALL ON FUNCTION rpc_finalize_pdv_order, rpc_pay_bill (se ainda existir até o DROP), rpc_open_cash_register, rpc_close_cash_register, rpc_upsert_expense FROM PUBLIC, anon, authenticated`.
- [ ] Prova: `information_schema.routine_privileges` / `proacl` sem anon nas RPCs novas.
- [ ] `fn_*` trigger que restar: `SECURITY DEFINER` + `search_path = public, pg_temp` + REVOKE execute de anon (triggers não precisam de grant a anon).

### Backfill

Remoto de referência (2026-08-14): 32 FE, 1 bill pago R$ 58, 1 promissória pending R$ 305, 1 expense, 10 sales, 23 sale_items custo 0.

- [ ] Income `received` → journal posted em `coalesce(received_at, occurred_at)`; chave `backfill:fe:{id}`.
- [ ] Income pending + bill `paid` (R$ 58) → posted na data `bills.paid_at`.
- [ ] Income pending aberto (R$ 305) → bill AR se faltar + journal DR 1.2 CR 3.1 (sem 1.1).
- [ ] `expenses` → payable (+ journal 4.2 se paid).
- [ ] Recalc `sale_items.unit_cost` do custo atual do produto (documentar no FINANCEIRO.md).
- [ ] DROP `financial_entries` / `expenses` / triggers **depois** da prova de totais.

### Swap call sites no mesmo commit (senão a home quebra)

- [ ] `app/api/dashboard/stats/route.ts` → `rpc_fin_cash_revenue` (card R$ inalterado em nome `salesTotal`).
- [ ] `lib/server/financeiro/receivedIncome.ts` **ou** adapter novo usado pelo stats e pelo dashboard financeiro.
- [ ] `dashboardPayload` / extrato: RPC nova (pode ainda viver em `lib/server` até F5).
- [ ] `reports/summary` e `daily`: caixa, fuso loja, **proibido** `sum(orders.total_amount)`.
- [ ] `pdv/finalize` + mesa close: RPC reescrita (snapshot custo).
- [ ] Testes M7 (`checklistAcceptance`, `e2eRemoteAndUiContracts`): apontar `rpc_fin_cash_revenue`, não `financial_entries`.

### Prova SQL (obrigatória)

- [ ] Policies: 1 `*_service_role_only` em journals/lines.
- [ ] Grants tabela/view: anon/authenticated ausentes.
- [ ] Grants RPC: anon/authenticated ausentes.
- [ ] Insert desbalanceado falha.
- [ ] Unique só em idempotency_key; dois payments do mesmo `order_id` ok.
- [ ] Dois posts mesma chave → mesmo `id`.
- [ ] `rpc_recognize_order_sale` a prazo falha.
- [ ] Soma caixa backfill = received antigo + R$ 58 corrigido.
- [ ] `v_aging_receivables` ainda devolve o título aberto (promissória) se existir.

---

## F2 — Writers (status ≠ dinheiro + write + idempotency client)

**Estado:** [x] 2026-08-14

- [ ] `rpc_set_order_status` **não** posta (trigger já dropado na F1).
- [ ] `PATCH /api/admin/orders`: se o body pedir liquidação (`settle: true` / payment), chama `rpc_recognize_order_sale` com chave `order:{id}:recognize`.
- [ ] `POST .../financeiro/finalize-order`: status + recognize **ou** AR; `financeiro.write`.
- [ ] `PedidosClient.tsx`: o clique “Finalizar” que hoje só muda status passa a liquidar à vista na mesma request (senão a home zera).
- [ ] `PATCH bills` → `rpc_settle_bill` + chave; `POST opex` → `rpc_post_opex`.
- [ ] Sangria/suprimento → `rpc_post_cash_movement` (nunca insert cru).
- [ ] Cancelar pedido com journal posted → `rpc_reverse_journal` ou 409 se caixa da sessão fechou.
- [ ] Rotas de mutação: `requireCapability("financeiro.write")` (PDV finalize continua `pdv.access`).
- [ ] Caixa (`financeiro.write` false) **pode** finalizar PDV; **não** lança opex nem baixa título.
- [ ] Erros: `409 settlement_conflict` (retry devolve 200 + mesmo id, não 409), `422 chatbot_prazo_forbidden`.
- [ ] Rate limit em settle/opex/reverse (além de PDV). → [x] 2026-08-25: `reverse_order` + settle/opex já via `enforceFinanceWriteRateLimit`.

Arquivos: application command + `PedidosClient` + rotas write + `rbacPermissions.test.ts`.

---

## F3 — Dashboard (contrato M7 visível)

**Estado:** [x] 2026-08-14

A home é o financeiro do Essencial. Não é “se o JSON mudar”.

### Números (todos os planos, `dashboard.view`)

| Card | Fonte | Não é |
|------|--------|--------|
| **Recebido hoje** | `rpc_fin_cash_revenue` dia civil | soma de `orders` |
| **A receber** | `v_aging_receivables` total_open da empresa | só Pro |
| **Pedidos ativos** | `orders` `new\|preparing\|delivered` | misturar no ticket |
| **Ticket** | recebido / **count de sales posted no dia** (journals ou `sales.sold_at` liquidadas) | recebido / pedidos `new` criados |

- [x] `GET /api/dashboard/stats` devolve: `salesTotal` (recebido), `arOpen`, `ordersToday` (criados — operacional, rótulo na UI), `settledSalesToday`, `ticketMedio` (recebido/settled), `activeOrders`, `timeZone`, `revenueSource: "finance_journals_1_1"`, `day` YYYY-MM-DD.
- [x] Gráfico 24h: **caixa posted** por hora no fuso, **ou** pedidos criados com rótulo explícito “Pedidos criados (não é faturamento)”. Preferir caixa; se pesado, dois datasets.
- [x] Top produtos: items de **sales** do período, não `order_items` de pedidos `new`.
- [x] `DashboardClient.tsx`: mostra fuso; card A Receber; ticket usa `settledSalesToday`; clique no R$ → `/financeiro?from={day}&to={day}` (Pro) — Essencial sem rota: tooltip “Recebido no caixa hoje”.
- [x] Relatórios usam o mesmo `rpc_fin_cash_revenue` / by_day.
- [x] Teste: `dashboard.salesTotal === financeiro.revenue === reports.faturamento` no mesmo `[from,to)` civil.
- [ ] Comparativo D−1 opcional se barato (mesmo RPC ontem); senão F3.1 depois — não bloquear.

Arquivos: **T** `stats/route.ts` · **T** `DashboardClient.tsx` · **T** `reports/*` · **C** `queryHomeStats.ts`.

---

## F4 — UI Financeiro

**Estado:** [x] 2026-08-14

- [x] `page.tsx` shell (período + tabs + `PlanFeatureGate`). Respeita `?from&to` da home.
- [x] 6 componentes de tab.
- [x] KPIs com as definições do FINANCEIRO.md. Resultado gerencial + aviso se CMV=0.
- [x] A Pagar = `bills` payable; modal → `POST /opex`.
- [x] A Receber = lista + aging (reusar totais da view).
- [x] Caixa: “Total esperado” preenchido (`v_fin_cash_session`).
- [x] Origem: PDV / Chat / Web / UI / IA / Mesa / Marketplace — `ai_chat` não cai em balcão.
- [x] Extrato: cursor; linha abre pedido/venda.

---

## F5 — Mata-legado

**Estado:** [x] 2026-08-14

- [x] Apagar arquivos da lista A.
- [x] Grep zero: `from("financial_entries")`, `from("expenses")`, `rpc_upsert_expense`, `rpc_company_received_income`, `rpc_pay_bill`, `v_daily_sales` em faturamento.
- [x] `postingMatrix`: PDV misto; a prazo→baixa; chatbot à vista; chatbot prazo recusa; estorno; retry mesma chave mesmo id; sangria dupla.
- [x] `npm test`. Prova `to_regclass('public.financial_entries')` IS NULL.

---

## Call sites de dinheiro

| Call site | Hoje | Alvo |
|-----------|------|------|
| `rpc_finalize_pdv_order` | FE por pagamento; `unit_cost=0`; EXECUTE anon | Journal por payment + snapshot; REVOKE anon |
| Trigger finalize `orders` | FE received se `sale_id` null | DROP; `rpc_recognize_order_sale` |
| Trigger bill paid | INSERT FE | DROP; `rpc_settle_bill` |
| `POST .../finalize-order` | status+bill; cap `.read` | status+recognize/AR; `.write` |
| `PATCH .../admin/orders` | só status (trigger faz o resto) | status; settle explícito |
| `POST .../pdv/finalize` | RPC PDV | RPC nova |
| Mesa close | RPC PDV | RPC nova |
| `POST/PATCH .../expenses` | `rpc_upsert_expense` | `/opex` + `rpc_post_opex` |
| `PATCH .../bills` | `rpc_pay_bill` | `rpc_settle_bill` |
| Sangria | insert `cash_movements` | `rpc_post_cash_movement` |
| `GET .../dashboard/stats` | `rpc_company_received_income` | `rpc_fin_cash_revenue` + aging F3 |
| `.../reports/*` | soma `orders` / `v_daily_sales` | caixa journal |
| `GET .../customers/[id]` | `bills` cru | aging/RPC |

---

## Ordem

1. F0 contrato (`docs/FINANCEIRO.md`)
2. F1 cutover (migration + APIs M7/PDV/reports) — **não** mergear só o SQL
3. F2 writers + Pedidos + `.write`
4. F3 dashboard UX (cards/gráfico/aging/drill)
5. F4 UI Financeiro
6. F5 delete

F3 pode começar em paralelo depois da F1 (o card R$ já está certo). F4 não começa com F1 incompleta.

---

## Fase F — Estorno operacional unificado (2026-08-25, aprovada)

**Plano detalhado:** `docs/PLANO_FINANCEIRO_ORIGEM_ESTORNO.md` §6 (checklist F.0–F.8) e §9 (contrato RPC).

**Resumo:** estorno com pedido = **storno integral do journal vigente** + **reemissão** (parcial) ou **cancelamento total** (full, sem reemissão). UI: **estorno completo do pedido** + **parcial por item** (+ taxas). Uma RPC: `rpc_admin_reverse_order_operation`.

| Sub | Entrega | Estado |
|-----|---------|--------|
| F.1 | DB: `order_events`, helpers, RPC canônica, extrato sem `reversed` | [x] |
| F.2 | TS: `reverseOrderOperation`, ports, `queryExtrato` | [x] |
| F.3 | APIs: `reverse-order` extended; journal reverse bloqueado com `order_id` | [x] |
| F.4 | UI: `JournalEntryModal` item a item + **Estornar pedido completo** + timeline | [x] |
| F.5 | Idempotência `order:{id}:reverse:{nonce}` | [x] |
| F.6 | Gargalos G1–G4 | [x] |
| F.7 | Testes + smoke full/partial | [~] testes ok; smoke manual pendente |
| F.8 | `FINANCEIRO.md` atualizado | [x] |

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-14 | Estrutura ledger aprovada (primeira versão). |
| 2026-08-14 | Crítica: opção A (journal sem CMV), unique só idempotency_key, cutover único, dashboard = M7, REVOKE RPCs/views, reusar aging, sem posting.ts duplicado. F0/F1/F3 reescritos neste arquivo. |
| 2026-08-14 | F1 aplicada no remoto: `finance_ledger_v1`. Caixa backfill = R$ 12.017,50 (received antigo + R$ 58). Aging promissória R$ 305. `financial_entries`/`expenses` dropadas. |
| 2026-08-14 | F2: `settle: true` no PATCH Pedidos; recognize a prazo só UI/PDV; cancel estorna journal (409 se caixa fechado); opex/baixa exigem `financeiro.write`; sangria via `rpc_post_cash_movement` com chave. |
| 2026-08-14 | F3: home M7 — Recebido/A receber/Ativos/Ticket; gráfico caixa 1.1; top de `sale_items`; drill Pro `?from&to`; `queryHomeStats`. |
| 2026-08-14 | F4: Financeiro em 6 tabs; opex via `POST /opex`; aging em A Receber; esperado no Caixa; origens F0; extrato com cursor. |
| 2026-08-14 | F5: moveu helpers para `src/financeiro`; drop `expenses` API + `v_daily_sales`; PDV passa a CR 3.2 na taxa de entrega. |
| 2026-08-25 | **Fase F aprovada:** estorno operacional unificado (storno + reemissão parcial; full = cancel pedido completo). Checklist F.0–F.8 em `PLANO_FINANCEIRO_ORIGEM_ESTORNO.md`. |
