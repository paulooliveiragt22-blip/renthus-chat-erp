# Env — Meta / Canais / WhatsApp (plataforma)

`.env*` está no `.gitignore` — este doc é o inventário canônico para ops/Vercel.
O paste do lojista (Configurações → **Canais**) só funciona se o número/token forem do **mesmo Meta App** da plataforma (webhook + secrets abaixo).

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
| `META_LOGIN_CONFIG_ID` | Configuration ID do **Facebook Login for Business** (obrigatório em muitos apps Business; sem isso o dialog pode dar “URL bloqueada”) |
| `META_MESSAGING_WEBHOOK_VERIFY_TOKEN` | Challenge webhook Page/IG `/api/meta/messaging/incoming` |
| `WHATSAPP_BASE_URL` | Default `https://graph.facebook.com/v20.0` |
| `CRON_SECRET` | Workers outbound / filas |

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
2. Inclua permissões: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `business_management`, `instagram_basic` / `instagram_business_basic`, `instagram_manage_messages`  
   - Nome do cliente IG/Messenger no inbox: User Profile API (`name` / `username` / `first_name`) — usa o **page access token** já salvo no OAuth; em Dev só testers recebem perfil completo.
3. Copie o **Configuration ID** → Vercel `META_LOGIN_CONFIG_ID` → redeploy  

## Fora desta entrega

- **Embedded Signup** (Tech Provider product) — coluna `provisioning_mode` reservada; sem UI.
- Token plaintext / fallback env por tenant em prod — removido; credencial só canal cifrado.

Ver também: [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) (C5), [`META_APP_REVIEW_WHATSAPP.md`](./META_APP_REVIEW_WHATSAPP.md).
