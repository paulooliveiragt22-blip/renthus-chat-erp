-- B14: mover pg_trgm e unaccent de public → extensions (advisor extension_in_public).
-- Extensões são relocatable; índice GIN products_name_trgm_idx permanece (ops por OID).
-- RPCs de busca fuzzy já usam search_path = public, extensions, pg_temp.
-- Schema `extensions` já existe no projeto com USAGE a anon/authenticated/service_role.

create schema if not exists extensions;

-- Garantir USAGE (idempotente) — funções da extensão precisam ser resolvíveis
-- via search_path da sessão (`"$user", public, extensions`) e das RPCs.
grant usage on schema extensions to postgres, anon, authenticated, service_role;

alter extension pg_trgm set schema extensions;
alter extension unaccent set schema extensions;

-- Confirma que a RPC de catálogo continua enxergando unaccent/similarity.
alter function public.rpc_search_chat_produtos(uuid, text, integer)
  set search_path = public, extensions, pg_temp;
