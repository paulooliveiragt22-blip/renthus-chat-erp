-- Preços falados no WhatsApp acompanham o plano: anual com 60% e mensal com 50% nos 3 primeiros meses.
update public.service_offerings
set price_cents = case name
      when 'Delivery Essencial mensal' then 13950
      when 'Delivery Essencial anual' then 133920
      when 'Delivery Pro mensal' then 17450
      when 'Delivery Pro anual' then 167520
      when 'Delivery Market mensal' then 22450
      when 'Delivery Market anual' then 215520
    end,
    description = case name
      when 'Delivery Essencial mensal' then
        case when description like 'Nos 3 primeiros meses%' then description
        else 'Nos 3 primeiros meses. Depois, 279 reais.' || E'\n' || description end
      when 'Delivery Pro mensal' then
        case when description like 'Nos 3 primeiros meses%' then description
        else 'Nos 3 primeiros meses. Depois, 349 reais.' || E'\n' || description end
      when 'Delivery Market mensal' then
        case when description like 'Nos 3 primeiros meses%' then description
        else 'Nos 3 primeiros meses. Depois, 449 reais.' || E'\n' || description end
      else description
    end,
    updated_at = now()
where company_id = '0113a3fe-e224-49ff-81c6-f8b9df556267'
  and name in (
    'Delivery Essencial mensal',
    'Delivery Essencial anual',
    'Delivery Pro mensal',
    'Delivery Pro anual',
    'Delivery Market mensal',
    'Delivery Market anual'
  );
