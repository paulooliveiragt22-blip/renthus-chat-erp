-- Pedidos criados pelo checkout do cardápio web público (`source = web_menu`).

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
    'ai_chat_pro_v2'::text,
    'web_menu'::text
  ]));
