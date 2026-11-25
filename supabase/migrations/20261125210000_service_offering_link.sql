alter table public.service_offerings
  add column if not exists link_url text,
  add column if not exists link_label text;

alter table public.service_offerings
  drop constraint if exists service_offerings_link_url_check;

alter table public.service_offerings
  add constraint service_offerings_link_url_check check (
    link_url is null
    or (char_length(link_url) <= 500 and link_url ~ '^https://[^[:space:]]+$')
  );

alter table public.service_offerings
  drop constraint if exists service_offerings_link_label_check;

alter table public.service_offerings
  add constraint service_offerings_link_label_check check (
    link_label is null
    or link_label in ('Ver oferta', 'Ver plano', 'Ver serviço')
  );

create or replace function public.rpc_service_list_offerings(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service', 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'description', o.description,
        'duration_min', o.duration_min,
        'price_cents', o.price_cents,
        'link_url', o.link_url,
        'link_label', o.link_label
      ) order by o.name)
      from public.service_offerings o
      where o.company_id = p_company_id
        and o.active
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.rpc_service_upsert_offering(uuid, uuid, text, text, integer, integer, boolean);

create or replace function public.rpc_service_upsert_offering(
  p_company_id uuid,
  p_offering_id uuid,
  p_name text,
  p_description text,
  p_duration_min integer,
  p_price_cents integer,
  p_active boolean,
  p_link_url text,
  p_link_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_name text;
  v_id uuid;
  v_link text;
  v_label text;
begin
  select c.attendance_mode into v_mode from public.companies c where c.id = p_company_id;
  if v_mode is distinct from 'service' then
    return jsonb_build_object('ok', false, 'code', 'not_service');
  end if;
  v_name := left(btrim(coalesce(p_name, '')), 80);
  if char_length(v_name) < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_title');
  end if;
  if p_duration_min is not null and p_duration_min not between 15 and 240 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;
  if p_price_cents is not null and p_price_cents < 0 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;

  v_link := nullif(btrim(coalesce(p_link_url, '')), '');
  if v_link is not null and (char_length(v_link) > 500 or v_link !~ '^https://[^[:space:]]+$') then
    return jsonb_build_object('ok', false, 'code', 'offering_invalid');
  end if;
  v_label := nullif(btrim(coalesce(p_link_label, '')), '');
  if v_link is null then
    v_label := null;
  elsif v_label is null or v_label not in ('Ver oferta', 'Ver plano', 'Ver serviço') then
    v_label := 'Ver oferta';
  end if;

  if p_offering_id is null then
    insert into public.service_offerings (
      company_id, name, description, duration_min, price_cents, active, link_url, link_label
    )
    values (
      p_company_id, v_name, nullif(p_description, ''), p_duration_min, p_price_cents, coalesce(p_active, true), v_link, v_label
    )
    returning id into v_id;
  else
    update public.service_offerings
      set name = v_name,
          description = nullif(p_description, ''),
          duration_min = p_duration_min,
          price_cents = p_price_cents,
          active = coalesce(p_active, active),
          link_url = v_link,
          link_label = v_label,
          updated_at = now()
      where id = p_offering_id
        and company_id = p_company_id
      returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'cross_tenant');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'offering_id', v_id);
end;
$$;

revoke all on function public.rpc_service_upsert_offering(uuid, uuid, text, text, integer, integer, boolean, text, text) from public, anon, authenticated;
grant execute on function public.rpc_service_upsert_offering(uuid, uuid, text, text, integer, integer, boolean, text, text) to service_role;
