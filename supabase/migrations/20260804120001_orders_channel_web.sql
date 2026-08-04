-- Canal dos pedidos do cardápio web público (+ mantém valores já usados em produção).

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_channel_check
  CHECK (channel = ANY (ARRAY[
    'whatsapp'::text,
    'admin'::text,
    'balcao'::text,
    'web'::text
  ]));
