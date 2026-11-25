-- Cada pagador escolhe valor ou item na mesma conta.

create or replace function public.fn_mesa_replace_parts(
  p_company_id uuid,
  p_session_id uuid,
  p_parts jsonb,
  p_due numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sum numeric := 0;
  v_i int := 0;
  v_n int;
  r jsonb;
  v_line jsonb;
  v_method text;
  v_amount numeric;
  v_by_item boolean;
  v_has_value boolean;
  v_order uuid;
  v_items numeric := 0;
  v_fee numeric := 0;
  v_item uuid;
  v_need numeric;
  v_got numeric;
  v_price numeric;
  v_raw numeric;
  v_sub numeric;
  v_subs numeric[] := array[]::numeric[];
  v_raws numeric[] := array[]::numeric[];
  v_methods text[] := array[]::text[];
  v_is_item boolean[] := array[]::boolean[];
  v_typed numeric[] := array[]::numeric[];
  v_last int := 0;
  v_used_sub numeric := 0;
  v_used_fee numeric := 0;
  v_share numeric;
begin
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    raise exception 'payments_required' using errcode = '23502';
  end if;

  select exists (
    select 1
      from jsonb_array_elements(p_parts) e
     where jsonb_typeof(e -> 'lines') = 'array'
  ) into v_by_item;

  delete from public.table_session_payments
   where session_id = p_session_id
     and company_id = p_company_id
     and status = 'draft';

  if not v_by_item then
    for r in select value from jsonb_array_elements(p_parts)
    loop
      v_method := lower(trim(coalesce(r ->> 'method', r ->> 'payment_method', '')));
      if v_method = any (array['credit_installment','boleto','promissoria','cheque','credit'])
         or v_method <> all (array['cash','pix','debit','card']) then
        raise exception 'payment_not_allowed' using errcode = '23514';
      end if;
      v_amount := round(coalesce((r ->> 'amount')::numeric, (r ->> 'value')::numeric, 0), 2);
      if v_amount <= 0 then
        raise exception 'payment_amount_invalid' using errcode = '23514';
      end if;
      v_i := v_i + 1;
      insert into public.table_session_payments (company_id, session_id, amount, payment_method, status, sort_order)
      values (p_company_id, p_session_id, v_amount, v_method, 'draft', v_i);
      v_sum := v_sum + v_amount;
    end loop;

    if round(v_sum, 2) <> round(p_due, 2) then
      raise exception 'payments_mismatch' using errcode = '23514';
    end if;
    return round(v_sum, 2);
  end if;

  select exists (
    select 1
      from jsonb_array_elements(p_parts) e
     where jsonb_typeof(e -> 'lines') is distinct from 'array'
  ) into v_has_value;

  select ts.order_id into v_order
    from public.table_sessions ts
   where ts.id = p_session_id and ts.company_id = p_company_id;
  if v_order is null then
    raise exception 'order_missing' using errcode = 'P0002';
  end if;

  select round(coalesce(sum(coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0)), 0), 2)
    into v_items
    from public.order_items oi
   where oi.order_id = v_order and oi.company_id = p_company_id;
  v_fee := round(coalesce(p_due, 0) - v_items, 2);

  for v_item, v_need in
    select oi.id, coalesce(oi.qty, oi.quantity, 0)
      from public.order_items oi
     where oi.order_id = v_order and oi.company_id = p_company_id
  loop
    v_got := 0;
    for r in select value from jsonb_array_elements(p_parts)
    loop
      if jsonb_typeof(r -> 'lines') is distinct from 'array' then
        continue;
      end if;
      for v_line in select value from jsonb_array_elements(r -> 'lines')
      loop
        if nullif(v_line ->> 'item_id', '')::uuid = v_item then
          v_got := v_got + coalesce((v_line ->> 'qty')::numeric, 0);
        end if;
      end loop;
    end loop;
    if v_got < 0 or round(v_got, 4) > round(v_need, 4) then
      raise exception 'qty_mismatch' using errcode = '23514';
    end if;
    if not v_has_value and round(v_got, 4) <> round(v_need, 4) then
      raise exception 'qty_mismatch' using errcode = '23514';
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_parts)
  loop
    v_method := lower(trim(coalesce(r ->> 'method', r ->> 'payment_method', '')));
    if v_method = any (array['credit_installment','boleto','promissoria','cheque','credit'])
       or v_method <> all (array['cash','pix','debit','card']) then
      raise exception 'payment_not_allowed' using errcode = '23514';
    end if;
    v_methods := v_methods || v_method;
    if jsonb_typeof(r -> 'lines') is distinct from 'array' then
      v_amount := round(coalesce((r ->> 'amount')::numeric, (r ->> 'value')::numeric, 0), 2);
      if v_amount <= 0 then
        raise exception 'payment_amount_invalid' using errcode = '23514';
      end if;
      v_is_item := v_is_item || false;
      v_raws := v_raws || 0;
      v_typed := v_typed || v_amount;
      continue;
    end if;

    v_raw := 0;
    for v_line in select value from jsonb_array_elements(r -> 'lines')
    loop
      v_item := nullif(v_line ->> 'item_id', '')::uuid;
      v_got := coalesce((v_line ->> 'qty')::numeric, 0);
      if v_got < 0 then
        raise exception 'qty_mismatch' using errcode = '23514';
      end if;
      if v_got = 0 then
        continue;
      end if;
      select oi.unit_price into v_price
        from public.order_items oi
       where oi.id = v_item and oi.order_id = v_order and oi.company_id = p_company_id;
      if not found then
        raise exception 'item_not_found' using errcode = 'P0002';
      end if;
      v_raw := v_raw + v_got * coalesce(v_price, 0);
    end loop;
    if v_raw <= 0 then
      raise exception 'payment_amount_invalid' using errcode = '23514';
    end if;
    v_is_item := v_is_item || true;
    v_raws := v_raws || v_raw;
    v_typed := v_typed || 0;
    if not v_has_value then
      v_last := coalesce(array_length(v_raws, 1), 0);
    end if;
  end loop;

  v_n := coalesce(array_length(v_raws, 1), 0);
  v_subs := array_fill(0::numeric, array[v_n]);

  if not v_has_value then
    for v_i in 1..v_n loop
      if v_i = v_last then
        continue;
      end if;
      v_sub := round(v_raws[v_i], 2);
      v_subs[v_i] := v_sub;
      v_used_sub := round(v_used_sub + v_sub, 2);
    end loop;
    if v_last > 0 then
      v_subs[v_last] := round(v_items - v_used_sub, 2);
    end if;

    for v_i in 1..v_n loop
      if v_i = v_last then
        v_share := round(v_fee - v_used_fee, 2);
      elsif v_items <= 0 then
        v_share := 0;
      else
        v_share := round(v_fee * v_subs[v_i] / v_items, 2);
        v_used_fee := round(v_used_fee + v_share, 2);
      end if;
      v_amount := round(v_subs[v_i] + v_share, 2);
      if v_amount <= 0 then
        raise exception 'payment_amount_invalid' using errcode = '23514';
      end if;
      insert into public.table_session_payments (company_id, session_id, amount, payment_method, status, sort_order)
      values (p_company_id, p_session_id, v_amount, v_methods[v_i], 'draft', v_i);
      v_sum := v_sum + v_amount;
    end loop;
  else
    for v_i in 1..v_n loop
      if v_is_item[v_i] then
        v_sub := round(v_raws[v_i], 2);
        if v_items <= 0 then
          v_share := 0;
        else
          v_share := round(v_fee * v_raws[v_i] / v_items, 2);
        end if;
        v_amount := round(v_sub + v_share, 2);
      else
        v_amount := v_typed[v_i];
      end if;
      if v_amount <= 0 then
        raise exception 'payment_amount_invalid' using errcode = '23514';
      end if;
      insert into public.table_session_payments (company_id, session_id, amount, payment_method, status, sort_order)
      values (p_company_id, p_session_id, v_amount, v_methods[v_i], 'draft', v_i);
      v_sum := v_sum + v_amount;
    end loop;
  end if;

  if round(v_sum, 2) <> round(p_due, 2) then
    raise exception 'payments_mismatch' using errcode = '23514';
  end if;
  return round(v_sum, 2);
end;
$$;

revoke all on function public.fn_mesa_replace_parts(uuid, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.fn_mesa_replace_parts(uuid, uuid, jsonb, numeric) to service_role;
