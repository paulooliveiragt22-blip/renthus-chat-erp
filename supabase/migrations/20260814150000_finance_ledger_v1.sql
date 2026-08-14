-- F1 cutover: journal sem CMV, unique só idempotency_key, RPCs service_role-only.
-- Contrato: docs/FINANCEIRO.md

-- ─── 0. Contas sistema (7) ───────────────────────────────────────────────────
update public.chart_of_accounts
   set code = code || '_legacy', is_active = false
 where company_id is null
   and is_system
   and code in (
     '1','1.1','1.1.1','1.1.2','1.1.3','1.2','1.3',
     '2','2.1','2.1.1','2.1.2','2.2','2.2.1','2.2.2','2.2.3','2.2.4','2.2.5','2.2.6','2.2.7',
     '2.3','2.3.1','2.3.2','2.3.3','2.4'
   );

insert into public.chart_of_accounts (id, company_id, code, name, type, is_system, is_active) values
  ('00000000-0001-0000-0000-000000000101', null, '1.1', 'Caixa e equivalentes', 'asset', true, true),
  ('00000000-0001-0000-0000-000000000102', null, '1.2', 'Contas a receber', 'asset', true, true),
  ('00000000-0001-0000-0000-000000000201', null, '2.1', 'Contas a pagar', 'liability', true, true),
  ('00000000-0001-0000-0000-000000000301', null, '3.1', 'Receita de vendas', 'revenue', true, true),
  ('00000000-0001-0000-0000-000000000302', null, '3.2', 'Taxa de entrega', 'revenue', true, true),
  ('00000000-0001-0000-0000-000000000402', null, '4.2', 'Despesas operacionais', 'expense', true, true),
  ('00000000-0001-0000-0000-000000000501', null, '5.1', 'Ajustes', 'expense', true, true)
on conflict (id) do update set code = excluded.code, name = excluded.name, is_active = true;

alter table public.sales
  alter column chart_account_id set default '00000000-0001-0000-0000-000000000301';

alter table public.sales drop constraint if exists sales_origin_check;
alter table public.sales
  add constraint sales_origin_check
  check (origin = any (array[
    'pdv','ui_order','chatbot','web_menu','ai_chat','table_service','marketplace','manual'
  ]));

-- ─── 1. Sequência e journal ──────────────────────────────────────────────────
create table if not exists public.finance_entry_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_seq   bigint not null default 0
);

create table if not exists public.finance_journals (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  entry_seq          bigint not null,
  idempotency_key    text,
  source_type        text not null check (source_type = any (array[
    'sale_payment','bill_settlement','cash_movement','opex','reversal','recognize'
  ])),
  source_id          uuid,
  sale_id            uuid references public.sales(id),
  order_id           uuid references public.orders(id),
  bill_id            uuid references public.bills(id),
  cash_register_id   uuid references public.cash_registers(id),
  sale_payment_id    uuid references public.sale_payments(id),
  origin             text not null check (origin = any (array[
    'pdv','chatbot','web_menu','ui_order','ai_chat','table_service','marketplace','manual'
  ])),
  payment_method     text check (payment_method is null or payment_method = any (array[
    'cash','pix','debit','card','credit_installment','boleto','promissoria','cheque'
  ])),
  posted_at          timestamptz not null default now(),
  occurred_at        timestamptz not null default now(),
  status             text not null default 'posted' check (status = any (array['posted','reversed'])),
  reverses_id        uuid references public.finance_journals(id),
  posted_by          uuid,
  reason             text,
  description        text,
  created_at         timestamptz not null default now(),
  unique (company_id, entry_seq)
);

create unique index if not exists finance_journals_idempotency_uq
  on public.finance_journals (company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists finance_journals_company_posted_idx
  on public.finance_journals (company_id, posted_at desc);
create index if not exists finance_journals_sale_idx
  on public.finance_journals (company_id, sale_id) where sale_id is not null;
create index if not exists finance_journals_bill_idx
  on public.finance_journals (company_id, bill_id) where bill_id is not null;

create table if not exists public.finance_journal_lines (
  id          uuid primary key default gen_random_uuid(),
  journal_id  uuid not null references public.finance_journals(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  account_id  uuid not null references public.chart_of_accounts(id),
  direction   text not null check (direction = any (array['debit','credit'])),
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now()
);

create index if not exists finance_journal_lines_journal_idx
  on public.finance_journal_lines (journal_id);

create or replace function public.fn_fin_journal_balanced()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_d numeric;
  v_c numeric;
begin
  select coalesce(sum(amount) filter (where direction = 'debit'), 0),
         coalesce(sum(amount) filter (where direction = 'credit'), 0)
    into v_d, v_c
    from public.finance_journal_lines
   where journal_id = coalesce(new.journal_id, old.journal_id);
  if v_d <> v_c then
    raise exception 'journal_unbalanced debit=% credit=%', v_d, v_c using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_fin_journal_balanced on public.finance_journal_lines;
create constraint trigger trg_fin_journal_balanced
  after insert or update or delete on public.finance_journal_lines
  deferrable initially deferred
  for each row execute function public.fn_fin_journal_balanced();

-- RLS
alter table public.finance_entry_counters enable row level security;
alter table public.finance_entry_counters force row level security;
alter table public.finance_journals enable row level security;
alter table public.finance_journals force row level security;
alter table public.finance_journal_lines enable row level security;
alter table public.finance_journal_lines force row level security;

drop policy if exists rls_finance_entry_counters_service_role_only on public.finance_entry_counters;
create policy rls_finance_entry_counters_service_role_only on public.finance_entry_counters
  as permissive for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists rls_finance_journals_service_role_only on public.finance_journals;
create policy rls_finance_journals_service_role_only on public.finance_journals
  as permissive for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists rls_finance_journal_lines_service_role_only on public.finance_journal_lines;
create policy rls_finance_journal_lines_service_role_only on public.finance_journal_lines
  as permissive for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

revoke all on table public.finance_entry_counters from anon, authenticated;
revoke all on table public.finance_journals from anon, authenticated;
revoke all on table public.finance_journal_lines from anon, authenticated;
grant select, insert, update on table public.finance_journals to service_role;
grant select, insert on table public.finance_journal_lines to service_role;
revoke update, delete, truncate on table public.finance_journal_lines from service_role;
grant select, insert, update on table public.finance_entry_counters to service_role;

-- ─── 2. Helpers ──────────────────────────────────────────────────────────────
create or replace function public.fn_fin_map_origin(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then 'pdv'
    when p_raw in ('pdv','pdv_direct','balcao') then 'pdv'
    when p_raw in ('chatbot') or p_raw like 'flow_%' then 'chatbot'
    when p_raw in ('web_menu') then 'web_menu'
    when p_raw in ('ui','ui_order','admin') then 'ui_order'
    when p_raw in ('ai_chat','ai_chat_pro_v2') then 'ai_chat'
    when p_raw in ('table_service','mesa') then 'table_service'
    when p_raw like 'marketplace%' then 'marketplace'
    else 'manual'
  end;
$$;

create or replace function public.fn_fin_map_payment_method(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(btrim(coalesce(p_raw, '')))
    when 'credit' then 'credit_installment'
    when 'a_prazo' then 'credit_installment'
    when 'debit_card' then 'debit'
    when 'credit_card' then 'card'
    when 'credit_card_installment' then 'credit_installment'
    when '' then null
    else lower(btrim(p_raw))
  end;
$$;

create or replace function public.fn_fin_is_prazo(p_method text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_method, '') in ('credit_installment','boleto','promissoria','cheque','credit');
$$;

create or replace function public.fn_fin_account_id(p_code text)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select id from public.chart_of_accounts
   where company_id is null and code = p_code and is_active
   limit 1;
$$;

create or replace function public.fn_fin_next_seq(p_company_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq bigint;
begin
  insert into public.finance_entry_counters (company_id, last_seq)
  values (p_company_id, 1)
  on conflict (company_id) do update
    set last_seq = public.finance_entry_counters.last_seq + 1
  returning last_seq into v_seq;
  return v_seq;
end;
$$;

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

  insert into public.finance_journals (
    company_id, entry_seq, idempotency_key, source_type, source_id,
    sale_id, order_id, bill_id, cash_register_id, sale_payment_id,
    origin, payment_method, posted_at, occurred_at, status,
    reverses_id, posted_by, reason, description
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
    p_reverses_id, p_posted_by, p_reason, p_description
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
  uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.fn_fin_post_journal(
  uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text, uuid, jsonb
) to service_role;

revoke all on function public.fn_fin_next_seq(uuid) from public, anon, authenticated;
grant execute on function public.fn_fin_next_seq(uuid) to service_role;

-- ─── 3. Leitura caixa / dashboard / extrato ─────────────────────────────────
create or replace function public.rpc_fin_cash_revenue(
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
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'America/Cuiaba');
  v_total numeric := 0;
  v_count int := 0;
  v_by_day jsonb := '[]'::jsonb;
  v_by_pay jsonb := '[]'::jsonb;
  v_by_ori jsonb := '[]'::jsonb;
begin
  with cash as (
    select j.id, j.posted_at, j.payment_method, j.origin,
           coalesce(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 0) as net_cash
      from public.finance_journals j
      join public.finance_journal_lines l on l.journal_id = j.id
      join public.chart_of_accounts a on a.id = l.account_id and a.code = '1.1'
     where j.company_id = p_company_id
       and j.status = 'posted'
       and (
         j.source_type in ('sale_payment','recognize','bill_settlement')
         or (
           j.source_type = 'reversal'
           and exists (
             select 1 from public.finance_journals o
              where o.id = j.reverses_id
                and o.source_type in ('sale_payment','recognize','bill_settlement')
           )
         )
       )
       and j.posted_at >= p_from
       and j.posted_at < p_to
     group by j.id, j.posted_at, j.payment_method, j.origin
    having coalesce(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 0) <> 0
  )
  select coalesce(sum(net_cash), 0), count(*)::int into v_total, v_count from cash;

  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
    into v_by_day
    from (
      select (timezone(v_tz, j.posted_at))::date as day,
             coalesce(sum(c.net_cash), 0)::numeric as amount,
             count(*)::int as entries_count
        from (
          select j.id, j.posted_at,
                 coalesce(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 0) as net_cash
            from public.finance_journals j
            join public.finance_journal_lines l on l.journal_id = j.id
            join public.chart_of_accounts a on a.id = l.account_id and a.code = '1.1'
           where j.company_id = p_company_id
             and j.status = 'posted'
             and (
               j.source_type in ('sale_payment','recognize','bill_settlement')
               or (
                 j.source_type = 'reversal'
                 and exists (
                   select 1 from public.finance_journals o
                    where o.id = j.reverses_id
                      and o.source_type in ('sale_payment','recognize','bill_settlement')
                 )
               )
             )
             and j.posted_at >= p_from and j.posted_at < p_to
           group by j.id, j.posted_at
        ) c
        join public.finance_journals j on j.id = c.id
       group by 1
    ) d;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.amount desc), '[]'::jsonb)
    into v_by_pay
    from (
      select coalesce(nullif(j.payment_method, ''), 'outros') as method,
             coalesce(sum(c.net_cash), 0)::numeric as amount,
             count(*)::int as entries_count
        from (
          select j.id,
                 coalesce(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 0) as net_cash
            from public.finance_journals j
            join public.finance_journal_lines l on l.journal_id = j.id
            join public.chart_of_accounts a on a.id = l.account_id and a.code = '1.1'
           where j.company_id = p_company_id
             and j.status = 'posted'
             and j.source_type in ('sale_payment','recognize','bill_settlement')
             and j.posted_at >= p_from and j.posted_at < p_to
           group by j.id
        ) c
        join public.finance_journals j on j.id = c.id
       group by 1
    ) p;

  select coalesce(jsonb_agg(row_to_json(o)::jsonb), '[]'::jsonb)
    into v_by_ori
    from (
      select coalesce(j.origin, 'pdv') as origin,
             coalesce(sum(c.net_cash), 0)::numeric as amount,
             count(*)::int as entries_count
        from (
          select j.id,
                 coalesce(sum(case when l.direction = 'debit' then l.amount else -l.amount end), 0) as net_cash
            from public.finance_journals j
            join public.finance_journal_lines l on l.journal_id = j.id
            join public.chart_of_accounts a on a.id = l.account_id and a.code = '1.1'
           where j.company_id = p_company_id
             and j.status = 'posted'
             and j.source_type in ('sale_payment','recognize','bill_settlement')
             and j.posted_at >= p_from and j.posted_at < p_to
           group by j.id
        ) c
        join public.finance_journals j on j.id = c.id
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

create or replace function public.rpc_fin_dashboard(
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
  v_income jsonb;
  v_cogs numeric := 0;
  v_opex numeric := 0;
  v_ar numeric := 0;
begin
  v_income := public.rpc_fin_cash_revenue(p_company_id, p_from, p_to, p_timezone);

  select coalesce(sum(si.line_cost), 0) into v_cogs
    from public.sale_items si
   where si.company_id = p_company_id
     and si.sale_id in (
       select distinct j.sale_id
         from public.finance_journals j
        where j.company_id = p_company_id
          and j.status = 'posted'
          and j.sale_id is not null
          and j.source_type in ('sale_payment','recognize','bill_settlement')
          and j.posted_at >= p_from and j.posted_at < p_to
     );

  select coalesce(sum(l.amount), 0) into v_opex
    from public.finance_journal_lines l
    join public.finance_journals j on j.id = l.journal_id
    join public.chart_of_accounts a on a.id = l.account_id and a.code = '4.2'
   where j.company_id = p_company_id
     and j.status = 'posted'
     and l.direction = 'debit'
     and j.posted_at >= p_from and j.posted_at < p_to;

  select coalesce(sum(b.saldo_devedor), 0) into v_ar
    from public.bills b
   where b.company_id = p_company_id
     and b.type = 'receivable'
     and b.status in ('open','partial','overdue');

  return v_income || jsonb_build_object('cogs', v_cogs, 'opex_paid', v_opex, 'ar_open', v_ar);
end;
$$;

create or replace function public.rpc_settle_bill(
  p_company_id     uuid,
  p_bill_id        uuid,
  p_pay_amount     numeric,
  p_payment_method text,
  p_received_at    date default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orig numeric;
  v_saldo numeric;
  v_amt numeric;
  v_type text;
  v_new_paid numeric;
  v_pm text := coalesce(public.fn_fin_map_payment_method(p_payment_method), 'pix');
  v_key text;
  v_jid uuid;
  v_posted timestamptz;
  v_sale uuid;
  v_order uuid;
begin
  select b.original_amount, b.saldo_devedor, b.amount, b.type, b.sale_id, b.order_id
    into v_orig, v_saldo, v_amt, v_type, v_sale, v_order
    from public.bills b
   where b.id = p_bill_id and b.company_id = p_company_id
   for update;
  if not found then
    raise exception 'bill_not_found' using errcode = 'P0002';
  end if;

  v_new_paid := v_orig - v_saldo + coalesce(p_pay_amount, 0);
  v_key := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''),
                    'bill:' || p_bill_id::text || ':settle:' || v_new_paid::text);
  v_posted := case
    when p_received_at is not null then timezone('UTC', p_received_at::timestamp + interval '12 hours')
    else now()
  end;

  update public.bills
     set amount_paid = v_new_paid,
         payment_method = v_pm,
         paid_at = case when v_new_paid >= v_amt then coalesce(paid_at, v_posted) else paid_at end
   where id = p_bill_id and company_id = p_company_id;

  if coalesce(p_pay_amount, 0) > 0 then
    if v_type = 'receivable' then
      v_jid := public.fn_fin_post_journal(
        p_company_id, v_key, 'bill_settlement', p_bill_id,
        v_sale, v_order, p_bill_id, null, null,
        'manual', v_pm, v_posted, v_posted, null, null, 'Baixa a receber', null,
        jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', p_pay_amount),
          jsonb_build_object('code','1.2','dir','credit','amt', p_pay_amount)
        )
      );
    else
      v_jid := public.fn_fin_post_journal(
        p_company_id, v_key, 'bill_settlement', p_bill_id,
        v_sale, v_order, p_bill_id, null, null,
        'manual', v_pm, v_posted, v_posted, null, null, 'Baixa a pagar', null,
        jsonb_build_array(
          jsonb_build_object('code','2.1','dir','debit','amt', p_pay_amount),
          jsonb_build_object('code','1.1','dir','credit','amt', p_pay_amount)
        )
      );
    end if;
  end if;

  return jsonb_build_object('ok', true, 'journal_id', v_jid);
end;
$$;

create or replace function public.rpc_post_opex(
  p_company_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_amt numeric;
  v_due date;
  v_status text;
  v_key text;
  v_desc text;
  v_cat text;
  v_paid boolean;
begin
  if coalesce(trim(p_payload ->> 'action'), '') = 'mark_paid' then
    v_id := (trim(p_payload ->> 'id'))::uuid;
    update public.bills
       set amount_paid = original_amount,
           paid_at = coalesce(paid_at, now()),
           status = 'paid'
     where id = v_id and company_id = p_company_id and type = 'payable';
    if not found then
      raise exception 'expense_not_found' using errcode = 'P0002';
    end if;
    perform public.fn_fin_post_journal(
      p_company_id,
      coalesce(nullif(trim(p_payload ->> 'idempotency_key'), ''), 'bill:' || v_id::text || ':settle:paid'),
      'bill_settlement', v_id, null, null, v_id, null, null,
      'manual', 'pix', now(), now(), null, null, 'Pagamento despesa', null,
      jsonb_build_array(
        jsonb_build_object('code','2.1','dir','debit','amt', (select original_amount from public.bills where id = v_id)),
        jsonb_build_object('code','1.1','dir','credit','amt', (select original_amount from public.bills where id = v_id))
      )
    );
    return v_id;
  end if;

  v_amt := coalesce((p_payload ->> 'amount')::numeric, 0);
  v_due := (trim(p_payload ->> 'due_date'))::date;
  v_status := coalesce(nullif(trim(p_payload ->> 'payment_status'), ''), 'pending');
  v_paid := v_status = 'paid';
  v_cat := trim(coalesce(p_payload ->> 'category', 'outros'));
  v_desc := trim(coalesce(p_payload ->> 'description', ''));
  v_key := nullif(trim(coalesce(p_payload ->> 'idempotency_key', '')), '');

  insert into public.bills (
    company_id, type, description, notes, amount, original_amount, amount_paid, saldo_devedor,
    due_date, status, origin, payment_method, idempotency_key
  ) values (
    p_company_id, 'payable', v_cat, nullif(v_desc, ''),
    v_amt, v_amt, case when v_paid then v_amt else 0 end,
    case when v_paid then 0 else v_amt end,
    v_due,
    case when v_paid then 'paid' else 'open' end,
    'manual', coalesce(public.fn_fin_map_payment_method(p_payload ->> 'payment_method'), 'pix'),
    v_key
  )
  returning id into v_id;

  if v_paid then
    perform public.fn_fin_post_journal(
      p_company_id,
      coalesce(v_key, 'opex:' || v_id::text),
      'opex', v_id, null, null, v_id, null, null,
      'manual', 'pix', now(), now(), null, null, coalesce(nullif(v_desc,''), v_cat), null,
      jsonb_build_array(
        jsonb_build_object('code','4.2','dir','debit','amt', v_amt),
        jsonb_build_object('code','1.1','dir','credit','amt', v_amt)
      )
    );
  else
    perform public.fn_fin_post_journal(
      p_company_id,
      coalesce(v_key, 'opex:' || v_id::text || ':accrual'),
      'opex', v_id, null, null, v_id, null, null,
      'manual', null, now(), now(), null, null, coalesce(nullif(v_desc,''), v_cat), null,
      jsonb_build_array(
        jsonb_build_object('code','4.2','dir','debit','amt', v_amt),
        jsonb_build_object('code','2.1','dir','credit','amt', v_amt)
      )
    );
  end if;
  return v_id;
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
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'reason_required' using errcode = '23502';
  end if;
  select * into v_j from public.finance_journals
   where id = p_journal_id and company_id = p_company_id for update;
  if not found then
    raise exception 'journal_not_found' using errcode = 'P0002';
  end if;
  if v_j.status = 'reversed' then
    return v_j.id;
  end if;
  v_key := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''),
                    'reversal:' || p_journal_id::text);

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', a.code,
           'dir', case when l.direction = 'debit' then 'credit' else 'debit' end,
           'amt', l.amount
         )), '[]'::jsonb)
    into v_lines
    from public.finance_journal_lines l
    join public.chart_of_accounts a on a.id = l.account_id
   where l.journal_id = p_journal_id;

  v_new := public.fn_fin_post_journal(
    p_company_id, v_key, 'reversal', p_journal_id,
    v_j.sale_id, v_j.order_id, v_j.bill_id, v_j.cash_register_id, v_j.sale_payment_id,
    v_j.origin, v_j.payment_method, now(), now(), null, p_reason, 'Estorno', p_journal_id,
    v_lines
  );
  update public.finance_journals set status = 'reversed' where id = p_journal_id;
  return v_new;
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

  insert into public.cash_movements (company_id, cash_register_id, type, amount, reason, operator_name)
  values (p_company_id, p_register_id, p_type, p_amount, p_reason, p_operator_name)
  returning id into v_id;

  v_key := coalesce(nullif(trim(coalesce(p_idempotency_key, '')), ''), 'cash:' || v_id::text);
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

create or replace function public.rpc_recognize_order_sale(
  p_company_id uuid,
  p_order_id uuid,
  p_idempotency_key text default null
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
  if public.fn_fin_is_prazo(v_pm) then
    raise exception 'chatbot_prazo_forbidden' using errcode = '23514';
  end if;

  v_gross := coalesce(v_o.total_amount, v_o.total, 0);
  insert into public.sales (
    company_id, order_id, customer_id, origin, subtotal, delivery_fee, total, status, sold_at
  ) values (
    p_company_id, p_order_id, v_o.customer_id,
    public.fn_fin_map_origin(v_o.source),
    coalesce(v_o.total, v_gross, 0),
    coalesce(v_o.delivery_fee, 0),
    v_gross,
    'paid', now()
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

  insert into public.sale_payments (sale_id, company_id, payment_method, amount, status, received_at)
  values (v_sale, p_company_id, v_pm, v_gross, 'received', now())
  returning id into v_pay;

  update public.orders set sale_id = v_sale, paid = true
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

  if v_fee > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('code','1.1','dir','debit','amt', v_gross),
      jsonb_build_object('code','3.1','dir','credit','amt', v_rev),
      jsonb_build_object('code','3.2','dir','credit','amt', v_fee)
    );
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('code','1.1','dir','debit','amt', v_gross),
      jsonb_build_object('code','3.1','dir','credit','amt', v_gross)
    );
  end if;

  v_jid := public.fn_fin_post_journal(
    p_company_id, v_key, 'recognize', p_order_id,
    v_sale, p_order_id, null, null, v_pay,
    public.fn_fin_map_origin(v_o.source), v_pm, now(), now(), null, null,
    'Pedido liquidado', null, v_lines
  );

  return jsonb_build_object('ok', true, 'sale_id', v_sale, 'journal_id', v_jid);
end;
$$;

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
begin
  for r in
    select sp.id, sp.payment_method, sp.amount
      from public.sale_payments sp
     where sp.sale_id = p_sale_id and sp.company_id = p_company_id
     order by sp.created_at, sp.id
  loop
    v_i := v_i + 1;
    v_prazo := public.fn_fin_is_prazo(r.payment_method);
    v_key := 'sale:' || p_sale_id::text || ':pay:' || v_i::text;
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
    perform public.fn_fin_post_journal(
      p_company_id, v_key, 'sale_payment', r.id,
      p_sale_id, p_order_id, null, p_cash_id, r.id,
      v_orig, r.payment_method, now(), now(), null, null, 'Venda', null, v_lines
    );
  end loop;
end;
$$;

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

    perform public.fn_fin_post_sale_payments(
        p_company_id, v_sale_id, v_oid, v_sale_origin, v_cash_id
    );

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

-- ─── 4. Views ────────────────────────────────────────────────────────────────
create or replace view public.v_fin_extrato
  with (security_invoker = true) as
select
  j.id,
  j.company_id,
  j.entry_seq,
  j.posted_at,
  j.occurred_at,
  j.source_type,
  j.origin,
  j.payment_method,
  j.description,
  j.status,
  j.sale_id,
  j.order_id,
  j.bill_id,
  j.cash_register_id,
  coalesce(sum(case
    when a.code = '1.1' and l.direction = 'debit' then l.amount
    when a.code = '1.1' and l.direction = 'credit' then -l.amount
    else 0
  end), 0) as cash_amount,
  coalesce(sum(l.amount) filter (where l.direction = 'debit'), 0) as debit_total,
  case
    when j.source_type in ('opex') then 'expense'
    when j.source_type = 'cash_movement' then 'expense'
    when j.source_type = 'bill_settlement' and exists (
      select 1 from public.bills b
       where b.id = j.bill_id and b.type = 'payable'
    ) then 'expense'
    else 'income'
  end as line_type
from public.finance_journals j
join public.finance_journal_lines l on l.journal_id = j.id
join public.chart_of_accounts a on a.id = l.account_id
group by j.id;

create or replace view public.v_fin_dre
  with (security_invoker = true) as
with monthly as (
  select
    s.company_id,
    date_trunc('month', s.sold_at)::date as period_start,
    (date_trunc('month', s.sold_at) + interval '1 mon' - interval '1 day')::date as period_end,
    sum(s.subtotal) as gross_revenue,
    sum(s.delivery_fee) as delivery_revenue,
    coalesce(sum(si_cost.total_cost), 0) as cogs,
    coalesce(sum(case
      when sp.payment_method = any (array['cash','pix','debit','card']) then sp.amount
      else 0 end), 0) as avista_revenue,
    coalesce(sum(case
      when sp.payment_method = any (array['credit_installment','boleto','promissoria','cheque']) then sp.amount
      else 0 end), 0) as prazo_revenue
  from public.sales s
  left join lateral (
    select sum(si.line_cost) as total_cost
      from public.sale_items si
     where si.sale_id = s.id
  ) si_cost on true
  left join public.sale_payments sp on sp.sale_id = s.id and sp.company_id = s.company_id
  where s.status <> 'canceled'
  group by s.company_id, date_trunc('month', s.sold_at)
),
opex as (
  select
    j.company_id,
    date_trunc('month', j.posted_at)::date as period_start,
    (date_trunc('month', j.posted_at) + interval '1 mon' - interval '1 day')::date as period_end,
    coalesce(sum(l.amount), 0) as opex_paid
  from public.finance_journals j
  join public.finance_journal_lines l on l.journal_id = j.id
  join public.chart_of_accounts a on a.id = l.account_id and a.code = '4.2'
  where j.status = 'posted' and l.direction = 'debit'
  group by j.company_id, date_trunc('month', j.posted_at)
)
select company_id, period_start, period_end, 'Vendas à Vista'::text as account_name, 'revenue'::text as account_type, avista_revenue as total from monthly
union all
select company_id, period_start, period_end, 'Vendas a Prazo', 'revenue', prazo_revenue from monthly
union all
select company_id, period_start, period_end, 'Taxa de Entrega', 'revenue', delivery_revenue from monthly
union all
select company_id, period_start, period_end, 'Custo de Mercadorias', 'cost', cogs from monthly
union all
select company_id, period_start, period_end, 'Despesas operacionais', 'expense', opex_paid from opex;

drop view if exists public.v_dre;
create view public.v_dre
  with (security_invoker = true) as
select * from public.v_fin_dre;

create or replace view public.v_fin_cash_session
  with (security_invoker = true) as
select
  cr.id,
  cr.company_id,
  cr.status,
  cr.opened_at,
  cr.closed_at,
  cr.operator_name,
  cr.initial_amount,
  cr.closing_amount,
  cr.initial_amount + coalesce((
    select sum(case when l.direction = 'debit' then l.amount else -l.amount end)
      from public.finance_journals j
      join public.finance_journal_lines l on l.journal_id = j.id
      join public.chart_of_accounts a on a.id = l.account_id and a.code = '1.1'
     where j.company_id = cr.company_id
       and j.cash_register_id = cr.id
       and j.status = 'posted'
  ), 0) as expected_balance
from public.cash_registers cr;

revoke all on table public.v_fin_extrato from public, anon, authenticated;
revoke all on table public.v_fin_dre from public, anon, authenticated;
revoke all on table public.v_dre from public, anon, authenticated;
revoke all on table public.v_fin_cash_session from public, anon, authenticated;
revoke all on table public.v_aging_receivables from public, anon, authenticated;
revoke all on table public.v_daily_sales from public, anon, authenticated;
revoke all on table public.v_cash_flow_projected from public, anon, authenticated;
grant select on table public.v_fin_extrato to service_role;
grant select on table public.v_fin_dre to service_role;
grant select on table public.v_dre to service_role;
grant select on table public.v_fin_cash_session to service_role;
grant select on table public.v_aging_receivables to service_role;
grant select on table public.v_daily_sales to service_role;
grant select on table public.v_cash_flow_projected to service_role;

-- ─── 5. Backfill ─────────────────────────────────────────────────────────────
-- Snapshot CMV atual (não é custo histórico). Ver docs/FINANCEIRO.md.
update public.sale_items si
   set unit_cost = coalesce((
     select coalesce(p.preco_custo_unitario, 0) * coalesce(pe.fator_conversao, 1)
       from public.produto_embalagens pe
       join public.products p on p.id = pe.produto_id
      where pe.id = si.produto_embalagem_id
   ), 0)
 where coalesce(si.unit_cost, 0) = 0;

-- Para de escrever FE antes de criar bills no backfill.
drop trigger if exists trg_financial_entry_on_finalize on public.orders;
drop trigger if exists trg_bill_paid_to_financial_entry on public.bills;
drop trigger if exists trg_prazo_to_financial on public.vendas_a_prazo;

do $$
declare
  fe record;
  v_pm text;
  v_origin text;
  v_posted timestamptz;
  v_fee numeric;
  v_amt numeric;
  v_rev numeric;
  v_lines jsonb;
  v_src text;
  v_bill uuid;
  v_cash boolean;
begin
  for fe in
    select * from public.financial_entries where type = 'income' and amount > 0
  loop
    v_bill := null;
    v_pm := public.fn_fin_map_payment_method(fe.payment_method);
    if v_pm is null or v_pm not in (
      'cash','pix','debit','card','credit_installment','boleto','promissoria','cheque'
    ) then
      v_pm := case when fe.status = 'pending' then 'credit_installment' else 'pix' end;
    end if;
    v_origin := public.fn_fin_map_origin(fe.origin);
    v_fee := coalesce(fe.delivery_fee, 0);
    v_amt := fe.amount;
    v_rev := case when v_fee > 0 and v_amt > v_fee then v_amt - v_fee else v_amt end;
    if v_fee > 0 and v_amt > v_fee then
      null;
    else
      v_fee := 0;
    end if;

    v_cash := fe.status = 'received' or exists (
      select 1 from public.bills b
       where b.company_id = fe.company_id
         and b.type = 'receivable'
         and b.status = 'paid'
         and (
           (fe.order_id is not null and b.order_id = fe.order_id)
           or (fe.sale_id is not null and b.sale_id = fe.sale_id)
         )
    );

    if v_cash then
      v_src := case when fe.status = 'pending' then 'bill_settlement' else 'sale_payment' end;
      select b.id into v_bill
        from public.bills b
       where b.company_id = fe.company_id
         and b.type = 'receivable'
         and b.status = 'paid'
         and (
           (fe.order_id is not null and b.order_id = fe.order_id)
           or (fe.sale_id is not null and b.sale_id = fe.sale_id)
         )
       limit 1;
      v_posted := coalesce(
        case when v_src = 'bill_settlement' then (select paid_at from public.bills where id = v_bill) end,
        fe.received_at,
        fe.occurred_at
      );
      if v_fee > 0 then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', v_amt),
          jsonb_build_object('code','3.1','dir','credit','amt', v_rev),
          jsonb_build_object('code','3.2','dir','credit','amt', v_fee)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.1','dir','debit','amt', v_amt),
          jsonb_build_object('code','3.1','dir','credit','amt', v_amt)
        );
      end if;
    else
      v_src := 'recognize';
      v_posted := fe.occurred_at;
      if v_fee > 0 then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.2','dir','debit','amt', v_amt),
          jsonb_build_object('code','3.1','dir','credit','amt', v_rev),
          jsonb_build_object('code','3.2','dir','credit','amt', v_fee)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','1.2','dir','debit','amt', v_amt),
          jsonb_build_object('code','3.1','dir','credit','amt', v_amt)
        );
      end if;

      select b.id into v_bill
        from public.bills b
       where b.company_id = fe.company_id
         and (
           (fe.order_id is not null and b.order_id = fe.order_id)
           or (fe.sale_id is not null and b.sale_id = fe.sale_id)
         )
       limit 1;
      if v_bill is null then
        insert into public.bills (
          company_id, type, sale_id, order_id, customer_id, amount, original_amount, amount_paid,
          due_date, status, origin, payment_method, description, idempotency_key
        ) values (
          fe.company_id, 'receivable', fe.sale_id, fe.order_id,
          coalesce(
            (select s.customer_id from public.sales s where s.id = fe.sale_id),
            (select o.customer_id from public.orders o where o.id = fe.order_id)
          ),
          v_amt, v_amt, 0,
          coalesce(fe.due_date, (fe.occurred_at at time zone 'UTC')::date),
          'open', v_origin, v_pm,
          coalesce(fe.description, 'Título a receber (backfill)'),
          'backfill:fe:' || fe.id::text
        )
        returning id into v_bill;
      end if;
    end if;

    perform public.fn_fin_post_journal(
      fe.company_id,
      'backfill:fe:' || fe.id::text,
      v_src,
      fe.id,
      fe.sale_id, fe.order_id, v_bill, null, null,
      v_origin, v_pm, v_posted, coalesce(fe.occurred_at, v_posted),
      null, null, coalesce(fe.description, 'Backfill FE'), null, v_lines
    );
  end loop;

  for fe in select * from public.expenses
  loop
    insert into public.bills (
      company_id, type, description, notes, amount, original_amount, amount_paid,
      due_date, status, origin, payment_method, paid_at, idempotency_key
    ) values (
      fe.company_id, 'payable', fe.category, fe.description, fe.amount, fe.amount,
      case when fe.payment_status = 'paid' then fe.amount else 0 end,
      fe.due_date,
      case when fe.payment_status = 'paid' then 'paid' else 'open' end,
      'manual', 'pix',
      case when fe.payment_status = 'paid' then coalesce(fe.paid_at, fe.created_at) else null end,
      'backfill:exp:' || fe.id::text
    )
    returning id into v_bill;

    if fe.amount > 0 then
      if fe.payment_status = 'paid' then
        v_lines := jsonb_build_array(
          jsonb_build_object('code','4.2','dir','debit','amt', fe.amount),
          jsonb_build_object('code','1.1','dir','credit','amt', fe.amount)
        );
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('code','4.2','dir','debit','amt', fe.amount),
          jsonb_build_object('code','2.1','dir','credit','amt', fe.amount)
        );
      end if;
      perform public.fn_fin_post_journal(
        fe.company_id,
        'backfill:exp:' || fe.id::text,
        'opex', v_bill, null, null, v_bill, null, null,
        'manual', 'pix',
        coalesce(fe.paid_at, fe.created_at),
        coalesce(fe.paid_at, fe.created_at),
        null, null, coalesce(fe.description, fe.category), null, v_lines
      );
    end if;
  end loop;
end;
$$;

-- ─── 6. DROP legado ──────────────────────────────────────────────────────────
drop function if exists public.fn_create_financial_entry_on_finalize();
drop function if exists public.fn_bill_paid_to_financial_entry();
drop function if exists public.fn_prazo_to_financial();
drop function if exists public.rpc_company_received_income(uuid, timestamptz, timestamptz, text);
drop function if exists public.rpc_upsert_expense(uuid, jsonb);
drop function if exists public.rpc_pay_bill(uuid, uuid, numeric, text, date);

drop table if exists public.financial_entries;
drop table if exists public.expenses;
drop table if exists public.vendas_a_prazo;

alter table public.bills drop constraint if exists bills_cost_center_id_fkey;
alter table public.sales drop constraint if exists sales_cost_center_id_fkey;
alter table public.bills drop column if exists cost_center_id;
alter table public.sales drop column if exists cost_center_id;
drop table if exists public.cost_centers;

-- ─── 7. REVOKE amplo ─────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (
         p.proname like 'rpc_fin_%'
         or p.proname like 'fn_fin_%'
         or p.proname in (
           'rpc_finalize_pdv_order',
           'rpc_finalize_sale',
           'rpc_open_cash_register',
           'rpc_close_cash_register',
           'rpc_set_order_status',
           'rpc_settle_bill',
           'rpc_post_opex',
           'rpc_reverse_journal',
           'rpc_post_cash_movement',
           'rpc_recognize_order_sale'
         )
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;


