-- Adiciona 'flow_catalog' e 'flow_checkout' aos valores permitidos em orders.source
ALTER TABLE public.orders
  DROP CONSTRAINT orders_source_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_source_check
    CHECK (source = ANY (ARRAY['chatbot'::text, 'ui'::text, 'pdv_direct'::text,
                               'flow_catalog'::text, 'flow_checkout'::text]));
