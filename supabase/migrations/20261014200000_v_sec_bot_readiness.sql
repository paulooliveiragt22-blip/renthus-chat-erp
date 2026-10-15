-- Leitura de prontidão do atendimento (ADR 0013 D4).
-- Uma linha por empresa. O browser não consulta esta view: a API admin lê com service_role
-- depois de validar a empresa. A conversa do chatbot não depende deste resultado.

create or replace view public.v_sec_bot_readiness
with (security_invoker = true) as
select
    flags.*,
    (
        flags.has_sale_price
        and flags.has_stock
        and flags.has_commercial_sigla
        and flags.has_delivery_zone_fee
        and flags.has_opening_hours
        and flags.has_store_address
    ) as ready
from (
select
    c.id as company_id,
    exists (
        select 1
        from public.produto_embalagens pe
        where pe.company_id = c.id
          and coalesce(pe.is_active, true)
          and pe.preco_venda is not null
          and pe.preco_venda > 0
    ) as has_sale_price,
    exists (
        select 1
        from public.products p
        where p.company_id = c.id
          and coalesce(p.is_active, true)
          and p.estoque_atual is not null
    ) as has_stock,
    exists (
        select 1
        from public.produto_embalagens pe
        where pe.company_id = c.id
          and coalesce(pe.is_active, true)
          and pe.id_sigla_comercial is not null
    ) as has_commercial_sigla,
    (
        exists (
            select 1
            from public.delivery_zones z
            where z.company_id = c.id
              and coalesce(z.is_active, true)
              and z.fee is not null
        )
        or exists (
            select 1
            from public.company_delivery_neighborhood_rules r
            where r.company_id = c.id
              and r.is_active is true
              and r.is_served is true
              and r.fee_override is not null
        )
        or (
            coalesce(pol.service_by_zone, false) is not true
            and exists (
                select 1
                from public.service_fee_definitions d
                where d.company_id = c.id
                  and d.system_key = 'delivery'
                  and d.is_active is true
                  and d.value is not null
            )
        )
    ) as has_delivery_zone_fee,
    (
        (
            nullif(btrim(cs.open_time), '') is not null
            and nullif(btrim(cs.close_time), '') is not null
        )
        or (
            jsonb_typeof(cs.opening_periods) = 'array'
            and jsonb_array_length(cs.opening_periods) > 0
        )
    ) as has_opening_hours,
    (
        nullif(btrim(c.endereco), '') is not null
        and lower(btrim(c.endereco)) not in ('-', '--', 'completar', '(completar)')
        and btrim(c.endereco) ~ '[[:alnum:]]'
        and nullif(btrim(c.numero), '') is not null
        and (
            lower(replace(btrim(c.numero), ' ', '')) in ('s/n', 'sn')
            or (
                lower(btrim(c.numero)) not in ('-', '--', 'completar', '(completar)')
                and btrim(c.numero) ~ '[[:alnum:]]'
            )
        )
        and nullif(btrim(c.bairro), '') is not null
        and lower(btrim(c.bairro)) not in ('-', '--', 'completar', '(completar)')
        and btrim(c.bairro) ~ '[[:alnum:]]'
        and nullif(btrim(c.cidade), '') is not null
        and lower(btrim(c.cidade)) not in ('-', '--', 'completar', '(completar)')
        and btrim(c.cidade) ~ '[[:alnum:]]'
        and char_length(btrim(coalesce(c.uf, ''))) = 2
    ) as has_store_address
from public.companies c
left join public.company_delivery_policy pol
    on pol.company_id = c.id
left join public.company_settings cs
    on cs.company_id = c.id
) flags;

comment on view public.v_sec_bot_readiness is
    'ADR 0013 D4. Prontidão do atendimento por empresa. Leitura via API admin, não pelo browser.';

revoke all on table public.v_sec_bot_readiness from public;
revoke all on table public.v_sec_bot_readiness from anon;
revoke all on table public.v_sec_bot_readiness from authenticated;
grant select on table public.v_sec_bot_readiness to service_role;
