-- Identifica a via no payload do job e passa o default de auto-print para 3 vias.
-- Entregador = via do cliente; RPC já ignora driver em pickup.

alter table public.company_settings
  alter column print_auto_copies set default array['kitchen', 'cashier', 'driver']::text[];

update public.company_settings
   set print_auto_copies = array['kitchen', 'cashier', 'driver']::text[]
 where print_auto_copies is null
    or cardinality(print_auto_copies) = 0
    or (
      print_auto_copies <@ array['kitchen', 'cashier']::text[]
      and cardinality(print_auto_copies) = 2
      and 'kitchen' = any (print_auto_copies)
      and 'cashier' = any (print_auto_copies)
      and not ('driver' = any (print_auto_copies))
    );

create or replace function public.rpc_enqueue_print_job(
    p_company_id uuid,
    p_order_id uuid,
    p_source text default 'reprint',
    p_change numeric default 0,
    p_priority integer default 5,
    p_copy_types text[] default null
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
    v_label        text;
    v_banner       text;
    v_header       text;
    v_footer       text;
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
            select coalesce(cs.print_auto_copies, array['kitchen', 'cashier', 'driver']::text[])
              into v_copies
              from public.company_settings cs
             where cs.company_id = p_company_id;
            if v_copies is null then
                v_copies := array['kitchen', 'cashier', 'driver']::text[];
            end if;
        else
            v_copies := array['cashier']::text[];
        end if;
    else
        v_copies := p_copy_types;
    end if;

    select array_agg(distinct lower(trim(x)) order by lower(trim(x)))
      into v_copies
      from unnest(v_copies) as x
     where lower(trim(x)) in ('kitchen', 'cashier', 'driver');

    if v_copies is null or cardinality(v_copies) = 0 then
        raise exception 'nenhuma via de impressão válida'
            using errcode = 'check_violation';
    end if;

    select
        coalesce((c.settings ->> 'hide_prices_kitchen')::boolean, false),
        coalesce(nullif(trim(c.settings ->> 'print_header'), ''), ''),
        coalesce(nullif(trim(c.settings ->> 'print_footer'), ''), '')
      into v_hide_kitchen, v_header, v_footer
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

        if v_copy = 'kitchen' then
            v_label := 'Cozinha';
            v_banner := 'VIA COZINHA';
        elsif v_copy = 'driver' then
            v_label := 'Entregador (cliente)';
            v_banner := 'VIA ENTREGADOR / CLIENTE';
        else
            v_label := 'Caixa';
            v_banner := 'VIA CAIXA';
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
                'copy_label', v_label,
                'copy_banner', v_banner,
                'hide_prices', (v_copy = 'kitchen' and v_hide_kitchen),
                'print_header', v_header,
                'print_footer', v_footer
            ),
            'pending',
            0,
            coalesce(p_priority, 5),
            v_src,
            v_copy
        )
        returning id into v_job_id;

        v_jobs := v_jobs || jsonb_build_array(
            jsonb_build_object(
                'copy_type', v_copy,
                'copy_label', v_label,
                'job_id', v_job_id
            )
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
  'Enfileira 1 job por via (kitchen|cashier|driver) com copy_label/banner. driver só em delivery.';

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
           coalesce(cs.print_auto_copies, array['kitchen', 'cashier', 'driver']::text[])
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
            raise warning 'enqueue_print_job_for_order: %', sqlerrm;
    end;

    return new;
end;
$$;
