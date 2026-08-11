-- Idempotência real no finalize do PDV: retry/double-click no botão "Finalizar"
-- não duplica venda/pedido/lançamento financeiro (checklist item 9,
-- docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md).

alter table public.sales
    add column if not exists idempotency_key text;

create unique index if not exists sales_idempotency_key_unique
    on public.sales (company_id, idempotency_key)
    where idempotency_key is not null;

create or replace function public.rpc_finalize_pdv_order(
    p_company_id uuid,
    p_payload jsonb
)
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
    v_primary_method text := 'pix';
    v_primary_val    numeric := 0;
    v_is_paid        boolean;
    v_sale_origin    text;
    v_fin_origin     text;
    v_sale_id        uuid;
    v_oid            uuid;
    v_display_name   text;
    v_m              text;
    v_now            timestamptz := now();
    v_auto_print     boolean := coalesce((p_payload ->> 'auto_print')::boolean, false);
begin
    -- Idempotência: já existe venda com essa chave nesta empresa? Devolve o
    -- mesmo resultado, não processa de novo (nem sale/order/financial_entries).
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

    for v_pay in select * from jsonb_array_elements(v_payments)
    loop
        if coalesce((v_pay ->> 'value')::numeric, 0) >= v_primary_val then
            v_primary_val := coalesce((v_pay ->> 'value')::numeric, 0);
            v_primary_method := trim(coalesce(v_pay ->> 'method', 'pix'));
        end if;
    end loop;

    v_is_paid := not v_has_credit;

    if v_active_src is null or v_active_src = 'pdv_direct' then
        v_sale_origin := 'pdv';
    elsif v_active_src = 'chatbot' or v_active_src ~ '^flow_' then
        v_sale_origin := 'chatbot';
    elsif v_active_src = 'ui' then
        v_sale_origin := 'ui_order';
    else
        v_sale_origin := 'pdv';
    end if;

    if v_sale_origin = 'chatbot' then
        v_fin_origin := 'chatbot';
    elsif v_sale_origin = 'ui_order' then
        v_fin_origin := 'ui_order';
    else
        v_fin_origin := 'balcao';
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
        nullif(trim(v_line ->> 'variant_id'), '')::uuid,
        trim(coalesce(v_line ->> 'product_name', ''))
            || case when nullif(trim(coalesce(v_line ->> 'details', '')), '') is not null
                then ' ' || trim(v_line ->> 'details') else '' end,
        coalesce((v_line ->> 'qty')::numeric, 0),
        coalesce((v_line ->> 'unit_price')::numeric, 0),
        0
    from jsonb_array_elements(v_cart) as t(v_line);

    insert into public.sale_payments (
        sale_id, company_id, payment_method, amount, due_date, received_at
    )
    select
        v_sale_id,
        p_company_id,
        case when lower(trim(coalesce(v_pay ->> 'method', ''))) = 'credit'
            then 'credit_installment' else lower(trim(coalesce(v_pay ->> 'method', 'pix'))) end,
        coalesce((v_pay ->> 'value')::numeric, 0),
        case when nullif(trim(coalesce(v_pay ->> 'due_date', '')), '') is not null
            then (trim(v_pay ->> 'due_date'))::date else null end,
        case when lower(trim(coalesce(v_pay ->> 'method', ''))) = any (
                array['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            then null else v_now end
    from jsonb_array_elements(v_payments) as p(v_pay);

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
            total, total_amount, delivery_fee, payment_method, status, channel, paid, confirmed_at
        )
        values (
            p_company_id,
            v_sale_id,
            'pdv_direct',
            v_customer_id,
            v_display_name,
            v_cart_total,
            v_cart_total,
            0,
            coalesce(nullif(trim(v_primary_method), ''), 'pix'),
            'finalized',
            'balcao',
            v_is_paid,
            v_now
        )
        returning id into v_oid;

        insert into public.order_items (
            company_id, order_id, product_id, produto_embalagem_id, product_name,
            quantity, qty, unit_type, unit_price
        )
        select
            p_company_id,
            v_oid,
            nullif(trim(v_line ->> 'produto_id'), '')::uuid,
            nullif(trim(v_line ->> 'variant_id'), '')::uuid,
            trim(coalesce(v_line ->> 'product_name', ''))
                || case when nullif(trim(coalesce(v_line ->> 'details', '')), '') is not null
                    then ' ' || trim(v_line ->> 'details') else '' end,
            coalesce((v_line ->> 'qty')::integer, 1),
            coalesce((v_line ->> 'qty')::numeric, 0),
            case when upper(trim(coalesce(v_line ->> 'sigla_comercial', ''))) = 'CX'
                then 'case'::text else 'unit'::text end,
            coalesce((v_line ->> 'unit_price')::numeric, 0)
        from jsonb_array_elements(v_cart) as t2(v_line);
    end if;

    insert into public.financial_entries (
        company_id, order_id, sale_id, type, amount, delivery_fee,
        payment_method, origin, description, occurred_at, status, due_date, received_at
    )
    select
        p_company_id,
        v_oid,
        v_sale_id,
        'income',
        coalesce((v_pay ->> 'value')::numeric, 0),
        0,
        case when lower(trim(coalesce(v_pay ->> 'method', ''))) = 'credit'
            then 'credit_installment' else lower(trim(coalesce(v_pay ->> 'method', 'pix'))) end,
        v_fin_origin,
        'Venda PDV' || case when v_seller_name is not null then ' — ' || v_seller_name else '' end,
        v_now,
        case when lower(trim(coalesce(v_pay ->> 'method', ''))) = any (
                array['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            then 'pending'::text else 'received'::text end,
        case when nullif(trim(coalesce(v_pay ->> 'due_date', '')), '') is not null
            then (trim(v_pay ->> 'due_date'))::date else null end,
        case when lower(trim(coalesce(v_pay ->> 'method', ''))) = any (
                array['credit', 'boleto', 'cheque', 'promissoria']::text[]
            )
            then null else v_now end
    from jsonb_array_elements(v_payments) as p2(v_pay);

    return jsonb_build_object('ok', true, 'sale_id', v_sale_id, 'order_id', v_oid);
exception
    -- Corrida rara: 2 chamadas concorrentes com a mesma chave. O unique index
    -- em sales resolve a corrida — quem perder cai aqui e devolve o resultado
    -- do vencedor em vez de propagar erro pro cliente.
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

create or replace function public.rpc_finalize_sale(
    p_company_id uuid,
    p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
    select public.rpc_finalize_pdv_order(p_company_id, p_payload);
$$;
