# Fluxos que usam service role (`createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY`)

Objetivo: saber onde o Postgres vê `auth.role() = 'service_role'` (RLS contornado) e garantir que só há acesso após verificação na borda.

**Atualizado:** 2026-09-05 — B1/B2/B4 (plano blindagem P3).

## Chamadas externas sem sessão Supabase do utilizador

| Fluxo | Entrada de confiança |
|--------|------------------------|
| Webhook WhatsApp `POST /api/whatsapp/incoming` | Assinatura `X-Hub-Signature-256` + `WHATSAPP_APP_SECRET` |
| Webhook Meta messaging `POST /api/meta/messaging/incoming` | HMAC Meta (`META_APP_SECRET` / `WHATSAPP_APP_SECRET`) |
| Webhook Pagar.me `POST /api/billing/webhook` | Rate limit IP; **Basic Auth** (`PAGARME_WEBHOOK_BASIC_*`); HMAC legado se header; **confirmação paid via GET order API** |
| Cron (billing, chatbot, marketplace, platform) | `Authorization: Bearer CRON_SECRET` — **um** secret; playbook: [`RUNBOOK_CRON_SECRET_ROTATION.md`](./RUNBOOK_CRON_SECRET_ROTATION.md) |
| Print agent (várias rotas `/api/agent/*`) | API key `rpa_*` validada em servidor; **não logar** plaintext. Rotação: `PATCH /api/agent/keys` `{ agent_id }`; revogar scramble hash. |
| Chatbot resolve interno `POST /api/chatbot/resolve` | `X-Service-Key: INTERNAL_CHATBOT_SECRET` + `_companyId` — **não** service_role |
| Cardápio público (HMAC sessão/link) | `WEB_MENU_SESSION_SECRET` — **obrigatório**; sem fallback para service_role |

### Crons HTTP — auth (`lib/security/cronAuth.ts`)

| Origem | Headers | Regra |
|--------|---------|--------|
| **Vercel Cron** (`vercel.json` → `crons`) | `Authorization: Bearer ${CRON_SECRET}` + `x-vercel-cron: 1` | Bearer **obrigatório** em produção |
| **cron-job.org** / scheduler externo | `Authorization: Bearer ${CRON_SECRET}` | Mesmo secret; sem `x-vercel-cron` |
| Local dev | Secret ausente → skip auth | Só fora de produção |

> **Nunca** aceitar só `x-vercel-cron` sem Bearer — header é indicativo, não segredo.

Rotas em `vercel.json` (atual): charge, mark-abandoned, expire-trials, webhook-health, detect-abandoned-carts, sync-catalog, platform alerts/check, platform audit/archive.  
Playbook de rotação: [`RUNBOOK_CRON_SECRET_ROTATION.md`](./RUNBOOK_CRON_SECRET_ROTATION.md).

Ver ADR-0004: billing **não** usa Edge Functions.

## Inventário B4 — `SUPABASE_SERVICE_ROLE_KEY` como credencial de borda

**Proibido:** comparar header/query/body do cliente com `SUPABASE_SERVICE_ROLE_KEY` para autorizar um request HTTP.

| Local | Uso | Status |
|-------|-----|--------|
| `app/api/chatbot/resolve` | Era `x-service-key === SERVICE_ROLE` | **Removido (B1)** → `INTERNAL_CHATBOT_SECRET` |
| `lib/public-menu/sessionToken.ts` | Fallback HMAC = service_role | **Removido (B2)** → só `WEB_MENU_SESSION_SECRET` |
| `lib/supabase/admin.ts` | Cliente PostgREST admin | Legítimo |
| `proxy.ts` | `fetch` PostgREST (membership/billing) | Legítimo (server-only) |
| `app/api/companies/create` | Bearer interno PostgREST | Legítimo (server-only) |
| Platform routes que passam Bearer service key a RPC | Server-only | Legítimo |
| Scripts (`scripts/replay-thread.ts`, workers) | Ops CLI / Lambda | Legítimo (não é borda pública) |

Grep de regressão: `x-service-key === process.env.SUPABASE_SERVICE_ROLE` e `WEB_MENU_SESSION_SECRET.*SERVICE_ROLE` devem permanecer **zero**.

## Sessão utilizador (cookie) + membership

Rotas que chamam `requireCompanyAccess` (ou equivalente) e depois `admin`: o utilizador autentica-se com **anon key** no browser; o servidor usa **service role** só depois de validar `company_id` + papel em `company_users`.

## Middleware

`proxy.ts` usa `SUPABASE_SERVICE_ROLE_KEY` em `fetch` ao PostgREST para subscription/empresa — o `company_id` vem do cookie `renthus_company_id` (rever se o cookie é só httpOnly / assinado na vossa política).

## SQL (migrações)

Policies `TO service_role` e `GRANT … TO service_role` definem o que o JWT da service role pode fazer na base, independentemente desta app.

---

*Documento de apoio ao item 3 do checklist de segurança.*
