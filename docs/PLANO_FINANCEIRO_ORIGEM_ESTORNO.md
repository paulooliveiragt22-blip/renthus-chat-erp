# Plano — Origem financeira, pagamentos loja e estorno (dinheiro + estoque)

Status: **em execução** — Fase F aprovada (2026-08-25).

Documento de execução complementa `docs/FINANCEIRO.md` e `docs/CHECKLIST_FINANCEIRO_LEDGER.md`.

> **Decisão F (2026-08-25):** estorno com pedido = **storno integral do journal vigente + reemissão** do que sobrou (parcial) ou **cancelamento total** (full). UI deve oferecer **estorno completo do pedido** e **estorno parcial por item** (+ taxas). Ver §9.

---

## 1. Crítica técnica (arquiteto de dados)

### O que a proposta anterior acertou

- Separar **operacional** (`orders.status`) de **liquidação** (`finance_journals`) — já é o design F2 e evita o bug clássico “mudei status e o caixa mudou”.
- Usar **ledger com `reverses_id`** em vez de DELETE em lançamentos — auditoria e KPI “Recebido” ficam consistentes.
- Estorno de estoque via **mutação de `order_items`** (trigger existente) em vez de RPC manual de estoque — uma fonte de verdade (`fn_debitar_estoque_embalagem`).

### Riscos e lacunas identificados

| Ponto | Crítica | Mitigação no plano |
|-------|---------|-------------------|
| **Snapshot vs join** | `finance_journals.origin` derivado no post; mesa patchava `orders.source` **depois** do journal → extrato errado para sempre | Colunas `order_source_snapshot` / `order_channel_snapshot` no journal + corrigir ordem no finalize mesa |
| **Dupla semântica `sales.origin` vs `orders.source`** | `sales.origin` usa enum financeiro; `orders.source` usa enum operacional (`pdv_direct`, `web_menu`…) | `fn_fin_map_origin(orders.source)` como único mapa; PDV finalize aceita `order_source` no payload |
| **Estorno sem estoque** | `rpc_admin_cancel_order` só reverte journals; CMV/operacional diverge do físico | Cancel full: `DELETE order_items` após journals (trigger credita estoque) |
| **Estorno parcial** | Reverter journal proporcional + linhas é complexo (taxas 3.1/3.2/3.3) | Fase D dedicada; Fase C só **full** |
| **Prazo / bills** | `sale_payments` a prazo gera AR; cancel reverte journal mas bill pode ficar aberto | Fase C: cancelar bills `open` ligados ao `sale_id` no mesmo RPC |
| **Policy em dois mundos** | `accepted_customer_payments` ≠ métodos PDV (`credit`, `boleto`…) | `accepted_store_payments` + `accepted_store_prazo` separados |
| **Idempotency mesa** | Double-close duplica venda | `idempotency_key` no close mesa |
| **Partial refund idempotency** | Sem unique em refund parcial → double-click duplica estorno | `order:{id}:refund:{client_key}` na Fase D |

### Decisão de modelagem (não negociar)

1. **Não reintroduzir `financial_entries`** — ledger é canônico.
2. **Não estornar estoque fora de `order_items`** — trigger é a política de movimentação.
3. **Mutação financeira + estoque = uma RPC** (`rpc_admin_cancel_order` / `rpc_reverse_order_sale`) — app nunca faz journal + delete items em duas chamadas.
4. **Frontend** nunca lê `finance_journals` cru — views `v_fin_extrato`, `v_fin_journal_trace` + APIs admin.

---

## 2. Contratos de domínio (TypeScript)

| Artefato | Caminho | Conteúdo |
|----------|---------|----------|
| `FinanceOrigin` | `src/financeiro/domain/origin.ts` | já existe — mapa `orders.source` → label |
| `AcceptedCustomerPayments` | `src/financeiro/domain/acceptedCustomerPayments.ts` | canais cliente |
| `AcceptedStorePayments` | `src/financeiro/domain/storePaymentPolicy.ts` | **novo** — à vista loja |
| `StorePrazoMethods` | idem | credit_installment, boleto, … |
| `ReversalMode` | `src/financeiro/domain/reversal.ts` | **novo** — `full` \| `partial` (Fase D) |
| `ReverseOrderSaleInput` | `src/financeiro/ports/financeCommand.port.ts` | **novo** |
| `JournalTraceRow` | `src/financeiro/ports/financeQuery.port.ts` | **novo** — extrato com origem |

### Payload PDV finalize (extensão)

```json
{
  "order_source": "table_service",  // opcional — mesa
  "channel": "mesa",
  "active_order_source": "web_menu", // pagar pedido existente
  "idempotency_key": "..."
}
```

---

## 3. Banco — migrations, RPCs, views

### Migration `20260819010000_finance_origin_snapshot_reversal.sql` (Fase A + C)

| Item | Tipo | Descrição |
|------|------|-----------|
| `finance_journals.order_source_snapshot` | column text | snapshot `orders.source` no post |
| `finance_journals.order_channel_snapshot` | column text | snapshot `orders.channel` |
| `fn_fin_post_journal` | function | preenche snapshots quando `p_order_id` presente |
| `rpc_finalize_pdv_order` | function | `fn_fin_map_origin` completo; `order_source`/`channel` no payload |
| `rpc_admin_cancel_order` | function | após journals: cancel bills open do sale; `DELETE order_items`; status canceled |
| `v_fin_journal_trace` | view | journal + snapshots + order labels |
| backfill | sql | snapshots em journals existentes com `order_id` |

### Migration `20260819020000_accepted_store_payments.sql` (Fase B)

| Item | Tipo | Descrição |
|------|------|-----------|
| seed `companies.settings.accepted_store_payments` | data | pix/cash/card/debit default on |
| seed `accepted_store_prazo` | data | credit/boleto/cheque/promissoria default on |

### Migration futura `20260819030000_finance_journal_partial_reversal.sql` (Fase D) [concluída]

| Item | Tipo |
|------|------|
| `fn_fin_journal_line_remaining` | function — saldo estornável por linha |
| `rpc_fin_journal_detail` | function — linhas + remaining |
| `rpc_reverse_journal_partial` | function — estorno parcial por conta (3.1/3.2/3.3/4.2…) |
| `rpc_reverse_journal` | function — estorno total do **remaining** (compatível com parciais anteriores) |

### RPCs (catálogo)

| RPC | Fase | Responsabilidade |
|-----|------|------------------|
| `rpc_finalize_pdv_order` | A | venda PDV/mesa + journals origem correta |
| `rpc_recognize_order_sale` | existente | liquidar pedido remoto |
| `rpc_reverse_journal` | D | estorno total do saldo restante |
| `rpc_reverse_journal_partial` | D | estorno parcial por linhas do ledger |
| `rpc_fin_journal_detail` | D | detalhe + remaining para UI |
| `rpc_admin_cancel_order` | C | estorno full + estoque + bills |

### Views

| View | Uso |
|------|-----|
| `v_fin_extrato` | existente — KPI caixa |
| `v_fin_journal_trace` | **novo** — drill origem pedido |
| `v_fin_dre` | existente — competência |

---

## 4. APIs admin

| Rota | Fase | Método |
|------|------|--------|
| `/api/admin/financeiro/reverse-order` | C | POST — cancel full + motivo [x] |
| `/api/admin/accepted-store-payments` | B | GET/PATCH [x] |
| `/api/admin/financeiro/journals/[id]` | D | GET detalhe + linhas [x] |
| `/api/admin/financeiro/journals/[id]/reverse` | D | POST partial por linhas ledger [x] |

### Migration `20260819040000_finance_reversal_reason_optional.sql` (UX D+)

| Item | Tipo |
|------|------|
| `rpc_fin_journal_detail` | `entry_seq`, `reason` no JSON |
| `rpc_reverse_journal` / `rpc_reverse_journal_partial` | motivo opcional (default `Estorno`) |

---

## 5. UI

| Tela | Fase | Mudança |
|------|------|---------|
| Configurações | B | aba pagamentos loja (PDV/Pedidos/Mesa) |
| PDV | B | filtrar métodos pela policy |
| Mesa | A+B | `order_source` + idempotency |
| Pedidos | C | cancel já chama RPC — confirmar estoque volta |
| Financeiro extrato | A+D | badge origem; modal `JournalEntryModal` — estorno por conta 3.1/3.2/3.3, confirmação vermelha, motivo opcional, link `/pedidos?open=` [x] |

---

## 6. Checklist de execução

### Fase A — Origem canônica [concluída]

- [x] Crítica + plano (`docs/PLANO_FINANCEIRO_ORIGEM_ESTORNO.md`)
- [x] Migration snapshots + `fn_fin_post_journal`
- [x] `rpc_finalize_pdv_order` — mapa origem + payload `order_source`
- [x] Mesa close — `order_source=table_service`, `channel=mesa`, idempotency
- [x] View `v_fin_journal_trace` + backfill
- [x] Aplicar migration remoto + `execute_sql` validação
- [ ] Testes RPC/origin (integração DB)

### Fase B — Pagamentos loja [concluída]

- [x] `storePaymentPolicy.ts` + migration seed
- [x] API `accepted-store-payments`
- [x] Wire PDV finalize + mesa (prazo separado)
- [x] Config UI aba loja
- [x] Testes policy (`tests/payments/storePaymentPolicy.test.ts`)

### Fase C — Estorno full (dinheiro + estoque) [concluída]

- [x] `rpc_admin_cancel_order` — delete items + bills (migration)
- [x] API `reverse-order` (`POST /api/admin/financeiro/reverse-order`)
- [x] Modal Pedidos — aviso estorno financeiro + estoque
- [x] Cancel finalizado habilitado (exceto delivered)
- [x] `reverseOrderSale` application + testes (`tests/financeiro/reverseOrderSale.test.ts`)
- [ ] Testes integração cancel + stock (DB smoke manual)

### Fase D — Estorno parcial (journal-first) [concluída]

- [x] `rpc_reverse_journal_partial` + `fn_fin_journal_line_remaining`
- [x] `rpc_reverse_journal` atualizado (remaining após parciais)
- [x] APIs journal detail + reverse
- [x] UI Extrato — `JournalEntryModal`: seleção por conta ledger, confirmação, motivo opcional
- [x] Testes `reverseJournal.test.ts`
- [ ] Estorno parcial com crédito de estoque (opcional futuro)

### Fase E — Documentação e gates [parcial]

- [ ] Atualizar `FINANCEIRO.md` (estorno + origem)
- [x] `npm test` verde (956 testes)
- [ ] Smoke: mesa → extrato `table_service`; cancel → estoque restaurado

### Fase F — Estorno operacional unificado (storno + reemissão) [em execução 2026-08-25]

**Modelo:** estorno integral do journal vigente + reemissão (parcial) ou cancel full (sem reemissão). UI: **estorno completo do pedido** + parcial por item.

#### F.0 — Decisões travadas

- [x] Aprovação do modelo storno + reemissão (parcial) e full sem reemissão
- [x] UI: estorno completo + parcial por item (+ taxas)
- [x] Uma RPC transacional (`rpc_admin_reverse_order_operation`)
- [x] Estoque via `order_items` (trigger)
- [x] Histórico em `order_events`

#### F.1 — Banco

- [x] Tabela `order_events` + RLS
- [x] `fn_order_recalc_totals`, `fn_sale_sync_from_order`
- [x] `fn_fin_reverse_order_journals`, `fn_fin_restate_order_sale`
- [x] `rpc_admin_reverse_order_operation` (full + partial)
- [x] `rpc_admin_cancel_order` delega full
- [x] Apply remoto (`20260825030000_order_reverse_operation.sql`)
- [x] Extrato: ocultar journals `status=reversed` (`queryExtrato`)

#### F.2 — Domain / application / ports

- [x] `reversal.ts`, `reverseOrderOperation.ts`
- [x] `reverseOrderSale.ts` → wrapper full
- [x] `financeCommand.port.ts` + adapter
- [x] `queryExtrato.ts` — sem `estornado (total)`
- [x] `errors.ts` — novos códigos

#### F.3 — APIs

- [x] `POST reverse-order` — mode, items, taxas, idempotency
- [x] `POST journals/reverse` — 409 se `order_id`
- [ ] `GET orders/[id]/events`

#### F.4 — UI

- [x] `JournalEntryModal` — itens + taxas + **Estornar pedido completo**
- [x] `ExtratoTab` — via queryExtrato
- [ ] Timeline pedido (`order_events`)

#### F.5 — Idempotência

- [x] Chaves `order:{id}:reverse:{nonce}` + `reversal:op:` + `:restate`

#### F.6 — Gargalos

- [x] G1–G4 (recalc, restate, unified path, extrato)
- [ ] G6–G9 (multi-pay proporcional v1 ok; prazo partial bloqueado)

#### F.7 — Testes

- [x] `reverseOrderSale.test.ts` atualizado
- [ ] `reverseOrderOperation.test.ts`
- [ ] Smoke manual full/partial

#### F.8 — Docs

- [ ] `FINANCEIRO.md`

---

## 7. Validação SQL (após apply)

```sql
-- snapshots preenchidos
select count(*) from finance_journals where order_id is not null and order_source_snapshot is null;

-- mesa no extrato
select origin, order_source_snapshot from finance_journals where order_source_snapshot = 'table_service' limit 5;
```

---

## 8. Fora deste plano (explícito)

- Estorno PIX gateway / chargeback bancário
- CMV no journal (opção A mantida)
- Policy distinta web vs chatbot (mesma `customer` policy)

---

## 9. Fase F — contrato e responsabilidades (referência implementação)

### 9.1 Arquitetura

```
UI (JournalEntryModal, Pedidos, Extrato)
  → POST /api/admin/financeiro/reverse-order
  → reverseOrderOperation.ts
  → financeCommand.supabase.ts
  → rpc_admin_reverse_order_operation (Postgres, uma transação)
       → fn_fin_reverse_order_journals → rpc_reverse_journal (full do vigente)
       → UPDATE/DELETE order_items (estoque via trigger)
       → fn_order_recalc_totals
       → fn_sale_sync_from_order
       → fn_fin_restate_order_sale (só partial com saldo > 0)
       → fn_order_append_event
```

Leitura extrato: `queryExtrato` + `v_fin_extrato` (sem journals `reversed` na lista).

### 9.2 RPC `rpc_admin_reverse_order_operation`

**Input:**

```typescript
{
  company_id: uuid
  order_id: uuid
  mode: "full" | "partial"
  items?: Array<{ order_item_id: uuid; qty: number }>  // obrigatório se partial
  include_delivery_fee?: boolean   // default false
  include_service_fees?: boolean   // default false
  reason?: string | null           // default "Estorno"
  idempotency_key: string          // obrigatório (client)
  reject_confirmation?: boolean    // fila
}
```

**Output:**

```json
{
  "ok": true,
  "mode": "full" | "partial",
  "order_id": "...",
  "reversed_journal_ids": ["..."],
  "restatement_journal_ids": ["..."],
  "order_status": "canceled" | "finalized",
  "event_id": "..."
}
```

**Fluxo interno (ordem fixa):**

1. `SELECT orders FOR UPDATE`
2. Validar status, caixa não fechado (se débito 1.1), idempotency
3. Estornar **todos** journals `posted` do pedido (integralmente)
4. **full:** `DELETE` todos `order_items`; cancel bills/sale; `orders.status=canceled`
5. **partial:** ajustar `order_items` por `items[]`; recalc totais; **reemitir** journal se total > 0
6. Registrar `order_events`

### 9.3 Padrões de lançamento no extrato

| Evento | `source_type` | Visível no extrato |
|--------|---------------|-------------------|
| Venda / liquidação | `sale_payment` / `recognize` | Sim (+ recebido) |
| Estorno (filho) | `reversal` | Sim (− estornado) |
| Original estornado | qualquer | **Não** (ou “substituído”, fora do fluxo principal) |
| Reemissão pós-parcial | `recognize` / `sale_payment` | Sim (+ recebido) |

**Exemplo parcial:** J#27 +R$1.475 → estorna UN R$160 → J#40 reversal −R$1.475 + J#41 novo +R$1.315; pedido mantém só CX.

**Exemplo full:** J#27 +R$1.475 → J#40 reversal −R$1.475; sem novo journal; pedido `canceled`; estoque restaurado.

### 9.4 Matriz de responsabilidade

| Peça | Dono |
|------|------|
| Regra storno + reemissão | RPC Postgres |
| Estoque | Trigger em `order_items` |
| Split 3.1 / 3.2 / 3.3 | `fn_fin_build_sale_credit_lines` |
| Idempotência | RPC + chaves únicas |
| RBAC / tenant | API Route Handlers |
| Seleção itens + **estorno completo** | `JournalEntryModal`, Pedidos |
| Extrato | `queryExtrato` |
| Auditoria | `order_events` |

### 9.5 O que permanece sem pedido

`rpc_reverse_journal` / `rpc_reverse_journal_partial` para **opex**, sangria, despesa — sem `order_id`, sem reemissão, sem estoque.
