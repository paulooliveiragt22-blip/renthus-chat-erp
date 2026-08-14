# Proposta — Formas de pagamento aceitas (cardápio + chatbot)

Status: **adiada** — gravada para discussão posterior (2026-08-14).  
Não implementar até validação explícita.

## Problema

Aba Configurações → Formas de pagamentos grava `companies.settings.enabled_payments` com chaves legadas (`credit_card`, `debit_card`, `voucher`). Nenhum canal lê esse JSON. Cardápio e chatbot usam lista hard-coded `pix | cash | card`.

## Decisões travadas (quando for implementar)

- Não cadastrar métodos novos no ledger — enum de `docs/FINANCEIRO.md` permanece canônico.
- Configurações só liga/desliga métodos já existentes.
- Escopo: canais do cliente = cardápio web + chatbot (+ Flow se compartilhar botões).
- Subconjunto oferecível: à vista `cash | pix | debit | card`.
- Prazo continua PDV / Pedidos admin (recognize já bloqueia prazo em chatbot/web).
- Mínimo: ≥ 1 método ativo por empresa.

## Estrutura proposta (FASE 1)

### Domain
- Estender `src/financeiro/domain/paymentMethod.ts`
- `CUSTOMER_FACING_PAYMENT_METHODS = ['cash','pix','debit','card']`
- `AcceptedPaymentsPolicy` + helpers `normalizeAcceptedPayments` / `listEnabledCustomerPayments`
- Default sugerido: espelhar hard-code atual (`pix/cash/card` on, `debit` off) — confirmar na implementação

### Persistence (radical, um caminho)
- Substituir `settings.enabled_payments` por:
  - `companies.settings.accepted_customer_payments: { cash, pix, debit, card }`
- Migration: backfill (`credit_card`→`card`, `debit_card`→`debit`, dropar `voucher`) e apagar `enabled_payments`
- Sem tabela nova — policy por empresa, não CRUD de meio de pagamento

### Application / API
- `getAcceptedCustomerPayments` / `upsertAcceptedCustomerPayments`
- `GET/PATCH /api/admin/accepted-payments` (ou companies update só com chave nova + validação de enum)

### Presentation
- Config → Formas: toggles canônicos + copy correta (“cardápio web e chatbot”)
- Cardápio: `CheckoutDrawer` monta botões a partir da policy
- Chatbot PRO: `checkoutPostProcess` filtra `pro_pay_*`
- Validação server-side no checkout/create order (rejeitar método fora da policy)

### Elite
Tratar como **Payment Acceptance Policy** (feature flag por método × canal cliente), não como cadastro contábil. Conta continua 1.1 vs 1.2.

### Fora de escopo desta proposta
- Métodos custom / MDR / split por bandeira
- Filtrar PDV/Pedidos admin pela mesma lista
- Aba Plano (Pagar.me SaaS)

## Referências

- `docs/FINANCEIRO.md` — enum `payment_method`
- `src/financeiro/domain/paymentMethod.ts`
- `app/(admin)/configuracoes/page.tsx` — aba `formas_pagamento` (settings morto hoje)
- `app/(public)/c/[slug]/CheckoutDrawer.tsx`
- `src/pro/pipeline/stages/checkoutPostProcess.ts`
