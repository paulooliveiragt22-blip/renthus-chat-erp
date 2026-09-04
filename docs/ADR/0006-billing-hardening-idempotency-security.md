# ADR 0006 — Billing: hardening de idempotência, segurança e fulfill atômico

**Status:** aceito (hardening P1 Fases 0–5 entregues; Fase 6 DoD — H6.3 PIX adiado; H6.2 webhook idempotente OK 2026-09-04)  
**Data:** 2026-09-04  
**Emenda:** 2026-09-04 — R3: unificar `setup_payments`∪`invoices` **neste** hardening; D7 abaixo supersedido parcialmente.  
**Escopo técnico:** races, HMAC, fulfill atômico, **unificação de obrigação**, anti-órfão.  
**Escopo comercial:** **não** — ver `docs/DECISOES_NEGOCIO_BILLING_PENDENTES.md` + rule `decisoes-negocio-antes-codigo.mdc`.

**Checklist:** [`CHECKLIST_BILLING_HARDENING_P1.md`](../CHECKLIST_BILLING_HARDENING_P1.md)  
**Corte:** [`CORTE_CIRURGICO_BILLING_P1.md`](../CORTE_CIRURGICO_BILLING_P1.md)  
**Smoke:** [`SMOKE_BILLING_PAGARME_SANDBOX.md`](../SMOKE_BILLING_PAGARME_SANDBOX.md)  
**Predecessor:** [`ADR/0004`](./0004-billing-route-handlers-only.md)  
**Orquestração P0 (histórico):** [`CHECKLIST_BILLING_ORCHESTRATION_P0.md`](../CHECKLIST_BILLING_ORCHESTRATION_P0.md) — O5.2 revalidado em P1 H5.6 (`POST /api/platform/billing/replay-fulfill`)

---

## Contexto

A orquestração P0 (ADR-0004) fixou: um `FulfillPayment`, webhook como caminho feliz, sync/replay como rede de segurança, preço canônico em `plans`/`planCatalog`, features em `plan_features`.

Diagnóstico de 2026-09-04 (código + contratos) mostrou **dívida de concorrência e segurança** que o P0 não fechou:

| Classe | Exemplo |
|--------|---------|
| Race / double-execution | Lock de webhook sem CAS; side-effects de activate fora do claim |
| Auth webhook | Basic Auth do painel não validado; HMAC opcional + `===` (timing); POST anônimo aceito |
| PSP órfãos | Novo PIX/cartão sem cancelar order anterior (cron + card path) |
| Invariantes DB | Sem unique parcial `invoices(subscription_id) WHERE pending` |
| Fulfill não-atômico | `activate` → `sync` → `provision` em 3 writes sem transação |
| Ops / escala | Platform routes incompletas; `listNeverPaid` / `lastByCompany` sem filtro SQL |
| Cache / tipos | Idempotência de checkout sem TTL; `SubscriptionPlanKey` com legados `bot`/`complete` |

Pré-produção radical: **corrigir causa raiz** (CAS, unique index, secret obrigatório em prod, RPC de fulfill) — não dual-path “por enquanto”.

---

## Decisão

### D1 — Cinco camadas de segurança (ordem de defesa)

```
L1 Auth & integrity     → Basic Auth obrigatório em produção (+ HMAC legado se header; timingSafeEqual)
L2 Idempotência ingestão → CAS em pagarme_webhook_events (consume único)
L3 Fonte de verdade PSP  → GET /orders/:id antes de fulfill ou fail
L4 Claim local           → UPDATE … WHERE status='pending' RETURNING (único efeito)
L5 Invariantes DB        → unique parcial pending + RLS FORCE em caches sensíveis
```

| Camada | O quê protege | O que **não** substitui |
|--------|---------------|-------------------------|
| L1 | Spoof / flood de webhook | Confirmação de pago no PSP |
| L2 | Dois workers no mesmo evento | Double-credit se fulfill sem claim |
| L3 | Payload mentiroso (`failed` / `customer.id`) | Lock local se sync e webhook colidem |
| L4 | Dois fulfills creditando a mesma obrigação | Provisioning se chamado fora do claim |
| L5 | Dois invoices pending no mesmo ciclo | Lógica de preço canônico |

**Regra:** cada recurso do checklist deve citar **quais camadas** fecha. Não “só alertar no Sentry” no lugar de L4/L5.

### D2 — Emenda à ADR-0004 B2 (auth webhook Core v5)

**Antes (0004 B2.5):** sem Basic Auth; `PAGARME_WEBHOOK_SECRET` HMAC opcional/legado; sem header/env → aceita e confirma na API.

**Agora (0006 + emenda 2026-09-04b):** Core v5 autentica o hookset com **HTTP Basic Auth** (user/senha no painel). HMAC **não** é o mecanismo documentado do v5.

| Ambiente | Comportamento |
|----------|----------------|
| Production (Vercel) | `PAGARME_WEBHOOK_BASIC_USER` + `PAGARME_WEBHOOK_BASIC_PASSWORD` **obrigatórios**. Ausentes → **503**. `Authorization: Basic` inválido → **401** (timing-safe). |
| Preview / local | Basic recomendado; sem Basic só com `ALLOW_INSECURE_PAGARME_WEBHOOK=1`. Se Basic estiver setado, deve bater. |
| HMAC legado | Se `PAGARME_WEBHOOK_SECRET` + `X-Hub-Signature` presentes → valida timing-safe; inválido → **401**. Sem header → ignora (v5). |

Confirmação GET order (L3) **permanece** obrigatória antes de `FulfillPayment` e antes de marcar `failed`. L1 não substitui L3.

### D3 — Fulfill atômico (efeito de negócio)

Pós-pago (`setup` ou `invoice`) deve:

1. Claim otimista da obrigação (`pending` → `paid`) com `RETURNING`.
2. Se claim vazio → `alreadyDone` (sem side-effects).
3. Se claim ok → **uma** unidade de trabalho que atualiza `pagarme_subscriptions` (`status`, `plan_*`, `next_billing_at`, `last_paid_at`, `pagarme_customer_id`) + flags de company + provision (se setup).

Preferência radical: **RPC `rpc_fulfill_*` SECURITY DEFINER** (transação Postgres) chamada pelo use case. Alternativa mínima aceitável no P1: guardar todos os side-effects atrás do claim + passar `next_billing_at` sempre em sync (sem upsert “cego”).

### D4 — Uma obrigação PIX/cartão viva por company

Antes de criar novo order no PSP (checkout regenerado, cron `attachPix`, path cartão):

1. Se obrigação tem `pagarme_order_id` → `getPagarmeOrder`.
2. Se já `paid` → **não** cancelar; rodar `FulfillPayment` e abortar criação.
3. Se aberto → `cancelPagarmeChargeBestEffort` → criar novo → persistir id **antes** de depender de EMV.

### D5 — Preço canônico no checkout (não no pending)

`EnsureCheckout` / create-invoice-checkout usam **sempre** `planCatalog` / `plans.price_cents` para `amountCents`. Valor no pending é informativo; se diverge → atualizar pending (ou invalidar+recriar) **antes** de criar order. Platform change-plan **deve** chamar o mesmo `rebillPendingObligationAfterPlanChange` que o tenant route.

### D6 — Cron charge sem double-pass ambíguo

Em um mesmo run de `/api/billing/charge`:

1. Loop de `dueSubs` cria/cobra invoice e marca sub (`pending_payment` / `overdue` conforme política).
2. Loop de overdue invoices **não** trata invoice criada no mesmo run como D1 (guard: `due_at` + idade mínima **ou** set de `invoiceId` já processados neste run).
3. `neverPaid` (`last_paid_at IS NULL`) → status canônico `pending_payment`, **não** `overdue` (alinha `resolveEffectiveBillingStatus` + dunning).

### D7 — Unificação de obrigação (emenda 2026-09-04)

**Decisão do dono:** unificar `setup_payments` ∪ `invoices` **neste** hardening (antes/junto do RPC fulfill).

- Forma preferida: uma tabela com `kind` (`setup` | `subscription` | `ai_pack` …) **ou** promover `invoices` + `kind` e migrar setup.
- Comportamento comercial **preservado** até BN-* fecharem (especialmente BN-05 setup fee).
- Ainda **fora:** multi-PSP; Edge Functions de billing; inventar matriz de features (BN-01).

### D8 — Gate de regra de negócio

Nenhuma migration/seed/API que altere preço, trial, features ou ciclo comercial sem item `[x]` em `docs/DECISOES_NEGOCIO_BILLING_PENDENTES.md`. Rule: `decisoes-negocio-antes-codigo.mdc`.

---

## Mapa de recursos → problema → camadas → arquivos

| ID | Recurso | Resolve | Camadas | Arquivos principais |
|----|---------|---------|---------|---------------------|
| R1 | Basic Auth prod + HMAC legado timing-safe | Spoof / flood sem auth | L1 | `lib/billing/pagarmeWebhookAuth.ts`, `webhook/route.ts`, env Vercel |
| R2 | CAS no consume de webhook (`updated_at` + RETURNING) | Dois workers no mesmo evento | L2 | `lib/billing/tryConsumePagarmeWebhookEvent.ts` |
| R3 | Key de idempotência por `order_id` (não por eventType) | `order.paid` + `charge.paid` = um slot | L2 | `lib/billing/webhookIdempotencyKey.ts` |
| R4 | Side-effects só após claim; customer.id só do GET API | Double activate; customer forjado | L3+L4 | `lib/billing/fulfillPayment.ts`, `pagarmeSetupPaid.ts` |
| R5 | RPC/transação fulfill (ou sync com `next_billing_at` obrigatório) | Crash mid-fulfill; upsert zera datas | L4 | migration + `fulfillPayment` / `pagarmeSetupPaid` |
| R6 | Unique parcial pending invoice | Dois invoices no mesmo ciclo | L5 | `supabase/migrations/*_invoices_pending_unique.sql` |
| R7 | Cancel-before-create (PIX cron + card checkout) | QRs/orders órfãos; double-pay PSP | L3+D4 | `collectPayment.ts`, `create-invoice-checkout/route.ts` |
| R8 | `handleOrderFailed` só após GET failed | Fail forjado bloqueia tenant | L3 | `app/api/billing/webhook/route.ts` |
| R9 | Checkout amount = catálogo; rebill no platform change-plan | Cobrança com preço stale | D5 | `ensureCheckout.ts`, platform `change-plan`, `rebillPendingObligation.ts` |
| R10 | Cron: set processados + `neverPaid`→`pending_payment`; `blockCompany` único UPDATE | Double-pass D0/D1; UPDATE morto | D6 | `app/api/billing/charge/route.ts` |
| R11 | Filtro SQL + limite em repositories | OOM / timeout platform list | — | `supabaseSubscriptionRepository.ts`, `supabaseInvoiceRepository.ts` |
| R12 | TTL cache `billing_checkout_idempotency` + RLS FORCE | PIX EMV eterno / leak via grant | L5 | migration + `create-invoice-checkout/route.ts` |
| R13 | Platform routes reais (change-plan + replay-fulfill) | Ops sem ferramenta; checklist falso-verde | L3 | `app/api/platform/billing/subscriptions/[id]/*` |
| R14 | Tipos sem legados em `SubscriptionPlanKey` | Persistência `bot`/`complete` raw | — | `lib/billing/contracts/status.ts`, `planCatalog.ts` |
| R15 | Sync PSP: todos pending da company (ou unique R6) | Órfão antigo nunca reconciliado | L3 | `syncPendingObligationFromPsp.ts` |
| R16 | Cancel change-plan: GET paid → fulfill, não cancel | Pagamento em trânsito órfão | L3+D4 | `change-plan/route.ts`, `rebillPendingObligation.ts` |
| R17 | Temp password sem modulo bias | Senha temporária enviesada | — | `pagarmeSetupPaid.ts` |

---

## Ordem cronológica (resumo)

Detalhe com DoD e checkboxes: **checklist**.

```
Fase 0  Decisões + env (D2 secret)          → R1 (parcial ops)
Fase 1  L1 + L2 (auth + consume + key)     → R1, R2, R3
Fase 2  L5 invariantes DB                  → R6, R12 (RLS/TTL)
Fase 3  L3 + L4 fulfill                    → R4, R5, R8, R17
Fase 4  Anti-órfão PSP + preço             → R7, R9, R15, R16
Fase 5  Cron + platform + repos            → R10, R11, R13, R14
Fase 6  Prova (testes, smoke, DoD B6)      → npm test + sandbox
```

Não pular Fase 1/2 para “só sync” — mascara race e duplicate invoice.

---

## Consequências

- Emenda ADR-0004 B2: Basic Auth **obrigatório em produção** (ver D2); HMAC legado.
- Checklist orquestração P0 permanece histórico; execução nova = `CHECKLIST_BILLING_HARDENING_P1.md`.
- Migrations: `FORCE RLS` + `service_role_only` em tabelas novas/cache; unique parcial em `invoices`.
- Testes: unit CAS/claim; integração webhook duplicate; smoke: dois POSTs mesmo order → um fulfill.

---

## Referências

- `docs/ADR/0004-billing-route-handlers-only.md`
- `docs/CHECKLIST_BILLING_ORCHESTRATION_P0.md`
- `docs/CHECKLIST_BILLING_HARDENING_P1.md`
- `.cursor/rules/supabase-migrations-seguranca.mdc`
- `.cursor/rules/projeto-pre-producao-radical.mdc`
- Stripe / Pagar.me: verify signature; webhook = notify; API = truth
