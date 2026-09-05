# Inventário — `createAdminClient()` (service role)

Índice para o item 1 de `SECURITY_IMPROVEMENTS_CHECKLIST.md`.  
**Atualizado:** 2026-09-05 (S9). Rotas novas: acrescentar na tabela do **gate** correspondente.

Regra: identidade **antes** da query; `company_id` só de cookie/`requireCompanyAccess`/`requireCapability`, nunca de querystring crua.

---

## Sessão tenant (`requireCompanyAccess` / `requireCapability`)

Admin operacional, billing self-service, workspace, uploads, WhatsApp painel, delivery, chatbot config, reports.

Exemplos: `app/api/admin/**`, `app/api/billing/status`, `create-invoice-checkout`, `change-plan`, `self-reactivate`, `payment-methods`, `allow-overage`, `pending-plan-change`, `app/api/workspace/**`, `app/api/products/upload-image`, `app/api/whatsapp/send`, `upload`, `threads`, `app/api/orders/**` (exceto gone), `app/api/companies/update`, `app/api/support/create-ticket`, `app/api/delivery/**`, `app/api/chatbot/config`.

`GET /api/billing/status` — **sem** `?company_id=` (P0.3).

## Cron (`validateCronAuthorization` / `CRON_SECRET`)

| Rota | Proxy público? |
|------|----------------|
| `app/api/billing/charge` | sim |
| `app/api/billing/expire-trials` | sim (P2 S5) |
| `app/api/billing/mark-abandoned` | sim (P2 S5) |
| `app/api/billing/webhook-health` | sim (`/api/billing/webhook*`) |
| `app/api/chatbot/detect-abandoned-carts` | sim |
| `app/api/chatbot/reactivate` | sim |
| `app/api/marketplace/sync-catalog` | sim |
| `app/api/platform/alerts/check` | sim |
| `app/api/platform/audit/archive` | sim |

`app/api/chatbot/process-queue` — legado/SQS; se ainda existir, mesmo gate.

## Webhook / HMAC / Basic Auth

| Rota | Gate |
|------|------|
| `app/api/whatsapp/incoming` | HMAC Meta + rate limit |
| `app/api/meta/messaging/incoming` | HMAC Meta |
| `app/api/billing/webhook` | Basic Auth Pagar.me (+ HMAC legado) + rate limit + GET order |

## Print agent (`api_key` ou pairing)

`app/api/agent/auth`, `heartbeat`, `jobs/*`, `print-data`, `reprint` — API key; proxy via `isPrintAgentMachineApi`.  
`app/api/agent/activate` — código de pareamento + rate limit (público no proxy).  
`app/api/agent/keys`, `settings` — sessão no handler **e** no proxy (S7).

`app/api/orders/[id]` — sessão **ou** API key do agent.

## Platform (`requirePlatformAccess`)

`app/api/platform/**` exceto crons acima — MFA + role. Impersonation, change-plan, replay-fulfill, courtesy-trial.

## Signup / público / health

| Rota | Gate |
|------|------|
| `app/api/billing/signup`, `app/api/ativar`, `app/api/onboarding`, `app/api/companies/create` | fluxo signup (sem tenant prévio) |
| `app/api/billing/public-plans`, `trial-policy` | catálogo público |
| `app/api/public/menu/**` | slug + rate limit |
| `app/api/health` | uptime |
| `app/api/debug/whoami` | 404 em prod salvo flag |

## Removidos

- `app/api/orders/by-phone` — 410 LGPD  
- `app/api/signup/complete` — signup via billing + `/ativar`  
- `app/api/superadmin/**` — platform P3  

## Lib (não é rota)

`lib/billing/*`, `lib/print/*`, `lib/workspace/requireCompanyAccess.ts`.  
`lib/superadmin/**` removido.

## Client browser (S9 — 2026-09-05)

`createClient()` no browser **só** para Auth. Sem `.from` / `.rpc` / Realtime em tabela.

**Permitido (`supabase.auth`):**

| Arquivo | Uso |
|---------|-----|
| `app/login/LoginClient.tsx` | `signInWithPassword`, reset senha |
| `app/(public)/signup/page.tsx` | `signInWithPassword` pós-signup |
| `app/logout/page.tsx` | `signOut` |
| `app/auth/set-password/SetPasswordClient.tsx` | sessão / updateUser |
| `app/platform/login/page.tsx` | Auth platform |
| `app/platform/login/mfa/page.tsx` | MFA |
| `components/HeaderClient.tsx` | `getSession`, `onAuthStateChange`, `signOut` |
| `components/platform/PlatformSidebar.tsx` | `signOut` |
| `components/MixpanelBootstrap.tsx` | `getSession` → identify |
| `hooks/useCompanyUser.ts` | `getUser` |

**Fechado nesta P2:**

| Arquivo | Antes | Agora |
|---------|-------|-------|
| `components/AdminShell.tsx` | `.from("orders")` | `GET /api/orders/[id]` (S8) |
| `app/page.tsx` (dashboard) | `createClient()` morto | poll `GET /api/orders/list` + `/api/whatsapp/threads` |
| `app/(admin)/configuracoes/page.tsx` | `createClient()` morto (só dep. de effect) | só `fetch /api/admin/*` |
| `app/(admin)/produtos/lista/ListaClient.tsx` | inventário citava Realtime | poll 15s via `/api/admin/products` (tabelas fora do Realtime + RLS service_role) |
| `lib/supabaseClient.ts`, `src/lib/supabaseClient.ts` | client global anon sem usos | **removidos** |

API routes usam `createClient()` de `@/lib/supabase/server` (cookie), não o browser.
