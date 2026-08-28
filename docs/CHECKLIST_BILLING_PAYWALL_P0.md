# Checklist — Billing paywall, entitlements e onboarding (P0→P2)

Origem: chat de desenho “pagamento / assinatura / onboarding” + autocrítica de
segurança (2026-08-28). Este documento existe pra **não perder contexto** entre
sessões — cada item tem objetivo, arquivos, correção proposta e resultado
esperado. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir.

**Processo:** uma item/fase por vez até `npm test` verde; migrations via MCP
`apply_migration` + validação `execute_sql`; postura pré-produção radical
(`.cursor/rules/projeto-pre-producao-radical.mdc`). Segurança de migration:
`.cursor/rules/supabase-migrations-seguranca.mdc`.

**Regra de ordem (bloqueante):** **não** implementar UX `/ativar` ou `/plano`
antes de fechar **P0** (paywall na API + revogação de entitlements + IDOR).
UI bonita em cima de bypass de API = receita e segurança furadas.

Referências:
- Planos: `docs/BILLING_PLANS.md`, `lib/billing/planCatalog.ts`
- Erros API: `docs/API_ERROR_CONTRACT.md`, `lib/api/errors.ts`
- Proxy atual: `proxy.ts` (`checkCompanyAccess` — **só páginas**, não `/api/*`)
- Entitlements: `lib/billing/entitlements.ts` (lê `subscriptions`, **não**
  `pagarme_subscriptions`)

---

## Resumo

| Fase | Escopo | Estado |
|------|--------|--------|
| **P0** | Settings trial (default 0) + `requireBillingActive` + gates API + block/IDOR/idempotência | [x] 2026-08-28 |
| **P1** | UX `/plano` + `/ativar` + banner + invalidação cookie paywall | [x] 2026-08-28 |
| **P2** | Consolidar entitlements (RPC/view) + limpeza legado signup/complete + dunning e-mail | [x] parcial 2026-08-28 |

| # | Item P0 | Severidade | Estado |
|---|---------|------------|--------|
| P0.0 | `platform_billing_settings` + default_trial_days=0 + UI platform | Crítico | [x] 2026-08-28 |
| P0.1 | Contrato + helper `requireBillingActive` (effective status) | Crítico | [x] 2026-08-28 |
| P0.2 | Integrar helper no guard central (`requireCompanyAccess` / wrappers) | Crítico | [x] 2026-08-28 |
| P0.3 | Fix IDOR `GET /api/billing/status?company_id=` | Crítico | [x] 2026-08-28 |
| P0.4 | `blockCompany` revoga `subscriptions` + invalida cache | Crítico | [x] 2026-08-28 |
| P0.5 | Webhook idempotente por `order_id` (+ `event.id`) | Alto | [x] 2026-08-28 |
| P0.6 | Idempotência checkout + unique pending invoice/setup | Alto | [x] 2026-08-28 |
| P0.7 | Signup usa settings (N=0 → `pending_payment`; N>0 → trial) + RPC | Alto | [x] 2026-08-28 |
| P0.8 | Envelope erro `billing_inactive` (402) no contrato API | Médio | [x] 2026-08-28 |
| P0.9 | Testes unitários/integração da matriz de estados | Alto | [x] 2026-08-28 |
| P0.10 | Proxy: fail-closed billing + não cachear decisão de block | Alto | [x] 2026-08-28 |

---

## Decisões arquiteturais

### Fechadas (sessão 2026-08-28)

| # | Tema | Decisão | Motivo |
|---|------|---------|--------|
| D1 | **Fonte de billing state** | `pagarme_subscriptions.status` é canônico para **acesso** (paywall) | É o que o cron/webhook mutam |
| D2 | **Fonte de features** | `subscriptions` + `plan_features` (+ addons) continuam canônicos para **gates de plano** até P2 | Evitar big-bang; P0 só sincroniza no block |
| D3 | **Trial dá features?** | **Sim** — **somente** enquanto `status=trial` e `trial_ends_at > now()` | Produto: experimentar valor no trial |
| D6 | **HTTP status** | `402 Payment Required` + `error.code = "billing_inactive"` | Distingue de 403 plano/role; client redireciona `/plano/bloqueado` |
| D7 | **Onde aplicar o gate** | **Dentro** de `requireCompanyAccess` (opt-out por flag) + wrappers plan/capability herdam | Uma linha de defesa; evita esquecer rota |
| D8 | **Allowlist billing** | Rotas `/api/billing/*` (exceto signup/webhook/charge) + `/api/auth/*` + `/api/workspace/select|list` **não** exigem billing active | Tenant precisa pagar e trocar workspace |
| D9 | **Impersonation platform** | Bypass de billing gate **somente leitura**; mutações tenant já bloqueadas no proxy | Suporte diagnostica blocked |
| D10 | **Setup fee = 0** | Manter; quando setup cents=0 **não** usar `pending_setup` — ir direto a invoice/`overdue` ou `pending_payment` | Evita estado morto com taxa zero |
| D11 | **Upgrade em overdue** | **Proibido** até pagar fatura pendente (mudança radical vs hoje) | Fecha leak receita `change-plan` |
| D12 | **Pós-signup redirect** | P1: `/ativar` (soft); P0 não mexe em UX | Segurança primeiro |

### Revisadas / novas (sessão 2026-08-28 — trial 0 + platform)

| # | Tema | Decisão | Motivo |
|---|------|---------|--------|
| D13 | **Default trial days** | **0** (pay-to-start). Clamp `0..90`. | Pedido dono; sem trial gratuito por padrão |
| D14 | **Fonte canônica de dias** | Tabela singleton `platform_billing_settings` (`default_trial_days`). Platform UI edita. Env `TRIAL_DAYS` = fallback só se row ausente (depois remover). | Feature flag boolean não serve pra número; env não é editável no super admin |
| D15 | **Override por empresa** | Platform pode gravar `pagarme_subscriptions.trial_days_granted` / estender `trial_ends_at` na ficha empresa | Campanhas / courtesy trial sem mudar global |
| D16 | **Signup com N=0** | **Não** criar `status=trial`. Criar `status=pending_payment` + 1ª fatura no signup. Gate 402 até 1º pagamento. **Onboarding `/ativar` só após pagamento** (decisão A, 2026-08-28). | Pay-to-enter; sem ERP/WA antes de pagar |
| D17 | **Signup com N>0** | `status=trial`, `trial_ends_at = now + N days` (N da settings/override) | Comportamento clássico |
| D18 | **Overdue grace (ex-D4)** | Grace 1–4 dias **só** se `last_paid_at IS NOT NULL` (já foi cliente pagante). **Never-paid** (`pending_payment` / 1ª fatura) = **402 imediato**, sem grace. | Senão trial=0 + D4 antigo = 5 dias de ERP de graça |
| D19 | **pending_setup** | Só quando `SETUP_PRICE_*>0` e 1ª cobrança é taxa. Com setup=0 usar `pending_payment`. Ambos = 402 na API mutável (ex-D5). | Alinha D5 + D10 + D16 |
| D5′ | **Estados 402** | `blocked` \| `cancelled` \| `pending_setup` \| `pending_payment` \| `missing` \| `trial` **expirado** (ends_at ≤ now e cron ainda não rodou — gate por data, não só status) | Evita janela entre vencimento e cron |
| D20 | **Ordem pós-signup (N=0)** | **A — fechado:** `/signup` → login → **402 em todo ERP** → `/plano/pagar` → webhook pago → `active` → redirect **`/ativar`** → depois `/pedidos` | Dono confirmou: “precisa pagar pra entrar no app” |
| D21 | **Ordem pós-signup (N>0)** | `/signup` → login → **`/ativar`** (soft, banner se incompleto) → `/pedidos`; trial corre em paralelo | Trial = experimentar com produto ativo |

### Inconsistências encontradas nos contratos anteriores (auditoria)

| # | Inconsistência | Impacto | Correção |
|---|----------------|---------|----------|
| I1 | D4 (overdue libera ERP) × trial default 0 | “0 dias” vira ~5 dias free via grace | **D18** |
| I2 | D5 `pending_setup` 402 × D10 setup=0 | Estado `pending_setup` com valor 0 é ambíguo | **D16/D19** + status `pending_payment` |
| I3 | D3 “trial dá features” sem checar `trial_ends_at` | Status `trial` stale após vencimento, antes do cron, libera API | **D5′** gate por data |
| I4 | Checklist assumia trial 15d; código `Math.max(1,…)` impede 0 | Impossível cumprir D13 | Clamp `0..90`; remover min 1 |
| I5 | `activateTrial` hardcoded **30d** ≠ `startFreeTrial` env **15d** ≠ UI `NEXT_PUBLIC_TRIAL_DAYS` | 3 fontes de verdade | Uma leitura: `getDefaultTrialDays()` ← settings |
| I6 | `NEXT_PUBLIC_*` no signup | Valor no client **não** atualiza quando platform muda dias | Signup busca `GET /api/billing/trial-policy` (público/rate-limited) ou SSR |
| I7 | D8 allowlist × P1 `/ativar` | Com N=0, `/ativar` **após** pagamento — não allowlist sob `pending_payment` | **D20** |
| I8 | Feature flags (`enabled_global` bool) como “dias de trial” | Modelo errado | **D14** settings tipadas |
| I9 | Matriz tratava `trial` como sempre ✅ | Trial expirado com status ainda `trial` | Gate: `status=trial AND trial_ends_at > now()` |
| I10 | `change-plan` em trial com N=0 | Quase sem janela; pending_payment não deve trocar plano sem pagar | Só `trial` (válido) ou `active` |

---

## Contrato — `requireBillingActive`

### Assinatura proposta

```ts
// lib/billing/requireBillingActive.ts
import "server-only";

export type BillingAccessStatus =
  | "trial"            // só se trial_ends_at > now()
  | "active"
  | "overdue"          // grace só se last_paid_at != null (D18)
  | "pending_payment"  // never-paid / trial=0 (D16)
  | "pending_setup"    // setup fee > 0
  | "blocked"
  | "cancelled"
  | "missing";

export type BillingGateMode =
  | "full"           // default: bloqueia pending_*|blocked|cancelled|missing|trial expirado|overdue never-paid
  | "billing_self"   // allowlist: status/features/checkout/change-plan
  | "skip";          // só impersonation read / rotas técnicas

export type BillingGateResult =
  | { ok: true; status: BillingAccessStatus; plan: string | null }
  | {
      ok: false;
      status: 402;
      code: "billing_inactive";
      billingStatus: BillingAccessStatus;
      message: string;
    };

/**
 * Lê pagarme_subscriptions da companyId (service_role).
 * Nunca confiar em cookie/JWT claim de plano.
 */
export async function requireBillingActive(
  admin: SupabaseClient,
  companyId: string,
  mode?: BillingGateMode
): Promise<BillingGateResult>;
```

### Matriz estado × acesso (pós D13–D19)

| Estado efetivo | UI admin | API mutável | Billing self | WA inbound | Features |
|----------------|----------|-------------|--------------|------------|----------|
| `trial` **e** `trial_ends_at > now()` | ✅ | ✅ | ✅ | ✅ se `is_active` | ✅ plano |
| `trial` **mas** `trial_ends_at ≤ now()` | ⚠ `/plano*` | ❌ 402 | ✅ | conforme `is_active` | ❌ |
| `active` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `overdue` **+** `last_paid_at` set | ✅ + banner | ✅ (grace ≤4d) | ✅ | ✅ se `is_active` | ✅ |
| `overdue` **never-paid** / 1ª fatura | ⚠ `/plano*` | ❌ 402 | ✅ | ❌ | ❌ |
| `pending_payment` (trial N=0) | ⚠ `/plano*` | ❌ 402 | ✅ | ❌ | ❌ |
| `pending_setup` (setup > 0) | ⚠ `/plano*` | ❌ 402 | ✅ | ❌ | ❌ |
| `blocked` / `cancelled` / *missing* | ⚠ `/plano*` | ❌ 402 | ✅ (read/checkout) | ❌ | ❌ |

**Regra do helper:** não confiar só em `status` — computar `effective = f(status, trial_ends_at, last_paid_at, now)`.

### Integração no guard

```ts
// requireCompanyAccess({ billing?: BillingGateMode })
// default billing = "full"
//
// Fluxo:
// 1. cookie workspace + auth user
// 2. membership company_users
// 3. role allowlist
// 4. se impersonating && GET → billing mode "skip"
// 5. senão requireBillingActive(admin, companyId, mode)
// 6. return ctx (+ billingStatus opcional)
```

`requireCapability` / `requireCompanyPlanFeature` / `requireCompanyAnyPlanFeature`
**herdam** o gate sem alteração por rota (exceto allowlist explícita).

### Envelope de erro (estender `docs/API_ERROR_CONTRACT.md`)

```json
{
  "error": {
    "code": "billing_inactive",
    "message": "Assinatura inativa. Regularize o pagamento em Plano."
  },
  "billing_status": "blocked"
}
```

- HTTP **402**
- `codeFromStatus(402)` → `"billing_inactive"` em `lib/api/errors.ts`
- Client admin: interceptor fetch → redirect `/plano/bloqueado` (P1)

### Allowlist explícita (mode `billing_self` ou skip)

| Rota | Motivo |
|------|--------|
| `GET /api/billing/status` | Ver fatura / PIX |
| `GET /api/billing/features` | UI gates (pode retornar vazio se blocked) |
| `POST /api/billing/create-invoice-checkout` | Pagar |
| `POST /api/billing/change-plan` | Só trial/active; overdue → 400 (D11) |
| `POST /api/billing/allow-overage` | Owner; se blocked → 402 |
| `POST /api/auth/*`, `POST /api/workspace/select`, `GET /api/workspace/list` | Sessão |
| `POST /api/billing/webhook`, `POST /api/billing/charge`, `POST /api/billing/signup` | Técnicos (já fora do cookie) |

**Não** allowlist: `/api/admin/**`, `/api/orders/**`, `/api/whatsapp/send`, `/api/reports/**`,
`/api/dashboard/**`, `/api/delivery/**`, `/api/meta/messaging/send`, PDV, etc.

---

## Inventário — APIs expostas hoje sem billing state

**Achado:** `proxy.ts` só aplica paywall em **páginas** (`!pathname.startsWith("/api/")`).
`requireCompanyAccess` / `requireCapability` **não** leem `pagarme_subscriptions`.
`blockCompany` **não** altera `subscriptions` → `requirePlanFeature` segue true.

### Grupo A — Mutáveis críticos (bloqueio P0 obrigatório)

Herdam `requireCompanyAccess`/`requireCapability` sem billing. Após P0.2, cobertos
automaticamente se o gate estiver no centro.

| Área | Rotas (amostra representativa) |
|------|--------------------------------|
| PDV | `/api/admin/pdv/finalize`, `cash-register`, `cash-movements`, `pending-orders`, `order-import`, `products`, `customers` |
| Pedidos | `/api/admin/orders`, `/api/admin/orders/[id]`, `items`, `notify-snapshot`, `/api/orders/*` |
| Financeiro | `/api/admin/financeiro/*` (dashboard, extrato, dre, opex, bills, journals, reverse, finalize-order, cash-*) |
| Estoque | `/api/admin/estoque` |
| Produtos | `/api/admin/products/**`, `/api/products/upload-image` |
| Clientes | `/api/admin/customers/**` |
| WhatsApp ops | `/api/whatsapp/send`, `threads/**` |
| Marketplace | `/api/admin/marketplace/ifood/**`, `aiqfome/**` |
| Mesa | `/api/admin/mesa/**` |
| Campanhas / templates | `/api/admin/campaigns/**`, `whatsapp-templates/**` |
| Print | `/api/admin/impressoras/**`, `print-agents/pairing` |
| Relatórios | `/api/reports/summary`, `/api/reports/daily` |
| Dashboard | `/api/dashboard/stats` |
| Users / staff | `/api/admin/users/**`, `staff-profiles/**` |
| Menu / taxas | `/api/admin/menu-profile/**`, `taxas/**`, `accepted-payments` |
| AI wallet | `/api/admin/ai-wallet`, `ai-wallet/checkout` (checkout: avaliar allowlist parcial) |
| Canais | `/api/admin/whatsapp-channel/**`, `meta-messaging/**` (OAuth: allowlist se blocked? **não** — só após pagar) |

### Grupo B — Já têm `requirePlanFeature` mas **não** billing state

Mesmo com plano Pro, tenant `blocked` ainda passa. P0.2 + P0.4 fecha.

### Grupo C — Billing com furo próprio

| Rota | Furo |
|------|------|
| `GET /api/billing/status?company_id=` | **IDOR** — usa `qCompanyId` sem validar membership (P0.3) |
| `POST /api/billing/change-plan` | Upgrade em `overdue` sem pagar (D11 / P0.2 policy) |
| `POST /api/billing/create-invoice-checkout` | Sem idempotency key; race com cron (P0.6) |
| `POST /api/billing/signup` | ~~Sem RPC transacional~~ → `rpc_signup_company_with_billing` (P0.7 ✅) |
| Webhook | Sem `event.id` → reprocessa (P0.5) |

### Grupo D — Canais inbound (já parcialmente ok)

| Rota | Comportamento atual | P0 |
|------|---------------------|----|
| `/api/whatsapp/incoming` | `companies.is_active` fail-closed | Manter; garantir `blockCompany` seta `is_active=false` (já faz) |
| `/api/meta/messaging/incoming` | Verificar se checa `is_active` / billing | Auditar no P0.2; alinhar |

---

## P0 — Segurança e receita (bloqueante)

### P0.0 — Trial days configurável no platform (default 0)

**Objetivo:** uma fonte canônica de dias de trial, editável em `/platform`,
default **0** (pay-to-start).

**Migration** `supabase/migrations/YYYYMMDDHHMMSS_platform_billing_settings.sql`:

```sql
create table public.platform_billing_settings (
  id smallint primary key default 1 check (id = 1), -- singleton
  default_trial_days int not null default 0
    check (default_trial_days >= 0 and default_trial_days <= 90),
  updated_at timestamptz not null default now(),
  updated_by uuid null -- platform_users.id
);
-- FORCE RLS + revoke anon/authenticated + policy service_role_only
insert into public.platform_billing_settings (id, default_trial_days) values (1, 0);

-- CHECK status inclui pending_payment em pagarme_subscriptions (se houver constraint)
```

**Código:**
- `lib/billing/getDefaultTrialDays.ts` — lê settings; fallback env `TRIAL_DAYS` só se row ausente; clamp 0..90
- Remover `Math.max(1, …)` em `startFreeTrial.ts`
- `activateTrial.ts` — **parar** de hardcodar 30; usar `getDefaultTrialDays()` (ou deprecar path legado)
- `GET/PATCH /api/platform/billing/settings` — role `superadmin`/`billing`
- UI: `/platform/billing` ou `/platform/settings` — input “Dias de trial padrão”
- RPC opcional `rpc_platform_grant_trial(company_id, days, reason)` — override/estender por empresa (audit)
- Público: `GET /api/billing/trial-policy` → `{ trial_days }` (rate limit) p/ copy do `/signup` (sem `NEXT_PUBLIC_TRIAL_DAYS`)

**Signup (ligado a P0.7):**
- `N = getDefaultTrialDays()`
- `N === 0` → `status=pending_payment`, `trial_ends_at=now()`, gerar 1ª cobrança (invoice se setup=0)
- `N > 0` → `status=trial`, `trial_ends_at=now()+N`

**Resultado esperado:** platform altera para 7 → próximo signup ganha trial 7d; com 0 → 402 até pagar.

---

### P0.1 — Helper `requireBillingActive`

**Objetivo:** uma função testável com a matriz acima.

**Arquivos:**
- Criar `lib/billing/requireBillingActive.ts`
- Criar `tests/billing/requireBillingActive.test.ts` (matriz status × mode)

**Resultado esperado:** 100% dos estados da tabela cobertos por teste; sem I/O
real (mock admin).

---

### P0.2 — Integrar no guard central

**Objetivo:** toda rota que usa `requireCompanyAccess` / `requireCapability` /
`requireCompanyPlanFeature` passa a respeitar billing state.

**Arquivos:**
- `lib/workspace/requireCompanyAccess.ts` — opção `billing?: BillingGateMode`
  (default `"full"`)
- `lib/billing/requirePlanFeature.ts` — propagar falha 402 (não misturar com
  `plan_feature_required` 403)
- `app/api/billing/status|features|create-invoice-checkout|change-plan|allow-overage`
  — chamar com `billing: "billing_self"`
- `app/api/billing/change-plan` — rejeitar upgrade se `overdue`/`blocked` (D11)
- `tests/workspace/requireCompanyAccess.billing.test.ts` (novo)

**Não fazer:** varrer 80 rotas admin manualmente se o gate estiver no centro —
só auditar rotas que **não** usam esses helpers (grep `createAdminClient` sem
require*).

**Resultado esperado:** tenant `blocked` → `POST /api/admin/pdv/finalize` = 402;
`GET /api/billing/status` = 200.

---

### P0.3 — Fix IDOR `billing/status`

**Objetivo:** `company_id` na query só se o user for member **dessa** company
(ou remover o parâmetro).

**Arquivos:**
- `app/api/billing/status/route.ts`
- Teste: user company A + `?company_id=B` → 403

**Postura radical:** remover `?company_id=` se só o cookie for usado no admin;
platform usa `/api/platform/billing/*`.

---

### P0.4 — Block revoga entitlements

**Objetivo:** ao bloquear, features somem.

**Arquivos:**
- `app/api/billing/charge/route.ts` → `blockCompany`
- Webhook / reativação (`applyMonthlyInvoicePaid`, `activateAfterSetupPayment`)
  → `syncLogicalSubscription` já reativa; garantir `status=active` em
  `subscriptions`
- Migration opcional: CHECK / doc de status `subscriptions`:
  `active | suspended` (evitar string solta)

**Patch mínimo em `blockCompany`:**

```ts
await admin.from("subscriptions")
  .update({ status: "suspended" })
  .eq("company_id", companyId)
  .eq("status", "active");
```

**Resultado esperado:** após block, `hasFeature(..., "pdv")` === false mesmo
antes do 402 (defesa em profundidade).

---

### P0.5 — Webhook idempotência por order

**Objetivo:** evento sem `id` não reprocessa side effects.

**Arquivos:**
- `lib/billing/tryConsumePagarmeWebhookEvent.ts` — aceitar
  `consumeKey = eventId ?? \`${eventType}:${orderId}\``
- Unique em `pagarme_webhook_events.id` já cobre; garantir chave estável
- `app/api/billing/webhook/route.ts`
- Teste: dois `order.paid` sem `event.id`, mesmo `order.id` → segundo
  `duplicate: true`

---

### P0.6 — Checkout + cron sem double charge

**Objetivo:** no máximo **uma** invoice/setup `pending` por company.

**Migration** `supabase/migrations/YYYYMMDDHHMMSS_billing_pending_unique.sql`:

```sql
-- partial unique
create unique index if not exists uq_invoices_one_pending_per_company
  on public.invoices (company_id) where (status = 'pending');

create unique index if not exists uq_setup_one_pending_per_company
  on public.setup_payments (company_id) where (status = 'pending');
```

**Arquivos:**
- `app/api/billing/create-invoice-checkout/route.ts` — header/body
  `Idempotency-Key` (uuid client); store em metadata ou tabela curta
- `charge/route.ts` — tratar 23505 como “já existe, skip” (não criar 2ª order
  Pagar.me **depois** do insert falhar — ordem: claim row → create order →
  update)

**Ordem segura (radical):**

1. Insert pending com `pagarme_order_id` null (unique pega race)
2. Chamar Pagar.me
3. Update order_id / PIX
4. Se Pagar.me falhar → marcar failed / delete pending

---

### P0.7 — Signup RPC transacional

**Objetivo:** company + owner + trial + logical sub atômicos; sem user Auth órfão
sem company.

**Arquivo migration:** `rpc_signup_company_with_trial(...)`

- Inputs: name, cnpj, email, whatsapp, plan, auth_user_id (criado antes ou via
  edge — Auth Admin ainda fora do SQL)
- Alternativa pragmática pré-prod: manter createUser no route, mas **uma** RPC
  para insert company + company_users + pagarme trial + subscriptions; rollback
  `deleteUser` só se RPC falhar

**Semântica trial:** `pagarme_subscriptions.status=trial` +
`subscriptions.status=active` **documentado** (D3) — não “corrigir” trial
apagando features.

**Arquivos:**
- `app/api/billing/signup/route.ts`
- `lib/billing/startFreeTrial.ts` / sync — preferir chamada única RPC
- Testes integração signup

---

### P0.8 — Contrato de erro 402

**Arquivos:**
- `lib/api/errors.ts` — `codeFromStatus(402)`
- `docs/API_ERROR_CONTRACT.md` — documentar `billing_inactive`
- Helper `jsonBillingInactive(billingStatus)`

---

### P0.9 — Suite de testes matriz

**Casos mínimos:**

| # | Setup | Call | Expect |
|---|-------|------|--------|
| 1 | `blocked` | `POST /api/admin/pdv/finalize` | 402 |
| 2 | `blocked` | `GET /api/billing/status` | 200 |
| 3 | `overdue` | `POST /api/admin/pdv/finalize` | 200/valida negócio (não 402) |
| 4 | `trial` | `hasFeature(pdv_basic)` | true |
| 5 | pós-`blockCompany` | `hasFeature(financeiro_full)` | false |
| 6 | user A, `?company_id=B` | status | 403 |
| 7 | webhook dup order | 2º POST | `{duplicate:true}` |
| 8 | `overdue` | `change-plan` upgrade | 400 |

---

### P0.10 — Proxy paywall alinhado

**Arquivos:** `proxy.ts`

- Em `billingPaywall`, permitir só `/plano`, `/plano/pagar`, `/plano/bloqueado`,
  `/configuracoes?tab=plano` (compat), `/logout`, `/api` **não** é papel do
  proxy (API já gated)
- **Não** retornar `fresh` (cookie `renthus_access_ok`) quando o último status
  conhecido era paywall — ou: cookie só cacheia “allow”, nunca “blocked skip”
- Catch de rede: **fail-closed** para billing (redirect `/plano/bloqueado`) se
  houver cookie de workspace; log Sentry

**Nota:** P1 cria rotas `/plano*`; até lá manter redirect atual para
`/configuracoes?tab=plano`.

---

## P1 — UX (após P0 verde)

| # | Item | Estado |
|---|------|--------|
| P1.1 | Extrair hub `/plano` de `configuracoes` (status, PIX, cartão, AI wallet) | [x] 2026-08-28 |
| P1.2 | `/plano/bloqueado` + `/plano/pagar` | [x] 2026-08-28 |
| P1.3 | Banner overdue/trial no header (`HeaderClient`) | [x] 2026-08-28 |
| P1.4 | `/ativar` wizard (steps persistidos `companies.onboarding_step`) | [x] 2026-08-28 |
| P1.5 | Signup redirect: N=0 → `/plano/pagar`; N>0 → `/ativar` (parar de setar `onboarding_completed_at` no insert) | [x] 2026-08-28 |
| P1.6 | Client interceptor 402 → `/plano/bloqueado` | [x] 2026-08-28 |
| P1.7 | Invalidar `renthus_access_ok` após webhook pago / block | [x] N/A (cookie removido P0.10) |

Detalhe de steps `/ativar` (soft skip):

0. Boas-vindas  
1. Dados loja  
2. WhatsApp / Meta (Config → Canais)  
3. Produto mínimo  
4. Teste bot  
5. Concluir → `onboarding_completed_at`

---

## P2 — Consolidação e limpeza

| # | Item | Estado |
|---|------|--------|
| P2.1 | RPC/view `get_company_entitlements` (billing + features + addons) | [x] 2026-08-28 |
| P2.2 | `entitlements.ts` passa a usar RPC; deprecar dual-read | [x] 2026-08-28 |
| P2.3 | Remover `/signup/complete` + `onboarding_token` flow (após zero tenants) | [x] 2026-08-28 |
| P2.4 | Unificar `TRIAL_DAYS` (15 vs 30 em `activateTrial`) | [x] 2026-08-28 (já usa `getDefaultTrialDays`) |
| P2.5 | E-mail dunning dias 1/3/5 (além de WA) | [ ] adiado — sem provider de e-mail no repo |
| P2.6 | Docs: remover menções Stripe em `DB_CURRENT_STATE.md` | [x] 2026-08-28 |
| P2.7 | Cron charge: paginação / cursor (evitar timeout Vercel) | [x] 2026-08-28 |

---

## Sandbox Pagar.me (cartão + PIX)

Runbook: [`docs/SMOKE_BILLING_PAGARME_SANDBOX.md`](./SMOKE_BILLING_PAGARME_SANDBOX.md)

| # | Item | Estado |
|---|------|--------|
| S1 | Chaves `sk_test_` / `pk_test_` em `.env.local` + Vercel | [ ] |
| S2 | `npm run test:billing-sandbox` (API smoke) | [ ] |
| S3 | E2E cartão `/plano/pagar` | [ ] |
| S4 | E2E PIX + webhook | [ ] |
| S5 | PIX copia-e-cola (EMV) aparece na UI | [ ] fix 2026-08-28 — auth no decode QR + backfill |
| S6 | `/plano/pagar` standalone (sem sidebar) até pagar → `/ativar` | [ ] fix 2026-08-28 |

---

## Fora de escopo (não abrir neste checklist)

- Stripe / multi-PSP genérico (`PaymentGatewayPort` amplo)
- Overage WhatsApp cobrado automaticamente
- Multi-usuário billing (só owner paga — já ok)
- NFC-e / TEF

---

## Ordem de execução recomendada

```
P0.0 → P0.1 → P0.8 → P0.2 → P0.3 → P0.4 → P0.5 → P0.6 → P0.7 → P0.10 → P0.9
     → npm test verde
     → P1.*
     → P2.*
```

---

## Definition of Done (P0)

- [x] `default_trial_days=0` no platform; signup N=0 → `pending_payment` + 402 até pagar
- [x] Platform consegue alterar dias (ex.: 7) e próximo signup respeita
- [x] Tenant `blocked` não conclui venda PDV via API (402)
- [x] Tenant `blocked` / `pending_payment` consegue abrir status e gerar PIX
- [x] Grace overdue **não** libera never-paid (D18)
- [x] `?company_id=` cross-tenant impossível em billing/status
- [x] `blockCompany` deixa `hasFeature` false
- [x] Webhook/cron não duplicam cobrança sob retry
- [x] `npm test` verde
- [x] Migration remota aplicada + `execute_sql` de validação
- [x] Este checklist atualizado com datas `[x]`

---

## Apêndice — divergência trial (documentar, não “bugfix” em P0)

Hoje:

- `pagarme_subscriptions.status = 'trial'`
- `subscriptions.status = 'active'` (via `syncLogicalSubscription`)

Isso é **intencional sob D3**. Em P2, a RPC de entitlements deve expor
`billing_status` + `features[]` juntos para a UI (“Trial · Pro”) sem o client
adivinhar a partir de duas tabelas.
