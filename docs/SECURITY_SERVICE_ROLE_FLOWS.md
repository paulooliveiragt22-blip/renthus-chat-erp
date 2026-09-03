# Fluxos que usam service role (`createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY`)

Objetivo: saber onde o Postgres vê `auth.role() = 'service_role'` (RLS contornado) e garantir que só há acesso após verificação na borda.

## Chamadas externas sem sessão Supabase do utilizador

| Fluxo | Entrada de confiança |
|--------|------------------------|
| Webhook WhatsApp `POST /api/whatsapp/incoming` | Assinatura `X-Hub-Signature-256` + `WHATSAPP_APP_SECRET` |
| Webhook Pagar.me `POST /api/billing/webhook` | Rate limit IP; HMAC opcional/legado; **confirmação paid via GET order API** |
| Cron fila chatbot `GET /api/chatbot/process-queue` | `Authorization: Bearer CRON_SECRET` |
| Cron sync catálogo marketplace `GET /api/marketplace/sync-catalog` | `Authorization: Bearer CRON_SECRET` |
| Cron billing `POST /api/billing/charge` | `Authorization: Bearer CRON_SECRET` (+ opcional `x-vercel-cron: 1` do Vercel) |
| Print agent (várias rotas `/api/agent/*`) | API key `rpa_*` validada em servidor |

### Crons HTTP — auth (`lib/security/cronAuth.ts`)

| Origem | Headers | Regra |
|--------|---------|--------|
| **Vercel Cron** (`vercel.json` → `crons`) | `Authorization: Bearer ${CRON_SECRET}` + `x-vercel-cron: 1` | Bearer **obrigatório** em produção |
| **cron-job.org** / scheduler externo | `Authorization: Bearer ${CRON_SECRET}` | Mesmo secret; sem `x-vercel-cron` |
| Local dev | Secret ausente → skip auth | Só fora de produção |

> **Nunca** aceitar só `x-vercel-cron` sem Bearer — header é indicativo, não segredo.

Rotas em `vercel.json` (2026-08-28): `/api/billing/charge`, `/api/chatbot/detect-abandoned-carts`, `/api/marketplace/sync-catalog`, `/api/platform/alerts/check`, `/api/platform/audit/archive`.

Ver ADR-0004: billing **não** usa Edge Functions.

## Sessão utilizador (cookie) + membership

Rotas que chamam `requireCompanyAccess` (ou equivalente) e depois `admin`: o utilizador autentica-se com **anon key** no browser; o servidor usa **service role** só depois de validar `company_id` + papel em `company_users`.

## Middleware

`proxy.ts` usa `SUPABASE_SERVICE_ROLE_KEY` em `fetch` ao PostgREST para subscription/empresa — o `company_id` vem do cookie `renthus_company_id` (rever se o cookie é só httpOnly / assinado na vossa política).

## SQL (migrações)

Policies `TO service_role` e `GRANT … TO service_role` definem o que o JWT da service role pode fazer na base, independentemente desta app.

---

*Documento de apoio ao item 3 do checklist de segurança.*
