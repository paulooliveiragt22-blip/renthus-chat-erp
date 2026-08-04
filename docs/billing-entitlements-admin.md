# Billing / entitlements (admin)

Documento legado. Contratos atuais:

- Planos: `essencial` | `pro` | `market` — ver `docs/BILLING_PLANS.md` e `lib/billing/planCatalog.ts`
- Troca de plano: `POST /api/billing/change-plan`
- Status: `GET /api/billing/status`
- Overage WhatsApp: `POST /api/billing/allow-overage`

A rota `POST /api/billing/upgrade` (`mini_erp` / `full_erp`) **foi removida**.
