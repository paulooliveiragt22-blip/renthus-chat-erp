-- Inclui taxas de serviço (não-entrega) no total do pedido.
-- total_amount = total + delivery_fee + service_fees_total

alter table public.orders
  add column if not exists service_fees_total numeric(14,2) not null default 0
  check (service_fees_total >= 0);

comment on column public.orders.service_fees_total is
  'Soma de order_fees com system_key <> delivery. Espelhado por trigger.';

-- Sync order_fees → delivery_fee + service_fees_total
create or replace function public.fn_order_fees_sync_delivery_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid uuid;
  v_delivery numeric;
  v_service numeric;
begin
  v_oid := coalesce(NEW.order_id, OLD.order_id);
  select
    coalesce(sum(amount) filter (where system_key = 'delivery'), 0),
    coalesce(sum(amount) filter (where system_key is distinct from 'delivery'), 0)
    into v_delivery, v_service
    from public.order_fees
   where order_id = v_oid;

  update public.orders
     set delivery_fee = v_delivery,
         service_fees_total = v_service
   where id = v_oid
     and (
       delivery_fee is distinct from v_delivery
       or service_fees_total is distinct from v_service
     );
  return coalesce(NEW, OLD);
end;
$$;

create or replace function public.calc_order_total_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  NEW.total_amount :=
    coalesce(NEW.total, 0)
    + coalesce(NEW.delivery_fee, 0)
    + coalesce(NEW.service_fees_total, 0);
  return NEW;
end;
$$;

drop trigger if exists trg_orders_calc_total_amount on public.orders;
create trigger trg_orders_calc_total_amount
  before insert or update of total, delivery_fee, service_fees_total on public.orders
  for each row execute function public.calc_order_total_amount();

alter table public.orders drop constraint if exists orders_total_amount_check;
alter table public.orders
  add constraint orders_total_amount_check
  check (
    total_amount = total + coalesce(delivery_fee, 0) + coalesce(service_fees_total, 0)
  );

-- Backfill service_fees_total e recalcular total_amount
update public.orders o
   set service_fees_total = coalesce((
         select sum(f.amount)
           from public.order_fees f
          where f.order_id = o.id
            and f.system_key is distinct from 'delivery'
       ), 0),
       total_amount = coalesce(o.total, 0)
         + coalesce(o.delivery_fee, 0)
         + coalesce((
             select sum(f.amount)
               from public.order_fees f
              where f.order_id = o.id
                and f.system_key is distinct from 'delivery'
           ), 0)
 where true;
