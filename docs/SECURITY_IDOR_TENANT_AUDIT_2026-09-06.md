# Auditoria IDOR — APIs tenant (2026-09-06)

**Escopo:** rotas tenant (`/api/admin/**`, orders, billing self, workspace, support).  
**Fora:** platform (já gated), menu público, webhooks, cron, print agent.  
**Premissa:** service_role no Next; isolamento = cookie `companyId` + filtros/associações.

## Achados e correção

| Sev | Achado | Fix |
|-----|--------|-----|
| HIGH | `rpc_admin_upsert_order_with_items` aceitava `customer_id` / `produto_embalagem_id` de outra company → PII via join + débito de estoque | Migration `20260906190000_idor_rpc_admin_upsert_tenant_checks.sql` |
| HIGH | `PATCH /api/admin/orders` setava `customer_id` sem check | `assertCustomerInCompany` |
| MED | POST endereços sem ownership do customer | mesmo helper |
| MED | `support/create-ticket` aceitava `thread_id`/`customer_id` alienígenas | `assertThreadInCompany` + customer |
| MED | push `onConflict: endpoint` podia reatribuir subscription | 409 `endpoint_owned` |
| LOW | updates pós-check sem `.eq(company_id)` | não bloqueante nesta rodada |

## Platform IP allowlist

Já existia em `proxy.ts` + `requirePlatformAccess` (prod fail-closed se lista vazia).  
Agora `check:prod-env --strict` **falha** sem `PLATFORM_ADMIN_IP_ALLOWLIST`.

Ops: CSV IPs/CIDRs do VPN/escritório na Vercel Production (e preview se testar platform).

## Secrets

Chaves expostas em log de deploy: **rotacionadas imediatamente** (confirmado owner 2026-09-06).

## Regressão

`tests/security/idorTenantAssociation.test.ts` + suite B15 createAdmin gate.
