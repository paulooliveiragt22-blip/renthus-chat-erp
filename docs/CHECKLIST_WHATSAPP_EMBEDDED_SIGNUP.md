# Checklist — WhatsApp Embedded Signup + Coexistence (C6)

Origem: aprovação 2026-09-06 (App Review + ADR-0010). Atualizar `Estado` (`[ ]` → `[x]` + data)
ao concluir cada item.

**ADR:** [`ADR/0010-whatsapp-embedded-signup-coexistence.md`](./ADR/0010-whatsapp-embedded-signup-coexistence.md)  
**Predecessor:** [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) (C0–C5)  
**Env/ops:** [`ENV_META_CHANNELS.md`](./ENV_META_CHANNELS.md)

**Processo:** uma fase por vez até `npm test` verde; migrations via MCP `apply_migration` +
`execute_sql`; pré-produção radical (sem paste + Embedded Signup lado a lado na UI do tenant).

**Quem conecta:** `owner` / `admin` + feature `whatsapp_messages`.

---

## Decisões fechadas (não reabrir no código)

| # | Tema | Decisão |
|---|------|--------|
| D1 | UX tenant | Embedded Signup; paste some da aba Canais |
| D2 | Modo | Coexistence **default**; Cloud API puro se o número não qualificar |
| D3 | Platform | Override de credencial continua (D4 Canais) |
| D4 | Carrinho | Só inbound do **cliente** + pipeline PRO (ou modal do inbox). Eco do celular **não** cria carrinho |
| D5 | Sync 24h | `smb_app_data` history/contacts = espelho; sem `chatbot_queue` |
| D6 | Config Meta | `META_EMBEDDED_SIGNUP_CONFIG_ID` ≠ `META_LOGIN_CONFIG_ID` (IG) |
| D7 | Token | BISU sem expiração; AES; `debug_token` + `evaluateGrantedMetaScopes('whatsapp')` |
| D8 | Register | Só Cloud API puro; Coexistence **skip** `/{phone}/register` |
| D9 | Billing Meta | Cliente paga conversa na Meta (Tech Provider). Sem credit line neste épico |
| D10 | Fora | NLP do texto do lojista → pedido; Vault; coexistência → Cloud API reverse (impossível na Meta) |

---

## Resumo de fases

| Fase | Escopo | Estado |
|------|--------|--------|
| **C6.0** | Ops Meta (dashboard + env) — sem código de produto | [ ] dono |
| **C6.1** | Schema mínimo + upsert `embedded_signup` | [x] 2026-09-06 |
| **C6.2** | Application: exchange / subscribe / register / sync | [x] 2026-09-06 |
| **C6.3** | API complete + config (gates B15) | [x] 2026-09-06 |
| **C6.4** | Inbound: `account_update`, echo, history, contacts | [x] 2026-09-06 |
| **C6.5** | CSP Facebook SDK | [x] 2026-09-06 |
| **C6.6** | UI Canais (botão; paste some) | [x] 2026-09-06 |
| **C6.7** | Testes + docs + smoke | [x] 2026-09-06 |

---

## C6.0 — Ops Meta (bloqueante; dono do App)

Fazer **antes** ou em paralelo ao C6.1. Sem isto o botão só funciona para admin do App.

- [ ] App em **Live** (não só permissões Approved em Development)
- [ ] Business Verification do Portfolio **Renthus** (Tech Provider)
- [ ] Produto WhatsApp no App + webhook `https://<domínio>/api/whatsapp/incoming`
- [ ] Campos do webhook WABA: `messages` (já), `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`
- [ ] Facebook Login for Business → Configuration **nova** pelo template *WhatsApp Embedded Signup*
  - Assets: WABA + phone numbers
  - Permissões: só `whatsapp_business_management` + `whatsapp_business_messaging`
  - Token: Business Integration System User, **never expire**
- [ ] Login → Settings: Client OAuth, Web OAuth, JS SDK, Enforce HTTPS, Strict Mode
- [ ] Allowed Domains = host do SaaS (prod + preview se for testar)
- [ ] Valid OAuth Redirect URIs = origem HTTPS exata (byte a byte)
- [ ] Copiar Configuration ID → Vercel `META_EMBEDDED_SIGNUP_CONFIG_ID`
- [ ] `NEXT_PUBLIC_META_APP_ID` = mesmo `META_APP_ID` do App Tech Provider
- [ ] `META_APP_SECRET` / `WHATSAPP_APP_SECRET` já batem com o App do webhook
- [ ] Redeploy após env

**Não** reutilizar `META_LOGIN_CONFIG_ID` (escopos de Page/IG — S14).

---

## C6.1 — Schema / contrato de persistência

Colunas C0 já existem (`provisioning_mode`, `waba_id`, `token_expires_at`, audit). Só completar o que faltar.

**Arquivo (criar se precisar de coluna/check):**  
`supabase/migrations/YYYYMMDDHHMMSS_whatsapp_embedded_signup_coexistence.sql`

- [ ] `provisioning_mode` CHECK já inclui `embedded_signup` — confirmar no remoto
- [ ] Se não existir: `coexistence boolean` **ou** persistir em `provider_metadata.coexistence` / `is_on_biz_app` (preferir coluna se for filtrar; senão metadata — uma fonte só)
- [ ] `token_expires_at` preenchível (null = never)
- [ ] Comentário da coluna: tirar “(futuro)”
- [ ] Sem tabela nova de tokens
- [ ] Se criar tabela: RLS FORCE + `rls_*_service_role_only` + REVOKE anon/authenticated (`supabase-migrations-seguranca.mdc`)
- [ ] MCP `apply_migration` + `execute_sql` de policy/grants
- [ ] `upsertWhatsappChannelCredentials` aceita `provisioningMode: "embedded_signup"` (hoje só `platform` \| `tenant_paste`)

**Alterar:**

```text
lib/channels/upsertWhatsappChannelCredentials.ts
lib/whatsapp/channelCredentials.ts          # PublicWhatsappChannel + coexistence?
src/domain/contracts/channels.ts            # criar se ainda não existir; senão estender
```

---

## C6.2 — Application (server-only)

**Criar:**

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/channels/exchangeEmbeddedSignupCode.ts` | `GET/POST graph …/oauth/access_token` (code + app id/secret). Timeout `AbortController`. Nunca no client |
| `lib/channels/debugWhatsappEmbeddedToken.ts` | `debug_token` + `evaluateGrantedMetaScopes('whatsapp')`; rejeita `META_FORBIDDEN_TOKEN_SCOPES` |
| `lib/channels/subscribeWabaToApp.ts` | `POST /{waba_id}/subscribed_apps` |
| `lib/channels/resolveWabaPhoneNumberId.ts` | `GET /{waba_id}/phone_numbers` quando sessionInfo não trouxe phone |
| `lib/channels/registerCloudApiPhone.ts` | `POST /{phone}/register` — **só** Cloud API puro |
| `lib/channels/startCoexistenceDataSync.ts` | `POST /{phone}/smb_app_data` contacts + history; best-effort; log se falhar (janela 24h) |
| `lib/channels/completeWhatsappEmbeddedSignup.ts` | Orquestra: exchange → scopes → subscribe → (register?) → upsert → probe health → sync se Coexistence |

**Reusar:**

```text
lib/whatsapp/metaGraphFetch.ts
lib/meta/metaAppCredentials.ts              # + resolveEmbeddedSignupConfigId()
lib/meta/metaOauthScopes.ts                 # já tem META_WHATSAPP_* 
lib/channels/probeWhatsappChannelHealth.ts
lib/channels/upsertWhatsappChannelCredentials.ts
```

Regras do use case:

- [ ] `companyId` só do caller (sessão)
- [ ] Coexistence: **não** register; `GET phone?fields=is_on_biz_app,platform_type` para gravar flag
- [ ] Phone Number ID global único — conflito `phone_number_id_conflict` (já existe)
- [ ] Idempotente: mesmo company + mesmo phone reconecta (update token)
- [ ] Erros tipados (`unknown` no catch); sem vazar token no log/response
- [ ] Cliente Graph no escopo de módulo (não por request)

---

## C6.3 — APIs tenant

**Criar:**

```text
app/api/admin/whatsapp-channel/embedded-signup/config/route.ts
app/api/admin/whatsapp-channel/embedded-signup/complete/route.ts
```

### GET `…/config`

- Gate: `requireCompanyAccess(["owner","admin"])` + `requirePlanFeature(..., "whatsapp_messages")`
- Retorna: `{ appId, graphVersion, configId, featureTypeDefault, sessionInfoVersion }`
- **Não** devolve app secret
- 503 se `META_APP_ID` ou `META_EMBEDDED_SIGNUP_CONFIG_ID` ausentes

### POST `…/complete`

Body Zod (não aceitar `company_id`):

```ts
{
  code: string,
  event: "FINISH" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  wabaId: string,
  phoneNumberId?: string,
  displayPhone?: string | null,
}
```

- [ ] Rate limit (ex. 5/10 min / company) — evita replay de code
- [ ] Code de uso único; falha Meta → 409/422 com hint sem secret
- [ ] Linha em `docs/SECURITY_CREATEADMIN_INVENTORY.md` (sessão tenant)
- [ ] `createAdminRouteGate` / teste estático continua verde

**Alterar (paste some do tenant, API pode 410 ou ficar só platform):**

```text
app/api/admin/whatsapp-channel/route.ts     # PUT token: 410 gone no tenant OU só platform
```

Preferência radical: `PUT` tenant com `accessToken` → **410** + hint “use Conectar WhatsApp”. Platform route inalterada.

---

## C6.4 — Inbound webhook

**Alterar:**

```text
app/api/whatsapp/incoming/route.ts
```

Hoje o loop ignora `change.field !== "messages"`. Estender:

| `field` | Ação |
|---------|------|
| `messages` | Como hoje (cliente → fila → carrinho) |
| `smb_message_echoes` | Insert `whatsapp_messages` outbound/`human`; `bot_active=false`; **não** `chatbot_queue` |
| `history` | Insert inbound/outbound histórico; dedup `provider_message_id`; **não** fila |
| `smb_app_state_sync` | Upsert contato (nome/fone) se houver tabela/uso; senão log estruturado + persist raw mínimo |
| `account_update` | Se `PARTNER_ADDED` e canal ainda não existe: log + métrica (complete() é o caminho feliz; webhook é rede) |

- [ ] Dedup 23505 em todos os inserts
- [ ] Echo **não** chama `ensureBotActiveOrRecover` no sentido de religar o bot
- [ ] Testes de parse (fixtures) para cada field — sem payload de exploit

**Testes (criar/estender):**

```text
tests/integration/webhook-integration.test.ts
tests/channels/embeddedSignupInboundFields.test.ts   # criar
```

---

## C6.5 — CSP

**Alterar:**

```text
lib/security/cspPolicy.ts
tests/security/cspPolicy.test.ts
tests/security/cspProxy.test.ts          # se o header composto mudar
tests/proxy.test.ts                      # só se o snapshot do header quebrar
```

- [ ] `connect-src` += `https://www.facebook.com https://web.facebook.com https://connect.facebook.net`
- [ ] `frame-src https://www.facebook.com https://web.facebook.com`
- [ ] SDK via `next/script` com nonce do `x-nonce` (já no layout) — **não** `'unsafe-inline'`
- [ ] `npm test` nos testes CSP acima

---

## C6.6 — UI (Canais)

**Criar:**

```text
components/channels/WhatsAppEmbeddedSignupButton.tsx
lib/meta/loadFacebookSdk.ts              # FB.init uma vez; falha alta se window.FB undefined
```

**Alterar:**

```text
components/channels/ChannelsSettings.tsx
```

UI:

- [ ] Primário: **Conectar WhatsApp** (Radix Button; loading; erro toast/`sonner`)
- [ ] Listener `message` só `https://www.facebook.com` / `https://web.facebook.com`; parse `WA_EMBEDDED_SIGNUP`
- [ ] Esperar **code + session** (podem chegar fora de ordem) antes do POST complete
- [ ] Cancelamento / `status=unknown`: mensagem clara, sem retry cego do code
- [ ] Badge: Conectado / Coexistence (`is_on_biz_app`) / Cloud API / health
- [ ] Remover inputs Phone Number ID / token / WABA da jornada tenant
- [ ] Manter Testar conexão + Ativar/Desativar
- [ ] Copy: “Você continua usando o WhatsApp Business no celular. Pedidos automáticos vêm do que o **cliente** pede ao assistente; o que você digitar no celular aparece na inbox e pausa o bot.”
- [ ] a11y: botão nativo, Esc não aplica (popup é da Meta), focus volta ao botão no close
- [ ] Dark mode tokens

**Não criar** pasta `/canais`. Não Facebook Login redirect (isso é IG).

---

## C6.7 — Testes, docs, inventário

**Criar:**

```text
tests/channels/completeWhatsappEmbeddedSignup.test.ts
tests/channels/exchangeEmbeddedSignupCode.test.ts
tests/channels/embeddedSignupComplete.auth.test.ts
docs/SMOKE_WHATSAPP_EMBEDDED_SIGNUP.md
```

**Alterar:**

```text
docs/ENV_META_CHANNELS.md
docs/CHECKLIST_CANAIS_WABA_IG_MESSENGER.md          # D9 → ADR-0010
docs/CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md      # “Fora” Embedded Signup
docs/SECURITY_CREATEADMIN_INVENTORY.md
docs/CHATBOT_PROD.md                                # 2 linhas: echo ≠ carrinho
lib/meta/metaAppCredentials.ts
tests/meta/metaOauthScopes.test.ts                  # se exportar config resolver
```

- [ ] `npm test` verde
- [ ] Smoke manual (abaixo)
- [ ] Sem secrets no git

---

## Inventário de arquivos

### Criar

```text
docs/ADR/0010-whatsapp-embedded-signup-coexistence.md          # este épico (feito)
docs/CHECKLIST_WHATSAPP_EMBEDDED_SIGNUP.md                     # este arquivo
docs/SMOKE_WHATSAPP_EMBEDDED_SIGNUP.md

supabase/migrations/YYYYMMDDHHMMSS_whatsapp_embedded_signup_coexistence.sql
  # só se coluna coexistence / comment; senão pular

lib/meta/loadFacebookSdk.ts
lib/channels/exchangeEmbeddedSignupCode.ts
lib/channels/debugWhatsappEmbeddedToken.ts
lib/channels/subscribeWabaToApp.ts
lib/channels/resolveWabaPhoneNumberId.ts
lib/channels/registerCloudApiPhone.ts
lib/channels/startCoexistenceDataSync.ts
lib/channels/completeWhatsappEmbeddedSignup.ts

app/api/admin/whatsapp-channel/embedded-signup/config/route.ts
app/api/admin/whatsapp-channel/embedded-signup/complete/route.ts

components/channels/WhatsAppEmbeddedSignupButton.tsx

tests/channels/completeWhatsappEmbeddedSignup.test.ts
tests/channels/exchangeEmbeddedSignupCode.test.ts
tests/channels/embeddedSignupComplete.auth.test.ts
tests/channels/embeddedSignupInboundFields.test.ts
```

### Alterar

```text
lib/channels/upsertWhatsappChannelCredentials.ts    # mode embedded_signup
lib/whatsapp/channelCredentials.ts                  # DTO público + flag
lib/meta/metaAppCredentials.ts                      # resolveEmbeddedSignupConfigId
lib/security/cspPolicy.ts                           # facebook frame/connect
app/api/whatsapp/incoming/route.ts                  # fields Coexistence
app/api/admin/whatsapp-channel/route.ts             # PUT paste → 410 tenant
components/channels/ChannelsSettings.tsx
docs/ENV_META_CHANNELS.md
docs/CHECKLIST_CANAIS_WABA_IG_MESSENGER.md
docs/CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md
docs/SECURITY_CREATEADMIN_INVENTORY.md
docs/CHATBOT_PROD.md
tests/security/cspPolicy.test.ts
tests/integration/webhook-integration.test.ts
```

### Não tocar

```text
src/pro/pipeline/**                    # motor de pedido / carrinho
lib/chatbot/processMessage.ts
CartEditModal / fluxo humano inbox     # já é o caminho do lojista para carrinho
app/api/admin/meta-messaging/oauth/**  # IG/Messenger
Vault / CREDENTIALS_ENCRYPTION_KEY design
plan_features / preços / trial
Baileys / QR WhatsApp Web
```

---

## Ordem de execução

```text
C6.0 ops Meta (dono)
  → C6.1 upsert mode + migration se necessário
    → C6.2 use case + Graph
      → C6.3 rotas + inventário B15
        → C6.4 inbound fields
          → C6.5 CSP
            → C6.6 UI (paste some)
              → C6.7 testes + smoke
```

**Definition of Done:** owner/admin clica Conectar → popup Meta → canal `embedded_signup` + health ok; Coexistence: eco do celular na inbox, bot pausa, **carrinho inalterado** pelo eco; inbound do cliente continua criando carrinho pelo bot; `npm test` verde; env documentado; migration remota se houver.

---

## Smoke manual (C6.7)

1. Owner (plano com `whatsapp_messages`) em Canais → Conectar WhatsApp → escolhe número do **app Business** → vê badge Coexistence.
2. Cliente manda “2 heineken” → bot monta carrinho (igual hoje).
3. Lojista responde **no celular** → bolha humana na inbox; bot **não** responde; carrinho **não** muda.
4. Lojista edita carrinho no inbox (modal) → persiste.
5. Conta **sem role no App** (amigo/teste) completa o fluxo — prova Advanced Access.
6. Número sem WhatsApp Business → caminho Cloud API puro → health ok; celular daquele número **não** fica como app oficial.
7. Member/driver → API 403.
8. CSP: DevTools sem bloqueio de `connect.facebook.net` / dialog.
9. Paste: formulário sumiu; `PUT` com token → 410.

---

## Env novos (Vercel + `.env.local`)

| Variável | Onde | Uso |
|----------|------|-----|
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | server | `config_id` do FB.login WA (via GET config) |
| `NEXT_PUBLIC_META_APP_ID` | client | `FB.init` — mesmo App Tech Provider |

Já existentes: `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `CREDENTIALS_ENCRYPTION_KEY`, `META_GRAPH_VERSION` (subir para v25+ se o dashboard exigir).
