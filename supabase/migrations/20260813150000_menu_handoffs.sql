-- F5b: snapshot de carrinho do bot → cardápio web (token `hc` na URL).
-- Mutação/leitura só via service_role (API Next). Sem grant a anon/authenticated.

create table if not exists public.menu_handoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  slug text not null,
  thread_id text,
  purpose text not null check (purpose in ('checkout')),
  cart jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists menu_handoffs_company_created_idx
  on public.menu_handoffs (company_id, created_at desc);

create index if not exists menu_handoffs_expires_idx
  on public.menu_handoffs (expires_at);

alter table public.menu_handoffs enable row level security;
alter table public.menu_handoffs force row level security;

revoke all on table public.menu_handoffs from anon;
revoke all on table public.menu_handoffs from authenticated;

drop policy if exists rls_menu_handoffs_service_role_only on public.menu_handoffs;
create policy rls_menu_handoffs_service_role_only on public.menu_handoffs
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
