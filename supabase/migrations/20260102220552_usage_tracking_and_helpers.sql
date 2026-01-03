-- Threads por company (inbox)
create index if not exists whatsapp_threads_company_idx
on whatsapp_threads (company_id, last_message_at desc);

-- Mensagens por thread (chat view)
create index if not exists whatsapp_messages_thread_idx
on whatsapp_messages (thread_id, created_at);

-- Mensagens por company (billing)
create index if not exists whatsapp_messages_company_idx
on whatsapp_messages (provider, created_at);

-- =========================
-- BACKFILL legacy threads
-- =========================
do $$
declare
  v_company_id uuid;
  v_channel_id uuid;
  v_from_identifier text;
begin
  -- pega a primeira company
  select id into v_company_id
  from companies
  order by created_at asc
  limit 1;

  if v_company_id is null then
    raise exception 'Não existe nenhuma company em companies. Crie uma company antes de rodar esta migration.';
  end if;

  -- tenta descobrir um identificador "from" (fallback seguro)
  select coalesce(
    (select max(wa_to) from whatsapp_threads where wa_to is not null),
    'twilio:unknown'
  ) into v_from_identifier;

  -- pega canal ativo existente
  select id into v_channel_id
  from whatsapp_channels
  where company_id = v_company_id and status = 'active'
  limit 1;

  -- se não existe, cria um canal Twilio padrão para dados legados
  if v_channel_id is null then
    insert into whatsapp_channels (company_id, provider, status, from_identifier, provider_metadata)
    values (v_company_id, 'twilio', 'active', v_from_identifier, jsonb_build_object('note','legacy backfill'))
    returning id into v_channel_id;
  end if;

  -- preenche threads antigas
  update whatsapp_threads
  set company_id = v_company_id
  where company_id is null;

  update whatsapp_threads
  set channel_id = v_channel_id
  where channel_id is null;
end $$;

-- =========================
-- Agora sim: integridade
-- =========================
alter table whatsapp_threads
  alter column company_id set not null,
  alter column channel_id set not null;


create or replace function current_year_month()
returns text
language sql
immutable
as $$
  select to_char(now(), 'YYYY-MM');
$$;

create or replace function increment_monthly_usage(
  p_company_id uuid,
  p_feature_key text,
  p_amount int default 1
)
returns void
language plpgsql
as $$
begin
  insert into usage_monthly (
    company_id,
    feature_key,
    year_month,
    used
  )
  values (
    p_company_id,
    p_feature_key,
    current_year_month(),
    p_amount
  )
  on conflict (company_id, feature_key, year_month)
  do update set
    used = usage_monthly.used + excluded.used;
end;
$$;


create or replace function track_whatsapp_usage()
returns trigger
language plpgsql
as $$
begin
  -- só conta mensagens reais
  if new.provider is not null then
    perform increment_monthly_usage(
      (select company_id from whatsapp_threads where id = new.thread_id),
      'whatsapp_messages',
      1
    );
  end if;

  return new;
end;
$$;


drop trigger if exists whatsapp_usage_trigger on whatsapp_messages;

create trigger whatsapp_usage_trigger
after insert on whatsapp_messages
for each row
execute function track_whatsapp_usage();


create or replace view v_whatsapp_usage_current_month as
select
  u.company_id,
  c.name as company_name,
  u.used as messages_used,
  fl.limit_per_month,
  (u.used - fl.limit_per_month) as overage
from usage_monthly u
join companies c on c.id = u.company_id
left join subscriptions s on s.company_id = u.company_id and s.status = 'active'
left join feature_limits fl
  on fl.plan_id = s.plan_id
  and fl.feature_key = u.feature_key
where
  u.feature_key = 'whatsapp_messages'
  and u.year_month = current_year_month();


insert into features (key, description)
values ('whatsapp_messages', 'Quantidade de mensagens WhatsApp por mês')
on conflict do nothing;

