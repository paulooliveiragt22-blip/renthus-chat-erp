# Checklist — Taxas de serviço unificadas

Data: 2026-08-14. Contrato: `docs/FINANCEIRO.md`.

## Feito

- [x] Conta **3.3** Taxas de serviço (`00000000-0001-0000-0000-000000000303`)
- [x] `service_fee_definitions` + `order_fees` (FORCE RLS, service_role_only)
- [x] Seed `system_key=delivery` por empresa; unique parcial delivery
- [x] Bridge `orders.delivery_fee` ↔ `order_fees` delivery
- [x] `orders.service_fees_total`; `total_amount = total + delivery_fee + service_fees_total`
- [x] `fn_fin_build_sale_credit_lines` + recognize/PDV post → 3.1 / 3.2 / 3.3
- [x] RPCs `rpc_upsert_service_fee_definition`, `rpc_apply_order_fees`
- [x] Hex `src/taxas/` + APIs `/api/admin/taxas`, `/api/admin/taxas/order`
- [x] Config aba **Taxas** (canônico) + Pedidos (checkboxes outras taxas)
## Canônico sem dual-path: drop `companies.default_delivery_fee` / `delivery_fee_enabled`; leitores em `service_fee_definitions`

## Migrations

- `20260814180000_service_fees_v1.sql` (aplicada remoto)
- `20260814180100_service_fees_total_amount.sql` (aplicada remoto)
- `20260814180200_service_fees_apply_definition_id.sql` (aplicada remoto)
- `20260814200000_delivery_fee_canonical_definitions.sql` (aplicada remoto)

## Dívida de UX / cascata (fechada 2026-08-14)

Ownership canônico (um write path, sem coluna em `companies`):

1. **Delivery** — toggle “Cobrar taxa de entrega” → `service_fee_definitions.is_active` (system_key=delivery); link + resumo do valor → Taxas.
2. **Taxas** — só cálculo/valor da entrega; status ativo/inativo é leitura; preservar `is_active` no save.
3. **Pedidos** — ao abrir novo pedido, recarrega definição e pré-preenche taxa se ativa+fixed.

## Fora de escopo (v1)

- Repasse de gorjeta ao garçom
- MDR / taxas marketplace
- Cardápio web / chatbot aplicando taxas % (só delivery via policy existente)
