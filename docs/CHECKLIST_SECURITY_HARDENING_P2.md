# Checklist — Security Hardening P2

**ADR:** [`ADR/0007`](./ADR/0007-security-hardening-p2.md)  
**Inventário periódico:** [`SECURITY_IMPROVEMENTS_CHECKLIST.md`](./SECURITY_IMPROVEMENTS_CHECKLIST.md)

Estrutura (Clean Architecture desta stack):

| Peça | Path |
|------|------|
| Policy CSP (domínio) | `lib/security/cspPolicy.ts` + `cspPolicy.cjs` (next.config) |
| Headers HTTP | `next.config.js` → `headers()` |
| Proxy allowlist | `proxy.ts` `isTechnicalApiPublic` |
| Storage / grants | `supabase/migrations/2026090521*.sql` |
| Testes | `tests/security/cspPolicy.test.ts`, `tests/proxy.test.ts` |
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
| S7 | Granularizar `pathname.startsWith("/api/agent/")` — só `activate` + jobs/print públicos; `keys`/`settings` exigem cookie no proxy | `proxy.ts`, `tests/proxy.test.ts` | teste: `/api/agent/keys` sem cookie → login |
| S8 | `AdminShell.fetchOrderFull` via `GET /api/orders/[id]` (já existe); remover `.from("orders")` no browser | `components/AdminShell.tsx` | sem `createClient().from` no shell |
| S9 | Inventariar `createClient()` residual (Lista realtime, Configurações, Dashboard) — Realtime só se canal autenticado for inevitável; senão poll via API | `ListaClient.tsx`, `configuracoes/page.tsx` | lista no inventário §client |
| S10 | CSP enforce: nonce no `proxy.ts` + `x-nonce` no layout (guia Next.js) depois de Report-Only limpo | `proxy.ts`, `app/layout.tsx` | header `Content-Security-Policy` (não Report-Only); `X-Frame-Options` alinhado a `frame-ancestors` |
| S11 | Alinhar `X-Frame-Options` (`SAMEORIGIN` hoje) com `frame-ancestors 'none'` quando enforce | `next.config.js` | um único contrato |

---

## Lote 3 — operação (não é PR)

| ID | Item | Como fechar |
|----|------|-------------|
| S12 | Upstash Redis em Vercel Production | `CHECKLIST_MVP_LANCAMENTO` INFRA-1; `check:prod-env --strict` sem aviso |
| S13 | Confirmar `WHATSAPP_APP_SECRET` + `PAGARME_WEBHOOK_BASIC_*` no env production | `npm run check:prod-env --strict` no deploy |
| S14 | Escopos mínimos do token Meta | Meta Business |
| S15 | `report-uri` / Sentry CSP reports (opcional) | só depois de S1 estável |

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
