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
| `META_APP_SECRET` | OAuth + app secret Page |
| `NEXT_PUBLIC_APP_URL` (ou equivalente) | Callback OAuth absoluto |

## Recomendadas

| Variável | Uso |
|----------|-----|
| `META_MESSAGING_WEBHOOK_VERIFY_TOKEN` | Challenge webhook Page/IG `/api/meta/messaging/incoming` |
| `WHATSAPP_BASE_URL` | Default `https://graph.facebook.com/v20.0` |
| `CRON_SECRET` | Workers outbound / filas |

## Callbacks a cadastrar no Meta Developer

- OAuth: `/api/admin/meta-messaging/oauth/callback`
- Webhook WhatsApp: `/api/whatsapp/incoming`
- Webhook Page/IG: `/api/meta/messaging/incoming`

## Fora desta entrega

- **Embedded Signup** (Tech Provider product) — coluna `provisioning_mode` reservada; sem UI.
- Token plaintext / fallback env por tenant em prod — removido; credencial só canal cifrado.

Ver também: [`CHECKLIST_CANAIS_WABA_IG_MESSENGER.md`](./CHECKLIST_CANAIS_WABA_IG_MESSENGER.md) (C5), [`META_APP_REVIEW_WHATSAPP.md`](./META_APP_REVIEW_WHATSAPP.md).
