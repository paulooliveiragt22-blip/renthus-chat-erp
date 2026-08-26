-- CMV snapshot: custo da embalagem (produto_embalagens.preco_custo), não products.preco_custo_unitario * fator.
-- Cadastro atual guarda o custo na embalagem (UN/CX); a fórmula antiga zerava o CMV.
-- Pré-produção: backfill de sale_items com custo atual da embalagem (não é histórico perfeito).

create or replace function public.fn_fin_snapshot_pack_cost(p_embalagem_id uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(pe.preco_custo, 0),
    nullif(p.preco_custo_unitario, 0) * coalesce(nullif(pe.fator_conversao, 0), 1),
    0
  )::numeric
  from public.produto_embalagens pe
  join public.products p on p.id = pe.produto_id
  where pe.id = p_embalagem_id
$$;

revoke all on function public.fn_fin_snapshot_pack_cost(uuid) from public;
grant execute on function public.fn_fin_snapshot_pack_cost(uuid) to service_role;

-- ─── rpc_recognize_order_sale ────────────────────────────────────────────────
create or replace function public.rpc_recognize_order_sale(
  p_company_id uuid,
  p_order_id uuid,
  p_idempotency_key text default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders%rowtype;
  v_key text;
  v_pm text;
  v_sale uuid;
  v_pay uuid;
  v_jid uuid;
  v_existing uuid;
  v_lines jsonb;
  v_gross numeric;
  v_origin text;
  v_prazo boolean;
  v_due date;
  v_debit text;
begin
  select * into v_o from public.orders
   where id = p_order_id and company_id = p_company_id for update;
  if not found then
    raise exception 'pedido não encontrado' using errcode = 'no_data_found';
  end if;

  v_key := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''), 'order:' || p_order_id::text || ':recognize');
  select id into v_existing from public.finance_journals
   where company_id = p_company_id and idempotency_key = v_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'sale_id', v_o.sale_id, 'journal_id', v_existing, 'idempotent', true);
  end if;

  if v_o.sale_id is not null then
    return jsonb_build_object('ok', true, 'sale_id', v_o.sale_id, 'skipped', 'has_sale');
  end if;

  v_pm := coalesce(public.fn_fin_map_payment_method(v_o.payment_method), 'pix');
  v_origin := public.fn_fin_map_origin(v_o.source);
  v_prazo := public.fn_fin_is_prazo(v_pm);

  if v_prazo then
    if v_origin in ('chatbot', 'web_menu', 'ai_chat', 'table_service') then
      raise exception 'chatbot_prazo_forbidden' using errcode = '23514';
    end if;
    if v_o.customer_id is null then
      raise exception 'customer_required_for_prazo' using errcode = '23502';
    end if;
  end if;

  v_gross := coalesce(v_o.total_amount, v_o.total, 0);
  insert into public.sales (
    company_id, order_id, customer_id, origin, subtotal, delivery_fee, total, status, sold_at
  ) values (
    p_company_id, p_order_id, v_o.customer_id,
    v_origin,
    coalesce(v_o.total, v_gross, 0),
    coalesce(v_o.delivery_fee, 0),
    v_gross,
    case when v_prazo then 'partial'::text else 'paid'::text end,
    now()
  ) returning id into v_sale;

  insert into public.sale_items (
    sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
  )
  select
    v_sale, p_company_id, oi.produto_embalagem_id, coalesce(oi.product_name, 'Item'),
    coalesce(oi.qty, oi.quantity, 1),
    coalesce(oi.unit_price, 0),
    coalesce(public.fn_fin_snapshot_pack_cost(oi.produto_embalagem_id), 0)
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_due := coalesce(p_due_date, case when v_prazo then (current_date + 30) else current_date end);

  insert into public.sale_payments (sale_id, company_id, payment_method, amount, due_date)
  values (v_sale, p_company_id, v_pm, v_gross, v_due)
  returning id into v_pay;

  update public.orders
     set sale_id = v_sale, paid = not v_prazo
   where id = p_order_id and company_id = p_company_id;

  if v_gross <= 0 then
    return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', null);
  end if;

  v_debit := case when v_prazo then '1.2' else '1.1' end;
  v_lines := public.fn_fin_build_sale_credit_lines(p_company_id, p_order_id, v_gross, v_debit);

  v_jid := public.fn_fin_post_journal(
    p_company_id, v_key, 'recognize', p_order_id,
    v_sale, p_order_id, null, null, v_pay,
    v_origin, v_pm, now(), now(), null, null,
    case when v_prazo then 'Pedido a prazo' else 'Pedido liquidado' end,
    null, v_lines
  );

  return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', v_jid, 'prazo', v_prazo);
end;
$$;

revoke all on function public.rpc_recognize_order_sale(uuid, uuid, text, date) from public;
grant execute on function public.rpc_recognize_order_sale(uuid, uuid, text, date) to service_role;

-- ─── fn_sale_sync_from_order ─────────────────────────────────────────────────
create or replace function public.fn_sale_sync_from_order(p_company_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id uuid;
  v_old_total numeric;
  v_new_total numeric;
begin
  select o.sale_id, o.total_amount
    into v_sale_id, v_new_total
    from public.orders o
   where o.id = p_order_id and o.company_id = p_company_id;

  if v_sale_id is null then
    return;
  end if;

  select coalesce(s.total, 0) into v_old_total
    from public.sales s
   where s.id = v_sale_id and s.company_id = p_company_id;

  delete from public.sale_items
   where sale_id = v_sale_id and company_id = p_company_id;

  insert into public.sale_items (
    sale_id, company_id, produto_embalagem_id, product_name, qty, unit_price, unit_cost
  )
  select
    v_sale_id, p_company_id, oi.produto_embalagem_id, coalesce(oi.product_name, 'Item'),
    coalesce(oi.qty, oi.quantity, 1),
    coalesce(oi.unit_price, 0),
    coalesce(public.fn_fin_snapshot_pack_cost(oi.produto_embalagem_id), 0)
  from public.order_items oi
  where oi.order_id = p_order_id and oi.company_id = p_company_id;

  update public.sales s
     set subtotal = o.total,
         delivery_fee = coalesce(o.delivery_fee, 0),
         total = o.total_amount,
         updated_at = now()
    from public.orders o
   where s.id = v_sale_id
     and s.company_id = p_company_id
     and o.id = p_order_id
     and o.company_id = p_company_id;

  if v_old_total > 0 and v_new_total > 0 then
    update public.sale_payments sp
       set amount = round(sp.amount * v_new_total / v_old_total, 2)
     where sp.sale_id = v_sale_id and sp.company_id = p_company_id;
  elsif v_new_total <= 0 then
    update public.sale_payments sp
       set amount = 0
     where sp.sale_id = v_sale_id and sp.company_id = p_company_id;
  else
    update public.sale_payments sp
       set amount = v_new_total
     where sp.sale_id = v_sale_id and sp.company_id = p_company_id
       and sp.id = (
         select sp2.id from public.sale_payments sp2
          where sp2.sale_id = v_sale_id
          order by sp2.created_at, sp2.id
          limit 1
       );
  end if;
end;
$$;

revoke all on function public.fn_sale_sync_from_order(uuid, uuid) from public;
grant execute on function public.fn_sale_sync_from_order(uuid, uuid) to service_role;

-- ─── rpc_finalize_pdv_order (só troca snapshot de custo) ─────────────────────
-- Corpo = definição remota atual com unit_cost via fn_fin_snapshot_pack_cost.
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
            quantity, qty, unit_type, unit_price
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
            coalesce((elem ->> 'unit_price')::numeric, 0)
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

-- Backfill: custo atual da embalagem (pré-prod; não reconstrói histórico de preço).
update public.sale_items si
   set unit_cost = coalesce(public.fn_fin_snapshot_pack_cost(si.produto_embalagem_id), 0)
 where si.produto_embalagem_id is not null;
