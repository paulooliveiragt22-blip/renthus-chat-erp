# Checklist — Security Hardening P2

**ADR:** [`ADR/0007`](./ADR/0007-security-hardening-p2.md)  
**Inventário periódico:** [`SECURITY_IMPROVEMENTS_CHECKLIST.md`](./SECURITY_IMPROVEMENTS_CHECKLIST.md)

Estrutura (Clean Architecture desta stack):

| Peça | Path |
|------|------|
| Policy CSP (domínio) | `lib/security/cspPolicy.ts` + `cspPolicy.cjs` (next.config) |
| Headers HTTP | `next.config.js` → `headers()` (sem CSP; `X-Frame-Options: DENY`) |
| CSP enforce | `lib/security/cspProxy.ts` + `proxy.ts` (nonce + `strict-dynamic`) |
| Proxy allowlist | `proxy.ts` `isTechnicalApiPublic` + `lib/security/printAgentMachineApi.ts` |
| Storage / grants | `supabase/migrations/2026090521*.sql` |
| Testes | `tests/security/cspPolicy.test.ts`, `tests/security/cspProxy.test.ts`, `tests/proxy.test.ts` |
| UI residual | `components/AdminShell.tsx` → `GET /api/orders/[id]` (S8) |

---

## Lote 1 — aplicado nesta entrega

| ID | Item | Estado |
|----|------|--------|
| S1 | CSP Report-Only em `/:path*` | [x] 2026-09-04 |
| S2 | Storage `whatsapp-media` / `product-images`: write só `service_role`; MIME+size no bucket WA | [x] 2026-09-04 |
| S3 | Views: `security_invoker` + REVOKE client + GRANT SELECT `service_role` | [x] 2026-09-04 remoto: 18/18 views `security_invoker=true`; 0 grants anon/authenticated |
| S4 | `REVOKE EXECUTE` de `anon`/`authenticated`/`public` em funções `public`; default privileges | [x] 2026-09-04 remoto: 0 SECURITY DEFINER com EXECUTE a `anon` |
| S5 | Proxy: `/api/billing/expire-trials` e `mark-abandoned` na allowlist (auth = `CRON_SECRET`) | [x] 2026-09-04 |
| S6 | Checklist + inventário `createAdminClient` atualizados | [x] 2026-09-04 |

---

## Lote 2 — código restante

| ID | Item | Arquivos | DoD |
|----|------|----------|-----|
| S7 | Granularizar `pathname.startsWith("/api/agent/")` — só `activate` + jobs/print públicos; `keys`/`settings` exigem cookie no proxy | `proxy.ts`, `tests/proxy.test.ts` | [x] 2026-09-05 — `/api/agent/keys` e `/settings` sem cookie → `/login` |
| S8 | `AdminShell.fetchOrderFull` via `GET /api/orders/[id]` (já existe); remover `.from("orders")` no browser | `components/AdminShell.tsx` | [x] 2026-09-05 — `fetch` + cookie; sem `createClient` no shell |
| S9 | Inventariar `createClient()` residual (Lista realtime, Configurações, Dashboard) — Realtime só se canal autenticado for inevitável; senão poll via API | `ListaClient.tsx`, `configuracoes/page.tsx`, `app/page.tsx` | [x] 2026-09-05 — clients mortos removidos; Lista já pollava API; inventário §client |
| S10 | CSP enforce: nonce no `proxy.ts` + `x-nonce` no layout (guia Next.js) depois de Report-Only limpo | `proxy.ts`, `app/layout.tsx`, `lib/security/cspProxy.ts` | [x] 2026-09-05 — `Content-Security-Policy` com nonce + `strict-dynamic` |
| S11 | Alinhar `X-Frame-Options` (`SAMEORIGIN` hoje) com `frame-ancestors 'none'` quando enforce | `next.config.js` | [x] 2026-09-05 — `X-Frame-Options: DENY` |

---

## Lote 3 — operação (não é PR)

| ID | Item | Como fechar | Estado 2026-09-05 |
|----|------|-------------|-------------------|
| S12 | Upstash Redis em Vercel Production | `CHECKLIST_MVP_LANCAMENTO` INFRA-1; `check:prod-env --strict` sem aviso | [~] código: `--strict` **falha** sem `UPSTASH_*`. `.env.local` tem as duas keys. Confirmar as mesmas no dashboard Vercel Production (não listado daqui). |
| S13 | Confirmar `WHATSAPP_APP_SECRET` + `PAGARME_WEBHOOK_BASIC_*` no env production | `npm run check:prod-env --strict` no deploy | [~] `WHATSAPP_APP_SECRET` no `.env.local`. `PAGARME_WEBHOOK_BASIC_*` **não** está no `.env.local` (só `PAGARME_WEBHOOK_SECRET` legado). H0.10 marca Basic na Vercel Production — confirmar no dashboard. |
| S14 | Escopos mínimos do token Meta | Meta Business → App Review / Login for Business | [ ] ver tabela abaixo |
| S15 | `report-uri` / Sentry CSP reports (opcional) | só depois de S10 estável em prod | [ ] S10 já está em `app.renthus.com.br` (`npm run check:csp`); report-uri fica para depois |

### Como testar CSP sem DevTools

```bash
# produção (já enforce 2026-09-05)
npm run check:csp
# ou
curl.exe -sI https://app.renthus.com.br/login

# local (com `npm run dev`)
npm run check:csp -- http://localhost:3000/login
```

Esperado: `Content-Security-Policy` com `nonce-` + `strict-dynamic`; **sem** `Report-Only`; `X-Frame-Options: DENY`.

### S14 — escopos canônicos (só conferir no Meta)

Fonte: `docs/ENV_META_CHANNELS.md` + `docs/META_APP_REVIEW_WHATSAPP.md`.

| Canal | Permissões |
|-------|------------|
| WhatsApp | `whatsapp_business_messaging`; templates: `whatsapp_business_management` |
| Page / Messenger + IG | `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`, `business_management`, `instagram_basic` / `instagram_business_basic`, `instagram_manage_messages` |

Token do lojista (Configurações → Canais) tem de ser do **mesmo Meta App** do `WHATSAPP_APP_SECRET`.

---

## Validação remota (pós-migration)

```sql
-- Storage: insert whatsapp-media exige service_role
select policyname, cmd, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like '%whatsapp%';

-- Nenhuma SECURITY DEFINER com execute anon
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'EXECUTE');
-- esperado: 0 rows

-- Views: security_invoker
select c.relname, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v';
```
