-- M7: receita canônica = financial_entries recebidos; agregação SQL; anti-duplicata por pedido.

create unique index if not exists financial_entries_order_income_uq
  on public.financial_entries (order_id)
  where order_id is not null and type = 'income';

create index if not exists financial_entries_company_received_at_idx
  on public.financial_entries (company_id, received_at desc)
  where status = 'received' and type = 'income';

create or replace function public.rpc_company_received_income(
    p_company_id uuid,
    p_from       timestamptz,
    p_to         timestamptz,
    p_timezone   text default 'America/Cuiaba'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tz     text := coalesce(nullif(trim(p_timezone), ''), 'America/Cuiaba');
    v_total  numeric := 0;
    v_count  int := 0;
    v_by_day jsonb := '[]'::jsonb;
    v_by_pay jsonb := '[]'::jsonb;
    v_by_ori jsonb := '[]'::jsonb;
begin
    select coalesce(sum(fe.amount), 0), count(*)::int
      into v_total, v_count
      from public.financial_entries fe
     where fe.company_id = p_company_id
       and fe.type = 'income'
       and fe.status = 'received'
       and coalesce(fe.received_at, fe.occurred_at) >= p_from
       and coalesce(fe.received_at, fe.occurred_at) < p_to;

    select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
      into v_by_day
      from (
        select
            (timezone(v_tz, coalesce(fe.received_at, fe.occurred_at)))::date as day,
            coalesce(sum(fe.amount), 0)::numeric as amount,
            count(*)::int as entries_count
          from public.financial_entries fe
         where fe.company_id = p_company_id
           and fe.type = 'income'
           and fe.status = 'received'
           and coalesce(fe.received_at, fe.occurred_at) >= p_from
           and coalesce(fe.received_at, fe.occurred_at) < p_to
         group by 1
      ) d;

    select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.amount desc), '[]'::jsonb)
      into v_by_pay
      from (
        select
            coalesce(nullif(trim(fe.payment_method), ''), 'outros') as method,
            coalesce(sum(fe.amount), 0)::numeric as amount,
            count(*)::int as entries_count
          from public.financial_entries fe
         where fe.company_id = p_company_id
           and fe.type = 'income'
           and fe.status = 'received'
           and coalesce(fe.received_at, fe.occurred_at) >= p_from
           and coalesce(fe.received_at, fe.occurred_at) < p_to
         group by 1
      ) p;

    select coalesce(jsonb_agg(row_to_json(o)::jsonb), '[]'::jsonb)
      into v_by_ori
      from (
        select
            coalesce(nullif(trim(fe.origin), ''), 'balcao') as origin,
            coalesce(sum(fe.amount), 0)::numeric as amount,
            count(*)::int as entries_count
          from public.financial_entries fe
         where fe.company_id = p_company_id
           and fe.type = 'income'
           and fe.status = 'received'
           and coalesce(fe.received_at, fe.occurred_at) >= p_from
           and coalesce(fe.received_at, fe.occurred_at) < p_to
         group by 1
      ) o;

    return jsonb_build_object(
        'total', v_total,
        'count', v_count,
        'by_day', v_by_day,
        'by_payment_method', v_by_pay,
        'by_origin', v_by_ori
    );
end;
$$;

revoke all on function public.rpc_company_received_income(uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.rpc_company_received_income(uuid, timestamptz, timestamptz, text) from anon, authenticated;
grant execute on function public.rpc_company_received_income(uuid, timestamptz, timestamptz, text) to service_role;

comment on function public.rpc_company_received_income(uuid, timestamptz, timestamptz, text) is
  'M7: soma income received em financial_entries no intervalo (fuso para by_day).';

-- Trigger: search_path; anti-duplicata via unique index + exists
create or replace function public.fn_create_financial_entry_on_finalize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if (tg_op = 'UPDATE')
       and (new.status = 'finalized')
       and (old.status is distinct from 'finalized')
       and (new.sale_id is null)
    then
        if not exists (
            select 1 from public.financial_entries
             where order_id = new.id and type = 'income'
        ) then
            insert into public.financial_entries (
                company_id, order_id, type, amount, delivery_fee,
                payment_method, description, occurred_at, origin, status, received_at
            ) values (
                new.company_id,
                new.id,
                'income',
                coalesce(new.total_amount, 0),
                coalesce(new.delivery_fee, 0),
                new.payment_method,
                'Pedido finalizado',
                now(),
                case
                    when new.source in ('chatbot') or new.source like 'flow_%' then 'chatbot'
                    when new.source in ('ui', 'ui_order', 'admin') then 'ui_order'
                    else 'balcao'
                end,
                'received',
                now()
            );
        end if;
    end if;
    return new;
end;
$$;
