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
- [ ] **P2 S7:** não liberar **todo** `/api/agent/` — `keys`/`settings` devem exigir cookie no proxy. → `CHECKLIST_SECURITY_HARDENING_P2.md`

---

## 3. RLS no Supabase como rede de segurança

- [x] Remoto 2026-09-04: **97/97** tabelas `public` com RLS + `FORCE` + 1 policy `rls_*_service_role_only`. Zero GRANT de tabela base a `anon`/`authenticated`.
- [x] Fluxos service-role vs sessão. → `docs/SECURITY_SERVICE_ROLE_FLOWS.md`
- [x] **P2 S3:** views com `security_invoker` + REVOKE client (advisor `security_definer_view`). Migration `20260905211000_*`.
- [x] **P2 S4:** `REVOKE EXECUTE` de `anon`/`authenticated` em funções `public`. Migration `20260905212000_*`.

*Confirmado no remoto 2026-09-04:* 0 SECURITY DEFINER com EXECUTE a `anon`; 18/18 views `security_invoker=true`; 0 GRANT de objeto `public` a `anon`/`authenticated`.

---

## 4. Webhooks (Meta, Pagar.me)

- [ ] Produção: `WHATSAPP_APP_SECRET` + `PAGARME_WEBHOOK_BASIC_USER`/`PASSWORD` no env Vercel. HMAC `PAGARME_WEBHOOK_SECRET` = legado. *(ops · `npm run check:prod-env --strict`)*
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
- [ ] **Antes do MVP:** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` na Vercel. Sem isso o `check:prod-env` **só avisa**. → `CHECKLIST_MVP_LANCAMENTO.md` INFRA-1

---

## 9. Cabeçalhos HTTP globais

- [x] HSTS (prod), `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. → `next.config.js`
- [x] **P2 S1:** `Content-Security-Policy-Report-Only` (`lib/security/cspPolicy.ts` + `cspPolicy.cjs`). Guia Next.js (Context7): sem nonce → `'unsafe-inline'`; PWA `worker-src`.
- [ ] **P2 S10–S11:** enforce + nonce no `proxy.ts`; alinhar `X-Frame-Options` com `frame-ancestors 'none'`.

---

## 10. Segredos e variáveis de ambiente

- [x] `.env*` no `.gitignore`
- [ ] Escopos mínimos dos tokens Meta. *(Meta Business)*

---

## 11. Rotas de diagnóstico

- [x] `/api/debug/whoami` → 404 em produção salvo `DEBUG_WHOAMI_ENABLED=true`

---

## 12. PWA / cache de APIs

- [x] `runtimeCaching` sem NetworkFirst de APIs sensíveis. → `next.config.js`

---

## 13. Client browser → tabela (governança)

Caminho seguro: UI → `fetch("/api/...")` → RPC/view via `service_role`. Achados 2026-09-04:

- [ ] **P2 S8:** `components/AdminShell.tsx` ainda faz `.from("orders")` / `.from("order_items")` no browser (RLS nega; modal quebra). Usar `GET /api/orders/[id]`.
- [ ] **P2 S9:** `createClient()` residual — Lista (Realtime), Configurações, Dashboard, login/signup (Auth ok).

---

## Anexo — Onde entra a *service role* do Supabase

No **código da aplicação**, a chave `SUPABASE_SERVICE_ROLE_KEY` é lida em:

| Local | Uso |
|-------|-----|
| `lib/supabase/admin.ts` | Cliente `service_role` (ignora RLS). |
| `proxy.ts` | `Authorization: Bearer` em fetch PostgREST (rewrite de host do cardápio). |
| `app/api/companies/create/route.ts` | `createAdminClient()` + fetch RPC. |
| `app/api/chatbot/resolve/route.ts` | Header interno ou service key. |

`lib/superadmin/actions.ts` **não existe mais** (removido P3 platform).

Inventário de rotas: `docs/SECURITY_CREATEADMIN_INVENTORY.md`.

---

*Última atualização: auditoria 2026-09-04 + estrutura P2 (CSP Report-Only, grants, Storage, proxy crons).*
