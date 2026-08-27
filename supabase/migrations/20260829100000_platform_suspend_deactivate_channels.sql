-- P2.4: ao suspender empresa, desativa canais WA ativos (marca metadata);
-- ao reativar, restaura só os marcados por platform.

create or replace function public.rpc_platform_suspend_company(
  p_company_id   uuid,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_channels int;
begin
  select jsonb_build_object('is_active', is_active)
    into v_before
    from public.companies
   where id = p_company_id
   for update;

  if v_before is null then
    raise exception 'company_not_found';
  end if;

  update public.companies
     set is_active = false,
         updated_at = now()
   where id = p_company_id;

  update public.whatsapp_channels
     set status = 'inactive',
         provider_metadata = coalesce(provider_metadata, '{}'::jsonb)
           || jsonb_build_object('suspended_by_platform', true)
   where company_id = p_company_id
     and status = 'active';

  get diagnostics v_channels = row_count;

  v_after := jsonb_build_object('is_active', false, 'channels_deactivated', v_channels);

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.company.suspended', 'company', p_company_id::text, p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, ''), 'channels_deactivated', v_channels),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_suspend_company(
  uuid, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_suspend_company(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

create or replace function public.rpc_platform_reactivate_company(
  p_company_id   uuid,
  p_actor_id     uuid,
  p_actor_email  text,
  p_actor_role   text,
  p_request_id   text,
  p_ip_address   text,
  p_user_agent   text,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_channels int;
begin
  select jsonb_build_object('is_active', is_active)
    into v_before
    from public.companies
   where id = p_company_id
   for update;

  if v_before is null then
    raise exception 'company_not_found';
  end if;

  update public.companies
     set is_active = true,
         updated_at = now()
   where id = p_company_id;

  update public.whatsapp_channels
     set status = 'active',
         provider_metadata = (coalesce(provider_metadata, '{}'::jsonb) - 'suspended_by_platform')
   where company_id = p_company_id
     and coalesce(provider_metadata->>'suspended_by_platform', '') = 'true';

  get diagnostics v_channels = row_count;

  v_after := jsonb_build_object('is_active', true, 'channels_restored', v_channels);

  perform public.rpc_platform_record_audit(
    p_actor_id, p_actor_email, p_actor_role,
    'platform.company.reactivated', 'company', p_company_id::text, p_company_id,
    p_request_id, p_ip_address, p_user_agent,
    v_before, v_after,
    jsonb_build_object('reason', coalesce(p_reason, ''), 'channels_restored', v_channels),
    'success'
  );
end;
$$;

revoke all on function public.rpc_platform_reactivate_company(
  uuid, uuid, text, text, text, text, text, text
) from public;
grant execute on function public.rpc_platform_reactivate_company(
  uuid, uuid, text, text, text, text, text, text
) to service_role;
