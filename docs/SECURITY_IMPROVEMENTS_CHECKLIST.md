# Checklist — melhorias de segurança (prioridade sugerida)

Use como guia de implementação e revisão periódica. Itens derivados da análise do repositório `renthus-chat-erp`.

**Auditoria 2026-09-04:** código + MCP Supabase (`execute_sql`, `get_advisors`) + Context7 (Next.js CSP, Supabase Storage/RLS views).  
**P2 (estrutura + lote 1):** [`ADR/0007`](./ADR/0007-security-hardening-p2.md) · [`CHECKLIST_SECURITY_HARDENING_P2.md`](./CHECKLIST_SECURITY_HARDENING_P2.md)

**Legenda:** `[x]` implementado ou documentado neste repo · `[ ]` ação manual / contínua · `[~]` parcial

---

## 1. Autorização em rotas com `createAdminClient` (service role)

- [x] Inventariar rotas `app/api/**` que usam `createAdminClient()`. → `docs/SECURITY_CREATEADMIN_INVENTORY.md` (reescrito 2026-09-04, agrupado por gate)
- [ ] Revisão contínua: identidade confiável **antes** de qualquer query. *(processo; inventário é o índice)*
- [x] `GET /api/billing/status` sem `?company_id=` — cookie + `requireCompanyAccess` (IDOR P0.3).

---

## 2. Reduzir superfície “pública” no proxy (`proxy.ts`)

- [x] `isTechnicalApiPublic` granular (WhatsApp incoming, crons com `CRON_SECRET`, billing webhook/signup, agent, public menu, health).
- [x] Crons billing `expire-trials` e `mark-abandoned` na allowlist (2026-09-04) — handler continua com `validateCronAuthorization`.
- [x] **P2 S7:** `isPrintAgentMachineApi` — só activate/auth/heartbeat/print/jobs. `keys`/`settings` exigem cookie.

---

## 3. RLS no Supabase como rede de segurança

- [x] Remoto 2026-09-04: **97/97** tabelas `public` com RLS + `FORCE` + 1 policy `rls_*_service_role_only`. Zero GRANT de tabela base a `anon`/`authenticated`.
- [x] Fluxos service-role vs sessão. → `docs/SECURITY_SERVICE_ROLE_FLOWS.md`
- [x] **P2 S3:** views com `security_invoker` + REVOKE client (advisor `security_definer_view`). Migration `20260905211000_*`.
- [x] **P2 S4:** `REVOKE EXECUTE` de `anon`/`authenticated` em funções `public`. Migration `20260905212000_*`.

*Confirmado no remoto 2026-09-04:* 0 SECURITY DEFINER com EXECUTE a `anon`; 18/18 views `security_invoker=true`; 0 GRANT de objeto `public` a `anon`/`authenticated`.

---

## 4. Webhooks (Meta, Pagar.me)

- [x] **P2 S13:** `WHATSAPP_APP_SECRET` + `PAGARME_WEBHOOK_BASIC_USER`/`PASSWORD` em Vercel Production (owner 2026-09-05). HMAC `PAGARME_WEBHOOK_SECRET` = legado. `check:prod-env --strict` falha se faltar.
- [x] Rate limit no webhook de billing. → `app/api/billing/webhook/route.ts`
- [x] Pago confirmado via GET `/orders/:id` (API = fonte da verdade).

---

## 5. Crons e filas (`CRON_SECRET`)

- [x] `CRON_SECRET` obrigatório em produção (`validateCronAuthorization`).
- [x] `npm run check:prod-env` com `VERCEL_ENV=production` ou `--strict`.

---

## 6. Platform admin (substitui Superadmin)

`SUPERADMIN_SECRET` / cookie `sa_token` / `/api/superadmin/**` **removidos** (2026-08-27, `CHECKLIST_PLATFORM_ADMIN` P3). Console = `/platform` + Supabase Auth.

- [x] MFA de platform: `app/api/platform/auth/mfa/*`, gate no `proxy.ts`.
- [x] `check-production-env.mjs` não exige mais `SUPERADMIN_SECRET`.
- [ ] Allowlist de IP / host dedicado em produção (`PLATFORM_ADMIN_IP_ALLOWLIST`, `PLATFORM_ADMIN_HOST`) — aviso no `check:prod-env`, não falha o script.

---

## 7. Uploads (Storage)

- [x] Limites + MIME no app. → `lib/security/uploadGuards.ts`
- [x] **P2 S2:** write `whatsapp-media` / drop INSERT+DELETE `authenticated` em `product-images`; MIME+16MB no bucket WA. Migration `20260905210000_*`.
- [x] `platform-audit-archive` já era privado + `service_role`.
- [ ] Leitura pública de `product-images` e `whatsapp-media` é **intencional** (URL anônima). Não tornar privado sem mudar o contrato Meta/cardápio.

---

## 8. Rate limiting distribuído

- [x] Adapter Upstash + fallback in-memory. → `lib/security/rateLimitDistributed.ts`
- [x] **P2 S12 / INFRA-1:** `UPSTASH_REDIS_REST_URL` + `TOKEN` em Vercel Production (owner 2026-09-05). `check:prod-env --strict` **falha** se faltar.

---

## 9. Cabeçalhos HTTP globais

- [x] HSTS (prod), `nosniff`, `Referrer-Policy`, `Permissions-Policy`. → `next.config.js`
- [x] **P2 S1:** Report-Only primeiro (histórico). Substituído por S10.
- [x] **P2 S10:** `Content-Security-Policy` enforce no `proxy.ts` (`lib/security/cspProxy.ts`): nonce por request + `strict-dynamic`; `x-nonce` no `app/layout.tsx`. Sem CSP em `next.config.js` (AND com nonce quebraria a página).
- [x] **P2 S11:** `X-Frame-Options: DENY` alinhado a `frame-ancestors 'none'`.
- [x] **P2 S15:** `report-uri` / `report-to` + headers `Report-To` / `Reporting-Endpoints` para Sentry (`sentryCspReport.ts`), se houver DSN.

---

## 10. Segredos e variáveis de ambiente

- [x] `.env*` no `.gitignore`
- [x] **P2 S14:** escopos canônicos em `lib/meta/metaOauthScopes.ts`. OAuth Page/IG: `debug_token` + rejeita ads/publish. WhatsApp: `whatsapp_business_messaging` obrigatório (templates: `whatsapp_business_management`). Configuration `META_LOGIN_CONFIG_ID` deve espelhar a lista.

---

## 11. Rotas de diagnóstico

- [x] `/api/debug/whoami` → 404 em produção salvo `DEBUG_WHOAMI_ENABLED=true`

---

## 12. PWA / cache de APIs

- [x] `runtimeCaching` sem NetworkFirst de APIs sensíveis. → `next.config.js`

---

## 13. Client browser → tabela (governança)

Caminho seguro: UI → `fetch("/api/...")` → RPC/view via `service_role`. Achados 2026-09-04:

- [x] **P2 S8:** `AdminShell` lê pedido via `GET /api/orders/[id]` (cookie). Sem `createClient().from` no shell.
- [x] **P2 S9:** browser `createClient()` só Auth. Lista/Config/Dashboard via `/api`. Removidos `lib/supabaseClient.ts` e `src/lib/supabaseClient.ts`.

---

## Anexo — Onde entra a *service role* do Supabase

No **código da aplicação**, a chave `SUPABASE_SERVICE_ROLE_KEY` é lida em:

| Local | Uso |
|-------|-----|
| `lib/supabase/admin.ts` | Cliente `service_role` (ignora RLS). |
| `proxy.ts` | `Authorization: Bearer` em fetch PostgREST (rewrite de host do cardápio). |
| `app/api/companies/create/route.ts` | `createAdminClient()` + fetch RPC. |
| `app/api/chatbot/resolve/route.ts` | `X-Service-Key: INTERNAL_CHATBOT_SECRET` (+ cookie/`settings.company`). |

`lib/superadmin/actions.ts` **não existe mais** (removido P3 platform).

Inventário de rotas: `docs/SECURITY_CREATEADMIN_INVENTORY.md`.

---

*Última atualização: 2026-09-05 — P2 S1–S15 fechados.*
