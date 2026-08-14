-- rpc_apply_order_fees: incluir definition_id no JSON de retorno.
create or replace function public.rpc_apply_order_fees(
  p_company_id uuid,
  p_order_id uuid,
  p_fees jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric := 0;
  r jsonb;
  v_def uuid;
  v_name text;
  v_key text;
  v_mode text;
  v_rate numeric;
  v_amt numeric;
  v_row record;
begin
  if not exists (
    select 1 from public.orders where id = p_order_id and company_id = p_company_id
  ) then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(coalesce(oi.line_total, coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0))), 0)
    into v_subtotal
    from public.order_items oi
   where oi.order_id = p_order_id;

  delete from public.order_fees
   where order_id = p_order_id
     and company_id = p_company_id
     and system_key is distinct from 'delivery';

  for r in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb))
  loop
    v_def := nullif(trim(coalesce(r ->> 'definition_id', '')), '')::uuid;
    v_name := nullif(trim(coalesce(r ->> 'name', '')), '');
    v_key := nullif(trim(coalesce(r ->> 'system_key', '')), '');
    v_mode := coalesce(nullif(trim(r ->> 'calc_mode'), ''), 'fixed');
    v_rate := coalesce((r ->> 'rate_or_amount')::numeric, (r ->> 'value')::numeric, 0);

    if v_def is not null then
      select d.name, d.system_key, d.calc_mode, d.value
        into v_row
        from public.service_fee_definitions d
       where d.id = v_def and d.company_id = p_company_id;
      if found then
        v_name := coalesce(v_name, v_row.name);
        v_key := coalesce(v_key, v_row.system_key);
        v_mode := coalesce(nullif(trim(r ->> 'calc_mode'), ''), v_row.calc_mode, 'fixed');
        if (r ->> 'rate_or_amount') is null and (r ->> 'value') is null then
          v_rate := v_row.value;
        end if;
      end if;
    end if;

    if v_name is null then
      continue;
    end if;
    if v_mode = 'percent' then
      v_amt := round(v_subtotal * v_rate / 100.0, 2);
    else
      v_amt := round(v_rate, 2);
    end if;
    if v_amt < 0 then v_amt := 0; end if;

    if v_key = 'delivery' then
      delete from public.order_fees
       where order_id = p_order_id and system_key = 'delivery';
    end if;

    if v_amt = 0 then
      continue;
    end if;

    insert into public.order_fees (
      company_id, order_id, definition_id, name, system_key, calc_mode, rate_or_amount, amount
    ) values (
      p_company_id, p_order_id, v_def, v_name, v_key, v_mode, v_rate, v_amt
    );
  end loop;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'definition_id', f.definition_id,
      'name', f.name,
      'system_key', f.system_key,
      'calc_mode', f.calc_mode,
      'rate_or_amount', f.rate_or_amount,
      'amount', f.amount
    ) order by f.created_at), '[]'::jsonb)
    from public.order_fees f
    where f.order_id = p_order_id and f.company_id = p_company_id
  );
end;
$$;

revoke all on function public.rpc_apply_order_fees(uuid, uuid, jsonb) from public;
revoke all on function public.rpc_apply_order_fees(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.rpc_apply_order_fees(uuid, uuid, jsonb) to service_role;
