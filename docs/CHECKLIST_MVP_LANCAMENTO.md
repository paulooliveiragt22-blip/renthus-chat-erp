# Checklist — recursos MVP antes do lançamento

Origem: pontos do dono (2026-08-13). Este arquivo existe para **não perder contexto** entre
sessões. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir cada item.

**Processo:** estruturas M2–M7 aprovadas (2026-08-13) + matriz de planos → implementação
item a item (`apply_migration` MCP + `npm test`). Ordem: M2 → M5 → M4+M6 → M3 → M7.

Regra: mutação só RPC/API server-side; frontend nunca acessa tabela crua; migrations com
FORCE RLS + `service_role_only` (ou view `v_sec_*` se o client precisar ler). Postura
pré-produção radical (`.cursor/rules/projeto-pre-producao-radical.mdc`).

---

## Resumo

| # | Item | Planos | Estado |
|---|------|--------|--------|
| M1 | Entrega vs retirar no local + liga/desliga entregas | todos | [x] 2026-08-13 |
| M2 | Horário de atendimento + descrição do delivery | todos | [x] 2026-08-13 |
| M3 | Cadastro de usuários com permissões | Pro + Market (`staff_users`) | [ ] |
| M4 | Vias de impressão selecionáveis + reprint por via | Pro + Market (`printing_auto`) | [x] |
| M5 | Status `preparing` + notificar cliente | todos (IG só com omnichannel) | [x] |
| M6 | Limpar fila de impressão | Pro + Market (`printing_auto`) | [x] |
| M7 | Integridade financeira (receita real) | todos (não é feature flag) | [ ] |
| M0 | Seed de keys novas no commit do item | `staff_users` em M3 | [ ] parcial |

---

## Matriz de planos (aprovada 2026-08-13)

| Recurso | Essencial | Pro | Market | Key |
|---------|-----------|-----|--------|-----|
| M1 fulfillment | liga | liga | liga | nenhuma |
| M2 horário + descrição | liga | liga | liga | nenhuma |
| M5 preparo + WhatsApp | liga | liga | liga | nenhuma; IG só `omnichannel_ig_messenger` |
| M7 receita real | liga | liga | liga | **não** `financeiro_full` |
| M3 usuários | bloqueia (só owner) | liga | liga | `staff_users` |
| M4 vias + reprint | bloqueia | liga | liga | `printing_auto` |
| M6 limpar fila | bloqueia | liga | liga | `printing_auto` |

`financeiro_full` = extrato/despesas/lucro no Pro/Market. O R$ do dashboard do dia
precisa ser honesto em **todos** os planos (M7).

---

## Estruturas aprovadas (resumo)

### M2 — Horário + descrição
- Canônico: `company_settings.open_time`, `close_time`, `timezone` (default `America/Cuiaba`),
  `delivery_description` (≤280 chars, texto).
- Um módulo `lib/delivery/hours.ts`; remover leitura de jsonb / `business_hours` weekday.
- Checkout web recusa no servidor se fechado. Bot informa horário (distinto de entregas
  pausadas M1). Overnight suportado.

### M3 — Usuários
- Convite Supabase; Auth + `company_users` com compensação. Roles atuais.
- `admin` não rebaixa `owner`. Desativar = `is_active` + revogar sessão.
- Enxugar PATCH de staff. Feature `staff_users`.

### M4 — Vias selecionáveis
- `print_jobs.copy_type` = `kitchen | cashier | driver`.
- Unique ativo `(company_id, source_id, copy_type)`.
- Loja escolhe quais vias no auto-print; reprint multi-select.
- `driver` só em `fulfillment_type=delivery`. `copy_type` no payload.
- Trigger e `rpc_enqueue_print_job` atualizados.

### M5 — preparing
- CHECK + RPC `rpc_set_order_status` com allowlist.
- Retirada: `preparing → finalized`. Notify via `outbound_jobs`.
- Limpar status fantasma no extrato/PDV.

### M6 — Limpar fila
- RPC `rpc_clear_print_queue`; status `canceled`; sem DELETE de `processing` sem lease.

### M7 — Receita
- Uma fonte: lançamentos recebidos. Matar POST de receita no PedidosClient.
- Helper compartilhado dashboard + extrato; agregação SQL; fuso da loja.

---

## Estado atual do remoto (achados iniciais)

### Pedidos
- `orders.status` CHECK: `new | canceled | delivered | finalized` (+ `fulfillment_type` M1).
- Contagem na leitura inicial: 176 `new`, 28 `finalized`, 7 `delivered`, 2 `canceled`.

### Delivery
- M1 aplicado: `deliveries_enabled` / `pickup_enabled` em `company_delivery_policy`.
- Horário ainda não tipado (M2). Outbound lia `companies.settings` jsonb (null).

### Usuários / Impressão / Financeiro
- Sem tela de convite; só owners no remoto.
- Trigger de print bloqueia 2º job no mesmo pedido (M4 precisa mudar).
- Dashboard soma `orders` não-cancelados inclusive `new` (M7).

---

## M1 — Entrega ou retirar no local

**Estado:** [x] 2026-08-13 — policy flags + `orders.fulfillment_type` + RPC + bot + cardápio +
Configurações.

---

## M2 — Horário de atendimento + descrição do delivery

**Estado:** [x] 2026-08-13 — `company_settings` (`open_time`, `close_time`, `timezone`,
`delivery_description`); `lib/delivery/hours.ts`; outbound lê tipado; checkout/bot
bloqueiam se fechado; Configurações Delivery + cardápio exibem horário/descrição.

---

## M3 — Usuários e permissões

**Estado:** [ ] estrutura aprovada

---

## M4 — Vias de impressão selecionáveis + reimprimir por via

**Estado:** [x] 2026-08-13 — `print_jobs.copy_type`; unique ativo por via;
`rpc_enqueue_print_job` multi-via; `company_settings.print_auto_copies`; reprint
multi-select; payload com `copy_type`.

---

## M5 — Status em preparo + notificar cliente

**Estado:** [x] 2026-08-13 — CHECK `preparing`; `rpc_set_order_status`; notify
`outbound_jobs` (transactional); Pedidos “Em preparo”; dashboard ativos; limpeza
status fantasma (extrato/PDV).

---

## M6 — Limpar fila de impressão

**Estado:** [x] 2026-08-13 — `job_status.canceled` + `rpc_clear_print_queue`
(pending + processing stale); UI “Limpar fila” em Impressoras.

---

## M7 — Integridade de valores

**Estado:** [ ] estrutura aprovada

---

## Ordem de implementação

1. M1 — feito
2. M2 (horário)
3. M5 (preparing + notify)
4. M4 + M6 (impressão)
5. M3 (usuários)
6. M7 (financeiro)

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-13 | Checklist criado após inspeção do schema remoto |
| 2026-08-13 | M1 commit `c89bfea`; estruturas M2–M7 + matriz de planos aprovadas; inicia M2 |
| 2026-08-13 | M2 aplicado no remoto (`company_settings_store_hours`); npm test 826 pass |
| 2026-08-13 | M5 aplicado (`orders_status_preparing` + RPC + notify + UI) |
| 2026-08-13 | M4+M6 aplicados (`print_jobs.copy_type`, clear queue, UI vias) |
