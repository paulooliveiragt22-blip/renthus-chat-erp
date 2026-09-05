# Checklist — recursos MVP antes do lançamento

Origem: pontos do dono (2026-08-13). Este arquivo existe para **não perder contexto** entre
sessões. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir cada item.

**Processo:** estruturas M2–M7 aprovadas (2026-08-13) + matriz de planos → implementação
item a item (`apply_migration` MCP + `npm test`). Ordem: M2 → M5 → M4+M6 → M3 → M7.

Regra: mutação só RPC/API server-side; frontend nunca acessa tabela crua; migrations com
FORCE RLS + `service_role_only` (ou view `v_sec_*` se o client precisar ler). Postura
pré-produção radical (`.cursor/rules/projeto-pre-producao-radical.mdc`).

**Canais / HSM (épicos paralelos):** [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) · [`CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md`](./CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md) · [`ENV_META_CHANNELS.md`](./ENV_META_CHANNELS.md).

---

## Resumo

| # | Item | Planos | Estado |
|---|------|--------|--------|
| M1 | Entrega vs retirar no local + liga/desliga entregas | todos | [x] 2026-08-13 |
| M2 | Horário de atendimento + descrição do delivery | todos | [x] 2026-08-14 |
| M3 | Cadastro de usuários com permissões | Pro + Market (`staff_users`) | [x] |
| M4 | Vias de impressão selecionáveis + reprint por via | Pro + Market (`printing_auto`) | [x] |
| M5 | Status `preparing` + notificar cliente | todos (IG só com omnichannel) | [x] |
| M6 | Limpar fila de impressão | Pro + Market (`printing_auto`) | [x] |
| M7 | Integridade financeira (receita real) | todos (não é feature flag) | [x] |
| M0 | Seed de keys novas no commit do item | `staff_users` em M3 | [x] |
| INFRA-1 | Upstash Redis (rate limit distribuído) | todos | [x] 2026-09-05 owner — vars em Vercel Production |

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
- Canônico: `company_settings.opening_periods` (até 2 turnos `{open,close}` HH:MM).
  `open_time`/`close_time` = 1º turno (compat). `timezone` (default `America/Cuiaba`),
  `delivery_description` (≤280 chars).
- Um módulo `lib/delivery/hours.ts`; não usar jsonb / `business_hours` weekday.
- Checkout web e bot recusam se fechado (mensagem padrão hoje/amanhã). Overnight no turno.
- Sem períodos cadastrados → aberto (não inventar fechamento).

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

**Estado:** [x] 2026-08-14 — policy flags + `orders.fulfillment_type` + RPC + bot + cardápio +
Configurações + **admin Pedidos/Fila** (badge + endereço canônico) + **novo/editar pedido**
(`rpc_admin_upsert` com `p_fulfillment_type`) + PDV balcão=`pickup` + Flow/WA confirm por modo.
Clique Entrega/Retirar casa id **e** título; endereço salvo não infere entrega;
slot não avança pra pagamento enquanto o modo estiver vazio.

---

## M2 — Horário de atendimento + descrição do delivery

**Estado:** [x] 2026-08-14 — até 2 turnos/dia (`company_settings.opening_periods`);
`open_time`/`close_time` = 1º turno (compat); `lib/delivery/hours.ts`; cardápio e bot
usam o mesmo `isStoreOpen`; fechado → mensagem padrão (“não estamos atendendo… hoje/amanhã
a partir das HH:MM”); checkout recusa no servidor. Sem horário cadastrado = loja aberta
(não inventar fechamento). Overnight no 1º turno (ex. 18:00–02:00).

---

## M3 — Usuários e permissões

**Estado:** [x] 2026-08-14 — RBAC por perfil (`company_staff_profiles` + capabilities);
role `member` (ex-`staff`); gestão owner+admin em **Configurações → Geral**;
`requireCapability` nas APIs operacionais; feature `staff_users` (Pro/Market).

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

**Estado:** [x] 2026-08-13 — receita = `financial_entries` received; RPC agregação;
dashboard/extrato no fuso da loja; removido POST duplicado do PedidosClient.

---

## Ordem de implementação

1. M1 — feito
2. M2 (horário)
3. M5 (preparing + notify)
4. M4 + M6 (impressão)
5. M3 (usuários)
6. M7 (financeiro)

---

## Infra — antes do lançamento MVP

### INFRA-1 — Upstash Redis (rate limit distribuído)

**Estado:** [x] 2026-09-05 — owner confirmou `UPSTASH_*` em Vercel Production (P2 S12).

Código: `lib/security/rateLimitDistributed.ts`. Sem Redis o limite fica in-memory por réplica.

Checklist operacional:

1. [x] Database Redis no Upstash (produção).
2. [x] `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` no projeto.
3. [x] Vars em Vercel Production (owner 2026-09-05).
4. [ ] (Opcional agente) `COMPANY_LLM_MAX_IN_FLIGHT` (default 4) e/ou `LLM_GLOBAL_MAX_IN_FLIGHT` (default 0=off).
5. [x] `check:prod-env --strict` **falha** sem Upstash (S12).
6. [ ] Smoke: forçar 429 numa rota pública (ex. cardápio) e ver `Retry-After`.

Não confundir com “virtual threads” (Java/Loom) — este monorepo é **Node/Next.js**; não precisa.

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-13 | Checklist criado após inspeção do schema remoto |
| 2026-08-13 | M1 commit `c89bfea`; estruturas M2–M7 + matriz de planos aprovadas; inicia M2 |
| 2026-08-13 | M2 aplicado no remoto (`company_settings_store_hours`); npm test 826 pass |
| 2026-08-13 | M5 aplicado (`orders_status_preparing` + RPC + notify + UI) |
| 2026-08-13 | M4+M6 aplicados (`print_jobs.copy_type`, clear queue, UI vias) |
| 2026-08-13 | M3 aplicado (`staff_users` + convite + UI equipe) |
| 2026-08-13 | M7 aplicado (receita canônica + fuso loja + sem POST Pedidos) |
| 2026-08-14 | RBAC perfis (capabilities + UI Geral + requireCapability nas APIs) |
| 2026-08-14 | Aceite automatizado M1–M7 (`tests/mvp/checklistAcceptance.test.ts`) + schema remoto OK; npm test 877 pass |
| 2026-08-14 | E2E banco remoto (RPC/constraints M1–M7) + testes falha/notify preparing; **sem** Playwright UI |
| 2026-08-14 | Playwright smokes MVP (`e2e/mvp.smokes.spec.ts`): `npm run test:e2e` com `E2E_EMAIL`/`E2E_PASSWORD` |
| 2026-08-14 | M2 ajuste: 2 turnos (`opening_periods`), mensagem fechado, bot/cardápio no mesmo gate |
| 2026-08-14 | M1: clique Entrega/Retirar (id+título); sem inferir entrega por endereço; slot espera o modo |
| 2026-08-25 | INFRA-1: Upstash Redis marcado como pendente pré-MVP (código de rate limit distribuído já no repo) |
| 2026-09-05 | INFRA-1 / S12: owner confirmou `UPSTASH_*` em Vercel Production |
