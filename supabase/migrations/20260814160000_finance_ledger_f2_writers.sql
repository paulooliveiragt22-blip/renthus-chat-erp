-- F2: status ≠ dinheiro; recognize a prazo só UI/PDV; cancel estorna journal;
-- sangria exige chave do client.

create or replace function public.fn_validate_chatbot_payment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_origin text;
begin
  select origin into v_origin from public.sales where id = new.sale_id;
  if v_origin in ('chatbot', 'web_menu', 'ai_chat', 'table_service')
     and new.payment_method in ('credit_installment', 'boleto', 'promissoria', 'cheque') then
    raise exception 'chatbot_prazo_forbidden'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop function if exists public.rpc_recognize_order_sale(uuid, uuid, text);

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
  v_fee numeric;
  v_rev numeric;
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
    coalesce((
      select coalesce(p.preco_custo_unitario, 0) * coalesce(pe.fator_conversao, 1)
        from public.produto_embalagens pe
        join public.products p on p.id = pe.produto_id
       where pe.id = oi.produto_embalagem_id
    ), 0)
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_due := coalesce(p_due_date, case when v_prazo then (current_date + 30) else current_date end);

  insert into public.sale_payments (sale_id, company_id, payment_method, amount, due_date)
  values (v_sale, p_company_id, v_pm, v_gross, v_due)
  returning id into v_pay;

  update public.orders
     set sale_id = v_sale, paid = not v_prazo
   where id = p_order_id and company_id = p_company_id;

  v_fee := coalesce(v_o.delivery_fee, 0);
  v_rev := v_gross - v_fee;
  if v_rev <= 0 then
    v_rev := v_gross;
    v_fee := 0;
  end if;

  if v_gross <= 0 then
    return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', null);
  end if;

  v_debit := case when v_prazo then '1.2' else '1.1' end;
  if v_fee > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('code', v_debit, 'dir', 'debit', 'amt', v_gross),
      jsonb_build_object('code', '3.1', 'dir', 'credit', 'amt', v_rev),
      jsonb_build_object('code', '3.2', 'dir', 'credit', 'amt', v_fee)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('code', v_debit, 'dir', 'debit', 'amt', v_gross),
      jsonb_build_object('code', '3.1', 'dir', 'credit', 'amt', v_gross)
    );
  end if;

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
begin
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

    if not found then
        raise exception 'order_not_found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.rpc_post_cash_movement(
  p_company_id uuid,
  p_register_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text,
  p_operator_name text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_key text;
  v_lines jsonb;
begin
  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'idempotency_key_required' using errcode = '23502';
  end if;
  if p_type not in ('sangria','suprimento') then
    raise exception 'invalid_cash_movement' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.cash_registers
     where id = p_register_id and company_id = p_company_id and status = 'open'
  ) then
    raise exception 'cash_register_invalid' using errcode = 'P0002';
  end if;

  select j.source_id into v_id
    from public.finance_journals j
   where j.company_id = p_company_id and j.idempotency_key = v_key
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.cash_movements (company_id, cash_register_id, type, amount, reason, operator_name)
  values (p_company_id, p_register_id, p_type, p_amount, p_reason, p_operator_name)
  returning id into v_id;

  if p_type = 'sangria' then
    v_lines := jsonb_build_array(
      jsonb_build_object('code','5.1','dir','debit','amt', p_amount),
      jsonb_build_object('code','1.1','dir','credit','amt', p_amount)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('code','1.1','dir','debit','amt', p_amount),
      jsonb_build_object('code','5.1','dir','credit','amt', p_amount)
    );
  end if;
  perform public.fn_fin_post_journal(
    p_company_id, v_key, 'cash_movement', v_id,
    null, null, null, p_register_id, null,
    'pdv', 'cash', now(), now(), null, p_reason, p_type, null, v_lines
  );
  return v_id;
end;
$$;

revoke all on function public.rpc_recognize_order_sale(uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.rpc_recognize_order_sale(uuid, uuid, text, date) to service_role;

revoke all on function public.rpc_admin_cancel_order(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rpc_admin_cancel_order(uuid, uuid, boolean) to service_role;

revoke all on function public.rpc_post_cash_movement(uuid, uuid, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.rpc_post_cash_movement(uuid, uuid, text, numeric, text, text, text) to service_role;
