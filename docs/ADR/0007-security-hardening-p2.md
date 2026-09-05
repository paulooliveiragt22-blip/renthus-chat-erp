# ADR 0007 — Segurança P2: CSP Report-Only, grants e Storage

**Status:** aceito (estrutura + lote 1 aplicado 2026-09-04)  
**Data:** 2026-09-04  
**Checklist:** [`CHECKLIST_SECURITY_HARDENING_P2.md`](../CHECKLIST_SECURITY_HARDENING_P2.md)  
**Inventário vivo:** [`SECURITY_IMPROVEMENTS_CHECKLIST.md`](../SECURITY_IMPROVEMENTS_CHECKLIST.md)  
**Predecessor:** hardening de tabelas (`service_role_only` + FORCE) já fechado no remoto.

---

## Contexto

Auditoria 2026-09-04 (código + MCP `execute_sql` + `get_advisors` + Context7 Next.js/Supabase):

| Camada | Achado |
|--------|--------|
| Tabelas `public` | 97/97 com RLS + FORCE + policy `*_service_role_only` — **ok** |
| Views | owner `postgres`, maioria **sem** `security_invoker`; GRANT ALL (incl. INSERT/DELETE) a `anon`/`authenticated` |
| Funções `SECURITY DEFINER` | dezenas com `EXECUTE` a `anon` (incl. `rpc_platform_suspend_company`, `rpc_create_product_*`) |
| Storage | `whatsapp-media` INSERT aberto a `public`; sem `file_size_limit`/MIME; `product-images` INSERT/DELETE a `authenticated` |
| HTTP | sem CSP; HSTS/frame/Permissions-Policy ok |
| Proxy | crons `expire-trials` / `mark-abandoned` fora de `isTechnicalApiPublic` |
| Client | `AdminShell` ainda faz `.from("orders")` no browser (RLS já bloqueia; UX quebrada) |

RLS nas tabelas **não** protege view SECURITY DEFINER nem RPC com GRANT a `anon` + chave pública.

## Decisão

### D1 — Fonte de grants

`anon` / `authenticated` **não** executam RPC de mutação nem escrevem view. `service_role` só no Route Handler (`createAdminClient`). Browser: `fetch("/api/...")` ou Auth (`getUser` / Realtime se overhaul depois).

### D2 — Views

Toda view de domínio: `security_invoker = true` + `REVOKE ALL` de `anon`/`authenticated` + `GRANT SELECT` a `service_role`.

### D3 — Storage

Upload/update/delete: `auth.role() = 'service_role'`. Leitura pública só onde a URL precisa ser anônima (produto, mídia Meta). Limites de bucket = `uploadGuards.ts`.

### D4 — CSP

P2 = `Content-Security-Policy-Report-Only` via `next.config.js` `headers()` (Context7: sem nonce → `'unsafe-inline'`). Enforce + nonce no `proxy.ts` só após zero violações (S9.2).

### D5 — Fora de escopo comercial

Sem mudança de preço/trial/features. Hardening técnico já canônico (`governanca-seguranca-negocio.mdc`).

## Consequências

- PostgREST com anon key deixa de chamar RPC de negócio (efeito desejado).
- Qualquer `.from()` / `.rpc()` residual no client quebra de vez — migrar para API (S8).
- PWA / Sentry / Supabase realtime precisam estar no `connect-src`; ajustar allowlist se o Report-Only acusar host faltando.
