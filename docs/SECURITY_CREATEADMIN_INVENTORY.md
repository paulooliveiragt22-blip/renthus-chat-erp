# Inventário — rotas `app/api/**` que usam `createAdminClient()` (service role)

Gerado para o item 1 de `SECURITY_IMPROVEMENTS_CHECKLIST.md`. Rever em cada rota: autenticação antes da query, filtro por `company_id` quando aplicável.

| Rota | Notas |
|------|--------|
| `app/api/agent/auth/route.ts` | API key do print agent |
| `app/api/agent/heartbeat/route.ts` | API key |
| `app/api/agent/jobs/complete/route.ts` | API key |
| `app/api/agent/jobs/fail/route.ts` | API key |
| `app/api/agent/jobs/poll/route.ts` | API key |
| `app/api/agent/jobs/reserve/route.ts` | API key |
| `app/api/agent/keys/route.ts` | Sessão (painel) |
| `app/api/agent/print-data/route.ts` | API key |
| `app/api/agent/reprint/route.ts` | API key |
| `app/api/agent/settings/route.ts` | Sessão |
| `app/api/billing/charge/route.ts` | Sessão + billing |
| `app/api/billing/create-invoice-checkout/route.ts` | Sessão |
| `app/api/billing/signup/route.ts` | Fluxo signup |
| `app/api/billing/status/route.ts` | Sessão; atenção ao `?company_id=` — validar membership dessa empresa |
| `app/api/billing/webhook/route.ts` | HMAC Pagar.me + rate limit |
| `app/api/catalog/categories/route.ts` | `requireCompanyAccess` |
| `app/api/catalog/products/route.ts` | `requireCompanyAccess` |
| `app/api/catalog/search/route.ts` | `requireCompanyAccess` |
| `app/api/chatbot/process-queue/route.ts` | `CRON_SECRET` / Bearer |
| `app/api/chatbot/reactivate/route.ts` | Sessão |
| `app/api/chatbot/resolve/route.ts` | Header interno ou service key (ver rota) |
| `app/api/companies/create/route.ts` | Fluxo criação empresa |
| `app/api/companies/update/route.ts` | Sessão |
| `app/api/debug/whoami/route.ts` | Sessão; desativado em prod salvo `DEBUG_WHOAMI_ENABLED=true` |
| `app/api/onboarding/route.ts` | Fluxo onboarding |
| `app/api/orders/[id]/route.ts` | `requireCompanyAccess` |
| `app/api/orders/by-phone/route.ts` | `requireCompanyAccess` |
| `app/api/orders/stats/route.ts` | `requireCompanyAccess` |
| `app/api/orders/status/route.ts` | `requireCompanyAccess` |
| `app/api/products/upload-image/route.ts` | `requireCompanyAccess` + validação upload |
| `app/api/signup/complete/route.ts` | Token signup |
| `app/api/support/create-ticket/route.ts` | `requireCompanyAccess` |
| `app/api/whatsapp/flows/route.ts` | Payload Meta (sem sessão) — crypto/flow_token |
| `app/api/whatsapp/incoming/route.ts` | HMAC Meta + rate limit |
| `app/api/whatsapp/send/route.ts` | `requireCompanyAccess` |
| `app/api/whatsapp/upload/route.ts` | `requireCompanyAccess` + validação upload |
| `app/api/workspace/current/route.ts` | Sessão |
| `app/api/workspace/list/route.ts` | Sessão |
| `app/api/workspace/select/route.ts` | Sessão |

**Lib (não é rota HTTP direta):** `lib/billing/*`, `lib/print/*`, `lib/workspace/requireCompanyAccess.ts`, `lib/superadmin/actions.ts`, etc.

---

*Atualizar esta tabela quando novas rotas API usarem `createAdminClient`.*
