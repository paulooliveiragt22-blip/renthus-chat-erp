# ADR 0004 — Billing somente via Next.js Route Handlers (sem Edge Functions)

**Status:** aceito  
**Data:** 2026-08-28  
**Contexto:** R6.3 — cobrança, webhook Pagar.me, cron de renovação e fulfill compartilham `service_role`, idempotência e Sentry.

## Decisão

Toda lógica de **billing / pagamentos / fulfill / cron charge** roda em:

- `app/api/billing/*` (Route Handlers, `runtime = "nodejs"`)
- `lib/billing/*` (domínio + adapters)
- Workers/cron HTTP autenticados com `CRON_SECRET` (`lib/security/cronAuth.ts`)

**Não** criar Supabase Edge Functions nem Vercel Edge Middleware para:

- Webhook Pagar.me
- `FulfillPayment` / `CollectPayment`
- Cron de renovação ou recarga IA

## Motivo

1. **Idempotência e transações** — fulfill usa optimistic lock + RPC Postgres; Edge não compartilha o mesmo stack de testes (`npm test`) nem o lifecycle webhook E1.
2. **Secrets** — `PAGARME_*`, `CRON_SECRET`, HMAC webhook já centralizados em env server-side Node.
3. **Observabilidade** — Sentry + `billing_fulfill_failures` + `billingLog` num único runtime.
4. **Dual-path** — Edge Function paralela reintroduziria dois fulfillments (proibido por B3/R4).

## Exceção

Edge Functions permanecem permitidas para domínios **fora de billing** (ex.: notificações auxiliares) desde que **não** mutem `pagarme_subscriptions`, `invoices`, `setup_payments` ou `subscriptions`.

Nova Edge Function que toque billing exige **novo ADR** + revisão de segurança.

## Consequências

- Novos crons de cobrança → `vercel.json` + rota `app/api/billing/*` + `validateCronAuthorization`.
- Smoke e testes de contrato ficam em `tests/billing/` e `scripts/billing-sandbox-smoke.mjs`.

## Referências

- `docs/CHECKLIST_AUTO_RECHARGE_RENEWAL.md` (R6)
- `docs/CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` (B3 FulfillPayment)
- `lib/security/cronAuth.ts`
