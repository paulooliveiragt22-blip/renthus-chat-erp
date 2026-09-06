-- Copy comercial dos planos na vitrine (sem crédito IA / packs na descrição).
update public.plans
set description = case key
  when 'essencial' then 'WhatsApp + cardápio web + PDV básico'
  when 'pro' then 'ERP completo + impressão (canal próprio)'
  when 'market' then 'Tudo do Pro + iFood/Aiqfome + IG/Messenger + mesa'
  else description
end
where key in ('essencial', 'pro', 'market');
