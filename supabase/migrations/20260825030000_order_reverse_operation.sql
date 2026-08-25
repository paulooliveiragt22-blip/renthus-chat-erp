-- Fase F: estorno operacional unificado (storno integral + reemissão parcial ou cancel full).

-- ─── order_events (auditoria) ───────────────────────────────────────────────
create table if not exists public.order_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  order_id        uuid not null references public.orders(id) on delete cascade,
  event_type      text not null,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

create index if not exists order_events_company_order_idx
  on public.order_events (company_id, order_id, created_at desc);

create unique index if not exists order_events_idempotency_uq
  on public.order_events (company_id, idempotency_key)
  where idempotency_key is not null;

alter table public.order_events enable row level security;
alter table public.order_events force row level security;
revoke all on table public.order_events from anon;
revoke all on table public.order_events from authenticated;

create policy rls_order_events_service_role_only on public.order_events
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── fn_order_append_event ───────────────────────────────────────────────────
create or replace function public.fn_order_append_event(
  p_company_id uuid,
  p_order_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text default null,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.order_events (
    company_id, order_id, event_type, payload, idempotency_key, created_by
  ) values (
    p_company_id, p_order_id, p_event_type, coalesce(p_payload, '{}'::jsonb),
    nullif(trim(coalesce(p_idempotency_key, '')), ''), p_created_by
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fn_order_append_event(uuid, uuid, text, jsonb, text, uuid) from public;
grant execute on function public.fn_order_append_event(uuid, uuid, text, jsonb, text, uuid) to service_role;

-- ─── fn_order_recalc_totals ──────────────────────────────────────────────────
create or replace function public.fn_order_recalc_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric;
begin
  select coalesce(
    sum(coalesce(oi.line_total, coalesce(oi.qty, oi.quantity, 0) * coalesce(oi.unit_price, 0))),
    0
  )
    into v_subtotal
    from public.order_items oi
   where oi.order_id = p_order_id;

  update public.orders
     set total = v_subtotal
   where id = p_order_id;
end;
$$;

revoke all on function public.fn_order_recalc_totals(uuid) from public;
grant execute on function public.fn_order_recalc_totals(uuid) to service_role;

-- ─── fn_sale_sync_from_order ─────────────────────────────────────────────────
create or replace function public.fn_sale_sync_from_order(
  p_company_id uuid,
  p_order_id uuid
)
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
    coalesce((
      select coalesce(p.preco_custo_unitario, 0) * coalesce(pe.fator_conversao, 1)
        from public.produto_embalagens pe
        join public.products p on p.id = pe.produto_id
       where pe.id = oi.produto_embalagem_id
    ), 0)
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

-- ─── fn_fin_reverse_order_journals ───────────────────────────────────────────
create or replace function public.fn_fin_reverse_order_journals(
  p_company_id uuid,
  p_order_id uuid,
  p_reason text,
  p_key_prefix text
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_j record;
  v_closed boolean;
  v_ids uuid[] := '{}';
  v_rev uuid;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Estorno');
begin
  for v_j in
    select j.id, j.cash_register_id
      from public.finance_journals j
     where j.company_id = p_company_id
       and j.order_id = p_order_id
       and j.status = 'posted'
       and j.source_type in ('sale_payment', 'recognize', 'bill_settlement')
     order by j.posted_at, j.id
  loop
    if v_j.cash_register_id is not null then
      select exists (
        select 1 from public.cash_registers cr
         where cr.id = v_j.cash_register_id
           and cr.company_id = p_company_id
           and cr.status = 'closed'
      ) into v_closed;
      if v_closed then
        raise exception 'settlement_conflict' using errcode = 'P0001';
      end if;
    end if;

    v_rev := public.rpc_reverse_journal(
      p_company_id,
      v_j.id,
      v_reason,
      p_key_prefix || ':' || v_j.id::text
    );
    v_ids := array_append(v_ids, v_rev);
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.fn_fin_reverse_order_journals(uuid, uuid, text, text) from public;
grant execute on function public.fn_fin_reverse_order_journals(uuid, uuid, text, text) to service_role;

-- ─── fn_fin_restate_order_sale ───────────────────────────────────────────────
create or replace function public.fn_fin_restate_order_sale(
  p_company_id uuid,
  p_order_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders%rowtype;
  v_key text;
  v_existing uuid;
  v_gross numeric;
  v_pm text;
  v_prazo boolean;
  v_debit text;
  v_lines jsonb;
  v_cash uuid;
  v_jid uuid;
begin
  select * into v_o
    from public.orders
   where id = p_order_id and company_id = p_company_id;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  v_gross := coalesce(v_o.total_amount, 0);
  if v_gross <= 0 then
    return null;
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    raise exception 'idempotency_key_required' using errcode = '23502';
  end if;

  select id into v_existing
    from public.finance_journals
   where company_id = p_company_id and idempotency_key = v_key;
  if v_existing is not null then
    return v_existing;
  end if;

  v_pm := coalesce(public.fn_fin_map_payment_method(v_o.payment_method), 'pix');
  v_prazo := public.fn_fin_is_prazo(v_pm);
  v_debit := case when v_prazo then '1.2' else '1.1' end;
  v_lines := public.fn_fin_build_sale_credit_lines(p_company_id, p_order_id, v_gross, v_debit);

  select j.cash_register_id into v_cash
    from public.finance_journals j
   where j.company_id = p_company_id
     and j.order_id = p_order_id
   order by j.posted_at desc
   limit 1;

  v_jid := public.fn_fin_post_journal(
    p_company_id, v_key, 'recognize', null,
    v_o.sale_id, p_order_id, null, v_cash, null,
    public.fn_fin_map_origin(v_o.source), v_pm, now(), now(), null, null,
    'Pedido reemitido', null, v_lines
  );

  return v_jid;
end;
$$;

revoke all on function public.fn_fin_restate_order_sale(uuid, uuid, text) from public;
grant execute on function public.fn_fin_restate_order_sale(uuid, uuid, text) to service_role;

-- ─── rpc_admin_reverse_order_operation ───────────────────────────────────────
create or replace function public.rpc_admin_reverse_order_operation(
  p_company_id uuid,
  p_order_id uuid,
  p_mode text default 'full',
  p_items jsonb default null,
  p_include_delivery_fee boolean default false,
  p_include_service_fees boolean default false,
  p_reason text default null,
  p_idempotency_key text default null,
  p_reject_confirmation boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_mode text := lower(trim(coalesce(p_mode, 'full')));
  v_key text;
  v_evt record;
  v_o public.orders%rowtype;
  v_sale_id uuid;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Estorno');
  v_reversed uuid[] := '{}';
  v_restate uuid[] := '{}';
  v_event_id uuid;
  v_item jsonb;
  v_oi_id uuid;
  v_qty numeric;
  v_oi_qty numeric;
  v_restate_key text;
  v_restate_id uuid;
  v_status text;
  v_pm text;
  v_prazo boolean;
begin
  if v_mode not in ('full', 'partial') then
    raise exception 'invalid_mode' using errcode = '23514';
  end if;

  v_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'order:' || p_order_id::text || ':reverse:' || v_mode
  );

  select * into v_evt
    from public.order_events e
   where e.company_id = p_company_id
     and e.idempotency_key = v_key
   limit 1;

  if found then
    return coalesce(v_evt.payload, '{}'::jsonb)
      || jsonb_build_object('ok', true, 'idempotent', true, 'event_id', v_evt.id);
  end if;

  select * into v_o
    from public.orders o
   where o.id = p_order_id and o.company_id = p_company_id
   for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  v_sale_id := v_o.sale_id;
  v_pm := coalesce(public.fn_fin_map_payment_method(v_o.payment_method), 'pix');
  v_prazo := public.fn_fin_is_prazo(v_pm);

  if v_mode = 'partial' and v_prazo then
    raise exception 'prazo_partial_blocked' using errcode = 'P0001';
  end if;

  if v_mode = 'partial'
     and (p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0)
     and not coalesce(p_include_delivery_fee, false)
     and not coalesce(p_include_service_fees, false) then
    raise exception 'partial_requires_items' using errcode = '23502';
  end if;

  -- 1) Estorno integral de todos journals posted do pedido
  v_reversed := public.fn_fin_reverse_order_journals(
    p_company_id, p_order_id, v_reason, 'reversal:op:' || v_key
  );

  -- 2) Operacional
  if v_mode = 'full' then
    delete from public.order_items
     where order_id = p_order_id and company_id = p_company_id;
  else
    if p_items is not null and jsonb_typeof(p_items) = 'array' then
      for v_item in select * from jsonb_array_elements(p_items)
      loop
        v_oi_id := nullif(trim(v_item ->> 'order_item_id'), '')::uuid;
        v_qty := round((v_item ->> 'qty')::numeric, 4);
        if v_oi_id is null or v_qty is null or v_qty <= 0 then
          raise exception 'journal_line_invalid' using errcode = '23514';
        end if;

        select coalesce(oi.qty, oi.quantity, 0)
          into v_oi_qty
          from public.order_items oi
         where oi.id = v_oi_id
           and oi.order_id = p_order_id
           and oi.company_id = p_company_id;

        if not found then
          raise exception 'order_item_not_found' using errcode = 'P0002';
        end if;

        if v_qty > v_oi_qty then
          raise exception 'order_item_qty_exceeds' using errcode = '23514';
        end if;

        if v_qty >= v_oi_qty then
          delete from public.order_items
           where id = v_oi_id and order_id = p_order_id and company_id = p_company_id;
        else
          update public.order_items
             set qty = coalesce(qty, quantity, 0) - v_qty,
                 quantity = coalesce(quantity, qty, 0) - v_qty
           where id = v_oi_id and order_id = p_order_id and company_id = p_company_id;
        end if;
      end loop;
    end if;

    if coalesce(p_include_delivery_fee, false) then
      delete from public.order_fees
       where order_id = p_order_id
         and company_id = p_company_id
         and system_key = 'delivery';
      update public.orders
         set delivery_fee = 0
       where id = p_order_id and company_id = p_company_id;
    end if;

    if coalesce(p_include_service_fees, false) then
      delete from public.order_fees
       where order_id = p_order_id
         and company_id = p_company_id
         and system_key is distinct from 'delivery';
      update public.orders
         set service_fees_total = 0
       where id = p_order_id and company_id = p_company_id;
    end if;
  end if;

  perform public.fn_order_recalc_totals(p_order_id);

  select * into v_o
    from public.orders
   where id = p_order_id and company_id = p_company_id;

  if v_sale_id is not null then
    perform public.fn_sale_sync_from_order(p_company_id, p_order_id);
  end if;

  -- 3) Reemissão (parcial com saldo) ou cancel full
  if v_mode = 'full' or coalesce(v_o.total_amount, 0) <= 0 then
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

    update public.orders
       set status = 'canceled',
           confirmation_status = case
             when p_reject_confirmation then 'rejected'::text
             else confirmation_status
           end,
           confirmed_at = case
             when p_reject_confirmation then v_now
             else confirmed_at
           end
     where id = p_order_id and company_id = p_company_id;

    v_status := 'canceled';
  else
    v_restate_key := v_key || ':restate';
    v_restate_id := public.fn_fin_restate_order_sale(p_company_id, p_order_id, v_restate_key);
    if v_restate_id is not null then
      v_restate := array_append(v_restate, v_restate_id);
    end if;
    v_status := v_o.status;
  end if;

  v_event_id := public.fn_order_append_event(
    p_company_id,
    p_order_id,
    case when v_mode = 'full' then 'reverse_full' else 'reverse_partial' end,
    jsonb_build_object(
      'mode', v_mode,
      'reason', v_reason,
      'reversed_journal_ids', to_jsonb(v_reversed),
      'restatement_journal_ids', to_jsonb(v_restate),
      'order_status', v_status,
      'total_amount', v_o.total_amount
    ),
    v_key,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'order_id', p_order_id,
    'reversed_journal_ids', to_jsonb(v_reversed),
    'restatement_journal_ids', to_jsonb(v_restate),
    'order_status', v_status,
    'event_id', v_event_id
  );
end;
$$;

revoke all on function public.rpc_admin_reverse_order_operation(
  uuid, uuid, text, jsonb, boolean, boolean, text, text, boolean
) from public;
grant execute on function public.rpc_admin_reverse_order_operation(
  uuid, uuid, text, jsonb, boolean, boolean, text, text, boolean
) to service_role;

-- ─── rpc_admin_cancel_order → delega ao fluxo unificado (full) ─────────────
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
begin
  perform public.rpc_admin_reverse_order_operation(
    p_company_id,
    p_order_id,
    'full',
    null,
    false,
    false,
    'Cancelamento do pedido',
  case
    when p_reject_confirmation then 'order:' || p_order_id::text || ':reverse:reject'
    else 'order:' || p_order_id::text || ':reverse:cancel'
  end,
    p_reject_confirmation
  );
end;
$$;

revoke all on function public.rpc_admin_cancel_order(uuid, uuid, boolean) from public;
grant execute on function public.rpc_admin_cancel_order(uuid, uuid, boolean) to service_role;
