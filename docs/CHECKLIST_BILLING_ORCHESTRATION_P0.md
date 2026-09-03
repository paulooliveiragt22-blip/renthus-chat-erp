# Checklist — Billing orquestração P0 (webhook, preço, PIX, entitlements plumbing)

**Origem:** emenda ADR-0004 (2026-09-02) + diagnóstico sandbox (Ferrester / PIX pago no PSP sem fulfill local).  
**Runtime:** somente Route Handlers — ADR-0004 Decisão A.  
**Implementação:** sob aprovação item a item (“implementa” / bloco). Não abrir big-bang de pastas Obligation.

Estado: `[ ]` pendente · `[~]` parcial · `[x]` feito + data · `[!]` bloqueado (ops/produto).

**Fora de escopo explícito:** matriz *quais* features liberar em cada plano (`essencial` / `pro` / `market`). Isso é **próxima rodada** de produto. Aqui só plumbing (`plan_features` como fonte da RPC + TenantAccess).

---

## O0 — Decisões fechadas (não reabrir sem ADR)

| # | Decisão |
|---|--------|
| O0.1 | Um `FulfillPayment` para webhook e sync cartão |
| O0.2 | Webhook = caminho feliz; **status/checkout sync** + replay = rede de segurança (não cron “listar todos paid”) |
| O0.3 | Preço mensal canônico = `plans.price_cents` (catálogo); env `MONTHLY_PRICE_*` legado a remover/ignorar |
| O0.4 | Features booleanas na RPC = `plan_features`; cotas = `feature_limits` |
| O0.5 | Catálogo comercial de `feature_key` por plano = **próxima rodada** |
| O0.6 | Sem unificar fisicamente `setup_payments` ∪ `invoices` neste P0 |
| O0.7 | Sem Edge Functions de billing |

---

## O1 — Webhook vivo (ops + evidência)

| # | Item | Entregável / ação | DoD | Estado |
|---|------|-------------------|-----|--------|
| O1.1 | Confirmar URL webhook Pagar.me → `https://…/api/billing/webhook` (prod) | Painel Pagar.me + `docs/SMOKE_BILLING_PAGARME_SANDBOX.md` | URL e eventos `order.paid` / `charge.paid` ativos | [!] 2026-09-02 — Vercel 7d: quase 0 hits; 1× `405` em `/api/billing/webhook`. **Ação humana:** conferir URL/método/eventos no painel Pagar.me |
| O1.2 | Auth webhook v5 (sem secret HMAC no painel) | Env Vercel | Sem `PAGARME_WEBHOOK_SECRET` obrigatório; POST chega 2xx; pago só após GET order paid | [x] 2026-09-03 — HMAC opcional; API = fonte da verdade |
| O1.3 | Prova de ingestão | 1 checkout sandbox + wait | `pagarme_webhook_events` count **> 0**; linha `completed` ou `failed_*` documentada | [ ] bloqueado por O1.1 |
| O1.4 | Se O1.3 falhar: logs Vercel da rota + status HTTP no painel PSP | Runbook | Causa raiz escrita no checklist (não “implementar reconcile” como atalho) | [x] 2026-09-02 — zero ingestão; 405 isolado |
| O1.5 | Alerta mínimo | Sentry message ou cron watchdog | Se houve create-checkout e **0** eventos webhook em 24h → alerta (pode ser `[~]` após O1.3 verde) | [x] 2026-09-02 — `GET /api/billing/webhook-health` + cron **1x/dia** (`0 12 * * *`; Hobby não aceita `*/6`) |

---

## O2 — Entitlements plumbing (RPC)

> Não seedar/alterar a **lista** de features por plano. Só corrigir a **fonte** da agregação.

| # | Item | Arquivos | DoD | Estado |
|---|------|----------|-----|--------|
| O2.1 | `rpc_get_company_entitlements`: `array_agg` de **`plan_features`**, não `feature_limits` | migration + apply remoto | `execute_sql`: company com `plan_id` Market retorna as keys **já existentes** em `plan_features` (o que houver hoje); cotas continuam em `feature_limits` | [x] 2026-09-02 — Ferrester: 15 features + limits.whatsapp_messages=40000 |
| O2.2 | Contrato RPC: separar `features[]` (boolean) de limits (objeto/array de cotas) se ainda misturado | migration + `fetchCompanyEntitlements` | Tipagem TS alinhada; TenantAccess deny → `features=[]` | [x] 2026-09-02 — JSON `features` + `limits` |
| O2.3 | Segurança migration | `supabase-migrations-seguranca.mdc` | `search_path`, REVOKE/GRANT, policy intacta | [x] 2026-09-02 |
| O2.4 | Testes | `tests/billing/fetchCompanyEntitlements*.ts` | Verde; mock/RPC contract | [~] fixture trial_ends_at atualizado |
| O2.5 | Corrigir DoD falso em checklists antigos | `CHECKLIST_BILLING_PAYWALL_P0` D2/P2.1 nota | Nota: P2.1 estava `[x]` com bug; reabrir até O2.1 | [x] 2026-09-02 |

**Próxima rodada (não fazer agora):** revisão produto de `plan_features` + `planCatalog.features` + `docs/BILLING_PLANS.md`.

---

## O3 — Preço canônico + change-plan rebill

| # | Item | Arquivos | DoD | Estado |
|---|------|----------|-----|--------|
| O3.1 | `getMonthlyPriceCents` / checkout leem `plans.price_cents` (ou `planCatalog` = mesma fonte) | `lib/billing/pagarme.ts`, `ensureCheckout`, status | Market cobra 39700 se `plans.price_cents=39700`; env BOT 29700 não vence | [x] 2026-09-02 — env mensal ignorado |
| O3.2 | `ChangeSubscriptionPlan` / RPC: ao mudar plano, invalidar pending com amount mismatch + cancel order PSP se houver | use case + RPC/API platform | Após mudar para Market, UI/status não mostram R$ 297 stale | [x] 2026-09-02 — `rebillPendingObligationAfterPlanChange` no change-plan |
| O3.3 | Status API: `obligation_amount` + flag `amount_mismatch` (opcional mas recomendado) | `/api/billing/status` | UI pode avisar ou forçar regenerar | [x] 2026-09-02 |
| O3.4 | One-shot repair conta teste (Ferrester): pending 297 → alinhado a plan atual **ou** cancel+recreate | ops/SQL via RPC/API | Sem UPDATE cru no browser; audit se platform | [x] 2026-09-02 — invoice → R$ 397, order limpo |
| O3.5 | Remover/documentar deprecação `MONTHLY_PRICE_BOT_*` / `COMPLETE_*` | env + docs | Sem dual-path silencioso | [x] 2026-09-02 — código ignora; limpar env Vercel opcional |

---

## O4 — EnsureCheckout anti-órfão + EMV

| # | Item | Arquivos | DoD | Estado |
|---|------|----------|-----|--------|
| O4.1 | Persistir `pagarme_order_id` (+ URL) **antes** de retornar `pix_emv_unavailable` | `create-invoice-checkout` / ensure path | Order pago no PSP sempre matchável em `invoices`/`setup_payments` | [x] 2026-09-02 |
| O4.2 | Allowlist hosts no decode EMV (Pagar.me, Mundipagg, Stone QR) + timeout | `decodePixQrFromUrl.ts` | Sem fetch a host arbitrário; Stone URL não quebra auth-only-pagar.me | [x] 2026-09-02 |
| O4.3 | Fixture: GET order real sandbox → `extractPixCode` / `resolvePixFromOrder` | teste ou smoke | Se JSON traz `qr_code` EMV, persistimos `pix_qr_code` ≠ vazio | [ ] após deploy + O1 |
| O4.4 | Regenerar PIX: cancelar charge/order anterior quando API permitir | pagarme adapter + checkout | No máximo uma obrigação PIX “viva” por company | [x] 2026-09-02 — `cancelPagarmeChargeBestEffort` |
| O4.5 | UI: não tratar só QR imagem como “PIX gerado” sem EMV; botão Copiar só com código | `PlanBillingPanel` | UX alinhada a B3 ADR | [~] Copiar já exige código; toast 502 permanece |

---

## O5 — Fulfill + replay (rede de segurança)

| # | Item | Arquivos | DoD | Estado |
|---|------|----------|-----|--------|
| O5.1 | Confirmar webhook → `FulfillPayment` → `active` + `last_paid_at` + `is_active` | fluxo E1 | Conta teste: após `order.paid`, status local coerente | [ ] bloqueado por O1 |
| O5.2 | Platform ou cron **Replay** `order_id` → `FulfillPayment` (CRON_SECRET / superadmin) | `app/api/…` | Órfãos em `billing_fulfill_failures` / paid sem linha recuperáveis sem reconcile-first | [x] 2026-09-02 — `POST /api/platform/billing/replay-fulfill` |
| O5.3 | Watchdog (opcional após O1): não reprocessar massa; só alertar | cron RH | ADR-0004 B2 | [x] 2026-09-02 — webhook-health |
| O5.4 | Sync sob demanda: pending+`pagarme_order_id` → GET PSP → `fulfillPayment` se paid | `syncPendingObligationFromPsp` + `GET /status` + checkout | Paywall poll libera sem webhook; idempotente | [x] 2026-09-02 |

---

## O6 — DoD / testes / docs

| # | Item | DoD | Estado |
|---|------|-----|--------|
| O6.1 | Reabrir S3/S4 no `CHECKLIST_BILLING_PAYWALL_P0` até fulfill real | Nota `[~]` ou `[ ]` com motivo | [x] 2026-09-02 |
| O6.2 | E2E billing: após cartão/PIX, assert `status` ∈ active (ou pós-setup) **e** `last_paid_at` set | Playwright / status API | [x] 2026-09-02 — asserts endurecidos (aguardam deploy) |
| O6.3 | `npm test` suíte billing verde | CI local | [~] |
| O6.4 | Smoke sandbox atualizado (webhook count + EMV) | `SMOKE_BILLING_PAGARME_SANDBOX.md` | [ ] |
| O6.5 | ADR-0004 + este checklist linkados | refs cruzadas | [x] 2026-09-02 |

---

## Ordem de execução

```
O1 (webhook vivo — ops)
  → O2 (RPC plan_features — plumbing)
    → O3 (preço + rebill change-plan)
      → O4 (anti-órfão + EMV)
        → O5 (fulfill prova + replay)
          → O6 (DoD / E2E honesto)

Próxima rodada (produto): matriz features por plano
  → seed plan_features + planCatalog + BILLING_PLANS.md
```

Não abrir O5.2/O5.3 como atalho se O1 estiver vermelho.

---

## Achados que motivaram este checklist (snapshot)

| Achado | Evidência |
|--------|-----------|
| Webhook morto | `pagarme_webhook_events` = 0; `billing_fulfill_failures` = 0 |
| PIX pago no PSP sem liberar | Ferrester `trial`, `last_paid_at` null; invoice pending |
| Preço ≠ plano | plan `market`, invoice `297.00` (env BOT) |
| EMV ausente | `pix_qr_code` vazio com `pagarme_payment_url` set |
| RPC features errada | agg em `feature_limits` (1 key); catálogo real em `plan_features` |

---

## Referências

- `docs/ADR/0004-billing-route-handlers-only.md`
- `docs/CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` (E1)
- `docs/CHECKLIST_BILLING_PAYWALL_P0.md` (D1/D2)
- `docs/SMOKE_BILLING_PAGARME_SANDBOX.md`
- `.cursor/rules/supabase-migrations.mdc` / `supabase-migrations-seguranca.mdc`
- `.cursor/rules/projeto-pre-producao-radical.mdc`
- `.cursor/rules/arquitetura-lider.mdc` (Fase 2 só após “implementa”)
