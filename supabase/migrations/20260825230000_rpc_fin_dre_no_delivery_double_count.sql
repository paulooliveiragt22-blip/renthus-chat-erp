-- DRE: evita double-count da taxa de entrega.
-- sale_payments.amount já cobre sales.total (= produto + delivery).
-- Split proporcional: produto → à vista/a prazo; delivery → Taxa de Entrega.
-- Tudo deriva dos pagamentos (sem somar delivery de venda não liquidada).

create or replace function public.rpc_fin_dre(
  p_company_id uuid,
  p_from       timestamptz,
  p_to         timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_avista   numeric := 0;
  v_prazo    numeric := 0;
  v_delivery numeric := 0;
  v_cogs     numeric := 0;
  v_opex     numeric := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  select
    coalesce(sum(case
      when sp.payment_method = any (array['cash','pix','debit','card']) then
        sp.amount * (
          greatest(coalesce(s.total, 0) - coalesce(s.delivery_fee, 0), 0)
          / nullif(s.total, 0)
        )
      else 0 end), 0),
    coalesce(sum(case
      when sp.payment_method = any (array['credit_installment','boleto','promissoria','cheque']) then
        sp.amount * (
          greatest(coalesce(s.total, 0) - coalesce(s.delivery_fee, 0), 0)
          / nullif(s.total, 0)
        )
      else 0 end), 0),
    coalesce(sum(
      sp.amount * (coalesce(s.delivery_fee, 0) / nullif(s.total, 0))
    ), 0)
  into v_avista, v_prazo, v_delivery
  from public.sales s
  join public.sale_payments sp
    on sp.sale_id = s.id and sp.company_id = s.company_id
  where s.company_id = p_company_id
    and s.status <> 'canceled'
    and s.sold_at >= p_from
    and s.sold_at < p_to;

  select coalesce(sum(si.line_cost), 0)
    into v_cogs
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.company_id = p_company_id
    and s.status <> 'canceled'
    and s.sold_at >= p_from
    and s.sold_at < p_to;

  select coalesce(sum(l.amount), 0)
    into v_opex
  from public.finance_journal_lines l
  join public.finance_journals j on j.id = l.journal_id
  join public.chart_of_accounts a on a.id = l.account_id and a.code = '4.2'
  where j.company_id = p_company_id
    and j.status = 'posted'
    and l.direction = 'debit'
    and j.posted_at >= p_from
    and j.posted_at < p_to;

  return jsonb_build_array(
    jsonb_build_object('account_name', 'Vendas à Vista', 'account_type', 'revenue', 'total', round(v_avista, 2)),
    jsonb_build_object('account_name', 'Vendas a Prazo', 'account_type', 'revenue', 'total', round(v_prazo, 2)),
    jsonb_build_object('account_name', 'Taxa de Entrega', 'account_type', 'revenue', 'total', round(v_delivery, 2)),
    jsonb_build_object('account_name', 'Custo de Mercadorias', 'account_type', 'cost', 'total', round(v_cogs, 2)),
    jsonb_build_object('account_name', 'Despesas operacionais', 'account_type', 'expense', 'total', round(v_opex, 2))
  );
end;
$$;

revoke all on function public.rpc_fin_dre(uuid, timestamptz, timestamptz) from public;
grant execute on function public.rpc_fin_dre(uuid, timestamptz, timestamptz) to service_role;
