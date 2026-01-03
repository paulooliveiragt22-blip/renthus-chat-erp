-- Add allow_overage flag to active subscription
-- Idempotente (não quebra se rodar de novo)

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'allow_overage'
  ) then
    alter table public.subscriptions
      add column allow_overage boolean not null default false;
  end if;
end $$;

-- (Opcional) índice leve para lookup por company/status
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'subscriptions_company_status_idx'
  ) then
    create index subscriptions_company_status_idx
      on public.subscriptions(company_id, status);
  end if;
end $$;
