-- Copia-e-cola PIX também em setup_payments (taxa de ativação).
-- invoices já tinha pix_qr_code; setup só guardava URL da imagem.

alter table public.setup_payments
  add column if not exists pix_qr_code text;

comment on column public.setup_payments.pix_qr_code is
  'BR Code PIX (EMV copia-e-cola). URL da imagem fica em pagarme_payment_url.';
