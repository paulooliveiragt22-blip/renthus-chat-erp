-- Arte da promoção e teto de 5 promoções ainda não expiradas por empresa.

alter table public.promocoes
    add column if not exists image_path text;

create or replace function public.fn_assert_promocao_limite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.ends_at > now() and (
        select count(*)
          from public.promocoes p
         where p.company_id = new.company_id
           and p.ends_at > now()
           and p.id is distinct from new.id
    ) >= 5 then
        raise exception 'promocao_limite_5' using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_promocao_limite on public.promocoes;
create trigger trg_promocao_limite
    before insert or update of ends_at on public.promocoes
    for each row
    execute function public.fn_assert_promocao_limite();

revoke all on function public.fn_assert_promocao_limite() from public, anon, authenticated;
grant execute on function public.fn_assert_promocao_limite() to service_role;

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
    ), '[]'::jsonb) as alvos,
    p.image_path
  from public.promocoes p;
