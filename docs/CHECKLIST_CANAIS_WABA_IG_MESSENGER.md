# Checklist — Aba Canais (WABA + Instagram/Messenger)

Origem: aprovação 2026-08-27 (estrutura revisada). Atualizar `Estado` (`[ ]` → `[x]` + data)
ao concluir cada item.

**Processo:** uma fase por vez até `npm test` verde; migrations via MCP `apply_migration` +
validação `execute_sql`; postura pré-produção radical (sem dual-path legado após cutover).

**Fora deste épico (decidido):**
- WA Embedded Signup (App Meta ainda sem o produto) — só preparar `provisioning_mode`
- Mídia na inbox Meta
- Recovery ativo no IG (B3)
- Migrar tokens para Supabase Vault (manter AES `CREDENTIALS_ENCRYPTION_KEY`)

**Épico seguinte (aprovado):** Templates + campanhas — ver
[`CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md`](./CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md)
(feature `whatsapp_templates_broadcast` em Pro + Market; fase **M0** para App Review Tech Provider).

**Quem conecta:** apenas `owner` / `admin` da empresa (não `member` / perfil `driver`).

---

## Decisões fechadas

| # | Tema | Decisão |
|---|------|--------|
| D1 | UI | Nova aba **Canais** em `/configuracoes` (não Cardápio; não rota `/canais` isolada) |
| D2 | WABA tenant | Paste guiado Cloud API (`phone_number_id`, `waba_id` opcional, `access_token` write-only) |
| D3 | IG/Messenger | Manter OAuth Page + fallback manual; mover UI para aba Canais |
| D4 | Platform | Continua podendo criar/atualizar canal (override/suporte) |
| D5 | Shared use case | Um serviço de credenciais WA usado por platform **e** tenant |
| D6 | Encrypt | `CREDENTIALS_ENCRYPTION_KEY` **obrigatório** em prod; sem plaintext em `provider_metadata` |
| D7 | RLS | `whatsapp_channels` alinhado a `service_role_only` (como `meta_messaging_channels`) |
| D8 | Plan gates | WA: feature `whatsapp_messages`; IG/Messenger: `omnichannel_ig_messenger` (Market) |
| D9 | Embedded Signup | Adiado; coluna/campo `provisioning_mode` = `tenant_paste` \| `platform` \| `embedded_signup` (futuro) |

---

## Resumo de fases

| Fase | Escopo | Estado |
|------|--------|--------|
| **C0** | Schema/segurança (RLS, colunas health/source, audit actor tenant) | [x] 2026-08-27 |
| **C1** | Domain + shared use case WA + APIs tenant | [x] 2026-08-27 (API + upsert; health probe depois) |
| **C2** | Health probes (WA + Meta Page) + disconnect | [ ] parcial: disconnect WA via PATCH |
| **C3** | UI aba Canais + mover Meta + guia | [x] 2026-08-27 |
| **C4** | Cortar dual-path plaintext; platform refatorado; testes | [ ] platform usa shared upsert; dual-path plaintext ainda em dev |
| **C5** | Docs env/runbook + smoke; preparar gancho Embedded Signup | [ ] |

---

## Estrutura-alvo (Clean Architecture nesta stack)

```text
Presentation
  app/(admin)/configuracoes/page.tsx          # tab "canais"
  components/channels/
    ChannelsSettings.tsx                      # orquestra seções
    WhatsAppCloudConnectPanel.tsx             # WABA paste + status + health
    MetaConnectPanel.tsx                      # move/rename de MetaMessagingSettings
    ChannelHealthBadge.tsx
    MetaConnectGuide.tsx                      # checklist App/webhook (sem secrets)

API (Route Handlers)
  app/api/admin/whatsapp-channel/route.ts     # GET | PUT | PATCH status
  app/api/admin/whatsapp-channel/health/route.ts
  app/api/admin/meta-messaging/route.ts       # + DELETE disconnect
  app/api/admin/meta-messaging/health/route.ts
  app/api/admin/meta-messaging/oauth/*        # existente (inalterado contrato)

Application
  lib/channels/upsertWhatsappChannelCredentials.ts   # shared platform + tenant
  lib/channels/whatsappChannelPublic.ts               # DTO sanitize
  lib/channels/probeWhatsappChannelHealth.ts
  lib/channels/probeMetaPageHealth.ts
  lib/meta/*                                  # OAuth/persist existentes

Domain
  src/domain/contracts/channels.ts            # Zod public DTOs + ChannelHealth

Data / DB
  public.whatsapp_channels                    # + colunas novas
  public.whatsapp_channel_credential_audit    # actor tenant + platform
  public.meta_messaging_channels              # + last_health_* opcional
```

---

## C0 — Schema e segurança

### C0.1 — Migration `whatsapp_channels` harden + campos

**Arquivo (criar):**
`supabase/migrations/YYYYMMDDHHMMSS_whatsapp_channels_tenant_connect_harden.sql`

**Adicionar colunas (se não existirem):**

| Coluna | Tipo | Uso |
|--------|------|-----|
| `provisioning_mode` | `text` NOT NULL default `'platform'` | `platform` \| `tenant_paste` \| `embedded_signup` |
| `credential_source` | `text` | `platform_user` \| `company_user` (último writer) |
| `last_health_at` | `timestamptz` | último probe |
| `last_health_ok` | `boolean` | resultado probe |
| `last_health_error` | `text` | mensagem curta (sem secret) |
| `token_expires_at` | `timestamptz` nullable | se conhecido / futuro Embedded |

**Checklist SQL:**
- [ ] `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- [ ] Drop policies antigas (SELECT company / admin mutate)
- [ ] Policy única `rls_whatsapp_channels_service_role_only`
- [ ] `REVOKE ALL … FROM anon, authenticated`
- [ ] `GRANT` só ao necessário para `service_role`
- [ ] Índice já existente em `from_identifier` / unique — validar; documentar conflito global
- [ ] Backfill: `provisioning_mode = 'platform'` nas linhas atuais

**Validação remota (`execute_sql`):**
- [ ] `pg_policies` → exatamente 1 policy service_role_only
- [ ] grants: `anon`/`authenticated` ausentes

### C0.2 — Audit tenant-aware

**Tabela:** `whatsapp_channel_credential_audit` (já existe)

**Adicionar (migration mesma ou irmã):**
- [ ] `actor_kind` (`platform` \| `company_user`)
- [ ] `actor_user_id` uuid nullable
- [ ] Manter `action` (`created` \| `credentials_updated` \| `deactivated` \| …)
- [ ] Nunca gravar token/ciphertext

### C0.3 — Meta messaging (opcional mínimo)

**Arquivo:** mesma migration ou `…_meta_messaging_health.sql`

- [ ] `last_health_at`, `last_health_ok`, `last_health_error` em `meta_messaging_channels`
- [ ] Confirmar RLS já `service_role_only` (remoto OK) — sem reabrir SELECT authenticated

### C0.4 — Aplicar migration

- [ ] MCP `apply_migration` no projeto linked
- [ ] Confirmar colunas/policies com `execute_sql`
- [ ] Commit migration no git **na mesma entrega**

---

## C1 — Domain + shared use case + APIs tenant WA

### C1.1 — Contratos Zod

**Arquivo (criar):** `src/domain/contracts/channels.ts`

- [ ] `WhatsappChannelPublicSchema` (`id`, `phoneNumberId`, `wabaId`, `status`, `hasAccessToken`, `provisioningMode`, `lastHealth*`, `displayPhone?`)
- [ ] `MetaChannelPublicSchema` (espelhar `toPublicMetaConnection`)
- [ ] `ChannelHealthSchema` (`ok`, `checkedAt`, `errorCode?`, `errorMessage?`)
- [ ] Testes em `tests/domain/channels.contracts.test.ts`

### C1.2 — Shared upsert WA

**Arquivo (criar):** `lib/channels/upsertWhatsappChannelCredentials.ts`

Extrair de `lib/platform/services/platformOps.ts` (`createChannel` / `updateChannelCredentials`):

- [ ] Input: `companyId`, `phoneNumberId`, `accessToken?`, `wabaId?`, `whatsappPhone?`, `actor`
- [ ] Encrypt obrigatório se prod / se key presente; **falhar** se key ausente em prod (não gravar plaintext)
- [ ] Upsert por `company_id` (1 canal ativo) ou update por `channel_id`
- [ ] Strip secrets de `provider_metadata`
- [ ] Invalidate `waConfigCache`
- [ ] Insert audit com `actor_kind` / `actor_user_id`
- [ ] Set `provisioning_mode` = `tenant_paste` \| `platform` conforme actor

**Arquivos a alterar:**
- [ ] `lib/platform/services/platformOps.ts` — delegar ao shared
- [ ] `lib/whatsapp/channelCredentials.ts` — `sanitize*` inclui novos campos públicos; remover/ignorar plaintext em leitura preferindo só encrypted

### C1.3 — API tenant WhatsApp channel

**Arquivos (criar):**

| Path | Métodos | Auth |
|------|---------|------|
| `app/api/admin/whatsapp-channel/route.ts` | `GET`, `PUT` (upsert), `PATCH` (status inactive) | `requireCompanyAccess(["owner","admin"])` + plan `whatsapp_messages` |
| (opcional) `app/api/admin/whatsapp-channel/health/route.ts` | `POST` probe | idem |

**Contrato GET (sem secret):**
```json
{
  "connection": { "...WhatsappChannelPublic" },
  "displayPhone": "+55...",
  "webhookPath": "/api/whatsapp/incoming",
  "guide": { "appMustMatchPlatformWebhook": true }
}
```

**PUT body:**
```json
{
  "phoneNumberId": "...",
  "wabaId": "...",
  "accessToken": "...",
  "whatsappPhone": "+55..."
}
```

- [ ] Nunca retornar `accessToken` / `encrypted_access_token`
- [ ] Erros tipados: `token_required`, `encryption_unavailable`, `phone_number_id_conflict`, `plan_required`
- [ ] Rate limit básico (mesmo padrão Meta webhook / admin)

### C1.4 — Platform APIs

- [ ] Manter `app/api/platform/channels/route.ts` e `…/[id]/credentials/route.ts`
- [ ] Garantir que usam o shared use case (sem lógica duplicada de encrypt)

---

## C2 — Health + disconnect

### C2.1 — Probe WhatsApp

**Arquivo (criar):** `lib/channels/probeWhatsappChannelHealth.ts`

- [ ] Graph `GET /{phone-number-id}?fields=display_phone_number,verified_name` com token decrypt
- [ ] Mapear 401/190 → `token_invalid`; 100 → `id_mismatch`
- [ ] Persistir `last_health_*` via admin client
- [ ] Endpoint `POST /api/admin/whatsapp-channel/health`

### C2.2 — Probe Meta Page

**Arquivo (criar):** `lib/channels/probeMetaPageHealth.ts`

- [ ] Graph `GET /{page-id}?fields=name,instagram_business_account` (ou debug mínimo)
- [ ] Endpoint `POST /api/admin/meta-messaging/health`
- [ ] Em falha de `subscribed_apps` no OAuth: refletir em health/UI (não só `console.warn`)

### C2.3 — Disconnect

- [ ] WA: `PATCH` status `inactive` ou endpoint dedicado; limpar token opcional (decidir: inactive mantém ciphertext até reconnect — preferir inactive + token permanece até replace)
- [ ] Meta: `DELETE` ou `PATCH status=inactive` em `app/api/admin/meta-messaging/route.ts`
- [ ] Audit `deactivated`

---

## C3 — UI aba Canais

### C3.1 — Tab Configurações

**Arquivo alterar:** `app/(admin)/configuracoes/page.tsx`

- [ ] Estender `type Tab` com `"canais"`
- [ ] Alias URL `?tab=canais` (+ talvez `channels`)
- [ ] Item na lista de tabs (ícone `Radio` / `Share2` / `MessageCircle`)
- [ ] Remover bloco `MetaMessagingSettings` da tab `cardapio`
- [ ] Render `<ChannelsSettings />` na tab `canais`

### C3.2 — Componentes

**Arquivos (criar):**

| Arquivo | Conteúdo |
|---------|----------|
| `components/channels/ChannelsSettings.tsx` | Layout: seção WA + seção IG (MarketGate) |
| `components/channels/WhatsAppCloudConnectPanel.tsx` | Form paste, status, health, guia |
| `components/channels/MetaConnectPanel.tsx` | Conteúdo atual de `MetaMessagingSettings` |
| `components/channels/ChannelHealthBadge.tsx` | ok / fail / unknown |
| `components/channels/MetaConnectGuide.tsx` | texto App Review / webhook / redirect OAuth |

**Arquivos alterar/deprecar:**
- [ ] `components/menu/MetaMessagingSettings.tsx` — re-export de `MetaConnectPanel` **ou** delete após move (preferir delete + update imports)
- [ ] Inbox copy em `components/whatsapp/WhatsAppInbox.tsx` — link “Configurações → Canais” (não Cardápio)

### C3.3 — UX obrigatória WA

- [ ] Badge Conectado / Pendente / Erro (health)
- [ ] Campos write-only de token (não ecoar)
- [ ] Aviso: *token e Phone Number ID devem pertencer ao mesmo Meta App cujo webhook o Renthus valida* (`WHATSAPP_APP_SECRET`)
- [ ] Link copy da Callback URL `/api/whatsapp/incoming`
- [ ] Botão “Testar conexão” (health)
- [ ] Botão “Desativar canal”
- [ ] Se `provisioning_mode === 'platform'`: badge “Provisionado pela plataforma” + ainda permitir reconnect pelo lojista

### C3.4 — UX IG/Messenger

- [ ] Manter OAuth “Conectar com Facebook”
- [ ] Picker de Pages
- [ ] Toggles Messenger / Instagram
- [ ] Health + reconnect
- [ ] Gate `MarketPlanGate` / `omnichannel_ig_messenger`

---

## C4 — Hardening + testes

### C4.1 — Remover dual-path perigoso

- [ ] Produção: se encrypt falhar → 500 `encryption_unavailable` (WA e Meta)
- [ ] Leitura: preferir só `encrypted_*`; plaintext `provider_metadata.access_token` / `page_access_token` → log warn + ignore em prod (ou migrate one-shot para encrypted e limpar)
- [ ] Env `WHATSAPP_TOKEN` / `META_PAGE_ACCESS_TOKEN`: manter só como fallback **dev** documentado; em prod worker exigir canal por empresa

### C4.2 — Testes

| Arquivo | Cobrir |
|---------|--------|
| `tests/domain/channels.contracts.test.ts` | Zod |
| `tests/channels/upsertWhatsappChannelCredentials.test.ts` | encrypt, audit actor, conflict |
| `tests/channels/whatsappChannelApi.auth.test.ts` | owner/admin ok; member 403 |
| `tests/meta/…` existentes | health + disconnect se aplicável |
| `tests/proxy.test.ts` | sem regressão webhook exemptions |

- [ ] `npm test` verde

### C4.3 — Segurança checklist

- [ ] Nenhuma query Supabase client-side em `whatsapp_channels` / `meta_messaging_channels`
- [ ] DTO público sem secrets
- [ ] Rate limit save credentials
- [ ] OAuth cookie pending pages ainda httpOnly + TTL

---

## C5 — Docs, env, smoke, gancho futuro

### C5.1 — Documentação

**Arquivos alterar/criar:**
- [ ] Este checklist — marcar fases
- [ ] `docs/BILLING_PLANS.md` — nota: Canais tab; WA all plans; IG Market
- [ ] `docs/CHATBOT_PROD.md` — tenant self-serve paste + mesmo App webhook
- [ ] `docs/CHECKLIST_MVP_LANCAMENTO.md` — link Canais
- [ ] `docs/PLANO_LIMPEZA_AGENTE_IA.md` — corrigir §7 “placeholder” vs Canais feito
- [ ] `.env.example` — listar vars Meta/WA + `CREDENTIALS_ENCRYPTION_KEY` obrigatório prod

### C5.2 — Env / Meta Developer (ops, não código)

| Recurso | Obrigatório |
|---------|-------------|
| `CREDENTIALS_ENCRYPTION_KEY` | Sim (prod) |
| `WHATSAPP_APP_SECRET` + verify token | Sim (webhook WA) |
| `META_APP_ID` + `META_APP_SECRET` | Sim (OAuth IG) |
| `META_MESSAGING_WEBHOOK_VERIFY_TOKEN` | Recomendado |
| Callback OAuth cadastrado | `/api/admin/meta-messaging/oauth/callback` |
| Webhook WA no App da plataforma | `/api/whatsapp/incoming` |
| Webhook Page/IG | `/api/meta/messaging/incoming` |
| App Review scopes IG (Advanced) | Para clientes sem role no app |
| **Embedded Signup product no App** | **Não** nesta entrega |

### C5.3 — Smoke manual

- [ ] Owner Essencial: conecta WA paste → health ok → mensagem inbound enfileira
- [ ] Owner Market: OAuth IG → página com IGSID → inbound IG
- [ ] Member/driver: API 403
- [ ] Platform override credencial → audit `platform` + UI tenant mostra conectado
- [ ] Phone number id duplicado → erro claro
- [ ] Token inválido → health fail + badge erro

### C5.4 — Preparação Embedded Signup (só gancho)

- [ ] `provisioning_mode = 'embedded_signup'` reservado (sem UI)
- [ ] Comentário/ADR curto em `docs/ADR/` **somente se** quiser formalizar (opcional): “quando App tiver Embedded Signup, substituir paste”
- [ ] **Não** implementar FB.login WA / sessionInfoListener nesta entrega

---

## Inventário de arquivos

### Criar

```text
supabase/migrations/YYYYMMDDHHMMSS_whatsapp_channels_tenant_connect_harden.sql
src/domain/contracts/channels.ts
lib/channels/upsertWhatsappChannelCredentials.ts
lib/channels/whatsappChannelPublic.ts
lib/channels/probeWhatsappChannelHealth.ts
lib/channels/probeMetaPageHealth.ts
app/api/admin/whatsapp-channel/route.ts
app/api/admin/whatsapp-channel/health/route.ts
app/api/admin/meta-messaging/health/route.ts
components/channels/ChannelsSettings.tsx
components/channels/WhatsAppCloudConnectPanel.tsx
components/channels/MetaConnectPanel.tsx
components/channels/ChannelHealthBadge.tsx
components/channels/MetaConnectGuide.tsx
tests/domain/channels.contracts.test.ts
tests/channels/upsertWhatsappChannelCredentials.test.ts
tests/channels/whatsappChannelApi.auth.test.ts
docs/CHECKLIST_CANAIS_WABA_IG_MESSENGER.md          # este arquivo
```

### Alterar

```text
app/(admin)/configuracoes/page.tsx
lib/platform/services/platformOps.ts
lib/whatsapp/channelCredentials.ts
lib/meta/messagingChannels.ts                       # health fields + public DTO
app/api/admin/meta-messaging/route.ts               # DELETE/disconnect
lib/meta/oauthPersist.ts                            # falha subscribe → status/health
components/whatsapp/WhatsAppInbox.tsx                # copy “Canais”
components/menu/MetaMessagingSettings.tsx            # remove ou re-export
docs/BILLING_PLANS.md
docs/CHATBOT_PROD.md
docs/CHECKLIST_MVP_LANCAMENTO.md
docs/PLANO_LIMPEZA_AGENTE_IA.md
.env.example
```

### Não tocar (neste épico)

```text
Embedded Signup / FB JS SDK WA session
Inbox mídia Meta
Recovery outbound IG
Vault migration
Baileys / QR WhatsApp Web (não faz parte do Cloud API)
```

---

## Ordem de execução (caminho crítico)

```text
C0 migration harden + apply remoto
  → C1 shared upsert + API tenant WA
    → C2 health + disconnect
      → C3 UI aba Canais + mover Meta
        → C4 dual-path off + npm test
          → C5 docs + smoke
```

**Definition of Done:** lojista `owner`/`admin` conecta WABA e (Market) IG/Messenger na aba Canais; token nunca vaza; health funciona; platform ainda provisiona; `npm test` verde; migration no remoto.

---

## Nota operacional crítica (produção)

O paste do lojista **só funciona** se o `phone_number_id` + token estiverem no **mesmo Meta App** configurado no Renthus (webhook + `WHATSAPP_APP_SECRET`).  
Se cada cliente criar App isolado sem apontar webhook/secret para a plataforma, a UI “salva” e o inbound **não chega**. Isso deve estar explícito no guia da UI até existir Embedded Signup.
