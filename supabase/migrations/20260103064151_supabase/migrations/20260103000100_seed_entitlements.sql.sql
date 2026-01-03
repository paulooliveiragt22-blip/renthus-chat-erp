-- Seed de planos, features, relações e limites
-- Idempotente (pode rodar mais de uma vez)

-- 1) Plans
insert into plans (key, name, description)
values
  ('mini_erp', 'Mini ERP', 'Plano básico: pedidos/clientes/catálogo + WhatsApp com limites'),
  ('full_erp', 'ERP Full', 'Plano completo: ERP avançado + Fiscal (NF) + PDV')
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;

-- 2) Features (flags e contadores)
insert into features (key, description)
values
  -- Já existe via usage_tracking, mas mantemos aqui idempotente
  ('whatsapp_messages', 'Quantidade de mensagens WhatsApp por mês'),

  -- ERP / módulos
  ('erp_full', 'Libera recursos avançados do ERP'),
  ('pdv', 'Habilita módulo PDV (frente de caixa)'),

  -- Fiscal (as 3 notas)
  ('fiscal_nfse', 'Emissão de NFS-e (serviços)'),
  ('fiscal_nfe', 'Emissão de NF-e (produtos)'),
  ('fiscal_nfce', 'Emissão de NFC-e (varejo / balcão)'),

  -- Add-ons
  ('printing_auto', 'Fila de impressão automática'),
  ('tef', 'Pagamento integrado via TEF'),

  -- (Opcional, já deixando pronto pra cobrança por uso no futuro)
  ('invoices', 'Quantidade de documentos fiscais emitidos por mês'),
  ('tef_transactions', 'Quantidade de transações TEF por mês')
on conflict (key) do update
set
  description = excluded.description;

-- 3) Vincula features a planos + define limites
do $$
declare
  v_mini uuid;
  v_full uuid;
begin
  select id into v_mini from plans where key = 'mini_erp';
  select id into v_full from plans where key = 'full_erp';

  if v_mini is null or v_full is null then
    raise exception 'Seed entitlements: planos não encontrados';
  end if;

  -- Plan features
  -- Mini ERP: WhatsApp (com limite), sem ERP full, sem PDV/fiscal
  insert into plan_features (plan_id, feature_key)
  values
    (v_mini, 'whatsapp_messages')
  on conflict do nothing;

  -- Full ERP: libera ERP full + PDV + Fiscal + WhatsApp
  insert into plan_features (plan_id, feature_key)
  values
    (v_full, 'whatsapp_messages'),
    (v_full, 'erp_full'),
    (v_full, 'pdv'),
    (v_full, 'fiscal_nfse'),
    (v_full, 'fiscal_nfe'),
    (v_full, 'fiscal_nfce')
  on conflict do nothing;

  -- Feature limits (mensagens/mês)
  -- Ajuste os números conforme sua precificação
  insert into feature_limits (plan_id, feature_key, limit_per_month)
  values
    (v_mini, 'whatsapp_messages', 1000),
    (v_full, 'whatsapp_messages', 5000)
  on conflict (plan_id, feature_key) do update
  set limit_per_month = excluded.limit_per_month;

  -- (Opcional) se quiser já colocar limite de notas/transações (deixa comentado por ora)
  -- insert into feature_limits (plan_id, feature_key, limit_per_month)
  -- values
  --   (v_full, 'invoices', 1000),
  --   (v_full, 'tef_transactions', 2000)
  -- on conflict (plan_id, feature_key) do update
  -- set limit_per_month = excluded.limit_per_month;

end $$;
