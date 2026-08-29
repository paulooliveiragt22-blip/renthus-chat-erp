# Checklist — Recargas automáticas + renovação de assinatura (Pagar.me)

Origem: pedido 2026-08-28 — mesmo rigor de
[`CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md`](./CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md).

**Escopo deste doc:** desenho + checklist. **Não implementar** até aprovar decisões
(D-R* abaixo) e ordem de execução.

Stack real: **Next.js Route Handlers** (Vercel Cron) + webhook Pagar.me.  
**Não há Edge Functions Supabase** para billing hoje — não inventar segundo runtime.

Referências Context7 (Stripe, adaptadas ao Pagar.me Orders):
- Renovação falha → fatura **aberta** + assinatura `past_due` / nosso `overdue`
- Cliente atualiza payment method e retenta; retries controlados
- Fulfillment canônico via webhook (sync só otimista + **mesmo** use case idempotente)

---

## 0 — Duas cobranças distintas (não misturar)

| Domínio | O quê | Ciclo | Valor |
|---------|--------|-------|-------|
| **R1 — Assinatura** | Mensalidade do plano (desconto mensal / `next_billing_at`) | Mensal | Catálogo Essencial/Pro/Market |
| **R2 — Recarga IA** | Pack prepaid na `company_ai_wallets` | Sob demanda / saldo baixo | 10/20/50 |

Hoje no repo:

| Domínio | Comportamento atual | Problema |
|---------|---------------------|----------|
| R1 | Cron `/api/billing/charge` **só gera PIX** + dunning WA + block D+5 | **Não tenta cartão salvo**; sem UX “trocar cartão” no fluxo de falha |
| R2 | `tryAutoRechargeAiWallet` no debit (inline) com `createOrderWithSavedCard` | Sem fallback PIX; crédito sync **e** webhook; debounce fraco (15 min ledger) |

**Fonte de verdade proposta:** um motor `CollectPayment` + um `FulfillPayment` (já no checklist signup).  
R1 e R2 só diferem em `PaymentIntentKind` e efeito pós-pago.

---

## 1 — Resposta de produto (vencimento sem saldo no cartão)

**Sim:** quando a mensalidade vence e o cartão falha (sem saldo, recusado, sem cartão):

1. Assinatura → `overdue` (grace só se `last_paid_at` set — D18).  
2. Fatura mensal **permanece a mesma** (`invoices` pending).  
3. Na UI **`/plano/pagar`** (e banner):
   - **PIX** — gerar/mostrar EMV copia-e-cola + QR (obrigatório no response).  
   - **Cadastrar / trocar cartão** — tokeniza no browser → salva no customer Pagar.me → **retentar** a mesma fatura.  
   - Se já houver cartão default: botão **“Tentar cartão de novo”**.  
4. Cron de retry (dias 1 e 3, alinhado ao dunning): tenta **só** cartão default off-session; se falhar, garante PIX EMV atualizado na fatura e notifica.  
5. Dia 5+: `blocked` (já existe) — ainda assim allowlist `billing_self` para pagar.

Não criar segunda fatura “porque o cartão falhou”. Uma invoice = uma obrigação do ciclo.

```
next_billing_at atingido
    → CollectPayment(kind=subscription_renewal)
        → tenta card_id default (se existir)
        → sucesso → FulfillPayment
        → falha / sem cartão → invoice pending + PIX EMV + status overdue
              → UI: PIX | novo cartão | retry cartão
              → retries D1/D3 card
              → D5+ block
```

---

## 2 — Crítica do estado atual (R1 + R2)

| # | Achado | Risco |
|---|--------|-------|
| C1 | Mensalidade **nunca** cobra cartão salvo no cron | Cliente com cartão no signup ainda cai só em PIX; churn e UX “sumiu a recorrência” |
| C2 | Sem `default_card_id` local — só `listCustomerCards` ad-hoc | Cartão “errado” cobrado; race com cartões expirados |
| C3 | Setup charge no cron **não grava `pix_qr_code`** (só URL) | Copia-e-cola some no dunning WA / UI |
| C4 | AI auto-recharge credita **sync** se paid + webhook também credita | Double credit se não houver unique em `pagarme_order_id` no ledger |
| C5 | AI recharge no path quente do chat (debit) | Latência + falha Pagar.me no request do usuário; timeout Vercel |
| C6 | Sem fila/outbox de tentativas | Retry bagunçado; sem auditoria de decline codes |
| C7 | Cron auth = Bearer `CRON_SECRET` (ok) mas **sem** IP allowlist / sem assinatura Vercel Cron opcional | Brute-force se secret vazar |
| C8 | Webhook HMAC + RL IP (ok); fulfill 200 em erro de negócio | Ativação silenciosa perdida (já no checklist B) |
| C9 | Dois checkouts: `/create-invoice-checkout` vs `/ai-wallet/checkout` | PIX/EMV/idempotência duplicados |
| C10 | `createOrderWithSavedCard` com `recurrence: false` | Mensalidade deveria marcar recorrência / descriptor claro |
| C11 | Não há Edge Function — risco futuro se alguém “mover cobrança pro Edge” sem o mesmo guard | Dual runtime = dual bug |

---

## 3 — Estrutura alvo (Clean Architecture)

```
Domain
  paymentIntent.ts
    kind: subscription_renewal | subscription_first | setup | ai_pack
    status: pending | collecting | paid | failed | void
  collectionPolicy.ts          # pure: quando tentar card vs pix; dias retry; block
  cardOnFile.ts                # default_card_id rules

Application (UMA trilha cada)
  CollectPayment.ts            # tenta card → fallback PIX na MESMA obligation
  EnsureCheckout.ts            # UI: pix | new_card | retry_card (já no checklist B)
  FulfillPayment.ts            # único pós-pago (webhook + sync)
  ScheduleRenewals.ts          # cron: due subs → CollectPayment (batch)
  ScheduleAiRecharge.ts        # opcional: outbox quando saldo baixo (não inline)

Adapters
  PagarmeOrdersAdapter         # order card_id | pix | resolve EMV (auth fetch)
  InvoiceRepository            # unique pending por ciclo
  PaymentAttemptRepository     # NEW: tentativas + decline + order_id
  WebhookInbox                 # pagarme_webhook_events (já)
  CronAuth                     # CRON_SECRET (+ opcional Vercel signature)

API (borda — única)
  POST /api/billing/charge              → ScheduleRenewals (cron only)
  POST /api/billing/webhook             → FulfillPayment
  POST /api/billing/create-invoice-checkout → EnsureCheckout (mensalidade/setup)
  POST /api/billing/payment-methods     → add/list/set-default card (NEW)
  POST /api/admin/ai-wallet/checkout    → EnsureCheckout(kind=ai_pack)  [thin]
  DELETE paths paralelos de cobrança

UI
  /plano/pagar + banner overdue:
    [ PIX copia-e-cola ] [ Cartões salvos / adicionar ] [ Tentar de novo ]
```

### Tabela nova (proposta)

```sql
-- payment_attempts: auditoria + anti-duplicidade de coleta
company_id, invoice_id|null, kind, channel (card|pix),
pagarme_order_id unique, status, decline_code, attempt_n, created_at
```

`pagarme_subscriptions.default_card_id` (text, id no Pagar.me) — setado no 1º cartão pago / ao escolher default.

### PIX copia-e-cola (obrigatório neste bloco)

- Todo path que cria order PIX passa por `resolvePixFromOrder` (com auth no QR URL).  
- Persistir **sempre** `pix_qr_code` em `invoices` / `setup_payments`.  
- EnsureCheckout: se URL sem EMV → backfill; se falhar → erro explícito (não “sucesso mudo”).  
- Cron dunning WA: preferir EMV no texto; URL só como fallback.

---

## 4 — Segurança / proteção de endpoints

| Superfície | Proteção obrigatória | Notas |
|------------|----------------------|-------|
| `POST /api/billing/charge` | `Authorization: Bearer CRON_SECRET`; prod sem secret → 500 | Avaliar `x-vercel-cron` / allowlist IP |
| `POST /api/billing/webhook` | HMAC `PAGARME_WEBHOOK_SECRET`; RL IP; idempotency store | **D-R4 híbrido:** 500 se retryable; 200 + dead-letter se permanente |
| `create-invoice-checkout` / `payment-methods` / `ai-wallet/*` | Sessão + `requireCompanyAccess` + `billing_self` ou full conforme rota; rate limit por company | Nunca aceitar `company_id` no body sem membership |
| Tokenização cartão | Só browser + `pk_*`; **nunca** PAN no servidor | Domínio cadastrado no Pagar.me |
| Service role | Só após cronAuth / HMAC / requireCompanyAccess | Doc: `SECURITY_SERVICE_ROLE_FLOWS.md` |
| Edge Functions | **Fora de escopo** até ADR explícito; se um dia existir, mesmo `CollectPayment`/`FulfillPayment` | Evitar segundo caminho |

**Não** expor `createOrderWithSavedCard` via API pública com `card_id` arbitrário — só server-side com card do `customer_id` da company.

---

## 5 — Política de coleta (mensalidade) — detalhe

| Momento | Ação |
|---------|------|
| D0 `next_billing_at` | Claim invoice pending do ciclo → tentar `default_card_id` |
| D0 card OK | `FulfillPayment` → `active`, `last_paid_at`, `next_billing_at+=1m` |
| D0 card fail / sem card | `overdue`; gerar/atualizar PIX EMV na **mesma** invoice; notificar |
| D1, D3 | Retry card (máx N); se fail, refresh PIX se próximo de expirar; WA |
| D5+ | `blockCompany` + features revogadas (TenantAccess deny) |
| Qualquer dia | UI: PIX \| add card \| set default \| retry |

**IA (R2) — ajuste estrutural:**

| Hoje | Alvo |
|------|------|
| Inline no debit do chat | Enfileirar `ai_recharge_jobs` (ou reusar outbox) + worker cron curto |
| Credit sync + webhook | Só `FulfillPayment(kind=ai_pack)` (unique order_id no ledger) |
| Sem PIX se card fail | Marcar `auto_recharge_last_error`; UI oferece “recarregar com PIX”; opcional desliga auto |

---

## 6 — Checklist de implementação

### R0 — Decisões fechadas (2026-08-28)

| # | Decisão | Escolha |
|---|---------|---------|
| D-R1 | Mensalidade card vs PIX | **Card-first** se `default_card_id`; senão PIX |
| D-R2 | Dias retry card | **1 e 3** (igual dunning WA) |
| D-R3 | AI recharge | **Fila/outbox** — chat não chama Pagar.me |
| D-R4 | Webhook fulfill fail | **Híbrido** — ver `CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` §E1 |
| D-R5 | PAN/token | **Nunca** no servidor; só `card_id` Pagar.me |

Detalhe D-R4: transitório → HTTP **500** + evento `failed_retryable` (PSP retenta); permanente → HTTP **200** + `billing_fulfill_failures` + `failed_permanent`. Nunca claim terminal antes do fulfill OK.


### R1 — Domain + schema

| # | Item | DoD |
|---|------|-----|
| R1.1 | `collectionPolicy.ts` puro + testes | Matriz D0/D1/D3/D5 | [x] 2026-08-28 |
| R1.2 | Migration `default_card_id` em `pagarme_subscriptions` | Coluna + comentário | [x] 2026-08-28 |
| R1.3 | Migration `payment_attempts` + unique `pagarme_order_id` | RLS service_role_only | [x] 2026-08-28 |
| R1.4 | Unique ledger meta / coluna `pagarme_order_id` em créditos AI | Sem double credit | [x] 2026-08-28 |

### R2 — CollectPayment + cron mensalidade

| # | Item | DoD |
|---|------|-----|
| R2.1 | `CollectPayment` use case único | Card → PIX fallback mesma invoice | [x] 2026-08-28 `lib/billing/collectPayment.ts` |
| R2.2 | Cron `charge` só chama `ScheduleRenewals` → CollectPayment | Sem PIX-only hardcoded | [x] 2026-08-28 |
| R2.3 | Gravar `pix_qr_code` no cron (setup + invoice) | EMV no DB | [x] 2026-08-28 |
| R2.4 | Batch limit + cursor (já parcial) | Truncated flag + re-run ok | [x] parcial |
| R2.5 | Testes: card ok; card fail→PIX; unique pending | Verde | [x] 2026-08-28 `collectPayment.test.ts` |

### R3 — EnsureCheckout UI (falha / overdue)

| # | Item | DoD |
|---|------|-----|
| R3.1 | `/plano/pagar`: PIX + lista cartões + adicionar + retry | Um painel | [x] 2026-08-28 |
| R3.2 | `POST /api/billing/payment-methods` (add/list/default) | Rate limit + billing_self | [x] 2026-08-28 set_default; list via status |
| R3.3 | Set `default_card_id` após cartão aprovado no 1º pagamento | Persistido | [x] 2026-08-28 |
| R3.4 | PIX: response sempre com `pix_qr_code` ou erro | Sem sucesso mudo | [~] já no checkout |
| R3.5 | Banner overdue: CTA pagar / trocar cartão | Visível | [~] painel /plano/pagar |

### R4 — Fulfillment único

| # | Item | DoD |
|---|------|-----|
| R4.1 | Webhook + sync card → só `FulfillPayment` | Zero lógica paralela | [x] 2026-08-28 |
| R4.2 | Optimistic lock invoice/setup | Já no checklist B3 | [x] |
| R4.3 | AI pack: crédito só no fulfill; remover credit sync duplicado em auto-recharge | Unique order | [x] 2026-08-28 |

### R5 — Recarga IA

| # | Item | DoD |
|---|------|-----|
| R5.1 | Outbox/job ao saldo baixo (em vez de await no chat) | Chat não chama Pagar.me | [x] 2026-08-28 `ai_recharge_jobs` |
| R5.2 | Worker cron dedicado ou step no charge | CRON_SECRET | [x] 2026-08-28 step no `/api/billing/charge` |
| R5.3 | Falha card → flag + notificação; checkout PIX pack via EnsureCheckout | UX clara | [x] 2026-08-28 `auto_recharge_last_error` |
| R5.4 | `ai-wallet/checkout` thin adapter do EnsureCheckout | Sem segundo resolve PIX | [x] 2026-08-28 `ensureAiPackCheckout` |

### R6 — Segurança / ops

| # | Item | DoD |
|---|------|-----|
| R6.1 | Revisar cronAuth + doc Vercel Cron headers | Checklist segurança | [x] 2026-08-28 |
| R6.2 | Webhook: métrica fulfill_failed + alerta | Sentry | [x] 2026-08-28 `billing_fulfill_failed` |
| R6.3 | Proibir Edge Function billing sem ADR | Rule / ADR stub | [x] ADR-0004 |
| R6.4 | Smoke: renovação card ok; card fail→PIX EMV; add card→retry; AI auto | Runbook | [x] script + `SMOKE_BILLING_*` |

### R7 — DoD do bloco

- [x] Uma trilha Collect + uma Fulfill para R1 e R2  
- [x] Vencimento sem saldo: overdue + PIX + cadastrar/trocar cartão + retry  
- [x] EMV sempre persistido nos paths PIX  
- [x] Sem double charge / double credit  
- [x] Cron e webhook endurecidos (R6.1–R6.3)  
- [x] `npm test` + smoke sandbox (testes billing + `test:billing-sandbox`; PIX: paid ou EMV)  
- [x] Este checklist atualizado `[x]` + data  

---

## 7 — Ordem de execução (encaixe com A/B)

```
A2 (entitlements AND) + B3 (FulfillPayment)
  → R1 schema/policy
  → R2 CollectPayment + cron card-first
  → R3 UI PIX/cartão/retry
  → R4 unificar fulfill AI
  → R5 fila AI recharge
  → R6 segurança + smoke
```

Não abrir UI de “trocar cartão” antes de CollectPayment gravar tentativas — senão ops fica cego.

---

## 8 — Fora de escopo

- Pagar.me Subscriptions API nativa (recorrência gerenciada 100% no PSP) — avaliar ADR futuro; hoje Orders + nosso cron  
- E-mail dunning (P2.5)  
- Split / marketplace fees  
- Edge Functions de cobrança  

---

## 9 — Ligação com outros checklists

| Doc | Relação |
|-----|---------|
| `CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` | FulfillPayment, EnsureCheckout, PIX EMV, webhook |
| `CHECKLIST_BILLING_PAYWALL_P0.md` | D18 grace, charge cron, blockCompany |
| `SMOKE_BILLING_PAGARME_SANDBOX.md` | Smokes card/PIX |

Atualizar estados `[ ]` → `[x]` + data ao concluir cada item.
