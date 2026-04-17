-- Permite marcar pedidos criados pelo PRO Pipeline V2 em `orders.source`
-- (RPC `create_order_with_items` — `order.service.v2.ts`).

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_source_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_source_check
  CHECK (source = ANY (ARRAY[
    'chatbot'::text,
    'ui'::text,
    'pdv_direct'::text,
    'flow_catalog'::text,
    'flow_checkout'::text,
    'ai_chat_pro_v2'::text
  ]));
