# Migração UI -> acesso seguro (arquivo a arquivo)

Data: 2026-04-14

## Prioridade alta (quebra funcional imediata)

| Arquivo | Acesso atual (cru) | Alvo recomendado |
|---|---|---|
| `app/(admin)/pedidos/PedidosClient.tsx` | ✅ Migrado para API server-side (`/api/admin/orders*`, `/order-customers`, `/order-addresses`, `/products/search`, `/financial-entries`) | Próximo passo opcional: consolidar mutações em RPC transacional de domínio |
| `app/(admin)/pdv/page.tsx` | ✅ Migrado para `/api/admin/pdv/*` (produtos, pedidos pendentes, importação de pedido, caixa, clientes, finalização) | Opcional: RPC transacional única (`rpc_finalize_pdv_sale`) para atomicidade total |
| `app/(admin)/financeiro/page.tsx` | ✅ Migrado para `/api/admin/financeiro/*` (dashboard, extrato, despesas, contas, caixa, DRE, finalização) | Opcional: RPC transacional para baixa/lançamento |
| `app/(admin)/clientes/page.tsx` | ✅ Migrado para `/api/admin/customers*`, dívidas via `/api/admin/financeiro/bills` | Opcional: `rpc_upsert_customer_with_primary_address` |
| `app/(admin)/fila/FilaClient.tsx` | ✅ Migrado para `/api/admin/fila/*`, `/api/admin/orders/[id]`, drivers, busca de produtos, `order-customers`, itens do pedido | Overlay de edição: `components/fila/FilaOrderEditOverlay.tsx` via mesmas APIs (sem Supabase no browser) |
| `app/(admin)/entregadores/page.tsx` | `drivers` CRUD direto | ✅ Migrado para `/api/admin/drivers` |
| `app/(admin)/configuracoes/page.tsx` | `company_settings` direto | ✅ Migrado para `/api/admin/company-settings` |

## Prioridade média

| Arquivo | Acesso atual | Alvo |
|---|---|---|
| `app/(admin)/impressoras/page.tsx` | ✅ Migrado para APIs (`/api/agent/*`, `/api/admin/impressoras/jobs`, `/api/admin/impressoras/test-order`) | Fila enfileirada por RPC `rpc_enqueue_print_job` (server-side) |
| `app/(admin)/suporte/SuporteClient.tsx` | `support_tickets` | ✅ Migrado para `/api/admin/support-tickets` |
| `app/(admin)/produtos/[id]/imagens/page.tsx` | ✅ Migrado para `/api/admin/products/[id]/images` (GET/PATCH/DELETE) + upload em `/api/products/upload-image` |

## APIs já server-side (baixo risco imediato)

`app/api/*` e `lib/*` com `createAdminClient`/service role tendem a seguir funcionando sob RLS estrito, porém ainda precisam padronização:

- Preferir `rpc` de domínio para mutações críticas (pedido, financeiro, billing, WhatsApp).
- Evitar leitura “tabela nua” em rotas públicas sem filtro de company.

## Lacunas de RPC por domínio

- Pedidos: `rpc_admin_upsert_order_with_items` (já em uso em `POST /api/admin/orders` e `PUT /api/admin/orders/items`); **`rpc_admin_cancel_order`** (cancelamento e rejeição na fila via `PATCH /api/admin/fila/orders/[id]` e cancel em `PATCH /api/admin/orders`); **`rpc_admin_assign_driver`** (`PATCH /api/admin/orders` quando `driver_id` é enviado)
- Clientes: **`rpc_upsert_customer_with_primary_address`** (`POST`/`PATCH /api/admin/customers`, `POST /api/admin/pdv/customers` com endereço opcional)
- Financeiro: **`rpc_upsert_expense`** (`POST`/`PATCH mark_paid` em `/api/admin/financeiro/expenses`); **`rpc_pay_bill`** (`PATCH /api/admin/financeiro/bills`); **`rpc_open_cash_register`** / **`rpc_close_cash_register`** (`POST`/`PATCH` em `/api/admin/pdv/cash-register`)
- PDV: **`rpc_finalize_pdv_order`** + alias **`rpc_finalize_sale`** (`POST /api/admin/pdv/finalize`) — migration `20260414240000_domain_admin_rpcs.sql`
- Entregadores: **`rpc_upsert_driver`**, **`rpc_toggle_driver_active`** (RPC disponível; rotas usam upsert/delete), **`rpc_delete_driver`** (`/api/admin/drivers`)

## Regra operacional sugerida

1. UI (browser) nunca chama tabela diretamente.
2. UI chama apenas API Next (`app/api/*`).
3. API usa service role e executa:
   - leitura por views de domínio (não genéricas),
   - mutação por RPC de domínio.
