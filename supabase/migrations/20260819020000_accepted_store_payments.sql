-- Policy de pagamentos na loja (PDV / Pedidos admin / Mesa close).
-- Separado de accepted_customer_payments (cardápio + chatbot).

update public.companies
set settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'accepted_store_payments',
    jsonb_build_object(
      'pix', true,
      'cash', true,
      'card', true,
      'debit', true
    ),
    'accepted_store_prazo',
    jsonb_build_object(
      'credit_installment', true,
      'boleto', true,
      'promissoria', true,
      'cheque', true
    )
  )
where settings -> 'accepted_store_payments' is null;
