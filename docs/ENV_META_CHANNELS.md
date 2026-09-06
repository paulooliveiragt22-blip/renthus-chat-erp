# Env — Meta / Canais / WhatsApp (plataforma)

`.env*` está no `.gitignore` — este doc é o inventário canônico para ops/Vercel.
O lojista conecta em Configurações → **Canais** via Embedded Signup (mesmo Meta App do webhook). Paste de token no tenant foi removido (ADR-0010).

## Obrigatórias (produção)

| Variável | Uso |
|----------|-----|
| `CREDENTIALS_ENCRYPTION_KEY` | AES tokens WABA/Page (32 bytes base64). Sem plaintext em prod. |
| `WHATSAPP_APP_SECRET` | Assinatura webhook `POST /api/whatsapp/incoming` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Challenge GET do webhook WA |
| `META_APP_ID` | OAuth Instagram/Messenger |
| `META_APP_SECRET` | OAuth + assinatura webhook (app principal `26394…`) |
| `META_INSTAGRAM_APP_SECRET` | Assinatura webhook do produto **API do Instagram** (`28138…` — “Chave secreta do app do Instagram” no dashboard) |
| `NEXT_PUBLIC_APP_URL` (ou equivalente) | Callback OAuth absoluto |

## Recomendadas

| Variável | Uso |
|----------|-----|
| `META_LOGIN_CONFIG_ID` | Configuration ID do **Facebook Login for Business** Page/IG (não reutilizar no WhatsApp) |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Configuration ID **só** WhatsApp Embedded Signup |
| `NEXT_PUBLIC_META_APP_ID` | Opcional no client; o botão lê `appId` do GET config (server `META_APP_ID`) |
| `META_MESSAGING_WEBHOOK_VERIFY_TOKEN` | Challenge webhook Page/IG `/api/meta/messaging/incoming` |
| `WHATSAPP_BASE_URL` | Default `https://graph.facebook.com/v20.0` |
| `CRON_SECRET` | Workers outbound / filas (único — decisão B10). Rotação: `docs/RUNBOOK_CRON_SECRET_ROTATION.md` |
| `INTERNAL_CHATBOT_SECRET` | `X-Service-Key` em `POST /api/chatbot/resolve` (interno) |
| `WEB_MENU_SESSION_SECRET` | HMAC tokens do cardápio público (obrigatório; sem fallback) |

## Callbacks a cadastrar no Meta Developer

- OAuth: `/api/admin/meta-messaging/oauth/callback` (em **Facebook Login** e **Facebook Login for Business → Settings**)
- Webhook WhatsApp: `/api/whatsapp/incoming`
- Webhook Page/IG: `/api/meta/messaging/incoming`

### Webhook Instagram / Messenger

1. Caso de uso **Instagram** → Webhooks → callback `/api/meta/messaging/incoming` + verify token
2. Assine **`messages`** (e opcional `messaging_postbacks`)
3. **Obrigatório:** passo **“Adicionar conta”** (conta IG profissional autorizada no app) — sem isso a Meta **não envia** DMs, mesmo com OAuth/Page ok
4. App em **Dev:** quem manda DM precisa ser **Instagram Tester** ou admin/dev do app
5. Opcional: produto **Messenger** → Webhooks → objeto **Page** → campo `messages` (mesma URL)


1. App → **Facebook Login for Business** → **Configurations** → Create  
2. Inclua **só** as permissões de `META_MESSAGING_OAUTH_SCOPE_LIST` (`lib/meta/metaOauthScopes.ts`): `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `business_management`, `instagram_basic` (ou `instagram_business_basic`), `instagram_manage_messages`. Sem ads/publish. O callback valida via `debug_token` (S14).  
   - Nome do cliente IG/Messenger no inbox: User Profile API (`name` / `username` / `first_name`) — usa o **page access token** já salvo no OAuth; em Dev só testers recebem perfil completo.
3. Copie o **Configuration ID** → Vercel `META_LOGIN_CONFIG_ID` → redeploy  

## Embedded Signup (C6 — ADR-0010)

Quando o App estiver Live + Configuration WhatsApp criada:

| Variável | Uso |
|----------|-----|
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Configuration ID **só** WhatsApp Embedded Signup (não reutilizar `META_LOGIN_CONFIG_ID`) |
| `NEXT_PUBLIC_META_APP_ID` | `FB.init` no browser — mesmo App Tech Provider |

Webhook do App deve assinar também `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes`.

**Facebook Login for Business → Settings** (mesmo App do `META_APP_ID`):

- **Login com o SDK do Javascript** = Sim (bloqueante — sem isto `FB.login` no Canais falha)
- Allowed Domains for the JavaScript SDK = host do SaaS sem esquema (ex. `app.renthus.com.br`)
- Valid OAuth Redirect URIs = origem HTTPS exata (`https://app.renthus.com.br/`, `/configuracoes`)

Checklist: [`CHECKLIST_WHATSAPP_EMBEDDED_SIGNUP.md`](./CHECKLIST_WHATSAPP_EMBEDDED_SIGNUP.md).

## Fora desta entrega (Canais C5)

- Token plaintext / fallback env por tenant em prod — removido; credencial só canal cifrado.

Ver também: [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) (C5), [`META_APP_REVIEW_WHATSAPP.md`](./META_APP_REVIEW_WHATSAPP.md).
