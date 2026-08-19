-- Fase A+C: snapshot de origem no ledger, finalize PDV/mesa corrigido, cancel com estoque.

-- ─── 1. Snapshots operacionais no journal ───────────────────────────────────
alter table public.finance_journals
  add column if not exists order_source_snapshot text,
  add column if not exists order_channel_snapshot text;

comment on column public.finance_journals.order_source_snapshot is
  'Snapshot de orders.source no momento do post (auditoria; não muda se order é patchado depois).';
comment on column public.finance_journals.order_channel_snapshot is
  'Snapshot de orders.channel no momento do post.';

-- ─── 2. fn_fin_post_journal — preenche snapshots ────────────────────────────
create or replace function public.fn_fin_post_journal(
  p_company_id       uuid,
  p_idempotency_key  text,
  p_source_type      text,
  p_source_id        uuid,
  p_sale_id          uuid,
  p_order_id         uuid,
  p_bill_id          uuid,
  p_cash_register_id uuid,
  p_sale_payment_id  uuid,
  p_origin           text,
  p_payment_method   text,
  p_posted_at        timestamptz,
  p_occurred_at      timestamptz,
  p_posted_by        uuid,
  p_reason           text,
  p_description      text,
  p_reverses_id      uuid,
  p_lines            jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_line jsonb;
  v_code text;
  v_dir text;
  v_amt numeric;
  v_acc uuid;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_order_source text;
  v_order_channel text;
begin
  if v_key is not null then
    select id into v_id
      from public.finance_journals
     where company_id = p_company_id and idempotency_key = v_key;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'journal_lines_required' using errcode = '23502';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_amt := coalesce((v_line ->> 'amt')::numeric, 0);
    v_dir := v_line ->> 'dir';
    if v_amt <= 0 then
      raise exception 'journal_line_amount' using errcode = '23514';
    end if;
    if v_dir = 'debit' then v_debit := v_debit + v_amt; else v_credit := v_credit + v_amt; end if;
  end loop;
  if v_debit <> v_credit then
    raise exception 'journal_unbalanced' using errcode = '23514';
  end if;

  if p_order_id is not null then
    select o.source, o.channel
      into v_order_source, v_order_channel
      from public.orders o
     where o.id = p_order_id and o.company_id = p_company_id;
  elsif p_reverses_id is not null then
    select j.order_source_snapshot, j.order_channel_snapshot
      into v_order_source, v_order_channel
      from public.finance_journals j
     where j.id = p_reverses_id and j.company_id = p_company_id;
  end if;

  insert into public.finance_journals (
    company_id, entry_seq, idempotency_key, source_type, source_id,
    sale_id, order_id, bill_id, cash_register_id, sale_payment_id,
    origin, payment_method, posted_at, occurred_at, status,
    reverses_id, posted_by, reason, description,
    order_source_snapshot, order_channel_snapshot
  ) values (
    p_company_id,
    public.fn_fin_next_seq(p_company_id),
    v_key,
    p_source_type,
    p_source_id,
    p_sale_id, p_order_id, p_bill_id, p_cash_register_id, p_sale_payment_id,
    public.fn_fin_map_origin(p_origin),
    public.fn_fin_map_payment_method(p_payment_method),
    coalesce(p_posted_at, now()),
    coalesce(p_occurred_at, now()),
    'posted',
    p_reverses_id, p_posted_by, p_reason, p_description,
    v_order_source, v_order_channel
  )
  on conflict (company_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_id;

  if v_id is null then
    if v_key is not null then
      select id into v_id
        from public.finance_journals
       where company_id = p_company_id and idempotency_key = v_key;
      if v_id is not null then
        return v_id;
      end if;
    end if;
    raise exception 'journal_insert_failed' using errcode = '23505';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_code := v_line ->> 'code';
    v_dir := v_line ->> 'dir';
    v_amt := (v_line ->> 'amt')::numeric;
    v_acc := public.fn_fin_account_id(v_code);
    if v_acc is null then
      raise exception 'unknown_account %', v_code using errcode = 'P0002';
    end if;
    insert into public.finance_journal_lines (journal_id, company_id, account_id, direction, amount)
    values (v_id, p_company_id, v_acc, v_dir, round(v_amt, 2));
  end loop;

  return v_id;
exception
  when unique_violation then
    if v_key is not null then
      select id into v_id from public.finance_journals
       where company_id = p_company_id and idempotency_key = v_key;
      if v_id is not null then return v_id; end if;
    end if;
    raise;
end;
$$;

revoke all on function public.fn_fin_post_journal(
  uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, uuid, text, text, uuid, jsonb
) from public;
grant execute on function public.fn_fin_post_journal(
  uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text,
  timestamptz, timestamptz, uuid, text, text, uuid, jsonb
) to service_role;

-- ─── 3. rpc_finalize_pdv_order — origem canônica + payload order_source ───────
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
        nullif(trim(v_line ->> 'variant_id'), '')::uuid,
        trim(coalesce(v_line ->> 'product_name', ''))
            || case when nullif(trim(coalesce(v_line ->> 'details', '')), '') is not null
                then ' ' || trim(v_line ->> 'details') else '' end,
        coalesce((v_line ->> 'qty')::numeric, 0),
        coalesce((v_line ->> 'unit_price')::numeric, 0),
        coalesce((
          select coalesce(p.preco_custo_unitario, 0) * coalesce(pe.fator_conversao, 1)
            from public.produto_embalagens pe
            join public.products p on p.id = pe.produto_id
           where pe.id = nullif(trim(v_line ->> 'variant_id'), '')::uuid
        ), 0)
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

-- ─── 4. Cancel com estorno financeiro + estoque + bills ─────────────────────
create or replace function public.rpc_admin_cancel_order(
    p_company_id uuid,
    p_order_id uuid,
    p_reject_confirmation boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_now timestamptz := now();
    v_j record;
    v_closed boolean;
    v_sale_id uuid;
begin
    select o.sale_id into v_sale_id
      from public.orders o
     where o.id = p_order_id and o.company_id = p_company_id
     for update;

    if not found then
        raise exception 'order_not_found' using errcode = 'P0002';
    end if;

    for v_j in
      select j.id, j.cash_register_id
        from public.finance_journals j
       where j.company_id = p_company_id
         and j.order_id = p_order_id
         and j.status = 'posted'
         and j.source_type in ('sale_payment', 'recognize', 'bill_settlement')
    loop
      if v_j.cash_register_id is not null then
        select exists (
          select 1 from public.cash_registers cr
           where cr.id = v_j.cash_register_id
             and cr.company_id = p_company_id
             and cr.status = 'closed'
        ) into v_closed;
        if v_closed then
          raise exception 'settlement_conflict'
            using errcode = 'P0001';
        end if;
      end if;
      perform public.rpc_reverse_journal(
        p_company_id, v_j.id, 'Cancelamento do pedido',
        'reversal:cancel:' || p_order_id::text || ':' || v_j.id::text
      );
    end loop;

    if v_sale_id is not null then
        update public.bills b
           set status = 'canceled', updated_at = v_now
         where b.company_id = p_company_id
           and b.sale_id = v_sale_id
           and b.status in ('open', 'partial', 'overdue');

        update public.sales s
           set status = 'canceled', updated_at = v_now
         where s.id = v_sale_id and s.company_id = p_company_id;
    end if;

    -- Estorno de estoque: trigger fn_debitar_estoque_embalagem credita no DELETE.
    delete from public.order_items
     where order_id = p_order_id and company_id = p_company_id;

    update public.orders
    set
        status = 'canceled',
        confirmation_status = case
            when p_reject_confirmation then 'rejected'::text
            else confirmation_status
        end,
        confirmed_at = case
            when p_reject_confirmation then v_now
            else confirmed_at
        end
    where id = p_order_id
      and company_id = p_company_id;
end;
$$;

revoke all on function public.rpc_admin_cancel_order(uuid, uuid, boolean) from public;
grant execute on function public.rpc_admin_cancel_order(uuid, uuid, boolean) to service_role;

-- ─── 5. View trace + backfill ───────────────────────────────────────────────
create or replace view public.v_fin_journal_trace
  with (security_invoker = true) as
select
  j.id,
  j.company_id,
  j.entry_seq,
  j.posted_at,
  j.source_type,
  j.origin,
  j.order_source_snapshot,
  j.order_channel_snapshot,
  j.payment_method,
  j.description,
  j.status,
  j.sale_id,
  j.order_id,
  j.bill_id,
  j.reverses_id,
  o.source as order_source_live,
  o.channel as order_channel_live
from public.finance_journals j
left join public.orders o on o.id = j.order_id and o.company_id = j.company_id;

update public.finance_journals j
   set order_source_snapshot = o.source,
       order_channel_snapshot = o.channel
  from public.orders o
 where j.order_id = o.id
   and j.company_id = o.company_id
   and j.order_source_snapshot is null;

revoke all on table public.v_fin_journal_trace from anon, authenticated;
grant select on table public.v_fin_journal_trace to service_role;
