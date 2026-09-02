# Checklist — TenantAccess v2 + Signup/Pagamentos (estrutura)

Origem: crítica estrutural 2026-08-28 (never-paid, dual-source entitlements,
signup/pagamento). **Somente checklist + desenho** — implementação sob aprovação
item a item.

Padrão de análise: segurança · escalabilidade · inconsistência · bugs futuros.
Referências Context7: Stripe (`incomplete` → access só após pagamento; fulfill via
webhook idempotente) · Supabase (service_role bypassa RLS → regra no guard/RPC).

Estado: `[ ]` pendente · `[~]` parcial · `[x]` feito + data.

---

## A — TenantAccess v2 (empresas cadastradas sem pagamento)

### A0 — Decisões fechadas (não reabrir sem motivo)

| # | Decisão |
|---|--------|
| A0.1 | Never-paid ≠ overdue grace |
| A0.2 | Um snapshot `TenantAccess` = fonte de access + features |
| A0.3 | Features `[]` se `access=deny` |
| A0.4 | Colapsar `pending_setup` com setup=0 → `pending_payment` |
| A0.5 | Platform: courtesy/ensure-checkout via RPC/API — sem UPDATE cru |

### A1 — Domain puro

| # | Item | Arquivos / entregável | DoD |
|---|------|----------------------|-----|
| A1.1 | Extrair `resolveTenantAccess(pagarmeRow, now)` puro | `lib/billing/tenantAccess.ts` | Matriz unitária coberta | [x] 2026-08-28 |
| A1.2 | Tipar `{ access, reason, plan_intent, featuresEligible }` | idem | Sem I/O | [x] 2026-08-28 |
| A1.3 | Testes matriz (pending_*, trial válido/expirado, overdue±last_paid, blocked) | `tests/billing/tenantAccess.test.ts` | `npm test` verde | [x] 2026-08-28 |

### A2 — RPC entitlements (segurança — prioridade)

| # | Item | Arquivos | DoD |
|---|------|----------|-----|
| A2.1 | `rpc_get_company_entitlements` aplica AND: se TenantAccess deny → `features=[]` e `subscription` null ou `status=suspended` | migration + RPC | `execute_sql` com company pending_payment retorna features `[]` mesmo se existir `subscriptions.active` legado | [x] 2026-08-28 |
| A2.2 | Expor `access`, `access_reason`, `billing_status` efetivo no JSON | idem | Contrato documentado | [x] 2026-08-28 |
| A2.3 | `fetchCompanyEntitlements` / `hasFeature` consomem só esse contrato | `lib/billing/*` | Sem dual-read paralelo | [x] 2026-08-28 |
| A2.4 | Testes adapter + regressão gate | `tests/billing/fetchCompanyEntitlements.test.ts` | Verde | [x] 2026-08-28 |

### A3 — Guards e proxy

| # | Item | Arquivos | DoD |
|---|------|----------|-----|
| A3.1 | `requireBillingActive` delega a `resolveTenantAccess` | `requireBillingActive.ts` | Mesma matriz que A1 | [x] 2026-08-28 |
| A3.2 | Proxy calcula trial por **data** (`trial_ends_at`), não só `status` | `proxy.ts` | Trial expirado → `/plano/pagar` sem esperar cron | [x] 2026-08-28 |
| A3.3 | Testes proxy paywall (trial expirado, pending_payment) | `tests/proxy.test.ts` | Verde | [x] 2026-08-28 |

### A4 — Legado never-paid

| # | Item | Arquivos | DoD |
|---|------|----------|-----|
| A4.1 | Migration: `pending_setup` + setup_cents=0 → `pending_payment` | `supabase/migrations/...` | Contagem 0 em pending_setup “morto” | [x] 2026-08-28 |
| A4.2 | RPC `rpc_ensure_first_invoice(company_id)` idempotente | migration | Unique pending respeitado | [x] 2026-08-28 |
| A4.3 | Backfill invoices para never-paid sem pending | one-shot via RPC | Toda never-paid tem 1 pending ou failed documentado | [x] 2026-08-28 |
| A4.4 | Não criar `subscriptions.active` até `order.paid` | signup + activate paths | SQL check | [x] 2026-08-28 signup RPC + suspend legado |

### A5 — Platform ops

| # | Item | Arquivos | DoD |
|---|------|----------|-----|
| A5.1 | `GET /api/platform/tenants?billing=never_paid` | platform API | Lista paginada | [x] 2026-08-28 |
| A5.2 | `POST .../courtesy-trial` `{ days, plan_key }` | RPC + API | Audit log; status→trial | [x] 2026-08-29 superadmin 1–30d + plano |
| A5.3 | `POST .../ensure-checkout` | chama A4.2 + opcional PIX | Idempotente | [x] 2026-08-28 |
| A5.4 | UI platform: aba “Sem pagamento” | platform page | 3 ações acima | [x] 2026-08-28 `/platform/billing` |

### A6 — DoD do bloco A

- [x] Never-paid: features `[]` + 402 em API mutável + só `/plano*`
- [x] Trial expirado: proxy e API alinhados
- [x] Legado normalizado (A4 migration)
- [x] `npm test` verde (suíte billing + A6)
- [x] Migration remota aplicada + `execute_sql` validação

---

## B — Signup + Pagamentos (estrutura proposta)

### B0 — Crítica do estado atual (gargalos / bugs futuros)

| # | Achado | Por que importa | Severidade |
|---|--------|-----------------|------------|
| B0.1 | **Dois orquestradores de billing pós-cadastro**: `signupCompanyViaRpc` + `startBillingAfterSignup` (e `startFreeTrial` deprecated) | Drift de regra N=0 / trial; alguém chama o path errado | Alto |
| B0.2 | **`/signup/complete` + `/api/signup/complete` ainda no repo** (P2.3 marcado feito) | Dual-path legado; token onboarding paralelo | Alto |
| B0.3 | **Saga quebrada**: `auth.createUser` → RPC company → `createInitialMonthlyInvoice` (Pagar.me fora da tx) | Auth orphan (mitigado com delete); company `pending_payment` **sem PIX** se Pagar.me falhar | Alto |
| B0.4 | **Fulfillment em dois lugares**: checkout cartão (sync) **e** webhook `order.paid` | Sem idempotência forte = double activate / race em `invoices.status` | Alto |
| B0.5 | `applyMonthlyInvoicePaid` faz UPDATE sem `WHERE status='pending'` | Race webhook + sync → reprocessa efeitos | Médio |
| B0.6 | `processSetupOrderPaid` não early-return se setup já `paid` | Re-provision / side effects | Médio |
| B0.7 | Webhook retorna **200** em erro de negócio | Pagar.me não retenta — falha silenciosa de ativação | Médio |
| B0.8 | `isFirstPayment` / UI misturam `pending_payment` com setup | Preço errado ou grava em `setup_payments` vs `invoices` | Médio |
| B0.9 | Signup cria invoice no signup **e** checkout pode criar outro order | Orphan orders Pagar.me; EMV vazio até backfill | Médio |
| B0.10 | CNPJ unique check em app (meta + coluna) sem constraint única forte documentada | Race signup paralelo | Médio |
| B0.11 | WA inbound / `companies.is_active` vs paywall | Canal pode receber pedido com tenant never-paid se `is_active` inconsistente | Alto |
| B0.12 | Stripe boas práticas: **source of truth = webhook**; UI sync é otimista | Hoje sync ativa plano — OK só se **mesmo** use case idempotente que o webhook | — |

### B1 — Estrutura alvo (Signup + Payment)

```
Domain
  tenantAccess.ts              (bloco A)
  paymentIntent.ts             # tipo: first_invoice | setup | renewal | ai_pack
  signupPolicy.ts              # pure: trialDays → mode pending_payment | trial

Application (use cases — 1 caminho cada)
  SignupCompany.ts             # ÚNICO entry signup
  EnsureCheckout.ts            # gera/recupera cobrança (PIX/card) idempotente
  FulfillPayment.ts            # ÚNICO efeito pós-pago (chamado por webhook E sync)

Adapters
  rpc_signup_company_with_billing   # só DB (já); sem Pagar.me
  PagarmeOrdersAdapter              # create/get order, resolve PIX
  InvoiceRepository / SetupRepository
  WebhookInbox (pagarme_webhook_events) # já existe

API
  POST /api/billing/signup                 → SignupCompany
  POST /api/billing/create-invoice-checkout→ EnsureCheckout
  POST /api/billing/webhook                → FulfillPayment (canônico)
  (sync card paid)                         → FulfillPayment (mesmo use case)

DELETE / deprecar
  startBillingAfterSignup / startFreeTrial  (após zero callers)
  /signup/complete + /api/signup/complete
```

**Fluxo canônico (pay-to-start, N=0)** — alinhado Stripe `incomplete`:

```
1. SignupCompany
   - createUser
   - RPC: company + owner + pagarme pending_payment + plan_intent
   - NÃO cria subscriptions.active
   - EnsureCheckout (best-effort) → invoice pending + order PIX opcional
   - Se Pagar.me falhar: company ok; checkout na UI regenera (EnsureCheckout)

2. Login → proxy → /plano/pagar (sem AdminShell)

3. EnsureCheckout (PIX ou card)
   - idempotency_key
   - reutiliza pending se EMV/order válido; senão novo order + backfill

4. FulfillPayment (orderId)
   - claim invoice/setup pending → paid (UPDATE … WHERE status=pending)
   - pagarme → active + last_paid_at
   - syncLogicalSubscription (features)
   - companies.is_active=true
   - idempotente se já paid

5. Redirect /ativar → app
```

**Elite:** um `FulfillPayment` = zero divergência webhook vs cartão imediato; signup nunca “promete” PIX no mesmo commit que o Auth.

### B2 — Checklist implementação Signup

| # | Item | DoD |
|---|------|-----|
| B2.1 | Inventário callers de `startBillingAfterSignup` / `startFreeTrial` / `signup/complete` | Lista + decisão delete | [x] 2026-08-28 |
| B2.2 | Remover rotas/páginas `/signup/complete` de verdade (git + proxy) | 404; checklist P2.3 atualizado | [x] 2026-08-28 |
| B2.3 | `SignupCompany` use case único; rota só orquestra | Sem lógica duplicada | [x] 2026-08-28 `lib/billing/signupCompany.ts` |
| B2.4 | RPC signup: gravar `plan` como plan_intent; zero `subscriptions` se payment_required | SQL assert | [~] RPC já existente |
| B2.5 | Compensação auth: deleteUser se RPC falhar (já); log métrica orphan | Log + alerta opcional | [x] 2026-08-28 |
| B2.6 | Signup **não** falha HTTP 500 se Pagar.me cair — retorna `payment_required` + `invoice_ready:false` | Contrato API | [x] 2026-08-28 |
| B2.7 | Unique CNPJ no banco (constraint) se ainda frágil | Migration | [x] `companies_cnpj_unique` |
| B2.8 | Testes: N=0 → pending_payment + sem features; N>0 → trial + features | Verde | [~] TenantAccess + policy |
| B2.9 | Client signup: sempre `/plano/pagar` se `payment_required` | E2E smoke | [x] signup page |

### B3 — Checklist implementação Pagamentos / Fulfillment

| # | Item | DoD |
|---|------|-----|
| B3.1 | Extrair `FulfillPayment(orderId)` unificando `applyMonthlyInvoicePaid` + `processSetupOrderPaid` (+ sync features) | Um módulo | [x] 2026-08-28 `lib/billing/fulfillPayment.ts` |
| B3.2 | Optimistic lock: `UPDATE invoices SET paid WHERE id AND status='pending'` | 0 double-pay effects | [x] 2026-08-28 |
| B3.3 | Idempotência setup_payments igual | idem | [x] 2026-08-28 |
| B3.4 | Checkout sync card paid **só** chama `FulfillPayment` (não lógica paralela) | Diff limpo | [x] 2026-08-28 |
| B3.5 | Webhook: erro transitório → **500** + `failed_retryable`; permanente → **200** + `billing_fulfill_failures`; lifecycle do event (E1) | Retries PSP seguros; sem evento perdido | [x] 2026-08-28 |
| B3.6 | `EnsureCheckout`: uma estratégia first_invoice vs setup vs renewal | Sem misturar tabelas | [x] 2026-09-02 `lib/billing/ensureCheckout.ts` |
| B3.7 | PIX: EMV obrigatório no response ou erro explícito + retry | UI sempre com copia-e-cola ou mensagem clara | [x] 2026-09-02 checkout 502 sem EMV |
| B3.8 | Metadata order: `type`, `company_id`, `subscription_id` sempre | Webhook roteável | [x] 2026-08-28 `orderMeta` |
| B3.9 | Pós-pago: inválido cache entitlements; redirect `/ativar` | UX + gate | [x] 2026-08-28 panel + proxy |
| B3.10 | Testes: webhook duplo, sync+webhook race, PIX backfill EMV | Verde | [x] gate matrix + pixExtract + ensureCheckout |
| B3.11 | Smoke sandbox cartão + PIX no deploy | Runbook S3/S4 | [x] API smoke; E2E S3/S4 pendente credenciais |

### B4 — Canais / side effects pós-signup

| # | Item | DoD |
|---|------|-----|
| B4.1 | Never-paid: `companies.is_active=false` até fulfill | SQL + cron WA não processa | [x] |
| B4.2 | Inbound Meta/WA: reject ou silent se access deny | Teste integração | [x] `inbound-billing-gate.test.ts` |
| B4.3 | Dunning só se `last_paid_at` set | Cron charge | [x] |

### B5 — DoD do bloco B

- [x] Um signup path, um fulfill path, um checkout ensure (EnsureCheckout parcial)
- [x] Sem `/signup/complete`
- [x] Race webhook/sync segura (B3)
- [x] PIX copia-e-cola confiável (extract EMV + persist cron; smoke script)
- [x] `npm test` billing + smoke sandbox (script; chaves `sk_test_` em `.env.local` ou Vercel)
- [x] Docs checklist billing atualizado

---

## C — Ordem de execução recomendada

```
A1 (domain + testes)
 → A2 (RPC entitlements AND)     ← segurança primeiro
 → A3 (proxy trial por data)
 → B3.1–B3.5 (FulfillPayment idempotente)
 → B2 (SignupCompany único + limpar legado)
 → B3.6–B3.11 (EnsureCheckout + PIX + smoke)
 → A4 (migração legado never-paid)
 → A5 (platform ops)
 → B4 (canais)
```

Não abrir platform UI (A5) antes de A2+B3 — senão ops “libera” tenant com features furadas.

---

## D — Fora de escopo (neste checklist)

- E-mail dunning (P2.5 adiado)
- Multi-PSP / Stripe real
- Soft pre-pay (`/ativar` antes de pagar)
- NFC-e / TEF

---

## E — Decisões fechadas (2026-08-28)

| # | Decisão | Escolha |
|---|---------|---------|
| E1 | Webhook fulfill fail | **Híbrido** — ver §E1 abaixo (não 500 puro nem dead-letter puro) |
| E2 | Setup fee | Manter `pending_setup` **somente** se `SETUP_PRICE_*>0`; senão só `pending_payment` |
| E3 | Courtesy trial | Teto **30 dias**; só role `superadmin` (platform); `plan_key` ∈ {essencial, pro, market} |

### E1 — Webhook: híbrido (decisão técnica canônica)

**Problema:** claim-then-process + HTTP 200 no erro = evento **perdido** (retry vira duplicate skip).  
500 em tudo = retry infinito em payload podre. Dead-letter + 200 em tudo = sem recuperação automática de blip de DB.

**Regra:**

| Situação | HTTP | Idempotência | Ação |
|----------|------|--------------|------|
| Fulfill **OK** | 200 | Marcar `completed` | — |
| Duplicate já `completed` | 200 `{duplicate:true}` | sem reprocessar | — |
| Erro **transitório** (DB down, timeout, 5xx interno) | **500** | **Não** consumir de forma terminal — status `processing`/`failed_retryable` permite reentrada | Pagar.me retenta |
| Erro **permanente** (order desconhecido, metadata inválida, schema) | **200** | Marcar `failed_permanent` | Insert `billing_fulfill_failures` + Sentry; **não** retentar |

**Implementação (B3.5):** trocar insert “cego” em `pagarme_webhook_events` por lifecycle:

```
pending_claim → processing → completed | failed_retryable | failed_permanent
```

- Retry do PSP com mesma chave: se `failed_retryable` ou `processing` stale (> N min) → **reprocessa**.  
- Se `completed` / `failed_permanent` → skip 200.

Fonte de verdade do efeito de negócio continua sendo **`FulfillPayment`** com optimistic lock na invoice/setup.

---

## D — Fora de escopo (neste checklist)