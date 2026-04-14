# Fluxos que usam service role (`createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY`)

Objetivo: saber onde o Postgres vê `auth.role() = 'service_role'` (RLS contornado) e garantir que só há acesso após verificação na borda.

## Chamadas externas sem sessão Supabase do utilizador

| Fluxo | Entrada de confiança |
|--------|------------------------|
| Webhook WhatsApp `POST /api/whatsapp/incoming` | Assinatura `X-Hub-Signature-256` + `WHATSAPP_APP_SECRET` |
| WhatsApp Flows `POST /api/whatsapp/flows` | Payload cifrado da Meta + `flow_token` / chaves de flow |
| Webhook Pagar.me `POST /api/billing/webhook` | `PAGARME_WEBHOOK_SECRET` (HMAC) + rate limit por IP |
| Cron fila chatbot `GET /api/chatbot/process-queue` | `Authorization: Bearer CRON_SECRET` |
| Print agent (várias rotas `/api/agent/*`) | API key `rpa_*` validada em servidor |

## Sessão utilizador (cookie) + membership

Rotas que chamam `requireCompanyAccess` (ou equivalente) e depois `admin`: o utilizador autentica-se com **anon key** no browser; o servidor usa **service role** só depois de validar `company_id` + papel em `company_users`.

## Middleware

`middleware.ts` usa `SUPABASE_SERVICE_ROLE_KEY` em `fetch` ao PostgREST para subscription/empresa — o `company_id` vem do cookie `renthus_company_id` (rever se o cookie é só httpOnly / assinado na vossa política).

## SQL (migrações)

Policies `TO service_role` e `GRANT … TO service_role` definem o que o JWT da service role pode fazer na base, independentemente desta app.

---

*Documento de apoio ao item 3 do checklist de segurança.*
