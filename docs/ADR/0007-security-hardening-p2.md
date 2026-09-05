# ADR 0007 — Segurança P2: CSP enforce, grants e Storage

**Status:** aceito (S1–S15 fechados)  
**Data:** 2026-09-04 (S10/S11: 2026-09-05)  
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

S1 foi Report-Only em `next.config.js`. **S10 (2026-09-05):** enforce no `proxy.ts` — nonce por request em `x-nonce` + `Content-Security-Policy` no request e na response (`strict-dynamic`). `style-src` permanece `'unsafe-inline'` (Tailwind/Radix). Sem CSP estático no `next.config` (AND com nonce quebra scripts). **S11:** `X-Frame-Options: DENY` = `frame-ancestors 'none'`.

### D5 — Fora de escopo comercial

Sem mudança de preço/trial/features. Hardening técnico já canônico (`governanca-seguranca-negocio.mdc`).

## Consequências

- PostgREST com anon key deixa de chamar RPC de negócio (efeito desejado).
- Qualquer `.from()` / `.rpc()` residual no client quebra de vez — migrar para API (S8).
- PWA / Sentry / Supabase realtime / Mixpanel (`api-js.mixpanel.com`) no `connect-src`; se a página quebrar, o host faltou na policy — ajustar `cspPolicy.ts` + `.cjs` juntos.
