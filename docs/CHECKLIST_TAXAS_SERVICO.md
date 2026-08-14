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

## Dívida de UX / cascata (aberta 2026-08-14)

A unificação canônica no **dado** está ok (`service_fee_definitions` delivery). A **ativação** e o **default em Pedidos** ficaram opacos:

1. Toggle “Cobrar taxa de entrega” saiu da aba Delivery e só existe em Taxas (`is_active` da definição) — usuário espera isso em Delivery.
2. Migration de sync usou `companies.delivery_fee_enabled` (default histórico `false`) → a maioria das empresas ficou com delivery `is_active=false` e `value=0`.
3. Pedidos lê a definição: se inativa ou valor 0 → campo “Taxa de entrega” vem `0,00`; “outras taxas” ativas aparecem como checkboxes (caminho diferente).
4. Cotação por bairro / chatbot ainda usam base fee da definição — mesma regra.

**Correção proposta (discutir antes de código):** manter valor/cálculo canônico em Taxas; **reativar o toggle “Cobrar taxa” na aba Delivery** como UI que grava o mesmo `is_active` (um write path, dois pontos de leitura); ao abrir Pedidos novo, pré-preencher valor da definição quando ativa+fixed. Não recriar coluna em `companies`.

## Fora de escopo (v1)

- Repasse de gorjeta ao garçom
- MDR / taxas marketplace
- Cardápio web / chatbot aplicando taxas % (só delivery via policy existente)
