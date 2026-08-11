-- Achado crítico (auditoria 2026-08-11, extensão do item 4 do checklist P0):
-- `company_ai_ledger` e `company_ai_wallets` tinham RLS habilitado mas com policy
-- `USING (true) WITH CHECK (true)` — ou seja, sem restrição alguma — combinada com grants
-- completos (SELECT/INSERT/UPDATE/DELETE/...) a `anon` e `authenticated`. Isso permitia, com a
-- anon key pública (extraível de qualquer frontend Supabase), ler e escrever saldo/ledger de
-- carteira de IA de QUALQUER empresa. Confirmado antes de corrigir: todo acesso a essas duas
-- tabelas no código passa por `createAdminClient()` (service-role, server-side) via
-- `lib/billing/aiWallet.ts` / `app/api/admin/ai-wallet/*` / `app/api/billing/webhook` — nenhum
-- uso client-side. Sem regressão esperada.

revoke all on table public.company_ai_ledger from anon;
revoke all on table public.company_ai_ledger from authenticated;
revoke all on table public.company_ai_wallets from anon;
revoke all on table public.company_ai_wallets from authenticated;

alter table public.company_ai_ledger force row level security;
alter table public.company_ai_wallets force row level security;

drop policy if exists company_ai_ledger_service on public.company_ai_ledger;
drop policy if exists company_ai_wallets_service on public.company_ai_wallets;

create policy rls_company_ai_ledger_service_role_only on public.company_ai_ledger
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy rls_company_ai_wallets_service_role_only on public.company_ai_wallets
  as permissive for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Defesa em profundidade nas demais tabelas criadas após 20260414071525 que já tinham policy
-- própria company-scoped (via company_users) e portanto NÃO foram tocadas em policy/grants —
-- apenas liga FORCE (não muda comportamento para anon/authenticated, que nunca são owner da
-- tabela; fecha só o bypass teórico de owner/superuser). Ver docs/DB_SECURITY_GLOBAL_INVENTORY.md
-- para decisão pendente sobre migrar essas 10 para o padrão view/RPC.
alter table public.company_menu_profile force row level security;
alter table public.customer_channel_identities force row level security;
alter table public.dining_tables force row level security;
alter table public.marketplace_catalog_map force row level security;
alter table public.marketplace_connections force row level security;
alter table public.marketplace_external_orders force row level security;
alter table public.menu_page_events force row level security;
alter table public.meta_messaging_channels force row level security;
alter table public.table_session_items force row level security;
alter table public.table_sessions force row level security;
