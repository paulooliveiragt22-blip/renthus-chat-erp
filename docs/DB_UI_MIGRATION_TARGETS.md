# Migração UI -> acesso seguro (arquivo a arquivo)

Data: 2026-04-14

## Prioridade alta (quebra funcional imediata)

| Arquivo | Acesso atual (cru) | Alvo recomendado |
|---|---|---|
| `app/(admin)/pedidos/PedidosClient.tsx` | `orders`, `order_items`, `customers`, `enderecos_cliente`, `drivers`, `companies` via `from()` | Mover para API server-side: `GET /api/orders/list`, `PATCH /api/orders/[id]`, RPC de atualização de pedido com itens |
| `app/(admin)/pdv/page.tsx` | `orders`, `order_items`, `customers`, `sales`, `sale_items`, `sale_payments`, `cash_*`, `financial_entries` | APIs por domínio PDV + RPC transacional para fechamento de venda/pedido |
| `app/(admin)/financeiro/page.tsx` | `sales`, `orders`, `sale_*`, `expenses`, `bills`, `cash_*` | APIs server-side de financeiro com queries agregadas + RPC de baixa/lançamento |
| `app/(admin)/clientes/page.tsx` | `customers`, `enderecos_cliente`, `bills` | API de clientes (`list/create/update/delete`) + API de endereços + API de contas a receber |
| `app/(admin)/fila/FilaClient.tsx` | `orders`, `view_pdv_produtos` | API de fila com mutações server-side |
| `app/(admin)/entregadores/page.tsx` | `drivers` CRUD direto | ✅ Migrado para `/api/admin/drivers` |
| `app/(admin)/configuracoes/page.tsx` | `company_settings` direto | ✅ Migrado para `/api/admin/company-settings` |

## Prioridade média

| Arquivo | Acesso atual | Alvo |
|---|---|---|
| `app/(admin)/impressoras/page.tsx` | `orders`, `order_items` | Endpoints de impressão + leitura de pedido por API |
| `app/(admin)/suporte/SuporteClient.tsx` | `support_tickets` | ✅ Migrado para `/api/admin/support-tickets` |
| `app/(admin)/produtos/[id]/imagens/page.tsx` | `product_images` direto | API de imagens de produto |

## APIs já server-side (baixo risco imediato)

`app/api/*` e `lib/*` com `createAdminClient`/service role tendem a seguir funcionando sob RLS estrito, porém ainda precisam padronização:

- Preferir `rpc` de domínio para mutações críticas (pedido, financeiro, billing, WhatsApp).
- Evitar leitura “tabela nua” em rotas públicas sem filtro de company.

## Lacunas de RPC por domínio (a criar)

- Pedidos: `rpc_admin_upsert_order_with_items`, `rpc_admin_cancel_order`, `rpc_admin_assign_driver`
- Clientes: `rpc_upsert_customer_with_primary_address`
- Financeiro: `rpc_upsert_expense`, `rpc_pay_bill`, `rpc_open_cash_register`, `rpc_close_cash_register`
- PDV: `rpc_finalize_sale`, `rpc_finalize_pdv_order`
- Entregadores: `rpc_upsert_driver`, `rpc_toggle_driver_active`, `rpc_delete_driver`

## Regra operacional sugerida

1. UI (browser) nunca chama tabela diretamente.
2. UI chama apenas API Next (`app/api/*`).
3. API usa service role e executa:
   - leitura por views de domínio (não genéricas),
   - mutação por RPC de domínio.
