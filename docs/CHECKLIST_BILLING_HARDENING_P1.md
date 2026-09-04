# Checklist — Billing hardening P1 (idempotência, segurança, fulfill)

**Origem:** [ADR-0006](./ADR/0006-billing-hardening-idempotency-security.md) (2026-09-04) + diagnóstico de races/HMAC/órfãos PSP.  
**Runtime:** Route Handlers — ADR-0004 Decisão A (inalterada).  
**Implementação:** sob “implementa” / bloco por fase. Não misturar com matriz de features comerciais.

Estado: `[ ]` pendente · `[~]` parcial · `[x]` feito + data · `[!]` bloqueado.

**Predecessor (não reabrir):** `CHECKLIST_BILLING_ORCHESTRATION_P0.md` (O1–O6).  
**Escopo / o que não fazer:** [`CORTE_CIRURGICO_BILLING_P1.md`](./CORTE_CIRURGICO_BILLING_P1.md) — endurecer vs fundir vs apagar; blocos A–D.

---

## H0 — Decisões fechadas (ADR-0006)

| # | Decisão | Estado |
|---|---------|--------|
| H0.1 | Cinco camadas L1–L5 (auth → consume → PSP GET → claim → DB) | [x] 2026-09-04 ADR |
| H0.2 | Auth webhook **obrigatório em produção** (Basic Auth v5; HMAC legado); insecure só com flag | [x] 2026-09-04 código + env |
| H0.3 | Side-effects de fulfill **somente** após claim | [x] 2026-09-04 claim guards (setup/invoice) |
| H0.4 | Uma obrigação PSP viva; cancel-before-create (exceto se já paid → fulfill) | [ ] |
| H0.5 | Amount de checkout = catálogo, não pending stale | [ ] |
| H0.6 | Unificar `setup_payments`∪`invoices` **neste** P1 (R3); sem Edge billing | [x] 2026-09-04 dono |

---

## Fase 0 — Ops / env (antes ou em paralelo ao código L1)

| # | Item | Recursos / arquivos | Resolve | Camadas | DoD | Estado |
|---|------|---------------------|---------|---------|-----|--------|
| H0.10 | Definir `PAGARME_WEBHOOK_BASIC_USER` + `PASSWORD` em Vercel **Production** (+ Basic no painel) | env Vercel + painel Pagar.me | POST anônimo → 401; sem env → 503 | L1 | Secret set; redeploy | [x] 2026-09-04 |
| H0.11 | Preview/local: `ALLOW_INSECURE_PAGARME_WEBHOOK=1` só se necessário | `.env.local` / preview | Dev sem Basic sem silêncio | L1 | Doc no smoke | [x] 2026-09-04 |
| H0.12 | Atualizar smoke: Basic Auth presente em prod checklist | `docs/SMOKE_BILLING_PAGARME_SANDBOX.md` | Ops não esquece Basic | L1 | Seção auth | [x] 2026-09-04 |

---

## Fase 1 — L1 Auth + L2 Idempotência de ingestão

| # | Item | Arquivos | Resolve | Camadas | DoD | Estado |
|---|------|----------|---------|---------|-----|--------|
| H1.1 **R1a** | HMAC legado: `timingSafeEqual` + lengths iguais | `pagarmeWebhookAuth.ts` | Timing attack no HMAC | L1 | Teste unitário compare | [x] 2026-09-04 |
| H1.2 **R1b** | Prod: Basic obrigatório → 503/401; HMAC se header; flag insecure | `pagarmeWebhookAuth.ts` + `webhook/route.ts` | Unauthenticated fulfill trigger | L1 | Smoke 401/200 | [x] 2026-09-04 |
| H1.3 **R2** | Stale lock takeover com CAS: `AND updated_at = $prev` + `RETURNING id`; vazio = skip | `tryConsumePagarmeWebhookEvent.ts` | Dois workers no mesmo evento | L2 | Teste reclaim | [x] 2026-09-04 |
| H1.4 **R3** | Fallback key = `pge:{orderId}` (não `eventType:orderId`) | `webhookIdempotencyKey.ts` | `order.paid` + `charge.paid` duplicam slot | L2 | Mesmo order → mesma key | [x] 2026-09-04 |

**Ordem:** H1.1 → H1.2 → H1.3 → H1.4. Não pular H1.3.

---

## Fase 2 — L5 Invariantes de banco

| # | Item | Arquivos | Resolve | Camadas | DoD | Estado |
|---|------|----------|---------|---------|-----|--------|
| H2.1 **R6** | Unique parcial: `CREATE UNIQUE INDEX … ON invoices (subscription_id) WHERE status = 'pending'` | migration + apply remoto | Dois pending no mesmo ciclo | L5 | `execute_sql` índice existe; insert duplicado falha | [ ] |
| H2.2 | `ensurePendingInvoice`: tratar unique violation → re-select (já parcial) | `collectPayment.ts` | Race SELECT+INSERT | L5 | Path retry documentado | [ ] |
| H2.3 **R12a** | `billing_checkout_idempotency`: ENABLE+FORCE RLS + policy `service_role_only` + REVOKE anon/authenticated | migration | Leak de EMV / grants legados | L5 | `pg_policies` + grants audit | [x] 2026-08-28 mig |
| H2.4 **R12b** | TTL no cache: lookup só se `created_at > now() - interval '7 days'` (ou coluna `expires_at`) | `checkoutIdempotency.ts` + `create-invoice-checkout/route.ts` | QR PIX morto reutilizado | L5 | Key antiga regenera PIX | [x] 2026-09-04 |

**Aplicar migrations via MCP Supabase** (`apply_migration` + validação) na mesma entrega do código.

---

## Fase 3 — L3/L4 Fulfill atômico + fail verificado

| # | Item | Arquivos | Resolve | Camadas | DoD | Estado |
|---|------|----------|---------|---------|-----|--------|
| H3.1 **R4a** | `activate` / `syncLogicalSubscription` / `provision` **só** se claim retornou row | `fulfillPayment.ts` | Double provision / overwrite `next_billing_at` | L4 | Claim vazio = early return sem writes | [x] 2026-09-04 |
| H3.2 **R4b** | `pagarme_customer_id` só de `extractOrderCustomerId(apiOrder)` — ignorar hint webhook | `fulfillPayment.ts`, webhook merge | Customer forjado | L3 | Customer só API | [x] 2026-09-04 |
| H3.3 **R5** | Preferência: RPC `rpc_fulfill_setup` / `rpc_fulfill_invoice` (SECURITY DEFINER, search_path, REVOKE); mín.: sync sempre com `next_billing_at` | migration + `pagarmeSetupPaid.ts` | Crash mid-pipeline; upsert sem datas | L4 | Um call = sub coerente `active`+dates+plan | [ ] |
| H3.4 **R8** | `handleOrderFailed`: GET order; só marcar failed se PSP confirma failed/canceled | `webhook/route.ts` | Fail forjado | L3 | Sem GET paid → não UPDATE local | [x] 2026-09-04 |
| H3.5 **R17** | `generateTempPassword` rejection sampling (sem modulo bias) | `pagarmeSetupPaid.ts` | Bias estatístico | — | Unit | [ ] |

---

## Fase 4 — Anti-órfão PSP + preço canônico

| # | Item | Arquivos | Resolve | Camadas | DoD | Estado |
|---|------|----------|---------|---------|-----|--------|
| H4.1 **R7a** | `attachPixToInvoice`: se `pagarme_order_id` → GET; paid→fulfill; else cancel → create | `collectPayment.ts` | Múltiplos PIX abertos no cron | L3+D4 | No máximo 1 order vivo por obrigação | [ ] |
| H4.2 **R7b** | Path cartão em create-invoice-checkout: mesmo cancel-before-create | `create-invoice-checkout/route.ts` | Orders cartão acumulados | L3+D4 | Idem | [ ] |
| H4.3 **R9a** | `resolveCheckoutStrategy` / ensure: `amountCents` **sempre** do catálogo; se pending diverge, update/rebill antes do order | `ensureCheckout.ts` | Cobra preço stale | D5 | Status mismatch → checkout corrige | [ ] |
| H4.4 **R9b** | Platform change-plan chama `rebillPendingObligationAfterPlanChange` (mesmo tenant) | `platform/.../change-plan` + use case | Admin muda plano sem rebill | D5 | Amount alinhado pós-change | [ ] |
| H4.5 **R15** | Sync: reconciliar **todos** pending da company (ou confiar em R6) | `syncPendingObligationFromPsp.ts` | Órfão antigo | L3 | Segundo pending pago → fulfill | [ ] |
| H4.6 **R16** | Rebill/change-plan: GET order; se paid → fulfill e **não** cancel | `rebillPendingObligation.ts`, `change-plan` | Pagamento em trânsito órfão | L3+D4 | Paid mid-cancel → active | [ ] |

---

## Fase 5 — Cron, platform, repos, tipos

| # | Item | Arquivos | Resolve | Camadas | DoD | Estado |
|---|------|----------|---------|---------|-----|--------|
| H5.1 **R10a** | `charge`: set de `invoiceId` processados no run; overdue loop ignora esses | `charge/route.ts` | D0 tratado como D1 no mesmo cron | D6 | Um run ≠ double card retry | [ ] |
| H5.2 **R10b** | `neverPaid` → `fallbackSubStatus: "pending_payment"` (não `overdue`) | `charge/route.ts` + alinhar `resolveBillingAccess` | Stuck fora do dunning | D6 | Status efetivo coerente | [ ] |
| H5.3 **R10c** | `blockCompany`: **um** UPDATE `pagarme_subscriptions` por `company_id` | `charge/route.ts` | Double UPDATE / dead code | — | Diff limpo | [ ] |
| H5.4 **R11a** | `listNeverPaid`: filtro SQL + limite; respeitar `SubscriptionFilter` | `supabaseSubscriptionRepository.ts` | Full table scan | — | Query plana / teste | [ ] |
| H5.5 **R11b** | `lastByCompany`: DISTINCT ON / RPC / limite por company | `supabaseInvoiceRepository.ts` | 24k rows em Node | — | 1 latest/company | [ ] |
| H5.6 **R13** | Implementar (ou restaurar) `POST …/change-plan` e `…/replay-fulfill` não-vazios | `app/api/platform/billing/subscriptions/[id]/` | Ops sem replay; falso `[x]` no O5.2 | L3 | 401/403 auth + fulfill real | [ ] |
| H5.7 **R14** | Remover `bot`/`complete` de `SUBSCRIPTION_PLAN_KEYS`; aliases só em `PlanInputKey` + normalize | `contracts/status.ts`, `planCatalog.ts` | Raw legado no DB | — | Typecheck | [ ] |

---

## Fase 6 — Prova / DoD

| # | Item | DoD | Estado |
|---|------|-----|--------|
| H6.1 | `npm test` suíte billing (CAS, HMAC, claim, key) | Verde | [ ] |
| H6.2 | Sandbox: 2× POST webhook mesmo `order.paid` → 1 fulfill / 1 alreadyDone | `pagarme_webhook_events` + sub `active` único | [ ] |
| H6.3 | Sandbox: regenerar PIX → order antigo canceled ou unpaid; só novo vivo | Painel Pagar.me | [ ] |
| H6.4 | DoD B6 ADR-0004: paid local + `active` + `last_paid_at` | Smoke / E2E | [ ] |
| H6.5 | ADR-0004 + 0006 + este checklist linkados; O5.2 revalidado se R13 | Refs cruzadas | [ ] |

---

## Ordem de execução (cronológica)

```
Fase 0  Env secret + smoke HMAC
  → Fase 1  R1 HMAC + R2 CAS + R3 key          (L1+L2)
    → Fase 2  R6 unique + R12 RLS/TTL          (L5)
      → Fase 3  R4/R5/R8/R17 fulfill+fail      (L3+L4)
        → Fase 4  R7/R9/R15/R16 anti-órfão     (PSP+preço)
          → Fase 5  R10/R11/R13/R14 cron+ops
            → Fase 6  Prova / smoke / DoD
```

**Não** abrir Fase 4 como atalho se Fase 1/2 vermelhas (race + duplicate invoice).  
**Não** marcar H5.6 `[x]` sem HTTP real (evita falso-verde O5.2).

---

## Camadas × recursos (matriz rápida)

| | L1 Auth | L2 Consume | L3 PSP GET | L4 Claim | L5 DB |
|--|---------|------------|------------|----------|-------|
| R1 HMAC | ● | | | | |
| R2 CAS | | ● | | | |
| R3 Key | | ● | | | |
| R4 Claim guards | | | ● | ● | |
| R5 RPC fulfill | | | | ● | |
| R6 Unique pending | | | | | ● |
| R7 Cancel-before-create | | | ● | | |
| R8 Order failed | | | ● | | |
| R12 Cache RLS/TTL | | | | | ● |
| R15 Sync all pending | | | ● | | ○ (R6) |
| R16 Paid mid-rebill | | | ● | | |

---

## Arquivos tocados (inventário)

### Core billing
- `lib/billing/pagarme.ts`
- `lib/billing/tryConsumePagarmeWebhookEvent.ts`
- `lib/billing/webhookIdempotencyKey.ts`
- `lib/billing/fulfillPayment.ts`
- `lib/billing/pagarmeSetupPaid.ts`
- `lib/billing/collectPayment.ts`
- `lib/billing/ensureCheckout.ts`
- `lib/billing/rebillPendingObligation.ts`
- `lib/billing/syncPendingObligationFromPsp.ts`
- `lib/billing/resolveBillingAccess.ts` (alinhamento neverPaid)
- `lib/billing/contracts/status.ts`
- `lib/billing/planCatalog.ts`
- `lib/billing/adapters/supabaseSubscriptionRepository.ts`
- `lib/billing/adapters/supabaseInvoiceRepository.ts`

### Rotas
- `app/api/billing/webhook/route.ts`
- `app/api/billing/create-invoice-checkout/route.ts`
- `app/api/billing/charge/route.ts`
- `app/api/billing/change-plan/route.ts`
- `app/api/platform/billing/subscriptions/[id]/change-plan/route.ts`
- `app/api/platform/billing/subscriptions/[id]/replay-fulfill/route.ts`

### DB / docs / testes
- `supabase/migrations/YYYYMMDDHHMMSS_billing_hardening_*.sql` (unique + RLS/TTL + opcional RPC fulfill)
- `tests/billing/*`
- `docs/SMOKE_BILLING_PAGARME_SANDBOX.md`
- `docs/ADR/0004-billing-route-handlers-only.md` (emenda B2)
- `docs/ADR/0006-billing-hardening-idempotency-security.md`

---

## Referências

- [ADR-0006](./ADR/0006-billing-hardening-idempotency-security.md)
- [ADR-0004](./ADR/0004-billing-route-handlers-only.md)
- [CHECKLIST_BILLING_ORCHESTRATION_P0](./CHECKLIST_BILLING_ORCHESTRATION_P0.md)
- `.cursor/rules/supabase-migrations-seguranca.mdc`
- `.cursor/rules/projeto-pre-producao-radical.mdc`
- `.cursor/rules/arquitetura-lider.mdc` — Fase 2 só após “implementa”
