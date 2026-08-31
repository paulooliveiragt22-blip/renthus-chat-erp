# 🏗️ ARQUITETURA IDEAL: Billing & Entitlements
## Diagrama de Controle de Acesso — Renthus Chat ERP

---

## 1. FLUXO DE VALIDAÇÃO IDEAL (Defense-in-Depth)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    HTTP REQUEST VALIDATION LAYERS                         │
└──────────────────────────────────────────────────────────────────────────┘

    ┌─ GET /api/orders?id=123
    │
    ├─→ [LAYER 1] HTTP Protocol & Signature (se webhook)
    │   └─ Valida: X-Webhook-Signature (Pagar.me)
    │   └ Para rotas técnicas; skip para autenticadas
    │
    ├─→ [LAYER 2] Authentication
    │   └─ Valida: JWT / Session Cookie
    │   └ Retorna: 401 se inválido
    │
    ├─→ [LAYER 3] Company Access (Middleware Central)
    │   ├─ Valida: company_id no cookie
    │   ├─ Valida: User membership na empresa
    │   ├─ Valida: Role (owner/admin/member)
    │   └─ Retorna: 403 se falhar
    │
    ├─→ [LAYER 4] Billing Status Gate ⭐ (NOVO)
    │   ├─ Lê: pagarme_subscriptions.status (service_role)
    │   ├─ Resolve: Effective status (com trial_ends_at check)
    │   ├─ Valida: isBillingAccessAllowed(status, "full")
    │   └─ Retorna: 402 se pending_payment/blocked/trial_expired
    │
    ├─→ [LAYER 5] Plan Feature Gate (Opcional, feature-specific)
    │   ├─ Lê: plan_features + feature_limits
    │   ├─ Valida: Feature está no plano
    │   ├─ Valida: Limite não excedido (ou allow_overage)
    │   └─ Retorna: 403 se feature não existe
    │
    ├─→ [LAYER 6] RLS/Database (Final Line of Defense)
    │   ├─ Enforce: Row-level security policies
    │   ├─ Enforce: Foreign key constraints
    │   └─ Retorna: 403 se RLS reject
    │
    └─→ [LAYER 7] Executar ação (INSERT/UPDATE/DELETE)

RESULTADO: Sem passar nas 6 primeiras camadas, requisição nunca chega ao BD
```

---

## 2. STACK DE MIDDLEWARES (Composável)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  MIDDLEWARE COMPOSITION PATTERN                           │
└──────────────────────────────────────────────────────────────────────────┘

CORE MIDDLEWARES:

1️⃣  requireCompanyAccess(opts?)
    ├─ Input: allowedRoles?: ["owner", "admin"]
    ├─ Input: billing?: "full" | "billing_self" | "skip"
    ├─ Output: { ok: true; companyId; billingStatus; admin } | { ok: false; status: 402 }
    └─ Usado em: 100+ rotas de mutação
    
    // Internamente:
    ├─ getCurrentCompanyIdFromCookie() → Cookie
    ├─ getAuthUser() → Auth user
    ├─ checkMembership(user, company) → company_users
    ├─ checkRole(membership.role, allowedRoles) → RBAC
    └─ requireBillingActive(admin, companyId, mode) → ⭐ NOVO
       └─ Valida pagarme_subscriptions.status

2️⃣  requirePlanFeature(opts)
    ├─ Input: featureKey, allowedRoles?, admin
    ├─ Output: boolean (true se tem feature + status ok)
    ├─ Usado em: Rotas de features específicas
    │
    └─ Internamente:
       ├─ requireCompanyAccess() ← Reusa layer 3 + 4
       ├─ selectFeatureFromPlan(plan_id, featureKey) ← BD
       └─ AND(access ok, feature exists)

3️⃣  requireCompanyPlanFeature(opts)
    ├─ Input: featureKey, allowedRoles?
    ├─ Output: AccessOk | AccessDenied
    ├─ Composição: requireCompanyAccess() + requirePlanFeature()
    └─ Usado em: 1-linha em início de rota


EXEMPLO DE USO:

// ✅ Simples (só validação de company + billing)
async function POST_create_order(req) {
  const access = await requireCompanyAccess();
  if (!access.ok) return json(access, { status: access.status });
  
  // access.billingStatus ∈ {trial, active, overdue}
  // access.admin = client autenticado
  const { admin, companyId } = access;
}

// ✅ Com feature (company + billing + feature)
async function POST_send_whatsapp(req) {
  const access = await requireCompanyPlanFeature({
    featureKey: "whatsapp_messages",
    allowedRoles: ["owner", "admin"]
  });
  if (!access.ok) return json(access, { status: access.status });
  
  // Automaticamente validado:
  // 1. Company autenticado + membership ✅
  // 2. Billing status ∈ {trial, active, overdue} ✅
  // 3. Feature no plano ✅
  // 4. Limite não excedido (se aplicável)
}

// ✅ Técnico (sem billing, com validação)
async function POST_billing_webhook(req) {
  // Valida assinatura webhook (não requer auth)
  const verified = await verifyPagarmeSignature(req);
  if (!verified) return json({ error: "invalid" }, { status: 401 });
  
  // Idempotência por event.id
  const { data: exists } = await admin
    .from("pagarme_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();
  
  if (exists) return json({ received: true });
}
```

---

## 3. MATRIZ DE ACESSO (Estados × Recursos)

```
┌──────────────────────────────────────────────────────────────────────────┐
│              ACCESS MATRIX: Billing Status vs Resource Type              │
└──────────────────────────────────────────────────────────────────────────┘

             │ API Mutável │ Inbound │ Features │ Checkout │ Dashboard
             │  (full)     │ Message │  (gates) │ (billing │  (view)
             │             │         │          │  _self)  │
─────────────┼─────────────┼─────────┼──────────┼──────────┼──────────
trial✅      │     ✅      │   ✅    │    ✅    │    ✅    │    ✅
active       │     ✅      │   ✅    │    ✅    │    ✅    │    ✅
overdue*     │     ✅      │   ✅    │    ✅    │    ✅    │    ✅
overdue**    │     ❌ 402  │   ❌    │    ❌    │    ✅    │    ⚠️
pending_pay  │     ❌ 402  │   ⚠️    │    ❌    │    ✅    │    ✅
pending_set  │     ❌ 402  │   ⚠️    │    ❌    │    ✅    │    ✅
abandoned    │     ❌ 402  │   ⚠️ 📨 │    ❌    │    ✅    │    ✅
blocked      │     ❌ 402  │   ❌    │    ❌    │    ❌    │    ⚠️
cancelled    │     ❌ 402  │   ❌    │    ❌    │    ❌    │    ⚠️
missing      │     ❌ 402  │   ❌    │    ❌    │    ❌    │    ⚠️
─────────────┴─────────────┴─────────┴──────────┴──────────┴──────────

LEGENDA:
✅ = Permitido
❌ 402 = Bloqueado (Payment Required)
⚠️ = Condicional
📨 = Com autoReply (template de reativação WA)

* overdue COM last_paid_at (foi cliente pagante) = grace period
** overdue SEM last_paid_at (never-paid) = trata como pending_payment
⚠️ inbound = Permitido se hasPlanIntent=true (não perder vendas)
```

---

## 4. BANCO DE DADOS — Schema Ideal

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       DATABASE SCHEMA (ER Diagram)                        │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│  companies           │
├──────────────────────┤
│ id (PK)              │
│ is_active (bool)     │ ← Sync com pagarme_subscriptions.status
│ email (text)         │
│ created_at           │
│ updated_at           │
└──────────┬───────────┘
           │ 1:1
           │ UNIQUE(company_id)
           │
    ┌──────▼──────────────────────────────────────────┐
    │  pagarme_subscriptions  [CANÔNICA DE BILLING]   │
    ├───────────────────────────────────────────────────┤
    │ id (PK)                                          │
    │ company_id (FK, UNIQUE) ← One subscription/co    │
    │ status (enum) ⭐ FONTE DE VERDADE               │
    │   values: trial | active | overdue | blocked    │
    │           pending_payment | pending_setup       │
    │           abandoned | cancelled | missing       │
    │ plan (enum): essencial | pro | market           │
    │ plan_id (FK → plans)                            │
    │ trial_ends_at (timestamptz)                     │
    │ activated_at (timestamptz, NULL se trial)       │
    │ last_paid_at (timestamptz, NULL = never-paid)   │
    │ next_billing_at (timestamptz)                   │
    │ allow_overage (bool)                            │
    │ pagarme_customer_id (text, external ID)         │
    │ default_card_id (text, NO PAN)                  │
    │ abandoned_at (timestamptz, audit)               │
    │ self_reactivation_count (int, audit)            │
    │ last_status_change_at (timestamptz, TRIGGER)    │
    │ created_at, updated_at                          │
    └──────┬──────────────────────────────────────────┘
           │ 1:N
           │
      ┌────┴────┬────────────┬─────────────┐
      │          │            │             │
   ┌──▼────┐  ┌─▼──────┐  ┌──▼────────┐  ┌▼───────────────┐
   │invoices│  │setup_  │  │payment_   │  │pagarme_status_ │
   │        │  │payments│  │attempts   │  │history         │
   ├────────┤  ├────────┤  ├───────────┤  ├────────────────┤
   │id (PK) │  │id (PK) │  │id (PK)    │  │id (PK)         │
   │company │  │company │  │company    │  │subscription_id │
   │sub (FK)│  │plan    │  │invoice_id │  │company_id      │
   │amount  │  │amount  │  │setup_id   │  │old_status      │
   │status  │  │status  │  │kind (enum)│  │new_status      │
   │due_at  │  │paid_at │  │channel    │  │reason (text)   │
   │paid_at │  │pagarme │  │pagarme_id │  │changed_at      │
   │pg_id   │  │pg_url  │  │status     │  │changed_by      │
   │pg_url  │  │created │  │attempt_n  │  │ INDEXES:       │
   │pix_qr  │  │        │  │error      │  │ (sub_id)       │
   │attempt │  │        │  │created    │  │ (company_id)   │
   │created │  │        │  │           │  │ (changed_at)   │
   └────────┘  └────────┘  └───────────┘  └────────────────┘
   INDEXES:                   UNIQUE(        TRIGGER ON:
   (company)                  pagarme_id)    • INSERT sub
   (status)                   ✅ Idempoten    • UPDATE status
   (due_at)                                  → log histórico

                    ┌─────────────────┐
                    │  plans          │
                    ├─────────────────┤
                    │ id (PK)         │
                    │ key (UNIQUE)    │
                    │ name (text)     │
                    │ price_cents     │
                    │ created_at      │
                    └────┬──────┬─────┘
                         │      │ 1:N
                         │      │
        ┌────────────────┘      └────────────────┐
        │ 1:N                                     │ 1:N
    ┌───▼──────────┐                      ┌──────▼──────────┐
    │ plan_features│                      │ feature_limits  │
    ├──────────────┤                      ├─────────────────┤
    │ plan_id (FK) │                      │ plan_id (FK)    │
    │ feature_key  │                      │ feature_key     │
    │ UNIQUE(p, k) │                      │ limit_per_month │
    └──────────────┘                      │ UNIQUE(p, k)    │
                                          └──────┬──────────┘
                                                 │ FK
                                                 │
                                          ┌──────▼────────┐
                                          │ usage_monthly  │
                                          ├────────────────┤
                                          │ id (PK)        │
                                          │ company_id (FK)│
                                          │ feature_key    │
                                          │ year_month     │
                                          │ used (counter) │
                                          │ UNIQUE(c,k,ym)│
                                          └────────────────┘

    ┌───────────────────────────────────┐
    │ platform_billing_settings          │
    ├───────────────────────────────────┤
    │ id = 1 (PK, CHECK id=1)            │ SINGLETON
    │ default_trial_days (int, 0..90)    │ ⭐ Única fonte
    │ updated_at                          │
    │ updated_by (FK)                     │
    └───────────────────────────────────┘
```

---

## 5. RPC/Função SQL — Contracts

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    RPC CONTRACTS (Secure, Atomic)                         │
└──────────────────────────────────────────────────────────────────────────┘

1️⃣  rpc_get_company_entitlements(p_company_id uuid) → jsonb

    INPUT:  company_id
    
    OUTPUT: {
      company_id: uuid,
      is_active: bool,
      pagarme: {
        id: uuid,
        status: pagarme_sub_status,
        plan: subscription_plan,
        plan_key: text,
        trial_ends_at: timestamptz,
        activated_at: timestamptz,
        last_paid_at: timestamptz,
        next_billing_at: timestamptz,
        allow_overage: bool
      },
      subscription: {
        id: uuid,
        plan_id: uuid,
        plan_key: text,
        plan_name: text,
        allow_overage: bool
      },
      features: [array of feature_keys],  ← [] se access="deny"
      access: "allow" | "deny",
      access_reason: BillingAccessStatus
    }
    
    LOGIC: 
    ├─ Lê pagarme_subscriptions
    ├─ Resolve effective status
    ├─ AND: features[] se access="allow", [] senão
    ├─ Fail-closed: erro → retorna {}
    └─ Defense-in-depth: Client também resolve localmente


2️⃣  rpc_platform_change_subscription_plan(
      p_subscription_id, p_plan_key, 
      ... audit params
    ) → void
    
    VALIDATIONS:
    ├─ ✅ status ∈ {trial, active} (NOT overdue/pending_*/blocked)
    ├─ ✅ Plano existe (plan_key validado)
    ├─ ✅ FOR UPDATE lock (atomic)
    ├─ ✅ Audit log (rpc_platform_record_audit)
    └─ ❌ RAISES se: status ≠ allowed
    
    EXCEPTION: 'cannot_change_plan_in_status_X'


3️⃣  rpc_platform_grant_courtesy_trial(
      p_company_id, p_days, 
      ... audit params
    ) → timestamptz
    
    VALIDATIONS:
    ├─ ✅ p_days ∈ [1, 30]
    ├─ ✅ last_paid_at IS NULL (never-paid only)
    ├─ ✅ BEGIN...COMMIT (atomic)
    └─ ✅ Retorna trial_ends_at
    
    EXCEPTION: 'company_has_paid_before' (cannot grant courtesy)


4️⃣  rpc_self_reactivate_subscription(
      p_company_id, p_plan_key
    ) → timestamptz
    
    VALIDATIONS:
    ├─ ✅ RLS: authenticated user = owner
    ├─ ✅ status ∈ {abandoned, blocked, cancelled}
    ├─ ✅ Cooldown: 60 days desde last reactivation
    ├─ ✅ Trial days = 7d (market) ou 14d (essencial/pro)
    └─ ✅ Retorna trial_ends_at
    
    EXCEPTION: 'cooldown_not_expired' (< 60 days)


5️⃣  check_and_increment_usage(
      p_company, p_feature, p_amount DEFAULT 1
    ) → jsonb
    
    OUTPUT: {
      allowed: bool,
      used: int,
      limit: int,
      overage: bool
    }
    
    LOGIC:
    ├─ Busca limit em feature_limits
    ├─ Busca uso em usage_monthly (year_month=current)
    ├─ IF used >= limit AND NOT allow_overage → {allowed: false}
    ├─ ELSE → INCREMENT usage_monthly.used
    └─ Retorna estado novo
    
    ATOMICITY: ON CONFLICT DO UPDATE


6️⃣  rpc_platform_suspend_company(
      p_company_id,
      ... audit params
    ) → void
    
    ACTIONS:
    ├─ UPDATE companies.is_active = false
    ├─ UPDATE pagarme_subscriptions.status = 'blocked'
    ├─ UPDATE whatsapp_channels.status = 'inactive'
    │   + provider_metadata.suspended_by_platform = true
    ├─ BEGIN...COMMIT (atomic)
    └─ Audit log de todas as mudanças
```

---

## 6. CLIENT SIDE — Defense-in-Depth Verification

```
┌──────────────────────────────────────────────────────────────────────────┐
│            CLIENT-SIDE VERIFICATION (AND Logic)                           │
└──────────────────────────────────────────────────────────────────────────┘

import { resolveTenantAccess, isBillingAccessAllowed } from "@/lib/billing";

// Chamada: Pega RPC result + re-resolve localmente
async function fetchCompanyEntitlements(
  admin: SupabaseClient,
  companyId: string
): Promise<Entitlements> {
  // 1. RPC chama retorna features (pode estar old/compromised)
  const rpcResult = await admin.rpc("rpc_get_company_entitlements", {
    p_company_id: companyId
  });
  
  if (rpcResult.error) {
    // Fail-closed
    return {
      access: "deny",
      reason: "missing",
      features: [],
      ...empty
    };
  }
  
  // 2. CLIENT-SIDE: Re-resolve usando puro function
  const clientAccess = resolveTenantAccess({
    status: rpcResult.data.pagarme.status,
    trial_ends_at: rpcResult.data.pagarme.trial_ends_at,
    last_paid_at: rpcResult.data.pagarme.last_paid_at,
    plan: rpcResult.data.pagarme.plan
  }, new Date()); // ← NOW(), sempre atualizado
  
  // 3. AND LOGIC: Features só se client resolver allow
  const features = clientAccess.featuresEligible 
    ? rpcResult.data.features 
    : [];  // ← SEMPRE [], mesmo que RPC retorne arrays
  
  return {
    access: clientAccess.access,
    reason: clientAccess.reason,
    features,  // ← Gated
    pagarme: rpcResult.data.pagarme,
    subscription: rpcResult.data.subscription
  };
}

RESULTADO:
- Se RPC velha retorna features: ["whatsapp_messages"]
- Mas status no DB mudou pra "blocked"
- Rpc_get_company_entitlements é lenta para sync
- Cliente AINDA vê features: [] ✅ (gated localmente)
```

---

## 7. PIPELINE DE DADOS (Trial Lifecycle)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    BILLING STATE MACHINE (Ideal)                          │
└──────────────────────────────────────────────────────────────────────────┘

                         ┌─ SIGNUP ─┐
                         │           │
                         └─────┬─────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
            trial_days = 0         trial_days > 0
                    │                     │
                    ▼                     ▼
            PENDING_PAYMENT    ◄──    TRIAL
                    │                (valid)
                    │          ┌─────────▼───────┐
                    │          │ cron: expires   │
                    │          │ trial_ends_at < now
                    │          └────────┬────────┘
                    │                   │
                    │            TRIAL_EXPIRED
                    │                   │
                    ├───────────────────┤
                    │                   │
            (user pays)           (user pays)
                    │                   │
                    └─────┬─────────────┘
                          │
                    PROCESSING → ACTIVE
                          ▲
                          │ (automatic, webhook)
                    ┌─────┴─────┐
                    │           │
            (next fatura vence) (payment fails)
                    │           │
                    ▼           ▼
                OVERDUE  ◄──  ???
                    │
            ┌───────┼───────┐
            │               │
      (paga  │  (não paga)
      grace) │  (30d)
            │               │
            ▼               ▼
          ACTIVE      ABANDONED
                    │
            (user reactivates)
                    │
            (self_reactivate)
                    │
                    └──→ TRIAL (7d)
                         (cooldown 60d)

    OR: BLOCKED (admin action)
    OR: CANCELLED (admin action)

VALIDAÇÕES NO FLUXO:
├─ Signup: Cria status=PENDING_PAYMENT ou TRIAL (base no settings)
├─ Payment webhook: Transição PENDING_PAYMENT → PROCESSING → ACTIVE
├─ Trial expiry: Cron marca status=TRIAL_EXPIRED (se ainda status=TRIAL)
├─ Overdue: Cron marca status=OVERDUE quando due_at < now + has invoice pending
├─ Abandoned: Cron marca status=ABANDONED (30 dias sem payment after overdue)
└─ Self-reactivate: ABANDONED → TRIAL (com cooldown 60d)
```

---

## 8. COMPARAÇÃO: As-Is vs To-Be

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       AS-IS vs TO-BE                                      │
└──────────────────────────────────────────────────────────────────────────┘

ASPECTO                    | AS-IS                        | TO-BE
───────────────────────────┼──────────────────────────────┼─────────────────
Camadas de validação       | 4-5 (inconsistente)          | 6+ (obrigatório)
Cobertura de rotas         | ~30% (100+ sem proteção)     | ~100%
Fonte de trial_days        | 3 lugares (env, db, client)  | 1 lugar (DB)
Feature gate + status      | Não verifica status          | AND logic
IDOR em /api/billing/*     | Sim (lê qualquer empresa)    | Não (valida member)
Trial expirado             | Janela 1+ hora               | Real-time
Grace period bypass        | Sim (trial=0 + overdue)      | Não (never-paid bloqueado)
Change-plan validation     | Nenhuma                      | Bloqueia overdue/pending
Checkout idempotency       | Não (race condition)         | Sim (pagarme_order_id UK)
Auditoria                  | Básica                       | Completa (triggers)
RLS + Defense-in-depth     | Sim, mas não sempre usado    | Sim + client verify
```

---

## 🎯 Conclusão

A arquitetura ideal é **fail-closed, multi-layered, e defensiva**. Nenhuma camada é suficiente sozinha. Implementar todos os layers reduz vazamentos a ~0.
