-- Unique codigo_interno por empresa; EAN da CX + unit_type_sigla na lista; RPC geração hardened.

-- 1) Dedup: mantém o mais antigo; demais ganham sufixo -{8 chars do id}
with ranked as (
  select
    id,
    company_id,
    codigo_interno,
    row_number() over (
      partition by company_id, lower(btrim(codigo_interno))
      order by created_at nulls last, id
    ) as rn
  from public.produto_embalagens
  where codigo_interno is not null
    and btrim(codigo_interno) <> ''
)
update public.produto_embalagens pe
   set codigo_interno = pe.codigo_interno || '-' || substr(replace(pe.id::text, '-', ''), 1, 8)
  from ranked r
 where pe.id = r.id
   and r.rn > 1;

create unique index if not exists uq_produto_embalagens_company_codigo_interno
  on public.produto_embalagens (company_id, lower(btrim(codigo_interno)))
  where codigo_interno is not null and btrim(codigo_interno) <> '';

create index if not exists idx_produto_embalagens_company_codigo_interno
  on public.produto_embalagens (company_id, codigo_interno)
  where codigo_interno is not null and btrim(codigo_interno) <> '';

-- 2) View lista: case EAN + sigla de volume (DROP para poder inserir colunas no meio)
drop view if exists public.view_produtos_lista;

create view public.view_produtos_lista as
with un_packs as (
  select pe.id, pe.company_id, pe.produto_id, pe.descricao, pe.fator_conversao,
         pe.preco_venda, pe.preco_custo, pe.tags, pe.codigo_barras_ean,
         pe.is_acompanhamento, pe.codigo_interno, pe.id_sigla_comercial,
         pe.id_unit_type, pe.volume_quantidade, pe.product_volume_id,
         sc.sigla as sigla_comercial, ut.sigla as unit_type_sigla,
         coalesce(pe.is_active, true) as item_is_active
  from public.produto_embalagens pe
  join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
  left join public.unit_types ut on ut.id = pe.id_unit_type
  where upper(sc.sigla::text) = any (array['UN'::text, 'UNIDADE'::text])
),
case_packs as (
  select distinct on (pe.produto_id)
    pe.id as case_id, pe.produto_id, pe.descricao as case_details,
    pe.fator_conversao as case_qty, pe.preco_venda as case_price,
    pe.id_sigla_comercial as case_sigla_id, pe.codigo_interno as case_codigo_interno,
    pe.codigo_barras_ean as case_codigo_barras_ean,
    coalesce(pe.is_active, true) as case_is_active
  from public.produto_embalagens pe
  join public.siglas_comerciais sc on sc.id = pe.id_sigla_comercial
  where upper(sc.sigla::text) = any (array['CX'::text, 'CAIXA'::text, 'FARD'::text, 'PAC'::text])
  order by pe.produto_id, (
    case upper(sc.sigla::text)
      when 'CX'::text then 1 when 'CAIXA'::text then 2 when 'FARD'::text then 3 else 4
    end
  ), pe.is_active desc
)
select
  un.company_id, un.id, un.produto_id as product_id, un.descricao as details,
  un.id_unit_type, un.volume_quantidade as volume_value,
  un.unit_type_sigla,
  case
    when un.volume_quantidade is not null and un.unit_type_sigla is not null
      then trim(un.volume_quantidade::text || ' ' || un.unit_type_sigla::text)
    when un.volume_quantidade is not null
      then un.volume_quantidade::text
    else null
  end as volume_formatado,
  case
    when un.unit_type_sigla::text = 'L'::text then 'l'::text
    when un.unit_type_sigla::text = any (array['ml'::character varying, 'kg'::character varying, 'm'::character varying]::text[])
      then lower(un.unit_type_sigla::text)
    else 'none'::text
  end as unit,
  un.preco_venda as unit_price,
  coalesce(un.preco_custo, p.preco_custo_unitario) as cost_price,
  un.tags, un.codigo_barras_ean, un.is_acompanhamento, un.codigo_interno,
  case when cp.case_id is not null then true else false end as has_case,
  cp.case_id, cp.case_qty, cp.case_price, cp.case_details, cp.case_sigla_id,
  cp.case_codigo_interno, cp.case_codigo_barras_ean,
  p.is_active, p.name as product_name, p.category_id, c.name as category_name,
  un.product_volume_id,
  coalesce(pv.estoque_atual, 0::numeric) as estoque_un,
  case
    when cp.case_qty is not null and cp.case_qty > 0::numeric
      then floor(coalesce(pv.estoque_atual, 0::numeric) / cp.case_qty)
    else null::numeric
  end as estoque_cx,
  coalesce(p.vender_com_estoque_zero, true) as vender_com_estoque_zero,
  un.item_is_active,
  coalesce(cp.case_is_active, true) as case_is_active
from un_packs un
join public.products p on p.id = un.produto_id
left join public.categories c on c.id = p.category_id
left join case_packs cp on cp.produto_id = un.produto_id
left join public.product_volumes pv on pv.id = un.product_volume_id;

revoke all on public.view_produtos_lista from anon;
grant select on public.view_produtos_lista to authenticated;
grant select on public.view_produtos_lista to service_role;

-- 3) RPC gerar próximo código (search_path + grants)
create or replace function public.gerar_proximo_codigo_interno(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max int;
  v_next text;
  v_try text;
  v_n int := 0;
begin
  select coalesce(max(
    nullif(regexp_replace(codigo_interno, '\D', '', 'g'), '')::int
  ), 0) into v_max
  from public.produto_embalagens
  where company_id = p_company_id
    and codigo_interno is not null
    and codigo_interno ~ '\d';

  v_max := coalesce(v_max, 0) + 1;
  loop
    v_try := 'INT-' || v_max::text;
    exit when not exists (
      select 1 from public.produto_embalagens
       where company_id = p_company_id
         and lower(btrim(codigo_interno)) = lower(v_try)
    );
    v_max := v_max + 1;
    v_n := v_n + 1;
    if v_n > 1000 then
      raise exception 'codigo_interno_generation_failed';
    end if;
  end loop;
  return v_try;
end;
$$;

revoke all on function public.gerar_proximo_codigo_interno(uuid) from public;
revoke all on function public.gerar_proximo_codigo_interno(uuid) from anon, authenticated;
grant execute on function public.gerar_proximo_codigo_interno(uuid) to service_role;
