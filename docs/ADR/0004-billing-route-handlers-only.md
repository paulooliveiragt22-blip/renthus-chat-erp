# ADR 0004 — Billing: runtime Route Handlers + orquestração canônica

**Status:** aceito (emenda 2026-09-02)  
**Data original:** 2026-08-28  
**Emenda:** 2026-09-02 — calibração pós-diagnóstico sandbox (webhook morto, órfãos PIX, preço stale, RPC features errada)

**Contexto:** R6.3 — cobrança, webhook Pagar.me, cron de renovação e fulfill compartilham `service_role`, idempotência e Sentry. Emenda incorpora falhas reais: `pagarme_webhook_events` vazio com orders pagos no PSP; invoice pendente com valor ≠ plano; UI QR sem EMV; entitlements lendo a tabela errada.

---

## Decisão A — Runtime (inalterada)

Toda lógica de **billing / pagamentos / fulfill / cron charge** roda em:

- `app/api/billing/*` (Route Handlers, `runtime = "nodejs"`)
- `lib/billing/*` (domínio + adapters)
- Workers/cron HTTP autenticados com `CRON_SECRET` (`lib/security/cronAuth.ts`)

**Não** criar Supabase Edge Functions nem Vercel Edge Middleware para:

- Webhook Pagar.me
- `FulfillPayment` / `CollectPayment`
- Cron de renovação, recarga IA, reconcile/watchdog de billing

### Motivo (runtime)

1. **Idempotência e transações** — fulfill usa optimistic lock + RPC Postgres; Edge não compartilha o mesmo stack de testes (`npm test`) nem o lifecycle webhook E1.
2. **Secrets** — `PAGARME_*`, `CRON_SECRET`, HMAC webhook já centralizados em env server-side Node.
3. **Observabilidade** — Sentry + `billing_fulfill_failures` + `billingLog` num único runtime.
4. **Dual-path** — Edge Function paralela reintroduziria dois fulfillments (proibido por B3/R4).

### Exceção (runtime)

Edge Functions permanecem permitidas para domínios **fora de billing** (ex.: notificações auxiliares) desde que **não** mutem `pagarme_subscriptions`, `invoices`, `setup_payments` ou tabelas de entitlements/planos.

Nova Edge Function que toque billing exige **novo ADR** + revisão de segurança.

---

## Decisão B — Orquestração (emenda 2026-09-02)

### B1 — Fonte de verdade pós-pagamento

| Papel | Canônico | Não canônico |
|-------|----------|--------------|
| Acesso (paywall) | `pagarme_subscriptions.status` (+ datas `trial_ends_at` / `last_paid_at`) via `resolveTenantAccess` | UI otimista sozinha |
| Efeito pós-pago | **Um** use case: `FulfillPayment` (webhook **e** sync cartão) | Ativar plano em rotas paralelas |
| Obrigação aberta | `setup_payments` **ou** `invoices` pending (kind via `EnsureCheckout`) | Aggregate novo / unificação de tabelas no P0 |
| Preço da obrigação | `plans.price_cents` (mensal) + setup só se `SETUP_PRICE_*>0` | `MONTHLY_PRICE_BOT_*` / fallbacks UI divergentes |
| Features booleanas | Tabela `plan_features` (via RPC entitlements) | `feature_limits` (isso é **cota**, não catálogo) |

**Fora desta emenda:** *quais* `feature_key` entram em cada plano (`essencial` / `pro` / `market`). Catálogo comercial de features = **próxima rodada** de produto. Esta ADR só fixa **de onde** a RPC lê e **como** o acesso gated por TenantAccess.

### B2 — Webhook primeiro; reconcile é rede de segurança

Alinhado a E1 (`CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS`) e à lição do ADR-0003 (reconciler como primeira linha **mascara** ingestão morta):

1. **P0 obrigatório:** webhook Pagar.me → `POST /api/billing/webhook` recebendo e persistindo em `pagarme_webhook_events` (lifecycle E1). Auth: Core v5 **sem** secret HMAC no painel (Basic Auth opcional; neste projeto não usamos). Gate de segurança do pago = **GET `/orders/:id` na API** antes de `FulfillPayment` — webhook é notificação, API é fonte da verdade.
2. **Sync sob demanda (rede de segurança UX):** `GET /api/billing/status` e reentrada em `create-invoice-checkout` chamam `syncPendingObligationFromPsp` — se obrigação pending tem `pagarme_order_id` e o order no PSP está `paid`, roda o mesmo `FulfillPayment` (idempotente). O paywall já polla status ~5s; webhook morto não deixa o tenant eternamente travado após pagar.
3. **Watchdog / replay** (ops): cron Route Handler com `CRON_SECRET` **ou** ação platform “Replay fulfill(`order_id`)” — dead-letter / órfãos; alerta Sentry se checkouts criados e **zero** eventos webhook em janela N.
4. **Proibido no P0:** cron que lista “todos paid no PSP” como caminho feliz de liberação de plano.
5. **`PAGARME_WEBHOOK_SECRET`:** opcional/legado. Só rejeita body se `X-Hub-Signature` vier **e** o HMAC não bater. Sem header / sem env → aceita e confirma na API. **Não** guardar secret no Postgres.

### B3 — EnsureCheckout anti-órfão + PIX EMV

1. Criar order no Pagar.me → **persistir `pagarme_order_id` (+ URL se houver) na obrigação** antes de falhar por falta de EMV.
2. EMV (`qr_code` / copia-e-cola) é obrigatório para resposta de sucesso ao cliente; URL de imagem sozinha ≠ sucesso de UX (`pix_emv_unavailable` ok **depois** do vínculo local).
3. Regenerar PIX / change-plan: **cancelar** charge/order anterior no gateway quando possível — evita pagar QR stale com valor antigo.
4. Decode de QR por URL: **allowlist** de hosts (`pagar.me`, `mundipagg.com`, `stone.com.br` e subdomínios de QR documentados) + timeout (`AbortController`). Sem fetch aberto (SSRF).

Referência Pagar.me: `last_transaction.qr_code` = EMV; `qr_code_url` = imagem (gateway pode ser Stone sob Pagar.me).

### B4 — Change-plan e preço

`rpc_platform_change_subscription_plan` / `ChangeSubscriptionPlan` deve, na mesma operação de negócio (API/RPC):

1. Atualizar `plan` / `plan_key` / `plan_id`.
2. **Invalidar** obrigação pending com amount ≠ preço canônico do novo plano (e cancelar order PSP vinculado).
3. Recriar pending com amount canônico (ou deixar `EnsureCheckout` criar na próxima cobrança — sem exibir valor stale na UI).

Status API deve poder expor mismatch (`plan` vs `obligation.amount`) até o rebill estar feito.

### B5 — Entitlements (plumbing, não catálogo)

1. `rpc_get_company_entitlements` agrega features de **`plan_features`**, não de `feature_limits`.
2. `feature_limits` permanece só para cotas (ex.: `whatsapp_messages` mensal).
3. TenantAccess deny → `features = []` (já A0.3).
4. **Conteúdo** das linhas em `plan_features` por plano = decisão de produto **adiada** (próxima rodada). Não misturar seed de catálogo comercial nesta emenda de orquestração.

Migration que alterar a RPC: `SECURITY DEFINER` + `search_path = public, pg_temp` + REVOKE/GRANT conforme `supabase-migrations-seguranca.mdc`; aplicar no remoto na mesma entrega.

### B6 — DoD de pagamento (anti falso-verde)

E2E / smoke de “PIX pago” ou “cartão aprovado” só fecha quando:

- obrigação local `paid`, **e**
- `pagarme_subscriptions.status = active` (ou estado pós-setup definido), **e**
- `last_paid_at` setado,

não apenas presença de `img` QR ou toast de UI.

### B7 — O que não fazer nesta trilha

- Novo aggregate “Obligation” / unificação física `setup_payments`∪`invoices` (kind lógico basta).
- Multi-PSP / Stripe como processador.
- Redefinir matriz de features por plano (próxima rodada).
- Edge Functions para billing (Decisão A).
- Reconcile-first como liberação de plano.

---

## Consequências

- Novos crons de cobrança / watchdog → `vercel.json` + `app/api/billing/*` + `validateCronAuthorization`.
- Smoke e testes de contrato: `tests/billing/`, `scripts/billing-sandbox-smoke.mjs`, E2E com assert de fulfill (B6).
- Checklist de execução desta emenda: `docs/CHECKLIST_BILLING_ORCHESTRATION_P0.md`.
- Checklist de **features por plano** (próxima rodada): documento novo quando produto fechar a matriz — não reabrir seed ad hoc aqui.

---

## Referências

- `docs/CHECKLIST_AUTO_RECHARGE_RENEWAL.md` (R6)
- `docs/CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` (B3 FulfillPayment, E1 webhook híbrido)
- `docs/CHECKLIST_BILLING_PAYWALL_P0.md` (D1/D2 — D2: features ← `plan_features`)
- `docs/CHECKLIST_BILLING_ORCHESTRATION_P0.md` (execução desta emenda)
- `docs/ADR/0003-sqs-outbox-lambda.md` (lição: reconciler não mascara ingestão)
- `docs/BILLING_PLANS.md` / `lib/billing/planCatalog.ts` (preços; features comerciais TBD na próxima rodada)
- `lib/security/cronAuth.ts`
- Pagar.me docs: webhooks (`order.paid`), PIX (`qr_code` / `qr_code_url`)
- Stripe (padrão de mercado): webhook = source of truth; signature verification; reconcile só backup
