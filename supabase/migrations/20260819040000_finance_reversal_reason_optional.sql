-- Motivo de estorno opcional no journal; entry_seq no detalhe.

create or replace function public.rpc_fin_journal_detail(
  p_company_id uuid,
  p_journal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_j public.finance_journals%rowtype;
  v_lines jsonb;
begin
  select * into v_j
    from public.finance_journals
   where id = p_journal_id and company_id = p_company_id;

  if not found then
    raise exception 'journal_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code', a.code,
             'name', a.name,
             'direction', l.direction,
             'amount', round(l.amount, 2),
             'remaining', public.fn_fin_journal_line_remaining(p_journal_id, a.code, l.direction)
           )
           order by l.direction, a.code
         ), '[]'::jsonb)
    into v_lines
    from public.finance_journal_lines l
    join public.chart_of_accounts a on a.id = l.account_id
   where l.journal_id = p_journal_id;

  return jsonb_build_object(
    'id', v_j.id,
    'entry_seq', v_j.entry_seq,
    'status', v_j.status,
    'source_type', v_j.source_type,
    'origin', v_j.origin,
    'payment_method', v_j.payment_method,
    'description', v_j.description,
    'reason', v_j.reason,
    'posted_at', v_j.posted_at,
    'order_id', v_j.order_id,
    'sale_id', v_j.sale_id,
    'bill_id', v_j.bill_id,
    'cash_register_id', v_j.cash_register_id,
    'reverses_id', v_j.reverses_id,
    'lines', v_lines
  );
end;
$$;

create or replace function public.rpc_reverse_journal_partial(
  p_company_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_lines jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_j public.finance_journals%rowtype;
  v_line jsonb;
  v_code text;
  v_dir text;
  v_amt numeric;
  v_remaining numeric;
  v_total numeric := 0;
  v_out jsonb := '[]'::jsonb;
  v_rev_dir text;
  v_liquid_code text;
  v_liquid_dir text;
  v_liquid_remaining numeric;
  v_new uuid;
  v_key text;
  v_closed boolean;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Estorno');
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'journal_lines_required' using errcode = '23502';
  end if;

  select * into v_j
    from public.finance_journals
   where id = p_journal_id and company_id = p_company_id
   for update;

  if not found then
    raise exception 'journal_not_found' using errcode = 'P0002';
  end if;

  if v_j.status = 'reversed' then
    raise exception 'journal_already_reversed' using errcode = 'P0001';
  end if;

  if v_j.source_type = 'reversal' then
    raise exception 'cannot_reverse_reversal' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id and a.code = '1.1' and l.direction = 'debit'
  ) then
    v_liquid_code := '1.1';
    v_liquid_dir := 'debit';
  elsif exists (
    select 1
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id and a.code = '1.2' and l.direction = 'debit'
  ) then
    v_liquid_code := '1.2';
    v_liquid_dir := 'debit';
  elsif exists (
    select 1
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id and a.code = '1.1' and l.direction = 'credit'
  ) then
    v_liquid_code := '1.1';
    v_liquid_dir := 'credit';
  elsif exists (
    select 1
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id and a.code = '2.1' and l.direction = 'credit'
  ) then
    v_liquid_code := '2.1';
    v_liquid_dir := 'credit';
  else
    raise exception 'journal_no_liquid_account' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_code := trim(v_line ->> 'code');
    v_dir := trim(v_line ->> 'dir');
    v_amt := round((v_line ->> 'amt')::numeric, 2);

    if v_code is null or v_dir is null or v_amt is null or v_amt <= 0 then
      raise exception 'journal_line_invalid' using errcode = '23514';
    end if;

    if v_code in ('1.1', '1.2', '2.1') then
      raise exception 'liquid_line_not_selectable' using errcode = '23514';
    end if;

    if not exists (
      select 1
        from public.finance_journal_lines l
        join public.chart_of_accounts a on a.id = l.account_id
       where l.journal_id = p_journal_id
         and a.code = v_code
         and l.direction = v_dir
    ) then
      raise exception 'journal_line_not_found %', v_code using errcode = 'P0002';
    end if;

    v_remaining := public.fn_fin_journal_line_remaining(p_journal_id, v_code, v_dir);
    if v_amt > v_remaining then
      raise exception 'journal_line_exceeds_remaining' using errcode = '23514';
    end if;

    v_rev_dir := case when v_dir = 'debit' then 'credit' else 'debit' end;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object('code', v_code, 'dir', v_rev_dir, 'amt', v_amt)
    );
    v_total := v_total + v_amt;
  end loop;

  if v_total <= 0 then
    raise exception 'journal_line_amount' using errcode = '23514';
  end if;

  v_liquid_remaining := public.fn_fin_journal_line_remaining(
    p_journal_id, v_liquid_code, v_liquid_dir
  );
  if v_total > v_liquid_remaining then
    raise exception 'journal_exceeds_liquid_remaining' using errcode = '23514';
  end if;

  if v_j.cash_register_id is not null and v_liquid_code = '1.1' and v_liquid_dir = 'debit' then
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

  v_rev_dir := case when v_liquid_dir = 'debit' then 'credit' else 'debit' end;
  v_out := v_out || jsonb_build_array(
    jsonb_build_object('code', v_liquid_code, 'dir', v_rev_dir, 'amt', v_total)
  );

  v_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'reversal:partial:' || p_journal_id::text || ':' || md5(p_lines::text)
  );

  v_new := public.fn_fin_post_journal(
    p_company_id, v_key, 'reversal', p_journal_id,
    v_j.sale_id, v_j.order_id, v_j.bill_id, v_j.cash_register_id, v_j.sale_payment_id,
    v_j.origin, v_j.payment_method, now(), now(), null, v_reason, 'Estorno parcial', p_journal_id,
    v_out
  );

  if not exists (
    select 1
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id
       and public.fn_fin_journal_line_remaining(p_journal_id, a.code, l.direction) > 0
  ) then
    update public.finance_journals set status = 'reversed' where id = p_journal_id;
  end if;

  return v_new;
end;
$$;

create or replace function public.rpc_reverse_journal(
  p_company_id uuid,
  p_journal_id uuid,
  p_reason text,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_j public.finance_journals%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_new uuid;
  v_key text;
  v_row record;
  v_rem numeric;
  v_rev_dir text;
  v_closed boolean;
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Estorno');
begin
  select * into v_j
    from public.finance_journals
   where id = p_journal_id and company_id = p_company_id
   for update;

  if not found then
    raise exception 'journal_not_found' using errcode = 'P0002';
  end if;

  if v_j.status = 'reversed' then
    return v_j.id;
  end if;

  if v_j.source_type = 'reversal' then
    raise exception 'cannot_reverse_reversal' using errcode = 'P0001';
  end if;

  for v_row in
    select a.code, l.direction, l.amount
      from public.finance_journal_lines l
      join public.chart_of_accounts a on a.id = l.account_id
     where l.journal_id = p_journal_id
     order by l.direction, a.code
  loop
    v_rem := public.fn_fin_journal_line_remaining(p_journal_id, v_row.code, v_row.direction);
    if v_rem > 0 then
      v_rev_dir := case when v_row.direction = 'debit' then 'credit' else 'debit' end;
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('code', v_row.code, 'dir', v_rev_dir, 'amt', v_rem)
      );
    end if;
  end loop;

  if jsonb_array_length(v_lines) < 2 then
    raise exception 'journal_nothing_to_reverse' using errcode = 'P0001';
  end if;

  if v_j.cash_register_id is not null then
    if public.fn_fin_journal_line_remaining(p_journal_id, '1.1', 'debit') > 0 then
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
  end if;

  v_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    'reversal:' || p_journal_id::text
  );

  v_new := public.fn_fin_post_journal(
    p_company_id, v_key, 'reversal', p_journal_id,
    v_j.sale_id, v_j.order_id, v_j.bill_id, v_j.cash_register_id, v_j.sale_payment_id,
    v_j.origin, v_j.payment_method, now(), now(), null, v_reason, 'Estorno', p_journal_id,
    v_lines
  );

  update public.finance_journals set status = 'reversed' where id = p_journal_id;
  return v_new;
end;
$$;

revoke all on function public.rpc_fin_journal_detail(uuid, uuid) from public;
grant execute on function public.rpc_fin_journal_detail(uuid, uuid) to service_role;
revoke all on function public.rpc_reverse_journal_partial(uuid, uuid, text, jsonb, text) from public;
grant execute on function public.rpc_reverse_journal_partial(uuid, uuid, text, jsonb, text) to service_role;
revoke all on function public.rpc_reverse_journal(uuid, uuid, text, text) from public;
grant execute on function public.rpc_reverse_journal(uuid, uuid, text, text) to service_role;
