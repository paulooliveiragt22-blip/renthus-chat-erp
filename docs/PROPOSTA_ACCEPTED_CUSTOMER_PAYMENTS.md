# Proposta — Formas de pagamento aceitas (cardápio + chatbot)

Status: **implementada** (2026-08-14).

## Decisões fechadas

- Uma policy global para canais do cliente (cardápio + chatbot + Flow + mesa).
- Enum à vista: `cash | pix | debit | card`. Prazo fora desses canais.
- Default seed = hard-code histórico (`pix/cash/card` on, `debit` off) — **não** confiar em `enabled_payments` legado.
- Persistência: `companies.settings.accepted_customer_payments`
- API única: `GET/PATCH /api/admin/accepted-payments`
- Validação server-side nos creates (web, PRO prepare, Flow, mesa close)
- WhatsApp: máx. 3 botões (preferência pix → cash → card → debit)
- Aba Config: “Pagamentos no cardápio e chatbot”

## Arquivos-chave

- `src/financeiro/domain/acceptedCustomerPayments.ts`
- `app/api/admin/accepted-payments/route.ts`
- `supabase/migrations/20260814210000_accepted_customer_payments.sql`
- Wire: `loadPublicMenu`, `CheckoutDrawer`, `createWebMenuOrder`, `checkoutPostProcess` / `runProPipeline`, `prepareOrderDraft`, `flows/route`, mesa close

## Fora de escopo (ainda)

- Policy distinta por canal (web vs chatbot)
- Filtrar PDV / Pedidos admin
- Regenerar JSON estático do Flow Meta (botões fixos; rejeição no servidor se desabilitado)
