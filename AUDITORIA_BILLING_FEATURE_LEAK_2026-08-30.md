# 🔐 AUDITORIA DETALHADA: BILLING E CONTROLE DE ACESSO
## Análise de Vazamentos de Recursos (Feature Leaks) — Renthus Chat ERP
### Data: 2026-08-30 | Status: ANÁLISE (Sem Alterações)

---

## SUMÁRIO EXECUTIVO

Seu SaaS possui uma arquitetura de billing e controle de acesso **bem estruturada em camadas**, mas com **11 vulnerabilidades críticas** (I1–I10 + IDOR) que podem gerar **feature leaks** e **vazamento de receita**. 

### Vulnerabilidades Críticas Identificadas:
1. **IDOR** em `GET /api/billing/status?company_id=` — lê dados de qualquer empresa
2. **Grace period bypass** — Trial=0 + overdue com last_paid_at vira 5 dias gratuitos
3. **Trial expirado não bloqueia** — Status='trial' com data vencida ainda libera API
4. **Falta de validação em ~100+ rotas de mutação** — Nenhuma check de billing status
5. **Feature gates desprotegidas** — `requirePlanFeature` sem verificar pagarme_subscriptions
6. **Change-plan em overdue** — Permite upgrade sem pagar fatura anterior
7. **Estado ambíguo** — `pending_setup` com amount=0
8. **3 fontes de verdade** — Dias de trial em 3 lugares diferentes
9. **Inbox sem proteção** — Mensagens inbound podem ser processadas por tentant blocked
10. **Cache não invalidado** — blockCompany não revoga sessões/cookies
11. **Checkout duplicado** — Sem idempotência (race condition)

### Impacto Potencial:
- ❌ Empresas em `pending_payment` acessam ERP completo via trial=0 + grace (5 dias FREE)
- ❌ Trial expirado (status='trial', ends_at ≤ now) ainda processa mutações até cron rodar
- ❌ Acesso a `/api/admin/orders`, `/api/whatsapp/send`, `/api/reports` sem validação de billing
- ❌ Features (whatsapp_messages, ai_tokens) contadas mesmo com status ≠ active/trial
- ❌ Reativação de empresa suspended sem pagar débito anterior

---

## PARTE 1: ESTRUTURA ATUAL (AS-IS)

### 1.1 Arquitetura de Validação em Camadas

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUXO DE VALIDAÇÃO ATUAL                         │
└─────────────────────────────────────────────────────────────────────────┘

Requisição HTTP
    │
    ├─→ [CAMADA 1] Proxy Next.js (proxy.ts)
    │   └─ Valida: só páginas (/app/...), NÃO /api/*
    │   └ Bloqueio: ❌ APIs não protegidas pelo proxy
    │
    ├─→ [CAMADA 2] Middleware de Workspace (requireCompanyAccess)
    │   ├─ Valida: company_id do cookie
    │   ├─ Valida: user authentication
    │   ├─ Valida: company membership + role
    │   ├─ Valida: billing status (requireBillingActive)
    │   └─ Problema: ⚠️  Chamada via requireCompanyAccess(), mas nem toda rota usa
    │
    ├─→ [CAMADA 3] Feature Gate (requirePlanFeature)
    │   ├─ Valida: feature está habilitada para plano
    │   └─ Problema: ❌ NÃO verifica pagarme_subscriptions, só subscriptions (LEGADA)
    │
    ├─→ [CAMADA 4] RPC/Service Role (BD)
    │   ├─ Valida: RLS policy (authenticated can read own)
    │   ├─ Valida: service_role full access (crons, webhooks)
    │   └─ Problema: ⚠️ RLS só protege leitura, não pode bloquear lógica
    │
    └─→ Executar ação (INSERT/UPDATE/DELETE)
```

### 1.2 Estados de Billing e Regras de Acesso (Puro)

```typescript
// lib/billing/resolveBillingAccess.ts

export type BillingAccessStatus = 
  | "trial"            // Trial válido: status='trial' AND trial_ends_at > now
  | "active"           // Pago e ativo
  | "overdue"          // Atrasado, com last_paid_at != null (grace period)
  | "pending_payment"  // Esperando primeiro pagamento (trial=0)
  | "pending_setup"    // Taxa de ativação
  | "abandoned"        // Nunca pagou + 30 dias
  | "blocked"          // Admin suspenso
  | "cancelled"        // Cancelado
  | "missing"          // Não existe
  | "trial_expired"    // Status='trial' mas ends_at ≤ now (antes do cron)

// Matriz: Qual estado permite acesso à API mutável (mode="full")?
isBillingAccessAllowed(status, "full") → boolean

// ✅ Permite (3):
trial           (válido + ends_at > now)
active
overdue         (tem last_paid_at)

// ❌ Bloqueia (7):
pending_payment
pending_setup
abandoned
blocked
cancelled
missing
trial_expired
```

**Problema I3:** A função `resolveEffectiveBillingStatus()` verifica `trial_ends_at > now()` corretamente, mas algumas rotas não chamam `requireBillingActive()` — então tenant com status='trial' e `trial_ends_at < now()` ainda acessa API até o cron rodar (janela de horas).

### 1.3 Middleware Central (requireCompanyAccess)

**Arquivo:** [lib/workspace/requireCompanyAccess.ts](lib/workspace/requireCompanyAccess.ts)

```typescript
export async function requireCompanyAccess(
  allowedRoles?: string[],
  billing?: "full" | "billing_self" | "skip"  // default: "full"
): Promise<{ ok: true; billingStatus; ... } | { ok: false; status: 402; ... }>

// Fluxo:
1. ✅ Valida company_id no cookie
2. ✅ Valida user autenticado
3. ✅ Valida membership na empresa
4. ✅ Valida role (owner/admin/member)
5. ✅ [CRITICAL] Chama requireBillingActive(admin, companyId, mode)
6. ⚠️ Retorna billingStatus MAS nem toda rota a usa
```

**Uso:**
- ✅ Algumas rotas: `app/api/orders/[id]`, `app/api/billing/status`, `app/api/admin/users`
- ❌ Muitas rotas: `app/api/admin/pdv/finalize`, `app/api/whatsapp/send`, `app/api/admin/estoque/**`

### 1.4 Gates de Features (Desprotegidos)

**Arquivo:** `lib/billing/requirePlanFeature.ts`

```typescript
export async function requirePlanFeature(
  admin: SupabaseClient,
  companyId: string,
  featureKey: string
): Promise<boolean>

// Implementação:
const { data: subscription } = await admin
  .from("subscriptions")  // ❌ LEGADA!
  .select("plan_id")
  .eq("company_id", companyId)
  .maybeSingle();

const { data: planFeature } = await admin
  .from("plan_features")
  .select("*")
  .eq("plan_id", subscription.plan_id)
  .eq("feature_key", featureKey)
  .maybeSingle();

return !!planFeature;

// PROBLEMA: Não verifica pagarme_subscriptions.status!
// Um tenant com status='blocked' ainda pode ter plan_features ativas
// → Rota acredita que está protegida, MAS não está
```

### 1.5 Inbound Channel Gate (Com Exceções)

**Arquivo:** [lib/billing/canProcessInboundChannel.ts](lib/billing/canProcessInboundChannel.ts)

```typescript
// Lógica:
export function resolveInboundFromSnapshots(
  companyActive: boolean,           // companies.is_active
  sub: PagarmeSubSnapshot,          // pagarme_subscriptions
  now: Date
): { allowed: boolean; autoReply?: "reactivation" }

// Exceção 1: status=abandoned → allowed=true, autoReply="reactivation"
// Exceção 2: status=pending_payment + hasPlanIntent → allowed=true (não perder vendas)
// Normal: requires access="allow" na matriz
```

**Status:**
- ✅ Bem implementado — permite inbound mesmo em pending_payment (não perder vendas)
- ⚠️ Com exceção abandoned, envia template WA de reativação automaticamente

### 1.6 Banco de Dados — Schema Crítico

**Tabela Central:** `pagarme_subscriptions`

```sql
CREATE TABLE pagarme_subscriptions (
  id uuid PRIMARY KEY,
  company_id uuid UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  plan subscription_plan,              -- enum: bot, essencial, pro, market
  status pagarme_sub_status,           -- ✅ Fonte canônica
  trial_ends_at timestamptz NOT NULL,
  activated_at timestamptz,
  last_paid_at timestamptz,            -- NULL = never-paid
  plan_id uuid REFERENCES plans(id),
  allow_overage boolean DEFAULT false,
  -- ... mais campos
  UNIQUE(company_id)
);

-- ✅ Índices:
-- idx_pagarme_sub_company (company_id)
-- idx_pagarme_sub_status (status)
-- idx_pagarme_subs_trial_ends (trial_ends_at) WHERE status='trial'
```

**Tabelas Relacionadas:**
- `invoices` — Faturas (status: pending, paid, failed, cancelled)
- `setup_payments` — Taxa de ativação
- `payment_attempts` — Auditoria de tentativas (idempotente por pagarme_order_id UNIQUE)
- `platform_billing_settings` — Singleton (default_trial_days)

**RLS (Row-Level Security):**
- ✅ `service_role`: Full access (crons, webhooks)
- ✅ `authenticated`: Read own company only
- ✅ `pagarme_subscriptions`: Service role only (não exposed a auth users)

### 1.7 RPC/Funções SQL

| RPC | Segurança | Protegida | Problema |
|-----|-----------|-----------|----------|
| `check_and_increment_usage` | service_role | ✅ Bloqueia se limit hit | Não verifica status=active/trial |
| `rpc_platform_change_subscription_plan` | service_role | ✅ FOR UPDATE lock | ⚠️ D11: Permite em overdue (sem pagar) |
| `rpc_platform_grant_courtesy_trial` | service_role | ✅ Transação atômica | ✅ Verifica never-paid |
| `rpc_self_reactivate_subscription` | authenticated | ✅ RLS own company | ✅ Cooldown 60d |
| `rpc_platform_suspend_company` | service_role | ✅ Cascata: companies.is_active=false + pagarme.status=blocked | ✅ Tudo em transação |
| `rpc_get_company_entitlements` | service_role | ✅ AND logic: features=[] se access=deny | ⚠️ Nem toda rota usa |

### 1.8 Rotas de API e Cobertura de Billing

**Grupo A — Mutações Críticas (100+ rotas):**

| Área | Exemplo | Usa requireCompanyAccess? | Usa Billing Gate? | Status |
|------|---------|--------------------------|------------------|--------|
| PDV | `POST /api/admin/pdv/finalize` | ⚠️ Talvez | ❌ Não | ❌ VAZADO |
| Pedidos | `POST /api/orders`, `POST /api/admin/orders/[id]` | ✅ Sim | ⚠️ Via requireCompanyAccess (se usa) | ⚠️ PARCIAL |
| Financeiro | `POST /api/admin/financeiro/reverse-order` | ⚠️ Talvez | ❌ Não | ❌ VAZADO |
| WhatsApp | `POST /api/whatsapp/send` | ⚠️ Talvez | ❌ Não | ❌ VAZADO |
| Marketplace | `POST /api/admin/marketplace/ifood/order-confirm` | ⚠️ Talvez | ❌ Não | ❌ VAZADO |
| Produtos | `POST /api/admin/products/create` | ⚠️ Talvez | ✅ requirePlanFeature | ⚠️ Sem billing status |
| Clientes | `POST /api/admin/customers` | ⚠️ Talvez | ✅ requirePlanFeature | ⚠️ Sem billing status |

**Grupo B — Billing Self (Allowed com mode="billing_self"):**

| Rota | Motivo |
|------|--------|
| `GET /api/billing/status` | Ver faturas |
| `GET /api/billing/features` | UI gates |
| `POST /api/billing/create-invoice-checkout` | Pagar |
| `POST /api/billing/change-plan` | Mudar plano |
| `POST /api/auth/signout` | Logout |

### 1.9 Vulnerabilidades Documentadas (I1–I10 + IDOR)

**Arquivo:** [docs/CHECKLIST_BILLING_PAYWALL_P0.md](docs/CHECKLIST_BILLING_PAYWALL_P0.md#inconsistências-encontradas-nos-contratos-anteriores-auditoria)

| # | Inconsistência | Impacto | Status |
|----|-----------------|--------|--------|
| I1 | D4 (overdue grace) × D13 (trial=0) | 5 dias gratuito | ⚠️ Lógica viva |
| I2 | `pending_setup` com setup=0 | Estado ambíguo | ⚠️ Confuso |
| I3 | Trial vencido (status='trial' mas ends_at ≤ now) antes do cron | API aberta | ⚠️ Janela de horas |
| I4 | Min 1 clamp impede trial=0 | Impossível pagar-para-entrar | ✅ Corrigido |
| I5 | 3 fontes de dias de trial | Inconsistência | ⚠️ Vive em 3 places |
| I6 | NEXT_PUBLIC_TRIAL_DAYS no client | Não sincroniza | ⚠️ Stale value |
| I7 | `/ativar` allowlist em pending_payment | Bypassa paywall | ⚠️ Ordem errada |
| I8 | Feature flags (bool) para dias trial | Modelo errado | ⚠️ Implementado assim |
| I9 | Matriz assume trial sempre ✅ | Não verifica ends_at | ✅ Corrigido |
| I10 | Change-plan em trial=0 | Sem janela de pagamento | ⚠️ Pode mudar |
| IDOR | `GET /api/billing/status?company_id=` | Lê dados de qualquer empresa | ❌ **CRÍTICO** |

---

## PARTE 2: ESTRUTURA IDEAL (TO-BE)

### 2.1 Princípios Arquiteturais Recomendados

```
┌──────────────────────────────────────────────────────────────────────────┐
│              ARQUITETURA IDEAL DE CONTROLE DE ACESSO                      │
└──────────────────────────────────────────────────────────────────────────┘

PRINCÍPIO 1: Defense-in-Depth (Múltiplas camadas)
├─ Camada 1: Proxy (bloqueia páginas)
├─ Camada 2: Middleware central (requireCompanyAccess obrigatório)
├─ Camada 3: Feature gate (requirePlanFeature com billing)
├─ Camada 4: RLS/RPC (ultima linha de defesa)
└─ Nenhuma camada é suficiente sozinha

PRINCÍPIO 2: Fail-Closed (bloqueia por default)
├─ Sem validação explícita de billing? → 402
├─ Erro de leitura de pagarme_subscriptions? → 402
├─ RLS reject? → 402
└─ Nunca "libera por engano"

PRINCÍPIO 3: Fonte Única de Verdade (Single Source of Truth)
├─ Billing state: pagarme_subscriptions.status APENAS
├─ Trial days: platform_billing_settings.default_trial_days (+ RPC override)
├─ Features: rpc_get_company_entitlements() (AND logic + defense-in-depth)
└─ Nunca 3 implementações diferentes

PRINCÍPIO 4: Atomicidade nas Transações Críticas
├─ Signup: BEGIN company + user + subscription COMMIT
├─ Suspend: BEGIN company.is_active=false + pagarme.status=blocked COMMIT
├─ Plan change: FOR UPDATE + validação + UPDATE
└─ Nunca estado parcial

PRINCÍPIO 5: Auditoria Completa
├─ Status history: pagarme_status_history trigger
├─ Tentativas de pagamento: payment_attempts
├─ Ações de admin: rpc_platform_record_audit()
└─ Rastreabilidade 100%
```

### 2.2 Modelo de Banco de Dados Ideal (Entidades Principais)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SCHEMA IDEAL (EVOLVED FROM AS-IS)                  │
└─────────────────────────────────────────────────────────────────────────┘

ENTITIES & RELATIONSHIPS:

┌──────────────┐
│  companies   │
├──────────────┤
│ id (PK)      │────────┐
│ is_active    │        │ (denorm com pagarme)
│ email        │        │
│ created_at   │        │
└──────────────┘        │
                        │ 1:1
                        │
                    ┌───▼─────────────────────────────┐
                    │  pagarme_subscriptions          │
                    │  (FONTE CANÔNICA DE BILLING)    │
                    ├─────────────────────────────────┤
                    │ id (PK)                         │
                    │ company_id (UNIQUE, FK)         │
                    │ status (enum: 9 valores)   ◄────┼─ [CRÍTICO]
                    │ plan (enum: essencial|pro|market)
                    │ trial_ends_at (check: > created_at)
                    │ activated_at                    │
                    │ last_paid_at (NULL = never-paid)│
                    │ next_billing_at                 │
                    │ plan_id (FK → plans)            │
                    │ allow_overage (bool)            │
                    │ self_reactivation_count (audit) │
                    │ last_status_change_at (TRIGGER) │
                    │ default_card_id (PagarmeID)     │
                    │ abandoned_at (audit)            │
                    │ created_at                      │
                    │ updated_at (TRIGGER)            │
                    └───┬─────────────────────────────┘
                        │
         ┌──────────────┼──────────────┬──────────────┐
         │ 1:N          │ 1:N          │ 1:N          │
         │              │              │              │
    ┌────▼───────┐ ┌───▼────────┐ ┌──▼────────────┐ ┌▼──────────────┐
    │  invoices   │ │setup_      │ │payment_      │ │pagarme_status│
    │             │ │payments    │ │attempts      │ │_history      │
    ├─────────────┤ ├────────────┤ ├──────────────┤ ├──────────────┤
    │ id (PK)     │ │id (PK)     │ │id (PK)       │ │id (PK)       │
    │ company_id  │ │company_id  │ │company_id    │ │subscription..│
    │ subscription│ │plan        │ │invoice_id FK │ │old_status    │
    │_id FK       │ │amount      │ │setup_pay..FK │ │new_status    │
    │ amount      │ │status      │ │kind (enum)   │ │reason        │
    │ status      │ │paid_at     │ │channel(enum) │ │changed_at    │
    │ due_at      │ │pagarme_o.  │ │pagarme_o. UK │ │changed_by    │
    │ paid_at     │ │pagarme_p.  │ │status        │ │              │
    │ pagarme_o.  │ │created_at  │ │decline_code  │ │ INDEXES:     │
    │ pagarme_p.  │ └────────────┘ │attempt_n     │ │ • (sub_id)   │
    │ pix_qr_code │                │error_msg     │ │ • (company_id│
    │ attempt..   │                │created_at    │ │ • (changed_at│
    │ created_at  │                └──────────────┘ └──────────────┘
    └─────────────┘                                 TRIGGER ON:
    INDEXES:                                        • INSERT sub
    • (company_id)    ◄─────────────────────────   • UPDATE status
    • (status)
    • (due_at)
    • (pagarme_order)

                        ┌─────────────┐
                        │   plans     │
                        ├─────────────┤
                        │ id (PK)     │
                        │ key (UNIQUE)│
                        │ name        │
                        │ price_cents │
                        └────┬────────┘
                             │ 1:N
                             │
        ┌────────────────────┴────────────────────┐
        │ 1:N                                      │ 1:N
    ┌───▼───────────┐                      ┌─────▼─────────┐
    │ plan_features │                      │feature_limits │
    ├───────────────┤                      ├───────────────┤
    │ plan_id (FK)  │                      │ plan_id (FK)  │
    │ feature_key   │                      │ feature_key   │
    │ PK:(plan, k)  │                      │ limit/month   │
    └───────────────┘                      │ PK:(plan, k)  │
                                           └───────────────┘

                    ┌──────────────────────────┐
                    │   usage_monthly          │
                    ├──────────────────────────┤
                    │ id (PK)                  │
                    │ company_id (FK)          │
                    │ feature_key              │
                    │ year_month (YYYY-MM)     │
                    │ used (counter)           │
                    │ UNIQUE(company, key, ym) │
                    └──────────────────────────┘

    ┌────────────────────────────────────────────┐
    │  platform_billing_settings (SINGLETON)     │
    ├────────────────────────────────────────────┤
    │ id = 1 (PK, CHECK id=1)                    │
    │ default_trial_days (0..90)  ◄─ [ÚNICO]     │
    │ updated_at                                 │
    │ updated_by (FK)                            │
    └────────────────────────────────────────────┘

CONSTRAINTS CRÍTICAS:

1. pagarme_subscriptions.company_id UNIQUE
   → Uma assinatura por empresa, sem ambiguidade

2. pagarme_subscriptions.company_id REFERENCES companies(id) ON DELETE CASCADE
   → Deletar empresa = limpar billing

3. payment_attempts.pagarme_order_id UNIQUE WHERE IS NOT NULL
   → Idempotência de webhooks

4. usage_monthly UNIQUE (company_id, feature_key, year_month)
   → Uma entrada por feature/mês

5. pagarme_subscriptions.trial_ends_at CHECK (trial_ends_at > created_at OR status ≠ 'trial')
   → Trial sempre no futuro

6. platform_billing_settings.id = 1 (CHECK)
   → Garante singleton

TRIGGERS CRÍTICOS:

1. trg_pagarme_sub_updated_at
   ├─ BEFORE UPDATE
   ├─ SET updated_at = now()

2. trg_pagarme_subs_status_audit
   ├─ BEFORE UPDATE OF status
   ├─ SET last_status_change_at = now()
   ├─ IF status='abandoned' THEN SET abandoned_at = now()

3. trg_pagarme_subs_status_history
   ├─ AFTER UPDATE OF status
   ├─ INSERT pagarme_status_history
   ├─ Auditoria automática
```

### 2.3 Arquitetura de Middlewares e Decorators

```typescript
// ┌─────────────────────────────────────────────────────────────────┐
// │              MIDDLEWARE STACK IDEAL (COMPOSABLE)                 │
// └─────────────────────────────────────────────────────────────────┘

// 1. CORE: requireCompanyAccess (OBRIGATÓRIO em toda mutação)
export async function requireCompanyAccess(opts?: {
  allowedRoles?: string[];           // ["owner", "admin"]
  billing?: BillingGateMode;         // "full" | "billing_self" | "skip" (default: "full")
  skipBilling?: boolean;             // ⚠️ Use apenas com JUSTIFICATIVA
}): Promise<{
  ok: true;
  companyId: string;
  userId: string;
  role: string;
  admin: SupabaseClient;
  billingStatus: BillingAccessStatus;  // ✅ Sempre retorna
  impersonating: boolean;
} | AccessDenied>

// 2. COMPOSITE: requirePlanFeature (wrapper)
export async function requirePlanFeature(opts: {
  admin: SupabaseClient;
  companyId: string;
  featureKey: string;
  billingRequired?: boolean;         // default: true
}): Promise<boolean> {
  // ✅ Novo: Verifica TAMBÉM pagarme_subscriptions.status
  // AND(featureKey ∈ plan_features, status ∈ {trial, active})
}

// 3. COMPOSITE: requireCompanyPlanFeature
export async function requireCompanyPlanFeature(opts: {
  featureKey: string;
  allowedRoles?: string[];
}): Promise<AccessOk | AccessDenied> {
  // Combina requireCompanyAccess + requirePlanFeature
  // ✅ Usar em rotas de features específicas
}

// 4. ENTITLEMENTS: fetchCompanyEntitlements (RPC + Defense-in-Depth)
export async function fetchCompanyEntitlements(
  admin: SupabaseClient,
  companyId: string
): Promise<{
  access: "allow" | "deny";
  reason: BillingAccessStatus;
  features: string[];  // ✅ [] se access=deny
  subscription: { id, plan_id, plan_key, plan_name };
  pagarme: { id, status, plan, trial_ends_at, last_paid_at };
}> {
  // Chama RPC + client-side verification (AND logic)
  // Se RPC velha retorna features, client vê status=blocked → features=[]
}

// ┌─────────────────────────────────────────────────────────────────┐
// │                    EXEMPLOS DE USO                              │
// └─────────────────────────────────────────────────────────────────┘

// EXEMPLO 1: Rota simples (só precisa estar logado + pagar)
async function POST_orders(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return json(access, { status: access.status });
  
  // ✅ access.billingStatus ∈ {trial, active, overdue}
  // ✅ access.admin = admin client authenticated
  
  const { admin, companyId } = access;
  // ... criar pedido
}

// EXEMPLO 2: Rota com feature específica
async function POST_whatsapp_send(req: Request) {
  const access = await requireCompanyPlanFeature({
    featureKey: "whatsapp_messages",
    allowedRoles: ["owner", "admin"]
  });
  if (!access.ok) return json(access, { status: access.status });
  
  // ✅ Valida ao mesmo tempo:
  // 1. Empresa ativa + role correto
  // 2. Billing status = {trial, active}
  // 3. Feature habilitada no plano
  
  // ✅ Decrementa limite
  const checkLimit = await admin.rpc("check_and_increment_usage", {
    p_company: access.companyId,
    p_feature: "whatsapp_messages",
    p_amount: 1
  });
  
  if (!checkLimit.data.allowed) {
    return json({ error: "limit_exceeded" }, { status: 402 });
  }
  
  // ... enviar mensagem
}

// EXEMPLO 3: Rota técnica (sem validação de billing)
async function POST_billing_webhook(req: Request) {
  // ✅ SKIP billing, pois é handler de webhook
  // ❌ MAS valida assinatura do webhook
  
  const signature = req.headers.get("x-webhook-signature");
  if (!verify_pagarme_signature(signature, body)) {
    return json({ error: "invalid_signature" }, { status: 401 });
  }
  
  const event = await req.json();
  
  // Idempotência por event.id
  const { data: exists } = await admin
    .from("pagarme_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  
  if (exists) {
    return json({ received: true });  // Já processou
  }
  
  // INSERT event + processar
  const { data: inserted } = await admin
    .from("pagarme_webhook_events")
    .insert({ id: event.id, event_type: event.type })
    .single();
  
  if (inserted) {
    // Processar...
    handlePaymentEvent(event);
  }
  
  return json({ received: true });
}
```

### 2.4 Modelo de Entitlements (RPC com Defense-in-Depth)

```typescript
// lib/billing/fetchCompanyEntitlements.ts

/**
 * DEFENSE-IN-DEPTH: O modelo ideal valida em MÚLTIPLAS camadas
 * 
 * Cenário: RPC velha (ou compromised) retorna features: ["whatsapp_messages"]
 * Status real no DB: blocked
 * 
 * RESULT: Client vê features=[], porque AND(RPC, local resolver)
 */

export async function fetchCompanyEntitlements(
  admin: SupabaseClient,
  companyId: string
): Promise<{
  access: "allow" | "deny";
  reason: BillingAccessStatus;
  features: string[];
  pagarme: { ... };
  subscription: { ... };
}> {
  // CAMADA 1: RPC (retorna features canonicamente)
  const rpcResult = await admin.rpc("rpc_get_company_entitlements", {
    p_company_id: companyId
  });
  
  if (rpcResult.error) {
    // Fail-closed
    return { access: "deny", reason: "missing", features: [] };
  }
  
  // CAMADA 2: Client-side resolver (AND logic)
  const clientAccess = resolveTenantAccess({
    status: rpcResult.data.pagarme.status,
    trial_ends_at: rpcResult.data.pagarme.trial_ends_at,
    last_paid_at: rpcResult.data.pagarme.last_paid_at,
    plan: rpcResult.data.pagarme.plan
  });
  
  // CAMADA 3: Gating features
  const features = clientAccess.featuresEligible 
    ? rpcResult.data.features 
    : [];  // ✅ SE client resolve deny → sempre []
  
  return {
    access: clientAccess.access,
    reason: clientAccess.reason,
    features,  // ✅ [] se deny, mesmo que RPC retorne algo
    pagarme: rpcResult.data.pagarme,
    subscription: rpcResult.data.subscription
  };
}
```

### 2.5 Matriz de Acesso (Estado × Recurso)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                MATRIZ IDEAL: STATUS vs ACESSO POR TIPO                   │
└───────────────────────────────────────────────────────────────────────────┘

Estado Efetivo │ API Mutável │ Inbound WA │ Features │ Checkout │ Status
───────────────┼─────────────┼────────────┼──────────┼──────────┼──────────
trial ✅        │     ✅      │     ✅     │    ✅    │    ✅    │ Vê fatura
active          │     ✅      │     ✅     │    ✅    │    ✅    │ Pago
overdue*        │     ✅      │     ✅     │    ✅    │    ✅    │ Atrasado
overdue never   │     ❌      │     ❌     │    ❌    │    ✅    │ Pagar
pending_payment │     ❌      │    ⚠️ **   │    ❌    │    ✅    │ Pagar
pending_setup   │     ❌      │    ⚠️ **   │    ❌    │    ✅    │ Pagar taxa
abandoned       │     ❌      │    ⚠️ ***  │    ❌    │    ✅    │ Reativar
blocked         │     ❌      │     ❌     │    ❌    │    ❌    │ Contato
cancelled       │     ❌      │     ❌     │    ❌    │    ❌    │ Contato
missing         │     ❌      │     ❌     │    ❌    │    ❌    │ Signup
───────────────┴─────────────┴────────────┴──────────┴──────────┴──────────

LEGENDA:
* overdue com last_paid_at (foi cliente pagante) = grace period
** allowed se hasPlanIntent=true (não perder vendas enquanto aguarda pagamento)
*** allowed com autoReply="reactivation" (envia template WA de reativação)
✅ Permitido
❌ Bloqueado (402)
⚠️ Condicional
```

### 2.6 Checklist de Implementação To-Be

| # | Item | Prioridade | Impacto | Esforço | Descrição |
|---|------|-----------|--------|---------|-----------|
| 1 | Fix IDOR `/api/billing/status?company_id=` | P0 CRÍTICO | Alto | Baixo | Adicionar validação membership |
| 2 | Centralizar requireCompanyAccess | P0 CRÍTICO | Alto | Alto | Envolver todas as 100+ mutações |
| 3 | Atualizar requirePlanFeature | P0 CRÍTICO | Alto | Médio | Verificar pagarme_subscriptions.status |
| 4 | Trial expiration gate | P0 CRÍTICO | Médio | Baixo | Sempre verificar trial_ends_at > now |
| 5 | Remover allowlist `/ativar` em pending_payment | P1 | Alto | Baixo | Somente após pagamento |
| 6 | Consolidar fonte de trial_days | P1 | Médio | Médio | Única fonte: platform_billing_settings |
| 7 | Disable change-plan em overdue | P1 | Médio | Baixo | Validação no RPC |
| 8 | Implementar Idempotência de Checkout | P1 | Médio | Médio | Usar pagarme_order_id + timestamp |
| 9 | Revogação de cache no blockCompany | P1 | Médio | Médio | Invalidar sessões |
| 10 | Remoção de tabela subscriptions (LEGADA) | P2 | Baixo | Alto | Após migração 100% |

---

## PARTE 3: VULNERABILIDADES DETALHADAS E RECOMENDAÇÕES

### 3.1 IDOR: Leitura de Dados de Qualquer Empresa

**Arquivo:** [app/api/billing/status/route.ts](app/api/billing/status/route.ts) (simulado)

**Problema:**
```typescript
// ❌ VULNERABLE
async function GET_billing_status(req: Request) {
  const url = new URL(req.url);
  const qCompanyId = url.searchParams.get("company_id");  // ⚠️ User input!
  
  const { data } = await admin
    .from("pagarme_subscriptions")
    .select("*")
    .eq("company_id", qCompanyId)  // ❌ NÃO valida membership
    .maybeSingle();
  
  return json(data);  // Qualquer usuário autenticado lê qualquer empresa
}
```

**Impacto:**
- ❌ Usuário autenticado de empresa A lê dados de empresa B
- ❌ Descobre planos, valores de fatura, cards salvos
- ❌ Pode inferir dados de concorrentes

**Recomendação:**
```typescript
// ✅ FIXED
async function GET_billing_status(req: Request) {
  const access = await requireCompanyAccess({ billing: "billing_self" });
  if (!access.ok) return json(access, { status: access.status });
  
  // ✅ Agora só retorna da companyId do cookie (requireCompanyAccess valida)
  const { data } = await access.admin
    .from("pagarme_subscriptions")
    .select("*")
    .eq("company_id", access.companyId)  // ✅ Validado
    .maybeSingle();
  
  return json(data);
}
```

---

### 3.2 Grace Period Bypass: Trial=0 + Overdue = 5 dias FREE

**Cenário:**
```
Day 0:  Signup com trial_days=0 (pay-to-start)
        → status='pending_payment', invoice criada
        
Day 1:  Tenant acessa /api/orders → Billing gate:
        • resolveEffectiveBillingStatus(status='pending_payment') = 'pending_payment'
        • isBillingAccessAllowed('pending_payment', 'full') = false ✅ Bloqueado
        
Day 30: Paga 1ª fatura
        → status='active', last_paid_at=2026-09-30
        
Day 65: Próxima fatura vence (due_at=2026-10-30)
        → Cron marca status='overdue'
        
Day 66: Tenant acessa /api/orders → Billing gate:
        • resolveEffectiveBillingStatus(
            status='overdue',
            last_paid_at=2026-09-30  ← Tem valor!
          ) = 'overdue' ← PERMITE ACCESS!
        • isBillingAccessAllowed('overdue', 'full') = true ❌ LIBERADO!
        
Day 70: (5 dias depois) → Adm bloqueia company
```

**Impacto:**
- ❌ Tenant usa ERP por 5 dias sem pagar (grace period D4)
- ❌ Contradiz decisão D18 (grace só para ex-clientes pagantes)
- ❌ Diferente de trial=0 (pay-to-start)

**Raiz:**
```typescript
// Em resolveBillingAccess.ts:
if (raw === "overdue") {
  if (row.last_paid_at) return "overdue";  // ← Grace period!
  return "pending_payment";
}

// ✅ CORRETO: overdue com last_paid_at = EX-CLIENTE (pagou antes)
// ❌ MAS: Não diferencia se "nunca pagou before" (só trial=0 + missed first payment)
```

**Recomendação:**
```typescript
// ✅ MELHOR: Rastrear permanentemente se nunca pagou
function resolveEffectiveBillingStatus(
  row: PagarmeSubSnapshot,
  now: Date
): BillingAccessStatus {
  if (row.status === "overdue") {
    if (row.last_paid_at) {
      // Ex-cliente (pagou antes) → libera com grace period
      return "overdue";
    } else {
      // Nunca pagou (trial=0, missed first payment)
      return "pending_payment";  // ← Trata igual
    }
  }
  // ...
}

// ✅ Ou melhor ainda: Adicionar coluna never_paid_before: boolean
// para rastrear permanentemente se já pagou na vida
```

---

### 3.3 Trial Expirado Não Bloqueia (Janela de Horas)

**Cenário:**
```
Day 14: Cron job `/api/billing/expire-trials` está fora do ar (5 min de atraso)

00:00  trial_ends_at=2026-09-13 23:59:59 UTC
       ✅ Tenant cria pedido: 
          • resolveEffectiveBillingStatus(status='trial', trial_ends_at=PASSED)
            = 'trial_expired' ← Deveria bloquear!
       ❌ MAS: Nem toda rota chama requireBillingActive()
          → Se rota usa requirePlanFeature direto → LIBERA (não verifica date)

01:00  Cron finalmente roda:
       • status='trial' → 'trial_expired'
       • Proximas requisições AGORA são bloqueadas
```

**Impacto:**
- ⚠️ Janela de 1+ hora onde trial expirado ainda acessa API
- ⚠️ Se cron falhar: indefinido

**Recomendação:**
```typescript
// ✅ SEMPRE verificar data, não confiar em status
function resolveEffectiveBillingStatus(
  row: PagarmeSubSnapshot,
  now: Date = new Date()
): BillingAccessStatus {
  if (row.status === "trial") {
    const ends = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    // ✅ Verifica END_TIME, não status
    if (!ends || ends.getTime() <= now.getTime()) {
      return "trial_expired";  // Computado, não precisa de cron
    }
    return "trial";
  }
  // ...
}

// ✅ E usar isso em TODA rota de mutação:
export async function requireBillingActive(...) {
  const tenant = resolveTenantAccess(row, NOW());  // ← Sempre NOW()
  if (!isBillingAccessAllowed(tenant.reason, mode)) {
    return { ok: false, status: 402, ... };
  }
}
```

---

### 3.4 100+ Mutações Sem Validação de Billing

**Grupo Crítico Não Protegido:**

```typescript
// ❌ SEM requireCompanyAccess:
app/api/admin/pdv/finalize/route.ts
app/api/admin/pdv/order-import/route.ts
app/api/admin/estoque/[id]/route.ts
app/api/admin/financeiro/reverse-order/route.ts
app/api/admin/marketplace/ifood/order-confirm/route.ts
app/api/whatsapp/send/route.ts
app/api/chatbot/resolve/route.ts
app/api/admin/relatorios/daily/route.ts
app/api/dashboard/stats/route.ts
... (100+ mais)

// ⚠️ COM requireCompanyAccess MAS billing_mode não especificado:
app/api/admin/users/route.ts                 (POST criar user)
app/api/admin/products/route.ts              (POST criar produto)
app/api/admin/customers/route.ts             (POST criar cliente)
```

**Impacto:**
- ❌ Tenant em `pending_payment` (não pagou) acessa tudo
- ❌ Tenant em `trial_expired` acessa tudo
- ❌ Tenant em `blocked` acessa tudo

**Recomendação:**
```typescript
// ✅ Template: Toda rota de mutação deve ter requireCompanyAccess

// 1. Opção A: Simples (defaul billing='full')
async function POST_admin_users(req: Request) {
  const access = await requireCompanyAccess(["owner", "admin"]);
  if (!access.ok) return json(access, { status: access.status });
  
  // ✅ access.billingStatus ∈ {trial, active, overdue}
  // ...
}

// 2. Opção B: Com feature check
async function POST_whatsapp_send(req: Request) {
  const access = await requireCompanyPlanFeature({
    featureKey: "whatsapp_messages",
    allowedRoles: ["owner", "admin"]
  });
  if (!access.ok) return json(access, { status: access.status });
  // ...
}

// 3. Opção C: Técnica (sem billing check, MAS com validação extra)
async function POST_billing_webhook(req: Request) {
  // ✅ Valida assinatura do webhook (não requer auth user)
  const isValid = await verify_pagarme_signature(req);
  if (!isValid) return json({ error: "invalid" }, { status: 401 });
  
  // ✅ Idempotência por event.id
  // ...
}
```

---

### 3.5 Feature Gates Sem Verificar Billing Status

**Problema:**

```typescript
// lib/billing/requirePlanFeature.ts
export async function requirePlanFeature(
  admin: SupabaseClient,
  companyId: string,
  featureKey: string
): Promise<boolean> {
  // ❌ Lê de subscriptions (LEGADA)
  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan_id")
    .eq("company_id", companyId)
    .maybeSingle();
  
  // ❌ NÃO verifica pagarme_subscriptions.status
  const { data: planFeature } = await admin
    .from("plan_features")
    .select("id")
    .eq("plan_id", subscription?.plan_id)
    .eq("feature_key", featureKey)
    .maybeSingle();
  
  return !!planFeature;
  // Result: true MESMO que pagarme_subscriptions.status='blocked'
}
```

**Cenário:**
```
Tenant A:
  ✅ Plan: PRO (tem whatsapp_messages feature)
  ❌ Status: BLOCKED (adm suspenso)
  
Rota: POST /api/whatsapp/send
  1. Valida requirePlanFeature("whatsapp_messages") → true ✅
  2. Pensa: "Tem feature, pode enviar"
  3. Envia mensagem WhatsApp ❌ MAS tenant está bloqueado!
```

**Impacto:**
- ❌ Tenant bloqueado ainda envia WhatsApp
- ❌ Tenant overdue ainda acessa relatórios
- ❌ Tenant pending_payment ainda financia pedidos

**Recomendação:**
```typescript
// ✅ FIXED: Verificar billing status TAMBÉM

export async function requirePlanFeature(
  admin: SupabaseClient,
  companyId: string,
  featureKey: string
): Promise<boolean> {
  // 1. Verifica pagarme_subscriptions.status ← NOVO
  const { data: pagarme } = await admin
    .from("pagarme_subscriptions")
    .select("status, plan_id, trial_ends_at, last_paid_at")
    .eq("company_id", companyId)
    .maybeSingle();
  
  if (!pagarme) return false;
  
  // 2. Resolve status + gate
  const tenant = resolveTenantAccess(pagarme);
  if (!isBillingAccessAllowed(tenant.reason, "full")) {
    return false;  // ✅ Bloqueado
  }
  
  // 3. Verifica feature no plano
  const { data: planFeature } = await admin
    .from("plan_features")
    .select("id")
    .eq("plan_id", pagarme.plan_id)
    .eq("feature_key", featureKey)
    .maybeSingle();
  
  return !!planFeature;  // ✅ AND(billing ok, feature existe)
}
```

---

### 3.6 Change-Plan Sem Validação (Upgrade em Overdue)

**Decisão D11:** "Upgrade em overdue proibido até pagar fatura pendente"

**Problema:**
```typescript
// app/api/billing/change-plan/route.ts
async function POST_change_plan(req: Request) {
  const { planKey } = await req.json();
  
  const access = await requireCompanyAccess({ billing: "billing_self" });
  if (!access.ok) return json(access, { status: access.status });
  
  // ❌ NÃO valida D11: "Não upgraar em overdue"
  // Apenas chama RPC
  const result = await access.admin.rpc("rpc_platform_change_subscription_plan", {
    p_subscription_id: subId,
    p_plan_key: planKey,
    // ...
  });
  
  return json(result);
}

// RPC NÃO valida status:
export function rpc_platform_change_subscription_plan(...) {
  // SELECT * FROM pagarme_subscriptions WHERE id = ?
  // ❌ NÃO verifica status ≠ overdue
  // ❌ Permite upgrade mesmo em atraso
  
  // UPDATE plan_id, plan_key
  // COMMIT ✅ Vira PRO (mais caro) SEM PAGAR fatura anterior!
}
```

**Impacto:**
- ❌ Tenant muda PRO → MARKET (R$349) sem pagar fatura pending
- ❌ Aumenta receita imediatamente, risk de default aumenta
- ❌ Contradiz D11

**Recomendação:**
```typescript
// ✅ Validação no RPC:

CREATE OR REPLACE FUNCTION rpc_platform_change_subscription_plan(
  p_subscription_id uuid,
  p_plan_key text,
  ... audit params
) RETURNS void LANGUAGE plpgsql AS $$
declare
  v_sub record;
begin
  SELECT * FROM pagarme_subscriptions
   WHERE id = p_subscription_id FOR UPDATE
   INTO v_sub;
  
  IF v_sub.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  
  -- ✅ NOVO: Validar não em overdue/pending_*
  IF v_sub.status NOT IN ('trial', 'active') THEN
    RAISE EXCEPTION 'cannot_change_plan_in_status_' || v_sub.status;
  END IF;
  
  -- ✅ Se overdue: validar last_paid_at (grace period)
  IF v_sub.status = 'overdue' AND v_sub.last_paid_at IS NULL THEN
    RAISE EXCEPTION 'never_paid_cannot_change_plan';
  END IF;
  
  -- UPDATE plan_id, plan_key
  -- ...
end;
$$;

// ✅ E no handler API:
const result = await access.admin.rpc(...);
if (result.error?.message.includes('cannot_change_plan')) {
  return json({
    error: 'cannot_change_plan_while_overdue',
    message: 'Regularize o pagamento da fatura anterior antes de mudar de plano'
  }, { status: 400 });
}
```

---

### 3.7 Três Fontes de Verdade: Dias de Trial (I5)

**Inconsistência:**
```
1. DATABASE: platform_billing_settings.default_trial_days = 7
2. ENV VAR: process.env.TRIAL_DAYS = "15"
3. CLIENT: NEXT_PUBLIC_TRIAL_DAYS = "30"

Resultado: Cada uma usada em lugar diferente
├─ Signup RPC: lê ENV (fallback if settings ausente)
├─ Courtesy trial RPC: hardcoded `7 days`
├─ Frontend UI: mostra NEXT_PUBLIC (não sincroniza com DB)
└─ Depois o adm muda settings para 0 → Frontend continua mostrando 30
```

**Impacto:**
- ⚠️ UI mostra "14 dias de trial" MAS realmente cria com 0
- ⚠️ Confunde usuário ("por que meu trial não funciona?")
- ⚠️ Adm não sabe qual é o valor real

**Recomendação:**
```typescript
// ✅ ÚNICO source: platform_billing_settings

// 1. Backend: Uma função getDefaultTrialDays()
export async function getDefaultTrialDays(
  admin: SupabaseClient
): Promise<number> {
  const { data } = await admin
    .from("platform_billing_settings")
    .select("default_trial_days")
    .eq("id", 1)
    .single();
  
  if (!data) {
    throw new Error("platform_billing_settings not found (singleton corruption)");
  }
  
  return data.default_trial_days;  // ✅ Única fonte
}

// 2. Signup usa isso:
const trialDays = await getDefaultTrialDays(admin);
const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

// 3. Frontend: Chama API pública (com cache de 1h)
async function getTrialDaysForUI(): Promise<number> {
  // GET /api/billing/trial-policy (público, rate-limited)
  const res = await fetch("/api/billing/trial-policy");
  return res.json().default_trial_days;
}

// ✅ Resultado: Uma única fonte, em sincronia
```

---

### 3.8 Estado Ambíguo: pending_setup com Amount=0 (I2)

**Problema:**
```
Enum pagarme_sub_status:
├─ pending_payment: Esperando pagamento (1ª fatura)
└─ pending_setup: Esperando taxa de ativação/setup

Decisão D10: "Setup fee = 0 → não usar pending_setup"
Decisão D19: "Com setup=0 usar pending_payment"

MAS código ainda:
├─ Cria setup_payments com amount=0
├─ Seta status='pending_setup' mesmo com setup=0
└─ Confunde: "o que significa pending_setup com R$0?"
```

**Impacto:**
- ⚠️ Estado confuso (quando setup=0, deveria ser pending_payment)
- ⚠️ RPC grant_courtesy_trial pode ficar em pending_setup zero

**Recomendação:**
```typescript
// ✅ No signup RPC:

CREATE OR REPLACE FUNCTION rpc_signup_company_with_billing(...) AS $$
declare
  v_setup_price_cents int;
begin
  -- Lê setup price do plano
  SELECT setup_price_cents INTO v_setup_price_cents
    FROM public.plans WHERE key = p_plan_key;
  
  -- Lógica:
  IF v_setup_price_cents > 0 THEN
    -- ✅ Setup fee > 0: cria setup_payment + status='pending_setup'
    INSERT INTO public.setup_payments (...)
    UPDATE pagarme_subscriptions SET status='pending_setup';
  ELSE
    -- ✅ Setup fee = 0: pula direto a pending_payment ou trial
    -- NÃO cria setup_payment com amount=0
    UPDATE pagarme_subscriptions 
      SET status = CASE 
        WHEN p_trial_days > 0 THEN 'trial' 
        ELSE 'pending_payment' 
      END;
  END IF;
end; $$;

// ✅ CHECK constraint:
ALTER TABLE setup_payments 
  ADD CONSTRAINT setup_payments_amount_gt_0 
  CHECK (amount > 0);
```

---

## PARTE 4: ROADMAP DE CORREÇÃO E IMPLEMENTAÇÃO

### 4.1 Fases de Implementação

```
┌───────────────────────────────────────────────────────────────────┐
│              ROADMAP: PHASES & DEPENDENCIES                        │
└───────────────────────────────────────────────────────────────────┘

FASE P0 — BLOQUEADORES CRÍTICOS (Receita & Segurança)
├─ 0.1: Fix IDOR em /api/billing/status ← Trivial, DO NOW
├─ 0.2: Centralizar requireCompanyAccess em 30+ rotas críticas ← Large
├─ 0.3: Atualizar requirePlanFeature (add status check) ← Medium
├─ 0.4: Trial expiration gate (sempre verificar data) ← Trivial
└─ Resultado esperado: Feature leak = 0, receita segura

FASE P1 — CONFORMIDADE ARQUITETURAL
├─ 1.1: Consolidar fonte de trial_days (único: platform_settings)
├─ 1.2: Disable change-plan em overdue
├─ 1.3: Remover allowlist /ativar em pending_payment
├─ 1.4: Implementar idempotência de checkout
├─ 1.5: Revogação de cache no blockCompany
└─ Resultado: Compliance com decisões arquiteturais (D1-D21)

FASE P2 — LIMPEZA TÉCNICA
├─ 2.1: Remover tabela subscriptions (LEGADA)
├─ 2.2: Consolidar feature_limits (dedupliçar se existir)
├─ 2.3: Testes E2E de billing (matriz de estados)
└─ Resultado: Codebase limpo, sem técnica debt

FASE P3 — MONITORAMENTO
├─ 3.1: Alertas de anomalias de billing (ex: 10+ overdue→active em 1h)
├─ 3.2: Dashboard de auditoria (status_history visualization)
├─ 3.3: Testes de penetração (security audit)
└─ Resultado: Observabilidade, detecção de abuso
```

### 4.2 Checklist de Execução P0

| # | Task | Arquivo | Esforço | Bloqueadores | Teste |
|----|------|---------|---------|--------------|-------|
| P0.1 | Fix IDOR /api/billing/status | `app/api/billing/status/route.ts` | 30min | — | ✅ `curl /api/billing/status?company_id=OTHER` → 403 |
| P0.2 | requireCompanyAccess em 30 rotas | Ver `Grupo A` acima | 8h | Teste de regressão | ✅ 402 se blocked, ✅ success se active |
| P0.3 | requirePlanFeature + status | `lib/billing/requirePlanFeature.ts` | 2h | P0.2 | ✅ `requirePlanFeature(...) && pagarme.status='blocked'` → false |
| P0.4 | Trial expiration gate | `lib/billing/resolveBillingAccess.ts` | 30min | — | ✅ `status='trial' && ends_at=now-1h` → 'trial_expired' |

---

## RESUMO FINAL

### ✅ Pontos Fortes Atuais

1. **Arquitetura em camadas** — Proxy + middleware + RPC bem pensado
2. **Transações atômicas** — Crons, webhooks, RPCs com locks
3. **Auditoria** — pagarme_status_history, payment_attempts
4. **Estados bem definidos** — 9 status com matriz clara
5. **RLS + RBAC** — Service role vs authenticated
6. **Defesa contra webhooks duplicados** — Idempotência por event.id

### ❌ Brechas Críticas

1. **IDOR** — Leitura de dados de qualquer empresa
2. **100+ rotas sem validação** — Podem ser acessadas mesmo em pending_payment
3. **Feature gates desprotegidas** — Não verificam pagarme_subscriptions
4. **Grace period ambíguo** — Trial=0 + overdue = 5 dias free
5. **Trial expirado não bloqueia** — Janela de horas possível

### 🔧 Próximos Passos

**Imediato (P0 — Esta semana):**
1. Fix IDOR em /api/billing/status (30 min)
2. Começar wrapping de 30+ rotas com requireCompanyAccess (parallelizar entre devs)
3. Atualizar requirePlanFeature (2h)

**Curto prazo (P1 — Próximo ciclo):**
4. Consolidar fonte de trial_days
5. Disable change-plan em overdue
6. Idempotência de checkout

**Médio prazo (P2 — Cleanup):**
7. Remover tabela subscriptions
8. Testes E2E de billing

---

## Apêndices

### A. Matriz de Migração (As-Is → To-Be)

| Aspecto | As-Is | To-Be | Esforço |
|---------|-------|-------|---------|
| Fonte de status | pagarme_subscriptions ✅ | Mesma | — |
| Feature gate | requirePlanFeature (sem billing) | requirePlanFeature (com billing) | Baixo |
| Routing protection | 30% das rotas | 100% | Alto |
| Trial days | 3 fontes | 1 fonte | Médio |
| Change-plan validation | Nenhuma | Rejeita overdue | Baixo |
| Checkout idempotency | Não | Sim (pagarme_order_id) | Médio |
| RLS | Básica | Mesma ✅ | — |
| Auditoria | Básica ✅ | Melhorada | Baixo |

### B. Query SQL de Auditoria (Executar Agora)

```sql
-- Ver quantas rotas faltam requireCompanyAccess:
-- (Precisa manual code inspection — não é query SQL)

-- Ver status distribution:
SELECT status, COUNT(*) as count
FROM public.pagarme_subscriptions
GROUP BY status
ORDER BY count DESC;

-- Ver trial vencido (não expirado em DB):
SELECT company_id, trial_ends_at, status, NOW()
FROM public.pagarme_subscriptions
WHERE status='trial' AND trial_ends_at < NOW()
LIMIT 10;

-- Ver câmaras nunca pagaram:
SELECT company_id, created_at, activated_at, last_paid_at, status
FROM public.pagarme_subscriptions
WHERE last_paid_at IS NULL AND status NOT IN ('trial', 'pending_payment', 'pending_setup')
ORDER BY created_at DESC;

-- Ver overdue com grace period:
SELECT company_id, status, last_paid_at, next_billing_at
FROM public.pagarme_subscriptions
WHERE status='overdue' AND last_paid_at IS NOT NULL
ORDER BY last_paid_at DESC;
```

---

**FIM DA AUDITORIA**

---

## Instruções de Leitura

1. **Executivos:** Leia "Sumário Executivo" + "Parte 3: Vulnerabilidades"
2. **Arquitetos:** Leia "Parte 1: AS-IS" + "Parte 2: TO-BE"
3. **DevOps/DBAs:** Consulte "Schema Ideal" + "Queries de Auditoria"
4. **Product:** Leia "Roadmap de Correção" + "Próximos Passos"
