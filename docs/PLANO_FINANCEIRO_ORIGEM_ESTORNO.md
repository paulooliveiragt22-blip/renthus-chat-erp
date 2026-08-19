# Plano — Origem financeira, pagamentos loja e estorno (dinheiro + estoque)

Status: **em execução** (2026-08-19).

Documento de execução complementa `docs/FINANCEIRO.md` e `docs/CHECKLIST_FINANCEIRO_LEDGER.md`.

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

### Migration futura `..._finance_partial_refund.sql` (Fase D)

| Item | Tipo |
|------|------|
| `rpc_reverse_order_sale(p_mode, p_lines, …)` | function |
| `order_reversal_lines` | table opcional — auditoria de linhas estornadas |

### RPCs (catálogo)

| RPC | Fase | Responsabilidade |
|-----|------|------------------|
| `rpc_finalize_pdv_order` | A | venda PDV/mesa + journals origem correta |
| `rpc_recognize_order_sale` | existente | liquidar pedido remoto |
| `rpc_reverse_journal` | existente | estorno genérico |
| `rpc_admin_cancel_order` | C | estorno full + estoque + bills |
| `rpc_reverse_order_sale` | D | full + partial |

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
| `/api/admin/financeiro/journals` | A | GET — filtro `origin` |

---

## 5. UI

| Tela | Fase | Mudança |
|------|------|---------|
| Configurações | B | aba pagamentos loja (PDV/Pedidos/Mesa) |
| PDV | B | filtrar métodos pela policy |
| Mesa | A+B | `order_source` + idempotency |
| Pedidos | C | cancel já chama RPC — confirmar estoque volta |
| Financeiro extrato | A | badge origem via `v_fin_journal_trace` [x] |

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

### Fase D — Estorno parcial

- [ ] `rpc_reverse_order_sale` partial
- [ ] UI modal linhas + valor
- [ ] Idempotency refund

### Fase E — Documentação e gates [parcial]

- [ ] Atualizar `FINANCEIRO.md` (estorno + origem)
- [x] `npm test` verde (956 testes)
- [ ] Smoke: mesa → extrato `table_service`; cancel → estoque restaurado

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
