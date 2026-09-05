-- ADR-0008 P1.8 / D-P5: idempotência de cupom impresso offline (anti-enxurrada no sync).

alter table public.print_jobs
  add column if not exists client_print_id text;

comment on column public.print_jobs.client_print_id is
  'UUID gerado no PWA/agent local; unique por company. Sync offline grava job done sem pending.';

create unique index if not exists print_jobs_company_client_print_id_uq
  on public.print_jobs (company_id, client_print_id)
  where client_print_id is not null;

create or replace function public.rpc_record_offline_print_done(
  p_company_id uuid,
  p_order_id uuid,
  p_client_print_id text,
  p_copy_type text default 'cashier',
  p_payload jsonb default '{}'::jsonb,
  p_printed_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_key text := nullif(trim(p_client_print_id), '');
begin
  if p_company_id is null or p_order_id is null or v_key is null then
    raise exception 'invalid_args';
  end if;

  select id into v_id
  from public.print_jobs
  where company_id = p_company_id
    and client_print_id = v_key
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  begin
    insert into public.print_jobs (
      company_id,
      order_id,
      status,
      source,
      client_print_id,
      copy_type,
      payload,
      meta,
      priority,
      processed_at,
      finished_at,
      started_at
    ) values (
      p_company_id,
      p_order_id,
      'done'::job_status,
      'offline_local',
      v_key,
      coalesce(nullif(trim(p_copy_type), ''), 'cashier'),
      coalesce(p_payload, '{}'::jsonb),
      jsonb_build_object(
        'printed_offline', true,
        'printed_at', p_printed_at
      ),
      5,
      p_printed_at,
      p_printed_at,
      p_printed_at
    )
    returning id into v_id;
  exception
    when unique_violation then
      select id into v_id
      from public.print_jobs
      where company_id = p_company_id
        and client_print_id = v_key
      limit 1;
  end;

  return v_id;
end;
$$;

revoke all on function public.rpc_record_offline_print_done(uuid, uuid, text, text, jsonb, timestamptz) from public;
grant execute on function public.rpc_record_offline_print_done(uuid, uuid, text, text, jsonb, timestamptz) to service_role;
