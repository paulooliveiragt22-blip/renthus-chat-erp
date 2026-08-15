-- Policy canônica: companies.settings.accepted_customer_payments
-- Default = hard-code histórico (pix/cash/card on, debit off). Remove enabled_payments legado.

update public.companies
set settings = (
  coalesce(settings, '{}'::jsonb)
  - 'enabled_payments'
  || jsonb_build_object(
    'accepted_customer_payments',
    jsonb_build_object(
      'pix', true,
      'cash', true,
      'card', true,
      'debit', false
    )
  )
)
where settings is null
   or settings -> 'accepted_customer_payments' is null
   or settings ? 'enabled_payments';

-- Empresas que já tinham accepted_customer_payments: só limpa enabled_payments
update public.companies
set settings = settings - 'enabled_payments'
where settings ? 'enabled_payments';
