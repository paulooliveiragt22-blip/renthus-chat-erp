-- F5: PDV passa a separar taxa de entrega (3.2); drop view v_daily_sales (não é faturamento).
-- search_path + REVOKE padrão.

create or replace function public.fn_fin_post_sale_payments(
  p_company_id uuid,
  p_sale_id uuid,
  p_order_id uuid,
  p_origin text,
  p_cash_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_prazo boolean;
  v_i int := 0;
  v_key text;
  v_lines jsonb;
  v_orig text := public.fn_fin_map_origin(p_origin);
  v_fee numeric := 0;
  v_sale_fee numeric := 0;
  v_order_fee numeric := 0;
  v_rev numeric;
  v_fee_left numeric;
begin
  select coalesce(s.delivery_fee, 0) into v_sale_fee
    from public.sales s
   where s.id = p_sale_id and s.company_id = p_company_id;

  if p_order_id is not null then
    select coalesce(o.delivery_fee, 0) into v_order_fee
      from public.orders o
     where o.id = p_order_id and o.company_id = p_company_id;
  end if;

  v_fee := case when v_sale_fee > 0 then v_sale_fee else coalesce(v_order_fee, 0) end;
  if v_fee > 0 and coalesce(v_sale_fee, 0) = 0 then
    update public.sales
       set delivery_fee = v_fee
     where id = p_sale_id and company_id = p_company_id;
  end if;
  v_fee_left := v_fee;

  for r in
    select sp.id, sp.payment_method, sp.amount
      from public.sale_payments sp
     where sp.sale_id = p_sale_id and sp.company_id = p_company_id
     order by sp.created_at, sp.id
  loop
    v_i := v_i + 1;
    v_prazo := public.fn_fin_is_prazo(r.payment_method);
    v_key := 'sale:' || p_sale_id::text || ':pay:' || v_i::text;

    if v_fee_left > 0 and r.amount > v_fee_left then
      v_rev := r.amount - v_fee_left;
      if v_prazo then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.2','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.1','dir','credit','amt', v_rev),
          jsonb_build_object('code','3.2','dir','credit','amt', v_fee_left)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.1','dir','credit','amt', v_rev),
          jsonb_build_object('code','3.2','dir','credit','amt', v_fee_left)
        );
      end if;
      v_fee_left := 0;
    elsif v_fee_left > 0 and r.amount = v_fee_left then
      if v_prazo then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.2','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.2','dir','credit','amt', r.amount)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.2','dir','credit','amt', r.amount)
        );
      end if;
      v_fee_left := 0;
    else
      if v_prazo then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.2','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.1','dir','credit','amt', r.amount)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', r.amount),
          jsonb_build_object('code','3.1','dir','credit','amt', r.amount)
        );
      end if;
    end if;

    perform public.fn_fin_post_journal(
      p_company_id, v_key, 'sale_payment', r.id,
      p_sale_id, p_order_id, null, p_cash_id, r.id,
      v_orig, r.payment_method, now(), now(), null, null, 'Venda', null, v_lines
    );
  end loop;
end;
$$;

revoke all on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) from anon, authenticated;
grant execute on function public.fn_fin_post_sale_payments(uuid, uuid, uuid, text, uuid) to service_role;

drop view if exists public.v_daily_sales;
