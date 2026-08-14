-- M4+M6: vias de impressão (kitchen|cashier|driver) + limpar fila (canceled).
-- Pré-requisito: 20260813245000_job_status_canceled.sql

-- 1) Coluna copy_type + backfill
alter table public.print_jobs
  add column if not exists copy_type text;

update public.print_jobs
   set copy_type = 'cashier'
 where copy_type is null;

alter table public.print_jobs
  alter column copy_type set default 'cashier';

alter table public.print_jobs
  alter column copy_type set not null;

alter table public.print_jobs
  drop constraint if exists print_jobs_copy_type_check;

alter table public.print_jobs
  add constraint print_jobs_copy_type_check
  check (copy_type = any (array['kitchen'::text, 'cashier'::text, 'driver'::text]));

comment on column public.print_jobs.copy_type is
  'Via do cupom: kitchen | cashier | driver.';

-- Dedup ativos legados (mesmo pedido) antes do unique parcial — marca failed (enum canceled pode não estar usável ainda nesta txn)
with ranked as (
  select
    j.id,
    row_number() over (
      partition by j.company_id, j.source_id, j.copy_type
      order by j.created_at desc nulls last, j.id desc
    ) as rn
  from public.print_jobs j
  where j.status in ('pending', 'processing')
    and j.source_id is not null
)
update public.print_jobs j
   set status = 'failed',
       finished_at = coalesce(j.finished_at, now()),
       last_error = coalesce(j.last_error, 'dedup_before_copy_type_uq')
  from ranked r
 where j.id = r.id
   and r.rn > 1;

-- Unique ativo por pedido+via (permite reprint depois de done/failed/canceled)
drop index if exists public.print_jobs_active_copy_uq;
create unique index print_jobs_active_copy_uq
  on public.print_jobs (company_id, source_id, copy_type)
  where status in ('pending', 'processing')
    and source_id is not null;

create index if not exists print_jobs_company_copy_created_idx
  on public.print_jobs (company_id, created_at desc);

-- 3) company_settings: vias do auto-print
alter table public.company_settings
  add column if not exists print_auto_copies text[] not null default array['kitchen', 'cashier']::text[];

alter table public.company_settings
  drop constraint if exists company_settings_print_auto_copies_check;

alter table public.company_settings
  add constraint company_settings_print_auto_copies_check
  check (
    print_auto_copies <@ array['kitchen', 'cashier', 'driver']::text[]
    and cardinality(print_auto_copies) >= 0
  );

-- Backfill a partir do jsonb legado print_delivery_copy
update public.company_settings cs
   set print_auto_copies = case
     when coalesce((c.settings ->> 'print_delivery_copy')::boolean, false)
       then array['kitchen', 'cashier', 'driver']::text[]
     else array['kitchen', 'cashier']::text[]
   end
  from public.companies c
 where c.id = cs.company_id;

comment on column public.company_settings.print_auto_copies is
  'Vias enfileiradas no auto-print ao confirmar pedido.';

-- 4) RPC enqueue (DROP assinatura antiga — radical)
drop function if exists public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer);

create or replace function public.rpc_enqueue_print_job(
    p_company_id  uuid,
    p_order_id    uuid,
    p_source      text default 'reprint',
    p_change      numeric default 0,
    p_priority    integer default 5,
    p_copy_types  text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_printer_id   uuid;
    v_fulfill      text;
    v_copies       text[];
    v_copy         text;
    v_hide_kitchen boolean := false;
    v_job_id       uuid;
    v_jobs         jsonb := '[]'::jsonb;
    v_skipped      jsonb := '[]'::jsonb;
    v_src          text;
begin
    v_src := coalesce(nullif(trim(p_source), ''), 'reprint');

    select coalesce(o.fulfillment_type, 'delivery')
      into v_fulfill
      from public.orders o
     where o.id = p_order_id
       and o.company_id = p_company_id;

    if not found then
        raise exception 'pedido não encontrado'
            using errcode = 'no_data_found';
    end if;

    if p_copy_types is null or cardinality(p_copy_types) = 0 then
        if v_src = 'order' then
            select coalesce(cs.print_auto_copies, array['kitchen', 'cashier']::text[])
              into v_copies
              from public.company_settings cs
             where cs.company_id = p_company_id;
            if v_copies is null then
                v_copies := array['kitchen', 'cashier']::text[];
            end if;
        else
            v_copies := array['cashier']::text[];
        end if;
    else
        v_copies := p_copy_types;
    end if;

    -- dedupe + validação
    select array_agg(distinct lower(trim(x)) order by lower(trim(x)))
      into v_copies
      from unnest(v_copies) as x
     where lower(trim(x)) in ('kitchen', 'cashier', 'driver');

    if v_copies is null or cardinality(v_copies) = 0 then
        raise exception 'nenhuma via de impressão válida'
            using errcode = 'check_violation';
    end if;

    select coalesce((c.settings ->> 'hide_prices_kitchen')::boolean, false)
      into v_hide_kitchen
      from public.companies c
     where c.id = p_company_id;

    select cp.printer_id
      into v_printer_id
      from public.company_printers cp
     where cp.company_id = p_company_id
       and cp.is_default = true
     limit 1;

    if v_printer_id is null then
        select p.id
          into v_printer_id
          from public.printers p
         where p.company_id = p_company_id
           and coalesce(p.is_active, true) = true
         order by p.created_at asc
         limit 1;
    end if;

    if v_printer_id is null then
        raise exception 'Nenhuma impressora ativa configurada para esta empresa';
    end if;

    foreach v_copy in array v_copies
    loop
        if v_copy = 'driver' and v_fulfill <> 'delivery' then
            v_skipped := v_skipped || jsonb_build_array(v_copy);
            continue;
        end if;

        if exists (
            select 1
              from public.print_jobs j
             where j.company_id = p_company_id
               and j.source_id = p_order_id
               and j.copy_type = v_copy
               and j.status in ('pending', 'processing')
        ) then
            v_skipped := v_skipped || jsonb_build_array(v_copy);
            continue;
        end if;

        insert into public.print_jobs (
            company_id,
            order_id,
            source_id,
            printer_id,
            payload,
            status,
            attempts,
            priority,
            source,
            copy_type
        ) values (
            p_company_id,
            p_order_id,
            p_order_id,
            v_printer_id,
            jsonb_build_object(
                'type', 'receipt',
                'orderId', p_order_id,
                'change', coalesce(p_change, 0),
                'copy_type', v_copy,
                'hide_prices', (v_copy = 'kitchen' and v_hide_kitchen)
            ),
            'pending',
            0,
            coalesce(p_priority, 5),
            v_src,
            v_copy
        )
        returning id into v_job_id;

        v_jobs := v_jobs || jsonb_build_array(
            jsonb_build_object('copy_type', v_copy, 'job_id', v_job_id)
        );
    end loop;

    return jsonb_build_object(
        'ok', true,
        'order_id', p_order_id,
        'jobs', v_jobs,
        'skipped', v_skipped
    );
end;
$$;

revoke all on function public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer, text[]) from public;
revoke all on function public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer, text[]) from anon, authenticated;
grant execute on function public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer, text[]) to service_role;

comment on function public.rpc_enqueue_print_job(uuid, uuid, text, numeric, integer, text[]) is
  'M4: enfileira 1 job por via (kitchen|cashier|driver). driver só em delivery.';

-- 5) Trigger auto-print: N vias conforme company_settings
create or replace function public.enqueue_print_job_for_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_auto   boolean;
    v_copies text[];
    v_result jsonb;
begin
    if new.company_id is null then
        return new;
    end if;

    if coalesce(new.confirmation_status, '') <> 'confirmed' then
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if coalesce(old.confirmation_status, '') = 'confirmed' then
            return new;
        end if;
    end if;

    if new.printed_at is not null then
        return new;
    end if;

    select coalesce(cs.auto_print_orders, true),
           coalesce(cs.print_auto_copies, array['kitchen', 'cashier']::text[])
      into v_auto, v_copies
      from public.company_settings cs
     where cs.company_id = new.company_id;

    if not coalesce(v_auto, true) then
        return new;
    end if;

    if v_copies is null or cardinality(v_copies) = 0 then
        return new;
    end if;

    begin
        v_result := public.rpc_enqueue_print_job(
            new.company_id,
            new.id,
            'order',
            0,
            100,
            v_copies
        );
    exception
        when others then
            -- Não bloqueia o pedido se a impressora não estiver configurada
            raise warning 'enqueue_print_job_for_order: %', sqlerrm;
    end;

    return new;
end;
$$;

-- 6) Limpar fila (M6)
create or replace function public.rpc_clear_print_queue(
    p_company_id uuid,
    p_cancel_stale_processing boolean default true,
    p_stale_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_pending int := 0;
    v_stale   int := 0;
    v_mins    int;
begin
    v_mins := greatest(coalesce(p_stale_minutes, 15), 1);

    update public.print_jobs j
       set status = 'canceled',
           finished_at = now(),
           last_error = coalesce(j.last_error, 'cleared_by_admin')
     where j.company_id = p_company_id
       and j.status = 'pending';
    get diagnostics v_pending = row_count;

    if coalesce(p_cancel_stale_processing, true) then
        update public.print_jobs j
           set status = 'canceled',
               finished_at = now(),
               last_error = coalesce(j.last_error, 'cleared_stale_processing')
         where j.company_id = p_company_id
           and j.status = 'processing'
           and (
             (j.reserved_at is not null and j.reserved_at < now() - make_interval(mins => v_mins))
             or (j.reserved_at is null and j.started_at is not null and j.started_at < now() - make_interval(mins => v_mins))
             or (j.reserved_at is null and j.started_at is null and j.created_at < now() - make_interval(mins => v_mins))
           );
        get diagnostics v_stale = row_count;
    end if;

    return jsonb_build_object(
        'ok', true,
        'canceled_pending', v_pending,
        'canceled_stale_processing', v_stale
    );
end;
$$;

revoke all on function public.rpc_clear_print_queue(uuid, boolean, integer) from public;
revoke all on function public.rpc_clear_print_queue(uuid, boolean, integer) from anon, authenticated;
grant execute on function public.rpc_clear_print_queue(uuid, boolean, integer) to service_role;

comment on function public.rpc_clear_print_queue(uuid, boolean, integer) is
  'M6: cancela pending; processing só se lease/stale. Nunca DELETE.';
