# 📊 RESUMO EXECUTIVO: AUDITORIA DE BILLING
## Renthus Chat ERP — 2026-08-30

---

## 🚨 VULNERABILIDADES CRÍTICAS ENCONTRADAS

### Top 5 Brechas de Segurança (Feature Leaks)

| Risco | Descrição | Impacto | Esforço Fix |
|-------|-----------|---------|------------|
| **CRÍTICO** | **IDOR:** Leitura de dados de qualquer empresa via `GET /api/billing/status?company_id=OTHER` | Exposição de planos/valores de 100% das empresas | 30 min |
| **CRÍTICO** | **100+ rotas sem validação:** `/api/admin/pdv/finalize`, `/api/whatsapp/send`, etc não verificam billing status | Tenant em `pending_payment` acessa ERP completo | 8 horas |
| **ALTA** | **Grace Period Bypass:** Trial=0 (pay-to-start) + overdue com last_paid_at = 5 dias FREE | Perda de 5 dias de fatura por tenant | 2 horas |
| **ALTA** | **Feature gates desprotegidas:** `requirePlanFeature()` não verifica `pagarme_subscriptions.status` | Blocked tenant ainda envia WhatsApp, acessa reports | 2 horas |
| **MÉDIA** | **Trial expirado não bloqueia:** Status='trial' com `trial_ends_at < now()` ainda libera API até cron rodar | Janela de 1+ hora de acesso não-pago | 30 min |

---

## 📈 IMPACTO POTENCIAL

```
RECEITA EM RISCO:
┌─────────────────────────────────────────────────────────┐
│ Cenário: 1000 tenants × 50% chance de bug ocorrer × R$300/mês
│
│ Best case (30 min exploração):  R$ 0 (ninguém descobre)
│ Normal case (trial=0 + grace):  R$ 5,000/mês em vazamento
│ Worst case (100+ routes exposed): R$ 150,000/mês bloqueado
└─────────────────────────────────────────────────────────┘

SEGURANÇA:
├─ IDOR: Qualquer auth user lê dados de competidores
├─ Acesso não-autorizado: Frozen company ainda processa pedidos
├─ Limites de feature: Whatsapp_messages contador ignora status
└─ Reputação: Bug descoberto = perda de confiança
```

---

## 🔍 COMO SURGEM OS VAZAMENTOS (Attack Paths)

### Caminho 1: IDOR direto
```
1. Usuário de empresa A (autenticado)
2. GET /api/billing/status?company_id=<UUID empresa B>
3. Lê: plano, valores de fatura, cards salvos
4. ✅ Sem validação de membership
```

### Caminho 2: Trial=0 + Grace Period
```
Day 0:  Signup com trial_days=0 → pending_payment (sem acesso)
Day 30: Pagam 1ª fatura → active (acesso ok)
Day 65: Próxima fatura vence → adm cron marca overdue
Day 66: Tenant acessa /api/orders → Gate permite (last_paid_at set)
Day 70: 5 DIAS de uso sem nova fatura ❌ (Receita vazada)
```

### Caminho 3: Rota não protegida
```
GET /api/orders, POST /api/admin/pdv/finalize, POST /api/whatsapp/send
├─ Sem requireCompanyAccess
├─ OU com requireCompanyAccess mas billing="skip"
├─ OU com requirePlanFeature (não verifica status)
→ Executa mesmo que tenant='blocked' ou 'pending_payment'
```

---

## ✅ SOLUÇÃO RÁPIDA (P0 — Esta Semana)

### Fix #1: IDOR (30 min)
```typescript
// ❌ Antes
const qCompanyId = url.searchParams.get("company_id");
const data = await admin.from("pagarme_subscriptions")
  .eq("company_id", qCompanyId).single();

// ✅ Depois
const access = await requireCompanyAccess({ billing: "billing_self" });
if (!access.ok) return json(access, { status: access.status });
const data = await access.admin.from("pagarme_subscriptions")
  .eq("company_id", access.companyId).single();  // ← Validado
```

### Fix #2: Rotas sem proteção (1-2 dias)
```typescript
// Template: Adicionar a TODA rota mutável

async function POST_admin_pdv_finalize(req: Request) {
  // ✅ NOVO: Requer acesso validado
  const access = await requireCompanyAccess(["owner", "admin"]);
  if (!access.ok) return json(access, { status: access.status });
  
  // Agora tenant.billing='pending_payment' é 402 automaticamente
  const { admin, companyId, billingStatus } = access;
  // ... resto da lógica
}
```

### Fix #3: Feature gates (2 horas)
```typescript
// ✅ Verificar TAMBÉM status

export async function requirePlanFeature(
  admin: SupabaseClient,
  companyId: string,
  featureKey: string
): Promise<boolean> {
  // 1. Lê pagarme_subscriptions
  const { data: pagarme } = await admin
    .from("pagarme_subscriptions")
    .select("status, plan_id, trial_ends_at, last_paid_at")
    .eq("company_id", companyId).maybeSingle();
  
  // 2. Gate de status (novo)
  const tenant = resolveTenantAccess(pagarme);
  if (!isBillingAccessAllowed(tenant.reason, "full")) return false;
  
  // 3. Verifica feature (existente)
  const { data: feat } = await admin
    .from("plan_features")
    .eq("plan_id", pagarme.plan_id)
    .eq("feature_key", featureKey).maybeSingle();
  
  return !!feat;  // ✅ AND(status ok, feature existe)
}
```

### Fix #4: Trial expiration (30 min)
```typescript
// ✅ SEMPRE verificar data, não confiar em status

export function resolveEffectiveBillingStatus(
  row: PagarmeSubSnapshot,
  now: Date = new Date()
): BillingAccessStatus {
  if (row.status === "trial") {
    const ends = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    // ✅ Verifica END_TIME (não status)
    if (!ends || ends.getTime() <= now.getTime()) {
      return "trial_expired";  // ← Computado, sem dependência de cron
    }
    return "trial";
  }
  // ... resto
}
```

---

## 📋 CHECKLIST DE IMPLEMENTAÇÃO

### FASE P0 (Crítica — Esta Semana)
- [ ] Fix IDOR `/api/billing/status` — 30 min
- [ ] Envolver 10 rotas críticas com `requireCompanyAccess` — 2h
- [ ] Atualizar `requirePlanFeature` — 2h
- [ ] Fix trial expiration gate — 30 min
- [ ] Testes de regressão — 2h
- **Total: 7h (~1 dev-day)**

### FASE P1 (Conformidade — Próximo Sprint)
- [ ] Envolver 90+ rotas restantes — 6h (parallelizar)
- [ ] Consolidar fonte de trial_days — 2h
- [ ] Disable change-plan em overdue — 1h
- [ ] Idempotência de checkout — 2h
- **Total: 11h (~1.5 dev-days)**

### FASE P2 (Cleanup — Futuro)
- [ ] Remover tabela `subscriptions` (LEGADA) — 3h
- [ ] Testes E2E de matriz de billing — 4h
- [ ] Security audit — 4h
- **Total: 11h (~1.5 dev-days)**

---

## 🏗️ ARQUITETURA IDEAL (Resumo)

```
CAMADAS DE VALIDAÇÃO (Defense-in-Depth):

Requisição HTTP
    ↓
[1] Proxy (páginas)
[2] Middleware requireCompanyAccess (OBRIGATÓRIO)
    ├─ Valida company_id + user + role
    ├─ Valida billing status ✅ (NOVO)
    └─ Retorna 402 se blocked/pending_payment/trial_expired
[3] Feature gate requirePlanFeature
    └─ Verifica status + feature no plano
[4] RPC/BD (RLS + constraints)
    └─ Última linha de defesa

RESULTADO: Nenhuma requisição passa sem validação tripla
```

---

## 📊 MÉTRICAS DE SUCESSO (Pós-Fix)

| Métrica | Antes | Depois |
|---------|-------|--------|
| **Rotas sem requireCompanyAccess** | 30-40 | 0 |
| **requirePlanFeature sem status check** | 20+ | 0 |
| **IDOR vulnerabilidades** | 1+ | 0 |
| **Trial expirado (janela)** | 1+ hour | 0 (real-time) |
| **Cobertura de billing na API** | ~30% | ~100% |
| **Testes de matrix de estados** | 36 casos | 50+ casos |

---

## 🎯 PRÓXIMAS AÇÕES (Ordem de Prioridade)

### TODAY (Hoje)
1. ✅ Aprovar esta auditoria
2. ✅ Criar branch `security/billing-fixes`
3. ✅ Fix IDOR (30 min)
4. ✅ Deploy + test

### THIS WEEK
5. ✅ Envolver 10 rotas críticas com requireCompanyAccess
6. ✅ Atualizar requirePlanFeature
7. ✅ Full test + deploy P0

### NEXT SPRINT
8. ✅ Envolver 90+ rotas restantes
9. ✅ Security audit externo
10. ✅ Deploy P1

---

## 📚 REFERÊNCIAS

- **Documento completo:** `AUDITORIA_BILLING_FEATURE_LEAK_2026-08-30.md` (600+ linhas)
- **Checklist de decisões:** `docs/CHECKLIST_BILLING_PAYWALL_P0.md`
- **Schema:** `supabase/migrations/20260830130000_*.sql`
- **Código de validação:** `lib/billing/resolveBillingAccess.ts`, `lib/workspace/requireCompanyAccess.ts`

---

## 📞 Dúvidas?

Este documento é análise pura (sem alterações de código). Próximo step: Implementar fixes em ordem de prioridade.

**Tempo estimado total:** 18 horas (3 dev-days) para 100% cobertura.

---

*Análise técnica completa realizada em 2026-08-30 via exploração automatizada do codebase.*
