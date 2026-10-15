-- ADR 0015: cardápio, pedido, PDV e mesa usam o preço efetivo.

create or replace function public.create_order_with_items(
    p_company_id                    uuid,
    p_customer_id                   uuid,
    p_status                        text,
    p_confirmation_status           text,
    p_source                        text,
    p_channel                       text,
    p_total_amount                  numeric,
    p_delivery_fee                  numeric,
    p_delivery_address              text,
    p_delivery_endereco_cliente_id  uuid,
    p_payment_method                text,
    p_change_for                    numeric,
    p_paid                          boolean,
    p_items                         jsonb,
    p_total                         numeric default null,
    p_idempotency_key               text default null,
    p_fulfillment_type              text default 'delivery',
    p_order_notes                   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id uuid;
    v_total    numeric;
    v_fulfill  text;
    v_fee      numeric;
    v_addr     text;
    v_addr_id  uuid;
    v_del      boolean;
    v_pick     boolean;
    v_notes    text;
    v_lines    jsonb;
begin
    v_fulfill := lower(coalesce(nullif(trim(p_fulfillment_type), ''), 'delivery'));
    if v_fulfill not in ('delivery', 'pickup') then
        raise exception 'fulfillment_type inválido'
            using errcode = 'check_violation';
    end if;

    v_notes := nullif(left(btrim(coalesce(p_order_notes, '')), 500), '');

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

    if p_idempotency_key is not null then
        select id into v_order_id
        from public.orders
        where company_id = p_company_id
          and idempotency_key = p_idempotency_key
        limit 1;

        if v_order_id is not null then
            return v_order_id;
        end if;
    end if;

    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'pedido não pode ser criado sem itens'
            using errcode = 'check_violation';
    end if;

    if v_fulfill = 'pickup' then
        v_fee := 0;
        v_addr := coalesce(nullif(trim(p_delivery_address), ''), 'Retirada no local');
        v_addr_id := null;
        v_total := coalesce(p_total, p_total_amount);
    else
        v_fee := coalesce(p_delivery_fee, 0);
        v_addr := p_delivery_address;
        v_addr_id := p_delivery_endereco_cliente_id;
        v_total := coalesce(p_total, p_total_amount - v_fee);
    end if;

    if coalesce(p_source, '') not ilike 'marketplace%' then
        v_lines := public.fn_expand_sale_lines(p_company_id, p_items, false);
        select coalesce(sum((ln ->> 'quantity')::numeric * (ln ->> 'unit_price')::numeric), 0)
          into v_total
          from jsonb_array_elements(v_lines) ln;
    end if;

    insert into public.orders (
        company_id, customer_id, status, confirmation_status,
        source, channel, total, delivery_fee, delivery_address,
        delivery_endereco_cliente_id, payment_method, change_for, paid,
        idempotency_key, fulfillment_type, notes
    ) values (
        p_company_id, p_customer_id, p_status, p_confirmation_status,
        p_source, p_channel, v_total, v_fee, v_addr,
        v_addr_id, p_payment_method, p_change_for, p_paid,
        p_idempotency_key, v_fulfill, v_notes
    )
    returning id into v_order_id;

    if coalesce(p_source, '') ilike 'marketplace%' then
        insert into public.order_items (
            order_id, company_id, product_name, produto_embalagem_id,
            quantity, qty, unit_price
        )
        select
            v_order_id,
            p_company_id,
            (item->>'product_name')::text,
            (item->>'produto_embalagem_id')::uuid,
            (item->>'quantity')::integer,
            (item->>'quantity')::numeric,
            (item->>'unit_price')::numeric
        from jsonb_array_elements(p_items) as item;
    else
        insert into public.order_items (
            order_id, company_id, product_name, produto_embalagem_id,
            quantity, qty, unit_price, combo_id, promocao_id, combo_label
        )
        select
            v_order_id,
            p_company_id,
            ln ->> 'product_name',
            nullif(ln ->> 'produto_embalagem_id', '')::uuid,
            (ln ->> 'quantity')::integer,
            (ln ->> 'quantity')::numeric,
            (ln ->> 'unit_price')::numeric,
            nullif(ln ->> 'combo_id', '')::uuid,
            nullif(ln ->> 'promocao_id', '')::uuid,
            nullif(ln ->> 'combo_label', '')
        from jsonb_array_elements(v_lines) ln;
    end if;

    return v_order_id;
exception
    when unique_violation then
        if p_idempotency_key is not null then
            select id into v_order_id
            from public.orders
            where company_id = p_company_id
              and idempotency_key = p_idempotency_key
            limit 1;
            if v_order_id is not null then
                return v_order_id;
            end if;
        end if;
        raise;
end;
$$;

revoke all on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) from public;

revoke all on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) from anon, authenticated;

grant execute on function public.create_order_with_items(
    uuid, uuid, text, text, text, text, numeric, numeric, text, uuid, text, numeric, boolean, jsonb, numeric, text, text, text
) to service_role;


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
    v_items         jsonb;
begin
    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'pedido não pode ser salvo sem itens'
            using errcode = 'check_violation';
    end if;

    if p_customer_id is null then
        raise exception 'customer_id_required'
            using errcode = 'check_violation';
    end if;

    if not exists (
        select 1
        from public.customers c
        where c.id = p_customer_id
          and c.company_id = p_company_id
    ) then
        raise exception 'customer_not_in_company'
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

    v_items := p_items;
    if coalesce(p_source, '') not ilike 'marketplace%' then
        v_items := public.fn_expand_sale_lines(p_company_id, p_items, true);
    end if;

    -- Cross-tenant embalagem → stock debit on victim (IDOR)
    if exists (
        select 1
        from jsonb_array_elements(v_items) as item
        where nullif(trim(coalesce(item->>'produto_embalagem_id', '')), '') is not null
          and not exists (
              select 1
              from public.produto_embalagens pe
              where pe.id = (nullif(trim(item->>'produto_embalagem_id'), ''))::uuid
                and pe.company_id = p_company_id
          )
    ) then
        raise exception 'produto_embalagem_not_in_company'
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
    from jsonb_array_elements(v_items) as item;

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

    if v_driver is not null and not exists (
        select 1
        from public.drivers d
        where d.id = v_driver
          and d.company_id = p_company_id
    ) then
        raise exception 'driver_not_in_company'
            using errcode = 'check_violation';
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
        unit_type,
        combo_id,
        promocao_id,
        combo_label
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
        coalesce(nullif(trim(item->>'unit_type'), ''), 'unit'),
        nullif(trim(coalesce(item->>'combo_id', '')), '')::uuid,
        nullif(trim(coalesce(item->>'promocao_id', '')), '')::uuid,
        nullif(trim(coalesce(item->>'combo_label', '')), '')
    from jsonb_array_elements(v_items) as item;

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
) is 'Admin upsert pedido+itens; rejeita customer/embalagem/driver de outra company (IDOR).';


create or replace function public.rpc_finalize_pdv_order(p_company_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_idem_key       text := nullif(trim(coalesce(p_payload ->> 'idempotency_key', '')), '');
    v_existing_sale  uuid;
    v_existing_order uuid;
    v_cash_id        uuid;
    v_cart           jsonb := p_payload -> 'cart';
    v_payments       jsonb := p_payload -> 'payments';
    v_cart_total     numeric := 0;
    v_pay_total      numeric := 0;
    v_line           jsonb;
    v_pay            jsonb;
    v_has_credit     boolean := false;
    v_customer_id    uuid;
    v_seller_name    text;
    v_active_oid     uuid;
    v_active_src     text;
    v_order_source_hint text;
    v_channel_hint   text;
    v_primary_method text := 'pix';
    v_primary_val    numeric := 0;
    v_is_paid        boolean;
    v_sale_origin    text;
    v_sale_id        uuid;
    v_oid            uuid;
    v_display_name   text;
    v_m              text;
    v_now            timestamptz := now();
    v_auto_print     boolean := coalesce((p_payload ->> 'auto_print')::boolean, false);
begin
    if v_idem_key is not null then
        select id into v_existing_sale
        from public.sales
        where company_id = p_company_id and idempotency_key = v_idem_key
        limit 1;

        if v_existing_sale is not null then
            select id into v_existing_order
            from public.orders
            where sale_id = v_existing_sale and company_id = p_company_id
            limit 1;
            return jsonb_build_object('ok', true, 'sale_id', v_existing_sale, 'order_id', v_existing_order);
        end if;
    end if;

    v_cash_id := nullif(trim(coalesce(p_payload ->> 'cash_register_id', '')), '')::uuid;
    if v_cash_id is null then
        raise exception 'cash_register_required' using errcode = '23502';
    end if;

    if v_cart is null or jsonb_array_length(v_cart) = 0 then
        raise exception 'cart_empty' using errcode = '23502';
    end if;

    if coalesce(p_payload ->> 'order_source', '') is distinct from 'table_service' then
        v_cart := (
            select coalesce(jsonb_agg(jsonb_build_object(
                'variant_id', x ->> 'produto_embalagem_id',
                'produto_id', x ->> 'produto_id',
                'product_name', x ->> 'product_name',
                'qty', x ->> 'quantity',
                'unit_price', x ->> 'unit_price',
                'sigla_comercial', x ->> 'sigla_comercial',
                'combo_id', x ->> 'combo_id',
                'promocao_id', x ->> 'promocao_id',
                'combo_label', x ->> 'combo_label'
            )), '[]'::jsonb)
              from jsonb_array_elements(public.fn_expand_sale_lines(p_company_id, v_cart, false)) x
        );
    end if;

    if v_payments is null or jsonb_array_length(v_payments) = 0 then
        raise exception 'payments_required' using errcode = '23502';
    end if;

    for v_line in select * from jsonb_array_elements(v_cart)
    loop
        v_cart_total := v_cart_total
            + coalesce((v_line ->> 'unit_price')::numeric, 0) * coalesce((v_line ->> 'qty')::numeric, 0);
    end loop;

    for v_pay in select * from jsonb_array_elements(v_payments)
    loop
        v_pay_total := v_pay_total + coalesce((v_pay ->> 'value')::numeric, 0);
        v_m := lower(trim(coalesce(v_pay ->> 'method', '')));
        if v_m = any (array['credit', 'boleto', 'cheque', 'promissoria']) then
            v_has_credit := true;
        end if;
    end loop;

    if v_pay_total < v_cart_total then
        raise exception 'payments_insufficient' using errcode = '23514';
    end if;

    v_customer_id := nullif(trim(coalesce(p_payload ->> 'customer_id', '')), '')::uuid;
    if v_has_credit and v_customer_id is null then
        raise exception 'customer_required_for_prazo' using errcode = '23502';
    end if;

    if not exists (
        select 1 from public.cash_registers cr
        where cr.id = v_cash_id and cr.company_id = p_company_id and cr.status = 'open'
    ) then
        raise exception 'cash_register_invalid' using errcode = 'P0002';
    end if;

    v_seller_name := nullif(trim(coalesce(p_payload ->> 'seller_name', '')), '');
    v_active_oid := nullif(trim(coalesce(p_payload ->> 'active_order_id', '')), '')::uuid;
    v_active_src := nullif(trim(coalesce(p_payload ->> 'active_order_source', '')), '');
    v_order_source_hint := nullif(trim(coalesce(p_payload ->> 'order_source', '')), '');
    v_channel_hint := nullif(trim(coalesce(p_payload ->> 'channel', '')), '');

    for v_pay in select * from jsonb_array_elements(v_payments)
    loop
        if coalesce((v_pay ->> 'value')::numeric, 0) >= v_primary_val then
            v_primary_val := coalesce((v_pay ->> 'value')::numeric, 0);
            v_primary_method := trim(coalesce(v_pay ->> 'method', 'pix'));
        end if;
    end loop;

    v_is_paid := not v_has_credit;

    if v_order_source_hint is not null then
        v_sale_origin := public.fn_fin_map_origin(v_order_source_hint);
    elsif v_active_src is not null then
        v_sale_origin := public.fn_fin_map_origin(v_active_src);
    else
        v_sale_origin := 'pdv';
    end if;

    insert into public.sales (
        company_id, cash_register_id, customer_id, seller_name, origin,
        subtotal, total, status, notes, order_id, idempotency_key
    )
    values (
        p_company_id,
        v_cash_id,
        v_customer_id,
        v_seller_name,
        v_sale_origin,
        v_cart_total,
        v_cart_total,
        case when v_is_paid then 'paid'::text else 'partial'::text end,
        case when v_seller_name is not null then 'Balcão — ' || v_seller_name else 'Balcão' end,
        v_active_oid,
        v_idem_key
    )
    returning id into v_sale_id;

    insert into public.sale_items (
        sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
    )
    select
        v_sale_id,
        p_company_id,
        nullif(trim(elem ->> 'variant_id'), '')::uuid,
        trim(coalesce(elem ->> 'product_name', ''))
            || case when nullif(trim(coalesce(elem ->> 'details', '')), '') is not null
                then ' ' || trim(elem ->> 'details') else '' end,
        coalesce((elem ->> 'qty')::numeric, 0),
        coalesce((elem ->> 'unit_price')::numeric, 0),
        coalesce(
          public.fn_fin_snapshot_pack_cost(nullif(trim(elem ->> 'variant_id'), '')::uuid),
          0
        )
    from jsonb_array_elements(v_cart) as t(elem);

    insert into public.sale_payments (
        sale_id, company_id, payment_method, amount, due_date, received_at
    )
    select
        v_sale_id,
        p_company_id,
        case when lower(trim(coalesce(pay_elem ->> 'method', ''))) = 'credit'
            then 'credit_installment' else lower(trim(coalesce(pay_elem ->> 'method', 'pix'))) end,
        coalesce((pay_elem ->> 'value')::numeric, 0),
        case when nullif(trim(coalesce(pay_elem ->> 'due_date', '')), '') is not null
            then (trim(pay_elem ->> 'due_date'))::date else null end,
        case when lower(trim(coalesce(pay_elem ->> 'method', ''))) = any (
                array['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            then null else v_now end
    from jsonb_array_elements(v_payments) as p(pay_elem);

    if v_active_oid is not null then
        update public.orders o
        set
            sale_id               = v_sale_id,
            status                = 'finalized',
            confirmation_status   = 'confirmed',
            confirmed_at          = v_now,
            printed_at            = case when v_auto_print then v_now else o.printed_at end
        where o.id = v_active_oid and o.company_id = p_company_id;

        if not found then
            raise exception 'active_order_not_found' using errcode = 'P0002';
        end if;

        v_oid := v_active_oid;
    else
        v_display_name := nullif(trim(coalesce(p_payload ->> 'customer_name', '')), '');
        if v_display_name is null then
            v_display_name := case
                when v_seller_name is not null then '[Balcão] ' || v_seller_name
                else 'Balcão'
            end;
        end if;

        insert into public.orders (
            company_id, sale_id, source, customer_id, customer_name,
            total, total_amount, delivery_fee, payment_method, status, channel, paid,
            confirmation_status, confirmed_at
        )
        values (
            p_company_id,
            v_sale_id,
            coalesce(v_order_source_hint, 'pdv_direct'),
            v_customer_id,
            v_display_name,
            v_cart_total,
            v_cart_total,
            0,
            coalesce(nullif(trim(v_primary_method), ''), 'pix'),
            'finalized',
            coalesce(v_channel_hint, 'balcao'),
            v_is_paid,
            'confirmed',
            v_now
        )
        returning id into v_oid;

        insert into public.order_items (
            company_id, order_id, product_id, produto_embalagem_id, product_name,
            quantity, qty, unit_type, unit_price, combo_id, promocao_id, combo_label
        )
        select
            p_company_id,
            v_oid,
            nullif(trim(elem ->> 'produto_id'), '')::uuid,
            nullif(trim(elem ->> 'variant_id'), '')::uuid,
            trim(coalesce(elem ->> 'product_name', ''))
                || case when nullif(trim(coalesce(elem ->> 'details', '')), '') is not null
                    then ' ' || trim(elem ->> 'details') else '' end,
            coalesce((elem ->> 'qty')::integer, 1),
            coalesce((elem ->> 'qty')::numeric, 0),
            case when upper(trim(coalesce(elem ->> 'sigla_comercial', ''))) = 'CX'
                then 'case'::text else 'unit'::text end,
            coalesce((elem ->> 'unit_price')::numeric, 0),
            nullif(trim(coalesce(elem ->> 'combo_id', '')), '')::uuid,
            nullif(trim(coalesce(elem ->> 'promocao_id', '')), '')::uuid,
            nullif(trim(coalesce(elem ->> 'combo_label', '')), '')
        from jsonb_array_elements(v_cart) as t2(elem);
    end if;

    perform public.fn_fin_post_sale_payments(
        p_company_id, v_sale_id, v_oid, v_sale_origin, v_cash_id
    );

    return jsonb_build_object('ok', true, 'sale_id', v_sale_id, 'order_id', v_oid);
exception
    when unique_violation then
        if v_idem_key is not null then
            select id into v_existing_sale
            from public.sales
            where company_id = p_company_id and idempotency_key = v_idem_key
            limit 1;
            if v_existing_sale is not null then
                select id into v_existing_order
                from public.orders
                where sale_id = v_existing_sale and company_id = p_company_id
                limit 1;
                return jsonb_build_object('ok', true, 'sale_id', v_existing_sale, 'order_id', v_existing_order);
            end if;
        end if;
        raise;
end;
$$;

revoke all on function public.rpc_finalize_pdv_order(uuid, jsonb) from public;
grant execute on function public.rpc_finalize_pdv_order(uuid, jsonb) to service_role;

create or replace function public.rpc_mesa_add_item(
    p_company_id uuid,
    p_session_id uuid,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_session public.table_sessions%ROWTYPE;
    v_qty numeric := coalesce((p_payload ->> 'qty')::numeric, (p_payload ->> 'quantity')::numeric, 1);
    v_lines jsonb;
    v_line jsonb;
    v_first jsonb;
begin
    select * into v_session
      from public.table_sessions
     where id = p_session_id and company_id = p_company_id
     for update;
    if not found then
        raise exception 'session_not_found' using errcode = 'P0002';
    end if;
    if v_session.status <> 'open' then
        raise exception 'session_not_open' using errcode = '23514';
    end if;

    v_lines := public.fn_expand_sale_lines(
        p_company_id,
        jsonb_build_array(jsonb_build_object(
            'produto_embalagem_id', p_payload ->> 'produto_embalagem_id',
            'combo_id', p_payload ->> 'combo_id',
            'quantity', greatest(1, trunc(v_qty)::integer)
        )),
        false
    );

    for v_line in select value from jsonb_array_elements(v_lines)
    loop
        insert into public.table_session_items (
            company_id, session_id, produto_embalagem_id, product_id, product_name,
            qty, unit_price, sigla_comercial, combo_id, promocao_id, combo_label
        ) values (
            p_company_id,
            p_session_id,
            nullif(v_line ->> 'produto_embalagem_id', '')::uuid,
            nullif(v_line ->> 'produto_id', '')::uuid,
            v_line ->> 'product_name',
            (v_line ->> 'quantity')::numeric,
            (v_line ->> 'unit_price')::numeric,
            v_line ->> 'sigla_comercial',
            nullif(v_line ->> 'combo_id', '')::uuid,
            nullif(v_line ->> 'promocao_id', '')::uuid,
            nullif(v_line ->> 'combo_label', '')
        );
        v_first := coalesce(v_first, v_line);
    end loop;

    return jsonb_build_object('ok', true, 'item', v_first, 'lines', v_lines);
end;
$$;

revoke all on function public.rpc_mesa_add_item(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_mesa_add_item(uuid, uuid, jsonb) to service_role;


CREATE OR REPLACE FUNCTION public.rpc_get_public_menu(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slug   text := lower(trim(COALESCE(p_slug, '')));
    v_prof   public.company_menu_profile%ROWTYPE;
    v_city   text;
    v_uf     text;
    v_items  jsonb;
    v_combos jsonb;
BEGIN
    IF v_slug = '' OR char_length(v_slug) < 2 THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
        'combo_id', c.id,
        'name', c.nome,
        'description', c.descricao,
        'price', public.fn_preco_efetivo_combo(c.id, now()),
        'list_price', c.preco,
        'image_url', c.image_path,
        'in_stock', coalesce(public.fn_combo_disponivel(c.id), 1) > 0,
        'promo_ends_at', (
            select pr.ends_at
              from public.promocao_alvos pa
              join public.promocoes pr on pr.id = pa.promocao_id
             where pa.combo_id = c.id
               and pr.paused = false
               and pr.starts_at <= now()
               and pr.ends_at > now()
             limit 1
        )
    ) order by c.nome), '[]'::jsonb)
      INTO v_combos
      FROM public.combos c
     WHERE c.company_id = v_prof.company_id
       AND c.is_active
       AND c.show_on_menu
       AND c.preco is not null;

    RETURN jsonb_build_object('error', 'menu_not_found');
    END IF;

    SELECT * INTO v_prof
    FROM public.company_menu_profile
    WHERE lower(slug) = v_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'menu_not_found');
    END IF;

    IF NOT v_prof.is_active THEN
        RETURN jsonb_build_object('error', 'menu_inactive');
    END IF;

    SELECT c.cidade, c.uf INTO v_city, v_uf
    FROM public.companies c
    WHERE c.id = v_prof.company_id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'embalagem_id',     x.embalagem_id,
                'product_id',       x.product_id,
                'category_id',      x.category_id,
                'category_name',    x.category_name,
                'name',             x.name,
                'description',      x.description,
                'price',            x.price,
                'list_price',       x.list_price,
                'promo_ends_at',    x.promo_ends_at,
                'sigla',            x.sigla,
                'fator_conversao',  x.fator_conversao,
                'thumbnail_url',    x.thumbnail_url,
                'image_url',        x.image_url,
                'in_stock',         x.in_stock,
                'category_sort',    x.category_sort
            )
            ORDER BY x.category_sort, x.category_name NULLS LAST, x.name_base, x.sigla_sort, x.name
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM (
        SELECT
            pe.id                                              AS embalagem_id,
            p.id                                               AS product_id,
            p.category_id                                      AS category_id,
            cat.name                                           AS category_name,
            COALESCE(NULLIF(trim(p.name), ''), 'Produto')      AS name_base,
            CASE
              WHEN NULLIF(trim(COALESCE(pe.descricao, '')), '') IS NOT NULL THEN
                CASE
                  WHEN upper(trim(pe.descricao)) = upper(trim(p.name))
                    OR upper(trim(pe.descricao)) LIKE upper(trim(p.name)) || ' %'
                  THEN trim(pe.descricao)
                  ELSE trim(p.name) || ' ' || trim(pe.descricao)
                END
              ELSE
                COALESCE(NULLIF(trim(p.name), ''), 'Produto')
                || CASE
                     WHEN pe.volume_quantidade > 0 AND ut.sigla IS NOT NULL
                       THEN ' ' || pe.volume_quantidade::text || ut.sigla
                     ELSE ''
                   END
            END                                                AS name,
            NULLIF(trim(COALESCE(pe.detalhes, '')), '')        AS description,
            public.fn_preco_efetivo_embalagem(pe.id, now())     AS price,
            pe.preco_venda                                     AS list_price,
            (
                select pr.ends_at
                  from public.promocao_alvos pa
                  join public.promocoes pr on pr.id = pa.promocao_id
                 where pa.produto_embalagem_id = pe.id
                   and pr.paused = false
                   and pr.starts_at <= now()
                   and pr.ends_at > now()
                 limit 1
            )                                                  AS promo_ends_at,
            COALESCE(sc.sigla, 'UN')                           AS sigla,
            COALESCE(pe.fator_conversao, 1)                    AS fator_conversao,
            CASE upper(COALESCE(sc.sigla, 'UN'))
                WHEN 'UN' THEN 0 WHEN 'UND' THEN 0 WHEN 'UNID' THEN 0
                WHEN 'CX' THEN 1 WHEN 'FARD' THEN 2 WHEN 'PAC' THEN 3
                ELSE 9
            END                                                AS sigla_sort,
            COALESCE(pie.thumbnail_url, piv.thumbnail_url, pip.thumbnail_url) AS thumbnail_url,
            COALESCE(pie.url, piv.url, pip.url)                AS image_url,
            COALESCE(
              pv.estoque_atual,
              (
                SELECT pv2.estoque_atual
                FROM public.product_volumes pv2
                WHERE pv2.product_id = p.id
                ORDER BY pv2.volume_quantidade NULLS LAST
                LIMIT 1
              ),
              0
            ) > 0                                              AS in_stock,
            CASE WHEN cat.name IS NULL THEN 999 ELSE 0 END     AS category_sort
        FROM public.products p
        INNER JOIN public.produto_embalagens pe ON pe.produto_id = p.id
        LEFT JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
        LEFT JOIN public.unit_types ut ON ut.id = pe.id_unit_type
        LEFT JOIN public.categories cat ON cat.id = p.category_id
        LEFT JOIN public.product_volumes pv ON pv.id = pe.product_volume_id
        LEFT JOIN LATERAL (
            SELECT pi.url, pi.thumbnail_url
            FROM public.product_images pi
            WHERE pi.produto_embalagem_id = pe.id
              AND pi.is_primary = true
            ORDER BY pi.created_at DESC
            LIMIT 1
        ) pie ON true
        LEFT JOIN LATERAL (
            SELECT pi.url, pi.thumbnail_url
            FROM public.product_images pi
            WHERE pi.product_id = p.id
              AND pi.produto_embalagem_id IS NULL
              AND pi.product_volume_id IS NOT DISTINCT FROM pe.product_volume_id
              AND pi.is_primary = true
            ORDER BY pi.created_at DESC
            LIMIT 1
        ) piv ON true
        LEFT JOIN LATERAL (
            SELECT pi.url, pi.thumbnail_url
            FROM public.product_images pi
            WHERE pi.product_id = p.id
              AND pi.produto_embalagem_id IS NULL
              AND pi.product_volume_id IS NULL
              AND pi.is_primary = true
            ORDER BY pi.created_at DESC
            LIMIT 1
        ) pip ON true
        WHERE p.company_id = v_prof.company_id
          AND COALESCE(p.is_active, true) = true
          AND COALESCE(pe.is_active, true) = true
          AND COALESCE(p.show_on_menu, true) = true
          AND pe.preco_venda IS NOT NULL
          AND pe.preco_venda > 0
          AND (
            COALESCE(p.vender_com_estoque_zero, true) = true
            OR COALESCE(
              pv.estoque_atual,
              (
                SELECT pv2.estoque_atual
                FROM public.product_volumes pv2
                WHERE pv2.product_id = p.id
                ORDER BY pv2.volume_quantidade NULLS LAST
                LIMIT 1
              ),
              0
            ) > 0
          )
    ) x;

    RETURN jsonb_build_object(
        'store', jsonb_build_object(
            'company_id',     v_prof.company_id,
            'slug',           v_prof.slug,
            'display_name',   v_prof.display_name,
            'tagline',        v_prof.tagline,
            'logo_url',       v_prof.logo_url,
            'cover_url',      v_prof.cover_url,
            'whatsapp_phone', v_prof.whatsapp_phone,
            'city',           v_city,
            'state',          v_uf,
            'is_active',      v_prof.is_active
        ),
        'items', v_items,
        'combos', v_combos
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_public_menu(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_public_menu(text) TO service_role;

COMMENT ON FUNCTION public.rpc_get_public_menu(text) IS
  'Cardápio público: name sem sigla/fator; badge via sigla + fator_conversao (ex. UN:1).';

