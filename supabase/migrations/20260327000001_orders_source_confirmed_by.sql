-- Migration: adiciona source e confirmed_by em orders
-- confirmation_status, confirmed_at, printed_at já existem (migrations anteriores)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chatbot',
  -- 'chatbot' | 'flow_catalog' | 'flow_status' | 'manual_ui' | 'pdv'
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.orders.source IS
  'Origem do pedido: chatbot | flow_catalog | manual_ui | pdv';

COMMENT ON COLUMN public.orders.confirmed_by IS
  'Usuário que confirmou/rejeitou o pedido (quando require_order_approval=true)';
