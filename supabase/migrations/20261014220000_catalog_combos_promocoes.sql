-- ADR 0015 — combo de catálogo e promoção com prazo.
-- Preço de venda interno sai de fn_preco_efetivo_*. Marketplace e mesa fechada
-- (itens já snapshotados em table_session_items) não são reprecificados.

create extension if not exists btree_gist with schema extensions;

set search_path = public, extensions;

-- ── tabelas ──────────────────────────────────────────────────────────────────

create table public.combos (
    id            uuid primary key default gen_random_uuid(),
    company_id    uuid not null references public.companies (id) on delete cascade,
    nome          text not null,
    descricao     text,
    image_path    text,
    is_active     boolean not null default false,
    show_on_menu  boolean not null default true,
    preco         numeric(15, 2),
    modo_preco    text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint combos_nome_chk check (char_length(btrim(nome)) between 1 and 120),
    constraint combos_modo_chk check (modo_preco is null or modo_preco in ('pro_rata', 'manual')),
    constraint combos_preco_chk check (preco is null or preco > 0),
    constraint combos_ativo_chk check (is_active = false or preco is not null)
);

create index combos_company_id_idx on public.combos (company_id);

create table public.combo_itens (
    id                       uuid primary key default gen_random_uuid(),
    combo_id                 uuid not null references public.combos (id) on delete cascade,
    produto_embalagem_id     uuid not null references public.produto_embalagens (id) on delete restrict,
    quantidade               integer not null,
    ordem                    integer not null default 0,
    preco_catalogo_snapshot  numeric(15, 2),
    preco_alocado            numeric(15, 2),
    constraint combo_itens_qty_chk check (quantidade >= 1),
    constraint combo_itens_alocado_chk check (preco_alocado is null or preco_alocado > 0),
    constraint combo_itens_emb_uq unique (combo_id, produto_embalagem_id)
);

create index combo_itens_combo_id_idx on public.combo_itens (combo_id);
create index combo_itens_embalagem_id_idx on public.combo_itens (produto_embalagem_id);

create table public.promocoes (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references public.companies (id) on delete cascade,
    nome        text not null,
    starts_at   timestamptz not null,
    ends_at     timestamptz not null,
    paused      boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint promocoes_nome_chk check (char_length(btrim(nome)) between 1 and 120),
    constraint promocoes_janela_chk check (ends_at > starts_at)
);

create index promocoes_company_id_idx on public.promocoes (company_id);

create table public.promocao_alvos (
    id                    uuid primary key default gen_random_uuid(),
    promocao_id           uuid not null references public.promocoes (id) on delete cascade,
    company_id            uuid not null references public.companies (id) on delete cascade,
    combo_id              uuid references public.combos (id) on delete restrict,
    produto_embalagem_id  uuid references public.produto_embalagens (id) on delete restrict,
    alvo_key              text not null,
    starts_at             timestamptz not null,
    ends_at               timestamptz not null,
    preco_promocional     numeric(15, 2) not null,
    preco_base_snapshot   numeric(15, 2) not null,
    constraint promocao_alvos_um_alvo_chk check (
        (combo_id is not null) <> (produto_embalagem_id is not null)
    ),
    constraint promocao_alvos_preco_chk check (
        preco_promocional > 0 and preco_promocional < preco_base_snapshot
    ),
    constraint promocao_alvos_janela_chk check (ends_at > starts_at),
    constraint promocao_alvos_alvo_uq unique (promocao_id, alvo_key),
    constraint promocao_alvos_sem_sobreposicao exclude using gist (
        company_id with =,
        alvo_key with =,
        tstzrange(starts_at, ends_at, '[)') with &&
    )
);

create index promocao_alvos_company_id_idx on public.promocao_alvos (company_id);
create index promocao_alvos_promocao_id_idx on public.promocao_alvos (promocao_id);
create index promocao_alvos_emb_idx on public.promocao_alvos (produto_embalagem_id);
create index promocao_alvos_combo_idx on public.promocao_alvos (combo_id);

alter table public.order_items
    add column if not exists combo_id uuid references public.combos (id) on delete restrict,
    add column if not exists promocao_id uuid references public.promocoes (id) on delete restrict,
    add column if not exists combo_label text;

create index if not exists order_items_combo_id_idx
    on public.order_items (combo_id) where combo_id is not null;

alter table public.table_session_items
    add column if not exists combo_id uuid references public.combos (id) on delete restrict,
    add column if not exists promocao_id uuid references public.promocoes (id) on delete restrict,
    add column if not exists combo_label text;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.combos enable row level security;
alter table public.combos force row level security;
alter table public.combo_itens enable row level security;
alter table public.combo_itens force row level security;
alter table public.promocoes enable row level security;
alter table public.promocoes force row level security;
alter table public.promocao_alvos enable row level security;
alter table public.promocao_alvos force row level security;

revoke all on table public.combos from anon, authenticated;
revoke all on table public.combo_itens from anon, authenticated;
revoke all on table public.promocoes from anon, authenticated;
revoke all on table public.promocao_alvos from anon, authenticated;

create policy rls_combos_service_role_only on public.combos
    as permissive for all to public
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

create policy rls_combo_itens_service_role_only on public.combo_itens
    as permissive for all to public
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

create policy rls_promocoes_service_role_only on public.promocoes
    as permissive for all to public
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

create policy rls_promocao_alvos_service_role_only on public.promocao_alvos
    as permissive for all to public
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

-- ── rateio ───────────────────────────────────────────────────────────────────

create or replace function public.fn_ratear_preco(p_partes numeric[], p_alvo numeric)
returns numeric[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
    v_n          int;
    v_i          int;
    v_sum_cents  bigint := 0;
    v_alvo_cents bigint;
    v_part_cents bigint;
    v_alloc      bigint[];
    v_acc        bigint := 0;
    v_remain     bigint;
    v_max_idx    int;
    v_max        bigint;
    v_out        numeric[] := array[]::numeric[];
begin
    if p_partes is null or cardinality(p_partes) = 0 then
        raise exception 'rateio_sem_partes' using errcode = 'check_violation';
    end if;
    if p_alvo is null or round(p_alvo, 2) <= 0 then
        raise exception 'rateio_alvo_invalido' using errcode = 'check_violation';
    end if;
    v_n := cardinality(p_partes);
    v_alvo_cents := (round(p_alvo, 2) * 100)::bigint;
    for v_i in 1..v_n loop
        if p_partes[v_i] is null or round(p_partes[v_i], 2) <= 0 then
            raise exception 'rateio_parte_invalida' using errcode = 'check_violation';
        end if;
        v_part_cents := (round(p_partes[v_i], 2) * 100)::bigint;
        v_sum_cents := v_sum_cents + v_part_cents;
        v_alloc := array_append(v_alloc, 0::bigint);
    end loop;
    if v_sum_cents <= 0 then
        raise exception 'rateio_soma_invalida' using errcode = 'check_violation';
    end if;
    for v_i in 1..v_n loop
        v_part_cents := (round(p_partes[v_i], 2) * 100)::bigint;
        v_alloc[v_i] := (v_alvo_cents * v_part_cents) / v_sum_cents;
        v_acc := v_acc + v_alloc[v_i];
    end loop;
    v_remain := v_alvo_cents - v_acc;
    while v_remain > 0 loop
        v_max_idx := 1;
        v_max := (round(p_partes[1], 2) * 100)::bigint;
        for v_i in 2..v_n loop
            v_part_cents := (round(p_partes[v_i], 2) * 100)::bigint;
            if v_part_cents > v_max then
                v_max := v_part_cents;
                v_max_idx := v_i;
            end if;
        end loop;
        v_alloc[v_max_idx] := v_alloc[v_max_idx] + 1;
        v_remain := v_remain - 1;
    end loop;
    for v_i in 1..v_n loop
        v_out := array_append(v_out, round(v_alloc[v_i]::numeric / 100, 2));
    end loop;
    return v_out;
end;
$$;

revoke all on function public.fn_ratear_preco(numeric[], numeric) from public, anon, authenticated;
grant execute on function public.fn_ratear_preco(numeric[], numeric) to service_role;

create or replace function public.fn_assert_combo_preco()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_combo uuid;
    v_preco numeric(15, 2);
    v_sum   numeric(15, 2);
    v_nulos int;
begin
    if tg_table_name = 'combos' then
        v_combo := new.id;
    else
        v_combo := new.combo_id;
    end if;
    select c.preco into v_preco from public.combos c where c.id = v_combo;
    if v_preco is null then
        return new;
    end if;
    select
        coalesce(sum(ci.preco_alocado), 0),
        count(*) filter (where ci.preco_alocado is null)
      into v_sum, v_nulos
      from public.combo_itens ci
     where ci.combo_id = v_combo;
    if v_nulos > 0 or v_sum <> v_preco then
        raise exception 'combo_preco_nao_fecha' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

revoke all on function public.fn_assert_combo_preco() from public, anon, authenticated;

create constraint trigger trg_combo_preco_fecha_itens
    after insert or update on public.combo_itens
    deferrable initially deferred
    for each row execute function public.fn_assert_combo_preco();

create constraint trigger trg_combo_preco_fecha_cab
    after update of preco on public.combos
    deferrable initially deferred
    for each row execute function public.fn_assert_combo_preco();

-- ── preço efetivo e estoque do combo ─────────────────────────────────────────

create or replace function public.fn_preco_efetivo_embalagem(
    p_embalagem_id uuid,
    p_em timestamptz default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_em    timestamptz := coalesce(p_em, now());
    v_promo numeric(15, 2);
    v_base  numeric(15, 2);
begin
    select pe.preco_venda into v_base
      from public.produto_embalagens pe
     where pe.id = p_embalagem_id;
    if v_base is null then
        return null;
    end if;
    select pa.preco_promocional into v_promo
      from public.promocao_alvos pa
      join public.promocoes pr on pr.id = pa.promocao_id
     where pa.produto_embalagem_id = p_embalagem_id
       and pr.paused = false
       and pr.starts_at <= v_em
       and pr.ends_at > v_em
     limit 1;
    return coalesce(v_promo, v_base);
end;
$$;

create or replace function public.fn_preco_efetivo_combo(
    p_combo_id uuid,
    p_em timestamptz default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_em    timestamptz := coalesce(p_em, now());
    v_promo numeric(15, 2);
    v_base  numeric(15, 2);
begin
    select c.preco into v_base from public.combos c where c.id = p_combo_id;
    if v_base is null then
        return null;
    end if;
    select pa.preco_promocional into v_promo
      from public.promocao_alvos pa
      join public.promocoes pr on pr.id = pa.promocao_id
     where pa.combo_id = p_combo_id
       and pr.paused = false
       and pr.starts_at <= v_em
       and pr.ends_at > v_em
     limit 1;
    return coalesce(v_promo, v_base);
end;
$$;

revoke all on function public.fn_preco_efetivo_embalagem(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_preco_efetivo_combo(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_preco_efetivo_embalagem(uuid, timestamptz) to service_role;
grant execute on function public.fn_preco_efetivo_combo(uuid, timestamptz) to service_role;

create or replace function public.fn_combo_disponivel(p_combo_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_min integer := null;
    r record;
    v_est numeric;
    v_un  integer;
begin
    for r in
        select
            ci.quantidade,
            greatest(1, coalesce(pe.fator_conversao, 1)) as fator,
            coalesce(p.vender_com_estoque_zero, true) as vender_zero,
            coalesce(
                pv.estoque_atual,
                (
                    select pv2.estoque_atual
                      from public.product_volumes pv2
                     where pv2.product_id = pe.produto_id
                     order by pv2.volume_quantidade nulls last
                     limit 1
                ),
                0
            ) as estoque
          from public.combo_itens ci
          join public.produto_embalagens pe on pe.id = ci.produto_embalagem_id
          join public.products p on p.id = pe.produto_id
          left join public.product_volumes pv on pv.id = pe.product_volume_id
         where ci.combo_id = p_combo_id
    loop
        if r.vender_zero then
            continue;
        end if;
        v_est := coalesce(r.estoque, 0);
        v_un := floor(v_est / r.fator / r.quantidade)::integer;
        if v_un < 0 then
            v_un := 0;
        end if;
        if v_min is null or v_un < v_min then
            v_min := v_un;
        end if;
    end loop;
    return v_min;
end;
$$;

revoke all on function public.fn_combo_disponivel(uuid) from public, anon, authenticated;
grant execute on function public.fn_combo_disponivel(uuid) to service_role;

create or replace function public.fn_promocao_id_ativa(
    p_embalagem_id uuid,
    p_combo_id uuid,
    p_em timestamptz
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select pr.id
      from public.promocao_alvos pa
      join public.promocoes pr on pr.id = pa.promocao_id
     where pr.paused = false
       and pr.starts_at <= p_em
       and pr.ends_at > p_em
       and (
            (p_embalagem_id is not null and pa.produto_embalagem_id = p_embalagem_id)
         or (p_combo_id is not null and pa.combo_id = p_combo_id)
       )
     limit 1;
$$;

revoke all on function public.fn_promocao_id_ativa(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_promocao_id_ativa(uuid, uuid, timestamptz) to service_role;

-- Linhas de venda. p_allow_texto: linha sem embalagem nem combo preserva o preço informado
-- (pedido admin com item livre). Catálogo ignora unit_price do cliente.
create or replace function public.fn_expand_sale_lines(
    p_company_id uuid,
    p_items jsonb,
    p_allow_texto boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_em       timestamptz := now();
    v_out      jsonb := '[]'::jsonb;
    v_item     jsonb;
    v_qty      integer;
    v_emb      uuid;
    v_combo    uuid;
    v_nome     text;
    v_sigla    text;
    v_pid      uuid;
    v_price    numeric(15, 2);
    v_promo    uuid;
    v_label    text;
    v_shares   numeric[];
    v_i        integer;
    v_n        integer;
    v_share    numeric(15, 2);
    v_cents    bigint;
    v_units    integer;
    v_base     bigint;
    v_rem      bigint;
    v_unit     text;
    r          record;
    v_disp     integer;
    v_active   boolean;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'pedido não pode ser criado sem itens' using errcode = 'check_violation';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
        v_qty := greatest(
            coalesce((v_item ->> 'quantity')::integer, (v_item ->> 'qty')::integer, 0),
            0
        );
        if v_qty < 1 then
            raise exception 'quantidade_invalida' using errcode = 'check_violation';
        end if;

        v_emb := nullif(trim(coalesce(v_item ->> 'produto_embalagem_id', '')), '')::uuid;
        v_combo := nullif(trim(coalesce(v_item ->> 'combo_id', '')), '')::uuid;
        if v_emb is null and v_combo is null then
            v_emb := nullif(trim(coalesce(v_item ->> 'variant_id', '')), '')::uuid;
        end if;

        if v_emb is not null and v_combo is not null then
            raise exception 'item_alvo_duplo' using errcode = 'check_violation';
        end if;

        if v_emb is null and v_combo is null then
            if not p_allow_texto then
                raise exception 'item_sem_catalogo' using errcode = 'check_violation';
            end if;
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'produto_embalagem_id', null,
                'produto_id', null,
                'product_name', coalesce(v_item ->> 'product_name', ''),
                'quantity', v_qty,
                'qty', v_qty,
                'unit_price', round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2),
                'unit_type', coalesce(nullif(trim(v_item ->> 'unit_type'), ''), 'unit'),
                'sigla_comercial', coalesce(nullif(trim(v_item ->> 'sigla_comercial'), ''), 'UN'),
                'combo_id', null,
                'promocao_id', null,
                'combo_label', null
            ));
            continue;
        end if;

        if v_emb is not null and not exists (
            select 1 from public.produto_embalagens pe
             where pe.id = v_emb and pe.company_id = p_company_id
        ) then
            if exists (
                select 1 from public.combos c
                 where c.id = v_emb and c.company_id = p_company_id
            ) then
                v_combo := v_emb;
                v_emb := null;
            else
                raise exception 'produto_embalagem_not_in_company' using errcode = 'check_violation';
            end if;
        end if;

        if v_emb is not null then
            select
                coalesce(nullif(trim(p.name), ''), 'Produto')
                    || case
                        when upper(coalesce(sc.sigla, 'UN')) in ('UN', 'UND', 'UNID') then ''
                        else ' (' || sc.sigla || ')'
                       end,
                coalesce(sc.sigla, 'UN'),
                pe.produto_id,
                case when upper(coalesce(sc.sigla, 'UN')) = 'CX' then 'case' else 'unit' end
              into v_nome, v_sigla, v_pid, v_unit
              from public.produto_embalagens pe
              join public.products p on p.id = pe.produto_id
              left join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
             where pe.id = v_emb;

            v_price := public.fn_preco_efetivo_embalagem(v_emb, v_em);
            v_promo := public.fn_promocao_id_ativa(v_emb, null, v_em);
            if v_price is null or v_price <= 0 then
                raise exception 'preco_indisponivel' using errcode = 'check_violation';
            end if;
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'produto_embalagem_id', v_emb,
                'produto_id', v_pid,
                'product_name', v_nome,
                'quantity', v_qty,
                'qty', v_qty,
                'unit_price', v_price,
                'unit_type', v_unit,
                'sigla_comercial', v_sigla,
                'combo_id', null,
                'promocao_id', v_promo,
                'combo_label', null
            ));
            continue;
        end if;

        select c.nome, c.preco, c.is_active
          into v_label, v_price, v_active
          from public.combos c
         where c.id = v_combo and c.company_id = p_company_id;
        if not found then
            raise exception 'combo_not_in_company' using errcode = 'check_violation';
        end if;
        if v_price is null or v_active is distinct from true then
            raise exception 'combo_indisponivel' using errcode = 'check_violation';
        end if;

        v_disp := public.fn_combo_disponivel(v_combo);
        if v_disp is not null and v_disp < v_qty then
            raise exception 'combo_sem_estoque' using errcode = 'check_violation';
        end if;

        v_promo := public.fn_promocao_id_ativa(null, v_combo, v_em);
        if v_promo is not null then
            select coalesce(array_agg(ci.preco_alocado order by ci.ordem, ci.id), array[]::numeric[])
              into v_shares
              from public.combo_itens ci
             where ci.combo_id = v_combo;
            v_shares := public.fn_ratear_preco(v_shares, public.fn_preco_efetivo_combo(v_combo, v_em));
        end if;

        v_i := 0;
        for r in
            select
                ci.produto_embalagem_id,
                ci.quantidade,
                ci.preco_alocado,
                pe.produto_id,
                coalesce(nullif(trim(p.name), ''), 'Produto')
                    || case
                        when upper(coalesce(sc.sigla, 'UN')) in ('UN', 'UND', 'UNID') then ''
                        else ' (' || sc.sigla || ')'
                       end as nome,
                coalesce(sc.sigla, 'UN') as sigla
              from public.combo_itens ci
              join public.produto_embalagens pe on pe.id = ci.produto_embalagem_id
              join public.products p on p.id = pe.produto_id
              left join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
             where ci.combo_id = v_combo
             order by ci.ordem, ci.id
        loop
            v_i := v_i + 1;
            v_share := case when v_promo is not null then v_shares[v_i] else r.preco_alocado end;
            v_cents := (round(v_share, 2) * 100)::bigint * v_qty;
            v_units := r.quantidade * v_qty;
            if v_units < 1 or v_cents < v_units then
                raise exception 'rateio_centavo_insuficiente' using errcode = 'check_violation';
            end if;
            v_base := v_cents / v_units;
            v_rem := v_cents - (v_base * v_units);
            v_unit := case when upper(r.sigla) = 'CX' then 'case' else 'unit' end;
            if v_units - v_rem > 0 then
                v_out := v_out || jsonb_build_array(jsonb_build_object(
                    'produto_embalagem_id', r.produto_embalagem_id,
                    'produto_id', r.produto_id,
                    'product_name', r.nome,
                    'quantity', v_units - v_rem,
                    'qty', v_units - v_rem,
                    'unit_price', round(v_base::numeric / 100, 2),
                    'unit_type', v_unit,
                    'sigla_comercial', r.sigla,
                    'combo_id', v_combo,
                    'promocao_id', v_promo,
                    'combo_label', v_label
                ));
            end if;
            if v_rem > 0 then
                v_out := v_out || jsonb_build_array(jsonb_build_object(
                    'produto_embalagem_id', r.produto_embalagem_id,
                    'produto_id', r.produto_id,
                    'product_name', r.nome,
                    'quantity', v_rem,
                    'qty', v_rem,
                    'unit_price', round((v_base + 1)::numeric / 100, 2),
                    'unit_type', v_unit,
                    'sigla_comercial', r.sigla,
                    'combo_id', v_combo,
                    'promocao_id', v_promo,
                    'combo_label', v_label
                ));
            end if;
        end loop;
        if v_i = 0 then
            raise exception 'combo_sem_itens' using errcode = 'check_violation';
        end if;
    end loop;

    return v_out;
end;
$$;

revoke all on function public.fn_expand_sale_lines(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.fn_expand_sale_lines(uuid, jsonb, boolean) to service_role;

create or replace function public.rpc_quote_sale_lines(p_company_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_lines jsonb;
    v_sum   numeric(15, 2);
begin
    v_lines := public.fn_expand_sale_lines(p_company_id, p_items, false);
    select coalesce(sum((x ->> 'quantity')::numeric * (x ->> 'unit_price')::numeric), 0)
      into v_sum
      from jsonb_array_elements(v_lines) x;
    return jsonb_build_object('lines', v_lines, 'subtotal', v_sum);
end;
$$;

revoke all on function public.rpc_quote_sale_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_quote_sale_lines(uuid, jsonb) to service_role;

-- ── escrita de combo e promoção ──────────────────────────────────────────────

create or replace function public.rpc_set_product_show_on_menu(
    p_company_id uuid,
    p_product_id uuid,
    p_value boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.products
       set show_on_menu = coalesce(p_value, true)
     where id = p_product_id
       and company_id = p_company_id;
    if not found then
        raise exception 'product_not_in_company' using errcode = 'check_violation';
    end if;
end;
$$;

revoke all on function public.rpc_set_product_show_on_menu(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rpc_set_product_show_on_menu(uuid, uuid, boolean) to service_role;

create or replace function public.rpc_upsert_combo(p_company_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id       uuid := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;
    v_nome     text := btrim(coalesce(p_payload ->> 'nome', ''));
    v_desc     text := nullif(btrim(coalesce(p_payload ->> 'descricao', '')), '');
    v_img      text := nullif(btrim(coalesce(p_payload ->> 'image_path', '')), '');
    v_show     boolean := coalesce((p_payload ->> 'show_on_menu')::boolean, true);
    v_itens    jsonb := p_payload -> 'itens';
    v_count    int;
    v_same     boolean := false;
    v_row      jsonb;
    v_emb      uuid;
    v_qty      int;
    v_ord      int := 0;
    v_snap     numeric(15, 2);
begin
    if char_length(v_nome) < 1 or char_length(v_nome) > 120 then
        raise exception 'combo_nome_invalido' using errcode = 'check_violation';
    end if;
    if v_itens is null or jsonb_typeof(v_itens) <> 'array' then
        raise exception 'combo_sem_itens' using errcode = 'check_violation';
    end if;
    v_count := jsonb_array_length(v_itens);
    if v_count < 1 or v_count > 20 then
        raise exception 'combo_itens_fora_do_limite' using errcode = 'check_violation';
    end if;

    if v_id is not null and not exists (
        select 1 from public.combos c where c.id = v_id and c.company_id = p_company_id
    ) then
        raise exception 'combo_not_in_company' using errcode = 'check_violation';
    end if;

    if v_id is null then
        insert into public.combos (company_id, nome, descricao, image_path, show_on_menu, is_active)
        values (p_company_id, v_nome, v_desc, v_img, v_show, false)
        returning id into v_id;
    else
        select not exists (
            select 1
              from jsonb_array_elements(v_itens) elem
              full join public.combo_itens ci
                on ci.combo_id = v_id
               and ci.produto_embalagem_id = nullif(trim(elem ->> 'produto_embalagem_id'), '')::uuid
               and ci.quantidade = coalesce((elem ->> 'quantidade')::integer, 0)
             where ci.id is null
                or elem is null
        ) into v_same;

        update public.combos
           set nome = v_nome,
               descricao = v_desc,
               image_path = v_img,
               show_on_menu = v_show,
               updated_at = now(),
               preco = case when v_same then preco else null end,
               modo_preco = case when v_same then modo_preco else null end,
               is_active = case when v_same then is_active else false end
         where id = v_id
           and company_id = p_company_id;

        if v_same then
            return v_id;
        end if;
        delete from public.combo_itens where combo_id = v_id;
    end if;

    for v_row in select value from jsonb_array_elements(v_itens)
    loop
        v_emb := nullif(trim(coalesce(v_row ->> 'produto_embalagem_id', '')), '')::uuid;
        v_qty := coalesce((v_row ->> 'quantidade')::integer, 0);
        if v_emb is null or v_qty < 1 then
            raise exception 'combo_item_invalido' using errcode = 'check_violation';
        end if;
        select pe.preco_venda into v_snap
          from public.produto_embalagens pe
         where pe.id = v_emb
           and pe.company_id = p_company_id
           and pe.preco_venda > 0;
        if v_snap is null then
            raise exception 'produto_embalagem_not_in_company' using errcode = 'check_violation';
        end if;
        insert into public.combo_itens (
            combo_id, produto_embalagem_id, quantidade, ordem, preco_catalogo_snapshot
        ) values (v_id, v_emb, v_qty, v_ord, v_snap);
        v_ord := v_ord + 1;
    end loop;

    return v_id;
end;
$$;

revoke all on function public.rpc_upsert_combo(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_upsert_combo(uuid, jsonb) to service_role;

create or replace function public.rpc_precificar_combo(p_company_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id    uuid := nullif(trim(coalesce(p_payload ->> 'combo_id', '')), '')::uuid;
    v_modo  text := lower(btrim(coalesce(p_payload ->> 'modo', '')));
    v_preco numeric(15, 2);
    v_parts numeric[];
    v_alloc numeric[];
    v_i     int := 0;
    r       record;
    v_unit  numeric(15, 2);
    v_share numeric(15, 2);
    v_sum   numeric(15, 2) := 0;
begin
    if v_id is null or not exists (
        select 1 from public.combos c where c.id = v_id and c.company_id = p_company_id
    ) then
        raise exception 'combo_not_in_company' using errcode = 'check_violation';
    end if;
    if v_modo not in ('pro_rata', 'manual') then
        raise exception 'modo_preco_invalido' using errcode = 'check_violation';
    end if;

    update public.combo_itens ci
       set preco_catalogo_snapshot = pe.preco_venda
      from public.produto_embalagens pe
     where ci.combo_id = v_id
       and pe.id = ci.produto_embalagem_id
       and pe.company_id = p_company_id
       and pe.preco_venda > 0;

    if v_modo = 'pro_rata' then
        v_preco := round(coalesce((p_payload ->> 'preco')::numeric, 0), 2);
        select coalesce(array_agg(
            round(ci.preco_catalogo_snapshot * ci.quantidade, 2)
            order by ci.ordem, ci.id
        ), array[]::numeric[])
          into v_parts
          from public.combo_itens ci
         where ci.combo_id = v_id;
        if cardinality(v_parts) = 0 then
            raise exception 'combo_sem_itens' using errcode = 'check_violation';
        end if;
        if v_preco <= 0 or v_preco > (select coalesce(sum(x), 0) from unnest(v_parts) x) then
            raise exception 'combo_preco_acima_do_catalogo' using errcode = 'check_violation';
        end if;
        v_alloc := public.fn_ratear_preco(v_parts, v_preco);
        for r in
            select ci.id, ci.quantidade
              from public.combo_itens ci
             where ci.combo_id = v_id
             order by ci.ordem, ci.id
        loop
            v_i := v_i + 1;
            v_share := v_alloc[v_i];
            if v_share < (r.quantidade::numeric * 0.01) then
                raise exception 'rateio_centavo_insuficiente' using errcode = 'check_violation';
            end if;
            update public.combo_itens
               set preco_alocado = v_share,
                   preco_catalogo_snapshot = (
                       select pe.preco_venda
                         from public.produto_embalagens pe
                        where pe.id = combo_itens.produto_embalagem_id
                   )
             where id = r.id;
        end loop;
    else
        for r in
            select ci.id, ci.produto_embalagem_id, ci.quantidade
              from public.combo_itens ci
             where ci.combo_id = v_id
             order by ci.ordem, ci.id
        loop
            select round((elem ->> 'preco_unitario')::numeric, 2)
              into v_unit
              from jsonb_array_elements(coalesce(p_payload -> 'itens', '[]'::jsonb)) elem
             where nullif(trim(elem ->> 'produto_embalagem_id'), '')::uuid = r.produto_embalagem_id
             limit 1;
            if v_unit is null or v_unit <= 0 then
                raise exception 'preco_unitario_invalido' using errcode = 'check_violation';
            end if;
            v_share := round(v_unit * r.quantidade, 2);
            v_sum := v_sum + v_share;
            update public.combo_itens
               set preco_alocado = v_share,
                   preco_catalogo_snapshot = (
                       select pe.preco_venda
                         from public.produto_embalagens pe
                        where pe.id = combo_itens.produto_embalagem_id
                   )
             where id = r.id;
        end loop;
        v_preco := v_sum;
        if v_preco <= 0 then
            raise exception 'combo_preco_invalido' using errcode = 'check_violation';
        end if;
    end if;

    update public.combos
       set preco = v_preco,
           modo_preco = v_modo,
           is_active = coalesce((p_payload ->> 'is_active')::boolean, true),
           updated_at = now()
     where id = v_id
       and company_id = p_company_id;

    return v_id;
end;
$$;

revoke all on function public.rpc_precificar_combo(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_precificar_combo(uuid, jsonb) to service_role;

create or replace function public.rpc_upsert_promocao(p_company_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id     uuid := nullif(trim(coalesce(p_payload ->> 'id', '')), '')::uuid;
    v_nome   text := btrim(coalesce(p_payload ->> 'nome', ''));
    v_start  timestamptz := (p_payload ->> 'starts_at')::timestamptz;
    v_end    timestamptz := (p_payload ->> 'ends_at')::timestamptz;
    v_paused boolean := coalesce((p_payload ->> 'paused')::boolean, false);
    v_alvos  jsonb := p_payload -> 'alvos';
    v_row    jsonb;
    v_emb    uuid;
    v_combo  uuid;
    v_preco  numeric(15, 2);
    v_base   numeric(15, 2);
    v_key    text;
begin
    if char_length(v_nome) < 1 then
        raise exception 'promocao_nome_invalido' using errcode = 'check_violation';
    end if;
    if v_start is null or v_end is null or v_end <= v_start then
        raise exception 'promocao_janela_invalida' using errcode = 'check_violation';
    end if;
    if v_alvos is null or jsonb_typeof(v_alvos) <> 'array' or jsonb_array_length(v_alvos) < 1 then
        raise exception 'promocao_sem_alvos' using errcode = 'check_violation';
    end if;

    if v_id is null then
        insert into public.promocoes (company_id, nome, starts_at, ends_at, paused)
        values (p_company_id, v_nome, v_start, v_end, v_paused)
        returning id into v_id;
    else
        if not exists (
            select 1 from public.promocoes p where p.id = v_id and p.company_id = p_company_id
        ) then
            raise exception 'promocao_not_in_company' using errcode = 'check_violation';
        end if;
        delete from public.promocao_alvos where promocao_id = v_id;
        update public.promocoes
           set nome = v_nome,
               starts_at = v_start,
               ends_at = v_end,
               paused = v_paused,
               updated_at = now()
         where id = v_id;
    end if;

    for v_row in select value from jsonb_array_elements(v_alvos)
    loop
        v_emb := nullif(trim(coalesce(v_row ->> 'produto_embalagem_id', '')), '')::uuid;
        v_combo := nullif(trim(coalesce(v_row ->> 'combo_id', '')), '')::uuid;
        v_preco := round(coalesce((v_row ->> 'preco_promocional')::numeric, 0), 2);
        if (v_emb is null) = (v_combo is null) then
            raise exception 'promocao_alvo_invalido' using errcode = 'check_violation';
        end if;
        if v_emb is not null then
            select pe.preco_venda into v_base
              from public.produto_embalagens pe
             where pe.id = v_emb and pe.company_id = p_company_id;
            v_key := 'emb:' || v_emb::text;
        else
            select c.preco into v_base
              from public.combos c
             where c.id = v_combo and c.company_id = p_company_id and c.preco is not null;
            v_key := 'combo:' || v_combo::text;
        end if;
        if v_base is null or v_preco <= 0 or v_preco >= v_base then
            raise exception 'promocao_preco_invalido' using errcode = 'check_violation';
        end if;
        insert into public.promocao_alvos (
            promocao_id, company_id, combo_id, produto_embalagem_id, alvo_key,
            starts_at, ends_at, preco_promocional, preco_base_snapshot
        ) values (
            v_id, p_company_id, v_combo, v_emb, v_key,
            v_start, v_end, v_preco, v_base
        );
    end loop;

    return v_id;
exception
    when exclusion_violation then
        raise exception 'promocao_sobrepoe' using errcode = 'check_violation';
end;
$$;

revoke all on function public.rpc_upsert_promocao(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_upsert_promocao(uuid, jsonb) to service_role;

create or replace function public.rpc_search_chat_combos(p_company_id uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_q text := btrim(coalesce(p_query, ''));
begin
    if char_length(v_q) < 2 then
        return '[]'::jsonb;
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', c.id,
            'nome', c.nome,
            'descricao', c.descricao,
            'preco', public.fn_preco_efetivo_combo(c.id, now()),
            'preco_catalogo', c.preco,
            'disponivel', public.fn_combo_disponivel(c.id),
            'promocao_ends_at', (
                select pr.ends_at
                  from public.promocao_alvos pa
                  join public.promocoes pr on pr.id = pa.promocao_id
                 where pa.combo_id = c.id
                   and pr.paused = false
                   and pr.starts_at <= now()
                   and pr.ends_at > now()
                 limit 1
            )
        ) order by c.nome)
          from public.combos c
         where c.company_id = p_company_id
           and c.is_active = true
           and c.preco is not null
           and c.nome ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
         limit 8
    ), '[]'::jsonb);
end;
$$;

revoke all on function public.rpc_search_chat_combos(uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_search_chat_combos(uuid, text) to service_role;

-- ── views de leitura (service_role) ──────────────────────────────────────────

create or replace view public.v_sec_combos
with (security_invoker = true) as
select
    c.id,
    c.company_id,
    c.nome,
    c.descricao,
    c.image_path,
    c.is_active,
    c.show_on_menu,
    c.preco,
    c.modo_preco,
    c.updated_at,
    public.fn_preco_efetivo_combo(c.id, now()) as preco_efetivo,
    public.fn_combo_disponivel(c.id) as disponivel,
    coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', ci.id,
            'produto_embalagem_id', ci.produto_embalagem_id,
            'quantidade', ci.quantidade,
            'ordem', ci.ordem,
            'preco_catalogo_snapshot', ci.preco_catalogo_snapshot,
            'preco_alocado', ci.preco_alocado,
            'preco_venda_atual', pe.preco_venda,
            'nome', p.name,
            'sigla', sc.sigla,
            'divergiu', ci.preco_catalogo_snapshot is distinct from pe.preco_venda
        ) order by ci.ordem, ci.id)
          from public.combo_itens ci
          join public.produto_embalagens pe on pe.id = ci.produto_embalagem_id
          join public.products p on p.id = pe.produto_id
          left join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
         where ci.combo_id = c.id
    ), '[]'::jsonb) as itens
  from public.combos c;

create or replace view public.v_sec_promocoes
with (security_invoker = true) as
select
    p.id,
    p.company_id,
    p.nome,
    p.starts_at,
    p.ends_at,
    p.paused,
    p.updated_at,
    case
        when p.paused then 'pausada'
        when now() < p.starts_at then 'agendada'
        when now() >= p.ends_at then 'expirada'
        else 'ativa'
    end as status,
    coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', pa.id,
            'combo_id', pa.combo_id,
            'produto_embalagem_id', pa.produto_embalagem_id,
            'preco_promocional', pa.preco_promocional,
            'preco_base_snapshot', pa.preco_base_snapshot,
            'nome', coalesce(c.nome, pr.name)
        ))
          from public.promocao_alvos pa
          left join public.combos c on c.id = pa.combo_id
          left join public.produto_embalagens pe on pe.id = pa.produto_embalagem_id
          left join public.products pr on pr.id = pe.produto_id
         where pa.promocao_id = p.id
    ), '[]'::jsonb) as alvos
  from public.promocoes p;

create or replace view public.v_sec_preco_efetivo_embalagem
with (security_invoker = true) as
select
    pe.id,
    pe.company_id,
    pe.preco_venda,
    public.fn_preco_efetivo_embalagem(pe.id, now()) as preco_efetivo,
    (
        select pr.ends_at
          from public.promocao_alvos pa
          join public.promocoes pr on pr.id = pa.promocao_id
         where pa.produto_embalagem_id = pe.id
           and pr.paused = false
           and pr.starts_at <= now()
           and pr.ends_at > now()
         limit 1
    ) as promo_ends_at
  from public.produto_embalagens pe;

revoke all on table public.v_sec_combos from public, anon, authenticated;
revoke all on table public.v_sec_promocoes from public, anon, authenticated;
revoke all on table public.v_sec_preco_efetivo_embalagem from public, anon, authenticated;
grant select on table public.v_sec_combos to service_role;
grant select on table public.v_sec_promocoes to service_role;
grant select on table public.v_sec_preco_efetivo_embalagem to service_role;

comment on table public.combos is
    'ADR 0015. Kit vendável sem promoção. preco_alocado nas linhas soma combos.preco.';
comment on table public.promocoes is
    'ADR 0015. Janela de preço. Não reescreve produto_embalagens.preco_venda.';
