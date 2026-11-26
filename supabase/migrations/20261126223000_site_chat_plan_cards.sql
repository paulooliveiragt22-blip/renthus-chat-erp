-- Cards de plano no chat do site, e o botão do WhatsApp da loja.

create or replace function public.rpc_site_chat_finish(
  p_company_id uuid,
  p_session_id uuid,
  p_body text,
  p_links jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text;
  v_links jsonb := '[]'::jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_item jsonb;
  v_opt jsonb;
  v_line jsonb;
  v_title text;
  v_benefits jsonb;
  v_options jsonb;
  v_benefit text;
  v_label text;
  v_price text;
  v_note text;
begin
  if not exists (
    select 1
      from public.site_chat_sessions
     where id = p_session_id
       and company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'session_invalid');
  end if;

  v_body := left(btrim(coalesce(p_body, '')), 2000);
  if v_body = '' then
    v_body := 'Não consegui responder agora. Tente de novo em instantes.';
  end if;

  if jsonb_typeof(p_links) = 'array' then
    for v_item in select value from jsonb_array_elements(p_links)
    loop
      if jsonb_typeof(v_item) <> 'object' then
        continue;
      end if;

      if v_item->>'kind' = 'plan' then
        if jsonb_array_length(v_cards) >= 6 then
          continue;
        end if;
        v_title := left(btrim(coalesce(v_item->>'title', '')), 40);
        if char_length(v_title) < 2 then
          continue;
        end if;
        v_benefits := '[]'::jsonb;
        if jsonb_typeof(v_item->'benefits') = 'array' then
          for v_line in select value from jsonb_array_elements(v_item->'benefits')
          loop
            exit when jsonb_array_length(v_benefits) >= 4;
            if jsonb_typeof(v_line) <> 'string' then
              continue;
            end if;
            v_benefit := left(btrim(v_line #>> '{}'), 80);
            if char_length(v_benefit) < 1 then
              continue;
            end if;
            v_benefits := v_benefits || jsonb_build_array(v_benefit);
          end loop;
        end if;
        v_options := '[]'::jsonb;
        if jsonb_typeof(v_item->'options') = 'array' then
          for v_opt in select value from jsonb_array_elements(v_item->'options')
          loop
            exit when jsonb_array_length(v_options) >= 2;
            if jsonb_typeof(v_opt) <> 'object' then
              continue;
            end if;
            if coalesce(v_opt->>'offeringId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
              continue;
            end if;
            v_label := left(btrim(coalesce(v_opt->>'label', '')), 20);
            v_price := left(btrim(coalesce(v_opt->>'price', '')), 40);
            v_note := nullif(left(btrim(coalesce(v_opt->>'note', '')), 40), '');
            if char_length(v_label) < 1 or char_length(v_price) < 1 then
              continue;
            end if;
            v_options := v_options || jsonb_build_array(jsonb_build_object(
              'offeringId', v_opt->>'offeringId',
              'label', v_label,
              'price', v_price,
              'note', v_note
            ));
          end loop;
        end if;
        if jsonb_array_length(v_options) < 1 then
          continue;
        end if;
        v_cards := v_cards || jsonb_build_array(jsonb_build_object(
          'kind', 'plan',
          'title', v_title,
          'benefits', v_benefits,
          'options', v_options
        ));
        continue;
      end if;

      if jsonb_array_length(v_links) >= 3 then
        continue;
      end if;
      if (v_item->>'label') not in ('Ver oferta', 'Ver plano', 'Ver serviço', 'Chamar no WhatsApp') then
        continue;
      end if;
      if coalesce(v_item->>'url', '') !~ '^https://[^[:space:]]+$' then
        continue;
      end if;
      if char_length(v_item->>'url') > 1000 then
        continue;
      end if;
      v_links := v_links || jsonb_build_array(jsonb_build_object('label', v_item->>'label', 'url', v_item->>'url'));
    end loop;
  end if;

  insert into public.site_chat_messages (session_id, company_id, role, body, links)
  values (p_session_id, p_company_id, 'assistant', v_body, v_links || v_cards);

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.rpc_site_chat_finish(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_site_chat_finish(uuid, uuid, text, jsonb) to service_role;
