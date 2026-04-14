-- Global hardening:
-- 1) Select via views (v_sec_*)
-- 2) Insert/Update/Delete via RPCs (service_role)
-- 3) Sem acesso cru em tabelas (REVOKE + RLS force)

-- ---------------------------------------------------------------------------
-- RPCs genéricas seguras (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.rpc_secure_insert(
  p_table text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_row jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from pg_tables
    where schemaname='public'
      and tablename = p_table
  ) then
    raise exception 'unknown table: %', p_table;
  end if;

  v_sql := format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(%I.*)',
    p_table, p_table, p_table
  );
  execute v_sql using p_payload into v_row;
  return coalesce(v_row, '{}'::jsonb);
end;
$$;

create or replace function public.rpc_secure_update(
  p_table text,
  p_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_row jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name = p_table
      and column_name = 'id'
  ) then
    raise exception 'table % has no id column', p_table;
  end if;

  v_sql := format(
    'update public.%I t set (%s) = (%s) from (select * from jsonb_populate_record(null::public.%I, $1)) x where t.id = $2 returning to_jsonb(t)',
    p_table,
    (
      select string_agg(format('%I', c.column_name), ', ')
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=p_table
        and c.column_name <> 'id'
    ),
    (
      select string_agg(format('x.%I', c.column_name), ', ')
      from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=p_table
        and c.column_name <> 'id'
    ),
    p_table
  );
  execute v_sql using p_payload, p_id into v_row;
  return coalesce(v_row, '{}'::jsonb);
end;
$$;

create or replace function public.rpc_secure_delete(
  p_table text,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_rows integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name = p_table
      and column_name = 'id'
  ) then
    raise exception 'table % has no id column', p_table;
  end if;

  v_sql := format('delete from public.%I where id = $1', p_table);
  execute v_sql using p_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.rpc_secure_insert(text, jsonb) from anon, authenticated;
revoke all on function public.rpc_secure_update(text, uuid, jsonb) from anon, authenticated;
revoke all on function public.rpc_secure_delete(text, uuid) from anon, authenticated;

grant execute on function public.rpc_secure_insert(text, jsonb) to service_role;
grant execute on function public.rpc_secure_update(text, uuid, jsonb) to service_role;
grant execute on function public.rpc_secure_delete(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Views equivalentes de SELECT (v_sec_<tabela>) para todas tabelas base public
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_name text;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname='public'
      and tablename <> 'schema_migrations'
    order by tablename
  loop
    v_name := format('v_sec_%s', r.tablename);
    execute format('drop view if exists public.%I cascade', v_name);
    execute format('create view public.%I as select * from public.%I', v_name, r.tablename);
    execute format('revoke all on public.%I from anon', v_name);
    execute format('grant select on public.%I to authenticated', v_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS + REVOKE em todas as tabelas base public
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  pol record;
  pol_name text;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public'
      and c.relkind='r'
      and c.relname <> 'schema_migrations'
    order by c.relname
  loop
    -- Remove grants diretos para perfis web
    execute format('revoke all on table public.%I from anon', r.table_name);
    execute format('revoke all on table public.%I from authenticated', r.table_name);

    -- RLS total
    execute format('alter table public.%I enable row level security', r.table_name);
    execute format('alter table public.%I force row level security', r.table_name);

    -- Limpa policies existentes
    for pol in
      select policyname
      from pg_policies
      where schemaname='public'
        and tablename = r.table_name
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, r.table_name);
    end loop;

    -- Policy única service_role
    pol_name := format('rls_%s_service_role_only', r.table_name);
    execute format(
      'create policy %I on public.%I as permissive for all to public using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      pol_name,
      r.table_name
    );
  end loop;
end $$;
