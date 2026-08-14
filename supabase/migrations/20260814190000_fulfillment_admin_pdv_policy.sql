-- Fulfillment completo: admin upsert + PDV balcão pickup + policy view/RPC.

-- ─── 1. rpc_admin_upsert_order_with_items (+ p_fulfillment_type, p_delivery_address)

drop function if exists public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb
);
drop function if exists public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb, text, text
);

create or replace function public.rpc_admin_upsert_order_with_items(
    p_company_id            uuid,
    p_order_id              uuid,
    p_customer_id           uuid,
    p_channel               text,
    p_status                text,
    p_confirmation_status   text,
    p_payment_method        text,
    p_paid                  boolean,
    p_change_for            numeric,
    p_delivery_fee          numeric,
    p_details               text,
    p_driver_id             uuid,
    p_source                text,
    p_items                 jsonb,
    p_fulfillment_type      text default 'delivery',
    p_delivery_address      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id      uuid;
    v_line_subtotal numeric;
    v_src           text;
    v_ch            text;
    v_fulfill       text;
    v_fee           numeric;
    v_addr          text;
    v_driver        uuid;
    v_del           boolean;
    v_pick          boolean;
begin
    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'pedido não pode ser salvo sem itens'
            using errcode = 'check_violation';
    end if;

    v_fulfill := lower(coalesce(nullif(trim(p_fulfillment_type), ''), 'delivery'));
    if v_fulfill not in ('delivery', 'pickup') then
        raise exception 'fulfillment_type inválido'
            using errcode = 'check_violation';
    end if;

    select
        coalesce(deliveries_enabled, true),
        coalesce(pickup_enabled, true)
      into v_del, v_pick
      from public.company_delivery_policy
     where company_id = p_company_id;

    if not found then
        v_del := true;
        v_pick := true;
    end if;

    if v_fulfill = 'delivery' and v_del is not true then
        raise exception 'entregas desativadas nesta loja'
            using errcode = 'check_violation';
    end if;
    if v_fulfill = 'pickup' and v_pick is not true then
        raise exception 'retirada desativada nesta loja'
            using errcode = 'check_violation';
    end if;

    select coalesce(
        sum(
            coalesce((item->>'quantity')::numeric, 0)
            * coalesce((item->>'unit_price')::numeric, 0)
        ),
        0
    )
    into v_line_subtotal
    from jsonb_array_elements(p_items) as item;

    v_src := coalesce(nullif(trim(p_source), ''), 'ui');
    v_ch  := coalesce(nullif(trim(p_channel), ''), 'admin');

    if v_fulfill = 'pickup' then
        v_fee := 0;
        v_addr := coalesce(nullif(trim(p_delivery_address), ''), 'Retirada no local');
        v_driver := null;
    else
        v_fee := coalesce(p_delivery_fee, 0);
        v_addr := nullif(trim(coalesce(p_delivery_address, '')), '');
        v_driver := p_driver_id;
    end if;

    if p_order_id is null then
        insert into public.orders (
            company_id,
            customer_id,
            status,
            confirmation_status,
            source,
            channel,
            total,
            delivery_fee,
            delivery_address,
            payment_method,
            change_for,
            paid,
            details,
            driver_id,
            fulfillment_type
        ) values (
            p_company_id,
            p_customer_id,
            coalesce(nullif(trim(p_status), ''), 'new'),
            coalesce(nullif(trim(p_confirmation_status), ''), 'confirmed'),
            v_src,
            v_ch,
            v_line_subtotal,
            v_fee,
            v_addr,
            coalesce(nullif(trim(p_payment_method), ''), 'pix'),
            p_change_for,
            coalesce(p_paid, false),
            nullif(trim(p_details), ''),
            v_driver,
            v_fulfill
        )
        returning id into v_order_id;
    else
        v_order_id := p_order_id;
        if not exists (
            select 1
            from public.orders o
            where o.id = v_order_id
              and o.company_id = p_company_id
        ) then
            raise exception 'order not found for company';
        end if;

        update public.orders o
        set
            customer_id           = p_customer_id,
            status                = coalesce(nullif(trim(p_status), ''), o.status),
            confirmation_status   = coalesce(nullif(trim(p_confirmation_status), ''), o.confirmation_status),
            channel               = coalesce(nullif(trim(p_channel), ''), o.channel),
            source                = coalesce(nullif(trim(p_source), ''), o.source),
            total                 = v_line_subtotal,
            delivery_fee          = v_fee,
            delivery_address      = case
                when v_fulfill = 'pickup' then v_addr
                when p_delivery_address is null then o.delivery_address
                else v_addr
            end,
            payment_method        = coalesce(nullif(trim(p_payment_method), ''), o.payment_method),
            change_for            = p_change_for,
            paid                  = coalesce(p_paid, o.paid),
            details               = case
                when p_details is null then o.details
                else nullif(trim(p_details), '')
            end,
            driver_id             = v_driver,
            fulfillment_type      = v_fulfill
        where o.id = v_order_id
          and o.company_id = p_company_id;

        delete from public.order_items oi
        where oi.order_id = v_order_id
          and oi.company_id = p_company_id;
    end if;

    insert into public.order_items (
        order_id,
        company_id,
        product_name,
        produto_embalagem_id,
        quantity,
        qty,
        unit_price,
        unit_type
    )
    select
        v_order_id,
        p_company_id,
        coalesce(item->>'product_name', ''),
        case
            when nullif(trim(coalesce(item->>'produto_embalagem_id', '')), '') is null then null
            else (nullif(trim(item->>'produto_embalagem_id'), ''))::uuid
        end,
        greatest(1, coalesce((item->>'quantity')::integer, 1)),
        greatest(1::numeric, coalesce((item->>'quantity')::numeric, 1)),
        coalesce((item->>'unit_price')::numeric, 0),
        coalesce(nullif(trim(item->>'unit_type'), ''), 'unit')
    from jsonb_array_elements(p_items) as item;

    return v_order_id;
end;
$$;

revoke all on function public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb, text, text
) from public;

revoke all on function public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb, text, text
) from anon, authenticated;

grant execute on function public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb, text, text
) to service_role;

comment on function public.rpc_admin_upsert_order_with_items(
    uuid, uuid, uuid, text, text, text, text, boolean, numeric, numeric, text, uuid, text, jsonb, text, text
) is 'Admin: cria/atualiza pedido+itens com fulfillment_type e delivery_address.';

-- ─── 2. PDV balcão = pickup (BEFORE INSERT)

create or replace function public.fn_orders_pdv_balcao_pickup()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.source = 'pdv_direct' and coalesce(new.channel, '') = 'balcao' then
        new.fulfillment_type := 'pickup';
        new.delivery_fee := 0;
        if new.delivery_address is null or btrim(new.delivery_address) = '' then
            new.delivery_address := 'Retirada no local';
        end if;
        new.driver_id := null;
        new.delivery_endereco_cliente_id := null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_orders_pdv_balcao_pickup on public.orders;
create trigger trg_orders_pdv_balcao_pickup
    before insert on public.orders
    for each row
    execute function public.fn_orders_pdv_balcao_pickup();

revoke all on function public.fn_orders_pdv_balcao_pickup() from public;
grant execute on function public.fn_orders_pdv_balcao_pickup() to service_role;

-- Backfill vendas balcão já gravadas como delivery
update public.orders
set
    fulfillment_type = 'pickup',
    delivery_fee = 0,
    delivery_address = coalesce(nullif(btrim(delivery_address), ''), 'Retirada no local'),
    driver_id = null,
    delivery_endereco_cliente_id = null
where source = 'pdv_direct'
  and coalesce(channel, '') = 'balcao'
  and fulfillment_type = 'delivery';

-- ─── 3. Policy view + upsert com flags de fulfillment

drop view if exists public.v_company_delivery_policy;

create view public.v_company_delivery_policy as
select
  c.id as company_id,
  c.nome_fantasia,
  c.cidade as company_city,
  c.uf as company_state,
  c.delivery_fee_enabled,
  c.default_delivery_fee,
  c.settings,
  p.service_city,
  p.service_state,
  p.service_by_zone,
  p.default_mode,
  coalesce(p.deliveries_enabled, true) as deliveries_enabled,
  coalesce(p.pickup_enabled, true) as pickup_enabled,
  p.updated_at as policy_updated_at
from public.companies c
left join public.company_delivery_policy p
  on p.company_id = c.id;

grant select on public.v_company_delivery_policy to authenticated, service_role;

drop function if exists public.upsert_company_delivery_policy(
  uuid, text, text, boolean, text
);
drop function if exists public.upsert_company_delivery_policy(
  uuid, text, text, boolean, text, boolean, boolean
);

create or replace function public.upsert_company_delivery_policy(
  p_company_id uuid,
  p_service_city text,
  p_service_state text,
  p_service_by_zone boolean,
  p_default_mode text,
  p_deliveries_enabled boolean default true,
  p_pickup_enabled boolean default true
)
returns public.company_delivery_policy
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_row public.company_delivery_policy;
begin
  v_mode := case
    when p_default_mode in ('all_city','allow_list','deny_list') then p_default_mode
    else 'all_city'
  end;

  insert into public.company_delivery_policy (
    company_id, service_city, service_state, service_by_zone, default_mode,
    deliveries_enabled, pickup_enabled, updated_at
  )
  values (
    p_company_id, nullif(trim(coalesce(p_service_city,'')), ''),
    nullif(trim(upper(coalesce(p_service_state,''))), ''),
    coalesce(p_service_by_zone, false),
    v_mode,
    coalesce(p_deliveries_enabled, true),
    coalesce(p_pickup_enabled, true),
    now()
  )
  on conflict (company_id)
  do update set
    service_city = excluded.service_city,
    service_state = excluded.service_state,
    service_by_zone = excluded.service_by_zone,
    default_mode = excluded.default_mode,
    deliveries_enabled = excluded.deliveries_enabled,
    pickup_enabled = excluded.pickup_enabled,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_company_delivery_policy(
  uuid, text, text, boolean, text, boolean, boolean
) from public;

revoke all on function public.upsert_company_delivery_policy(
  uuid, text, text, boolean, text, boolean, boolean
) from anon, authenticated;

grant execute on function public.upsert_company_delivery_policy(
  uuid, text, text, boolean, text, boolean, boolean
) to service_role;
