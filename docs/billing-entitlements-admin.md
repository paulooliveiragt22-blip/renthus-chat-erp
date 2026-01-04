# Billing / Entitlements / Admin Billing (Dev)

## Objetivo
Padronizar como o app decide:
- qual plano uma empresa (`company`) possui,
- quais features estão habilitadas,
- quais limites existem (ex.: mensagens/mês),
- quando bloquear (ou permitir overage),
- e como ativar/alterar plano após pagamento (produção) ou manualmente (desenvolvimento).

Este documento complementa a arquitetura "UI → app/api → Supabase (service role)" e reforça que regras de billing e gating são aplicadas no backend.

---

## Fonte de verdade: como o plano é marcado
A empresa NÃO guarda o plano diretamente em `companies`.
O plano atual é determinado por:

### Tabela `subscriptions` (principal)
- `company_id`: empresa (tenant)
- `plan_id`: referência para `plans.id`
- `status`: `'active'` ou `'ended'`
- `started_at`, `ended_at`
- `allow_overage`: boolean (default `false`)
  - `false`: ao atingir limite, bloqueia novas ações (ex.: enviar mensagem)
  - `true`: permite exceder limite (overage) e cobra/mede excedente

**Regra:** deve existir no máximo 1 subscription `active` por company.

### Tabela `plans`
- `id`
- `key`: ex. `mini_erp`, `full_erp`
- `name`, `description`

---

## Entitlements: features habilitadas e limites
O sistema determina permissões por:
1) plano ativo (`subscriptions → plans`)
2) features do plano (`plan_features`)
3) add-ons contratados (`subscription_addons`)
4) limites mensais (`feature_limits`)
5) uso mensal (`usage_monthly`)

### Tabelas
- `features`:
  - catálogo de features (ex.: `whatsapp_messages`, `erp_full`, `pdv`, `fiscal_nfce`, etc.)
- `plan_features`:
  - features incluídas por plano
- `subscription_addons`:
  - features extras contratadas (ex.: `tef`, `printing_auto`)
- `feature_limits`:
  - limites por plano (feature_key + limit_per_month)
- `usage_monthly`:
  - uso agregado por `company_id`, `feature_key`, `year_month` (ex.: `2026-01`)

### Exemplo: WhatsApp com limite mensal
- feature: `whatsapp_messages`
- limite em `feature_limits` por plano
- uso incrementado automaticamente via trigger ao inserir em `whatsapp_messages`

---

## Política de bloqueio x overage (upgrade flow)
Para uma ação que incrementa uso (ex.: enviar mensagem WhatsApp):

### Cálculo (pré-ação)
- `used` = uso atual no mês
- `limit` = limite do plano (ou `null` se ilimitado)
- `nextUsed = used + increment`
- `willOverageBy = max(0, nextUsed - limit)` se limit existir

### Permitir ou bloquear
- Se `limit == null`: permitido
- Se `nextUsed <= limit`: permitido
- Se `nextUsed > limit`:
  - permitido SOMENTE se `subscriptions.allow_overage == true`
  - caso contrário: BLOQUEIA e exige upgrade/aceite

### Resposta recomendada ao bloquear
HTTP `402 Payment Required` com payload:
- `error: "message_limit_reached"`
- `upgrade_required: true`
- `usage: { used, limit_per_month, will_overage_by, allow_overage, ... }`

O frontend então oferece:
- "Aceitar cobrança extra" → habilita `allow_overage=true`
- "Fazer upgrade" → troca plano (ex.: mini → full)
- "Cancelar" → não envia

---

## Endpoints de billing (backend)
Durante desenvolvimento e também como base para produção:

### POST `/api/billing/upgrade`
- Troca plano da empresa criando nova subscription `active` e encerrando a anterior (`ended`)
- Body:
  ```json
  { "plan_key": "mini_erp" | "full_erp", "allow_overage": false }
