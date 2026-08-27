# Checklist — Templates WhatsApp + Campanhas (massa)

Origem: aprovação 2026-08-27. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir.

**Processo:** uma fase por vez até `npm test` verde; migrations via MCP + `execute_sql`;
pré-produção radical (sem dual-path).

**Relacionado:** [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md)
(credenciais WABA na aba Canais — pré-requisito operacional).

**Fora deste épico:** Embedded Signup; broadcast IG/Messenger; Vault; editor visual rico.

---

## Decisões fechadas

| # | Tema | Decisão |
|---|------|--------|
| D1 | Planos | Feature **`whatsapp_templates_broadcast`** só em **Pro** e **Market** (não Essencial) |
| D2 | Ordem produto | **T0** sync+envio 1:1 → **T1** consent/opt-out → **T2** campanhas → **T3** criar no ERP (pode antecipar fatia p/ Meta Review) |
| D3 | Fonte da verdade | Meta Graph / WhatsApp Manager; ERP espelha status |
| D4 | Fila | Reusar `outbound_jobs` + `outbound-worker` (`purpose = broadcast_template`) |
| D5 | MARKETING | Sem consent + opt-out **não** dispara massa |
| D6 | RBAC | `owner`/`admin` gerem templates e campanhas; envio 1:1 inbox com `whatsapp.operate` |
| D7 | Meta Tech Provider | Entregar **superfície M0** (abaixo) para vídeo/API do App Review **antes** de campanhas em massa |

---

## Resumo de fases

| Fase | Escopo | Estado |
|------|--------|--------|
| **M0** | Superfície mínima App Review Tech Provider | [x] 2026-08-27 |
| **T0** | Schema mirror + sync + send template 1:1 (inbox) | [x] 2026-08-27 |
| **T1** | Consentimento + opt-out (`PARAR`/`SAIR`) | [x] 2026-08-27 |
| **T2** | Campanhas / massa + progresso + cancel | [ ] |
| **T3** | Criar/submeter template pelo ERP (completo) | [x] parcial M0 (body+footer) |
| **TX** | Plan catalog seed + docs + testes E2E smoke | [x] seed + doc review + contracts test |

---

## M0 — Superfície para passar App Review (Tech Provider)

Objetivo: o revisor vê **o produto Renthus** exercendo as permissões, não só Postman/Manager isolados.

### Permissões Meta mapeadas

| Permissão | Evidência que a Meta pede | O que entregamos no M0 |
|-----------|---------------------------|-------------------------|
| `whatsapp_business_messaging` | Vídeo: app envia msg Cloud API + celular recebe | Já: `/whatsapp` texto. **M0+:** botão **Enviar template** na inbox (Graph `type=template`) |
| `whatsapp_business_management` | Postman test calls + vídeo criar/salvar modelo | **M0:** tela **Templates** com **Criar modelo** (Graph) + **Sincronizar** + lista status (`PENDING`/`APPROVED`). Vídeo grava essa UI. Postman continua obrigatório em paralelo |

### Escopo mínimo M0 (bloqueante review)

```text
app/(admin)/templates/page.tsx
components/whatsapp-templates/TemplateList.tsx
components/whatsapp-templates/TemplateCreateForm.tsx   # nome, idioma, categoria, corpo {{1}}
components/whatsapp-templates/TemplateSyncButton.tsx

app/api/admin/whatsapp-templates/route.ts             # GET list, POST sync
app/api/admin/whatsapp-templates/submit/route.ts      # POST create → Meta
app/api/whatsapp/send/route.ts                        # aceitar payload template (ou rota dedicada)

lib/whatsapp-templates/syncTemplatesFromMeta.ts
lib/whatsapp-templates/submitTemplateToMeta.ts
lib/whatsapp-templates/sendTemplateMessage.ts

supabase: whatsapp_message_templates (+ RLS service_role_only)
feature: whatsapp_templates_broadcast em Pro + Market
```

### Roteiro de gravação (após M0)

1. **Management:** Configurações/Canais com WABA → `/templates` → criar modelo Utility → Salvar → status PENDING → Sync.  
2. **Messaging:** `/whatsapp` → escolher template APPROVED (ou texto livre se template ainda pending) → enviar → celular recebe.  
3. Anexar vídeos + completar coleção Postman Meta (test calls até 24h no formulário).

### Checklist M0

- [ ] Migration `whatsapp_message_templates` (colunas abaixo) + FORCE RLS + revoke + policy service_role_only
- [ ] Seed feature `whatsapp_templates_broadcast` + `plan_features` para Pro e Market
- [ ] `PLAN_CATALOG` Pro/Market incluem a feature; `requirePlanFeature` hint PT-BR
- [ ] Sync Graph `GET /{waba_id}/message_templates`
- [ ] Submit Graph `POST /{waba_id}/message_templates` (categoria UTILITY no demo)
- [ ] UI `/templates` list + create + sync (gate plano)
- [ ] Inbox: enviar template 1:1 (variáveis simples)
- [ ] Nunca expor access token na UI/API pública
- [ ] Testes unitários sync/submit sanitize + plan gate 403 Essencial
- [ ] Doc curta `docs/META_APP_REVIEW_WHATSAPP.md` com passos de vídeo

**DoD M0:** owner Pro/Market cria template no ERP, vê status, sincroniza; pode enviar template aprovado pela inbox; Essencial recebe upgrade hint.

---

## Estrutura-alvo completa

```text
Presentation
  app/(admin)/templates/page.tsx
  app/(admin)/campanhas/page.tsx
  components/whatsapp-templates/*
  components/campaigns/*
  components/whatsapp/WhatsAppInbox.tsx          # + Enviar template

API
  app/api/admin/whatsapp-templates/route.ts
  app/api/admin/whatsapp-templates/submit/route.ts
  app/api/admin/whatsapp-templates/[name]/route.ts
  app/api/admin/campaigns/route.ts
  app/api/admin/campaigns/[id]/route.ts
  app/api/admin/campaigns/[id]/start/route.ts
  (inbound) lib path: detectar PARAR/SAIR → consent revoke

Application
  lib/whatsapp-templates/syncTemplatesFromMeta.ts
  lib/whatsapp-templates/submitTemplateToMeta.ts
  lib/whatsapp-templates/sendTemplateMessage.ts
  lib/campaigns/buildAudience.ts
  lib/campaigns/enqueueCampaign.ts
  lib/campaigns/evaluateCampaignGates.ts
  lib/chatbot/outbound/*                        # estender purpose + worker

Domain
  src/domain/contracts/whatsappTemplates.ts
  src/domain/contracts/campaigns.ts
  src/domain/messaging/templateCategories.ts

Data
  whatsapp_message_templates
  customer_message_consents
  broadcast_campaigns
  broadcast_campaign_recipients
```

---

## Schema (migrações)

### `whatsapp_message_templates`

| Coluna | Tipo | Notas |
|--------|------|--------|
| `id` | uuid PK | |
| `company_id` | uuid FK | índice |
| `waba_id` | text | |
| `meta_template_id` | text nullable | id Meta quando existir |
| `name` | text | unique (company_id, name, language) |
| `language` | text | ex. `pt_BR` |
| `category` | text | `UTILITY` \| `MARKETING` \| `AUTHENTICATION` |
| `status` | text | `PENDING` \| `APPROVED` \| `REJECTED` \| `PAUSED` \| `DISABLED` |
| `components` | jsonb | corpo/header/buttons espelho Meta |
| `rejection_reason` | text nullable | |
| `last_synced_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

RLS: FORCE + service_role_only + revoke anon/authenticated.

### `customer_message_consents` (T1)

| Coluna | Tipo |
|--------|------|
| `company_id`, `customer_id` | uuid |
| `channel` | `whatsapp` |
| `marketing_opt_in` | boolean |
| `opt_in_at` / `opt_out_at` | timestamptz |
| `source` | text (`inbound_keyword`, `checkout`, `admin`, …) |
| unique `(company_id, customer_id, channel)` | |

### `broadcast_campaigns` + `broadcast_campaign_recipients` (T2)

- Campaign: `template_id`, `status` (`draft`/`running`/`paused`/`done`/`cancelled`), `audience_filter` jsonb, counts, `created_by`
- Recipients: `customer_id`, `phone_e164`, `status`, `outbound_job_id`, `error`
- Unique/dedup por campanha+telefone

---

## T0 — Sync + envio 1:1

- [ ] Contratos Zod
- [ ] `sendTemplateMessage` via Graph + persist em `whatsapp_messages`
- [ ] Inbox UI picker templates APPROVED
- [ ] Fora 24h: só template (ligar com `customerServiceWindow`)
- [ ] Testes send + sanitize

## T1 — Consent / opt-out

- [ ] Migration consents
- [ ] Inbound: `PARAR`/`SAIR`/`STOP` → opt-out + confirmação
- [ ] Opt-in explícito (checkbox admin ou palavra `QUERO` — definir UX)
- [ ] Gate MARKETING em send template / campaign
- [ ] Doc LGPD/Meta copy PT-BR

## T2 — Campanhas

- [ ] Wizard audiência: todos com phone / com pedido N dias / lista manual
- [ ] Enfileirar `outbound_jobs` purpose `broadcast_template`
- [ ] Worker envia com rate limit + fairness
- [ ] UI progresso / cancel
- [ ] Métricas: sent/failed/opt_out_skipped
- [ ] **Bloquear** start se template MARKETING e audiência sem opt-in

## T3 — Create completo no ERP

- [ ] Form completo (header media, buttons, exemplos)
- [ ] Poll/sync status até APPROVED/REJECTED
- [ ] Mostrar `rejection_reason`

## TX — Plano, nav, docs

**Alterar:**
- [ ] `lib/billing/planCatalog.ts` — feature em `pro` e `market`
- [ ] Migration seed `features` + `plan_features`
- [ ] `lib/billing/requirePlanFeature.ts` — hint upgrade
- [ ] `components/AdminSidebar.tsx` — Templates (+ Campanhas em T2)
- [ ] `docs/BILLING_PLANS.md`
- [ ] `docs/CHATBOT_PROD.md` — marcar HSM Fase 2 em andamento
- [ ] `docs/META_APP_REVIEW_WHATSAPP.md` — roteiro vídeo
- [ ] `.env.example` se precisar vars Graph extras

---

## Inventário de arquivos

### Criar (M0 / T0)

```text
supabase/migrations/YYYYMMDDHHMMSS_whatsapp_message_templates.sql
supabase/migrations/YYYYMMDDHHMMSS_feature_whatsapp_templates_broadcast.sql
src/domain/contracts/whatsappTemplates.ts
lib/whatsapp-templates/syncTemplatesFromMeta.ts
lib/whatsapp-templates/submitTemplateToMeta.ts
lib/whatsapp-templates/sendTemplateMessage.ts
app/api/admin/whatsapp-templates/route.ts
app/api/admin/whatsapp-templates/submit/route.ts
app/(admin)/templates/page.tsx
components/whatsapp-templates/TemplateList.tsx
components/whatsapp-templates/TemplateCreateForm.tsx
components/whatsapp-templates/TemplateSyncButton.tsx
docs/META_APP_REVIEW_WHATSAPP.md
tests/whatsapp-templates/*.test.ts
```

### Criar (T1–T2)

```text
supabase/migrations/…_customer_message_consents.sql
supabase/migrations/…_broadcast_campaigns.sql
lib/campaigns/*
app/api/admin/campaigns/*
app/(admin)/campanhas/page.tsx
components/campaigns/*
```

### Alterar

```text
lib/billing/planCatalog.ts
lib/billing/requirePlanFeature.ts
lib/whatsapp/send.ts                         # ou wrapper template
app/api/whatsapp/send/route.ts
components/whatsapp/WhatsAppInbox.tsx
components/AdminSidebar.tsx
lib/chatbot/outbound/gates.ts                # T1/T2
lib/chatbot/queue ou outbound worker         # purpose broadcast
app/api/whatsapp/incoming/route.ts           # opt-out keywords T1
docs/BILLING_PLANS.md
docs/CHATBOT_PROD.md
docs/CHECKLIST_CANAIS_WABA_IG_MESSENGER.md   # link cruzado
```

---

## Ordem de execução (caminho crítico)

```text
M0 (App Review) ──┬── migration templates + feature Pro/Market
                  ├── sync + submit + UI /templates
                  ├── send template 1:1 inbox
                  └── doc vídeo Meta
        ↓
T0 polish (janela 24h + testes)
        ↓
T1 consent/opt-out
        ↓
T2 campanhas massa
        ↓
T3 form template completo (se M0 ficou minimal)
```

**Paralelo recomendado com Canais:** C0–C1 (credenciais tenant) **antes ou junto** de M0 — sem `waba_id` + token válidos sync/submit quebram.

---

## Definition of Done

- [ ] Pro/Market: `/templates` cria + sync + lista status
- [ ] Inbox envia template aprovado; celular recebe (vídeo Meta)
- [ ] Essencial: 403/upgrade hint
- [ ] T1+T2: massa só com gates Meta/consent
- [ ] RLS service_role_only; zero token no client
- [ ] `npm test` verde; migration aplicada no remoto

---

## Nota App Review (ops)

Enquanto Advanced Access não estiver aprovado, create/sync pode falhar para usuários sem role no App — use o **número/WABA de teste do próprio App** no vídeo. Coleção Postman da Meta continua obrigatória e independente do ERP.
