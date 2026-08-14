# Inventário e hardening global do banco

Data: 2026-04-14

## Escopo

- Schema: `public`
- Tabelas base encontradas: `65`
- Views de segurança geradas (`v_sec_*`): `65`
- Policies RLS após hardening: `65` (1 por tabela)

## Migrações aplicadas

- `20260414213000_global_rls_revoke_views_rpcs.sql`
  - Cria RPCs genéricas seguras:
    - `rpc_secure_insert(text, jsonb)`
    - `rpc_secure_update(text, uuid, jsonb)`
    - `rpc_secure_delete(text, uuid)`
  - Cria views espelho para SELECT:
    - `v_sec_<nome_tabela>`
  - Aplica em todas as tabelas `public`:
    - `REVOKE ALL` para `anon` e `authenticated`
    - `ENABLE RLS` e `FORCE RLS`
    - remove policies anteriores
    - cria policy única: `rls_<tabela>_service_role_only`

## Resultado de validação

- Não há grants diretos de `anon/authenticated` em tabelas críticas como:
  - `companies`
  - `orders`
  - `customers`
- Acesso bruto às tabelas foi bloqueado para perfis web.
- Leitura deve ocorrer por views `v_sec_*`.
- Escrita deve ocorrer via RPC (server-side / `service_role`).

## Observação operacional

Esse hardening é deliberadamente rígido e pode exigir ajustes no app para migrar 100% das leituras para `v_sec_*` e mutações para RPCs.

## Atualização 2026-08-11 — hardening pós-migration global (item 4 do checklist P0)

O loop da migration `20260414071525_global_rls_revoke_views_rpcs.sql` roda uma vez só, sobre as
tabelas que existiam naquele momento. Toda tabela criada **depois** dela precisa repetir o padrão
manualmente — auditoria encontrou **17 tabelas** sem o hardening completo, em 2 grupos distintos:

### Grupo A — sem policy nenhuma (RLS "fantasma", igual ao caso que motivou a rule)

`whatsapp_order_confirmations`, `abandoned_carts`, `outbound_jobs`, `pipeline_turn_traces`,
`pro_pipeline_metric_events` — RLS habilitado, **zero** policy, **sem** `FORCE`, com grants completos
(`SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES`) a `anon`/`authenticated` ainda de pé.
Como não havia policy, o acesso já era bloqueado por padrão (deny-all do Postgres pra roles não-owner
sem policy) — mas ficava frágil: qualquer policy futura adicionada por engano nessas tabelas herdaria
os grants antigos e abriria acesso completo sem ninguém notar.

**Corrigido em `20260811130000_harden_rls_post_global_tables.sql`**: REVOKE dos grants, `FORCE RLS`,
policy única `rls_<tabela>_service_role_only` em cada uma. Confirmado antes de aplicar: 100% do acesso
a essas 5 tabelas no código é via `createAdminClient()` (service-role, server-side); nenhum uso
client-side. Validado pós-migration: 0 grants a `anon`/`authenticated`, exatamente 1 policy por
tabela, `FORCE` ligado nas 5.

### Grupo B — achado crítico extra: policy aberta em tabela de dinheiro

`company_ai_ledger` e `company_ai_wallets` tinham policy `USING (true) WITH CHECK (true)` — **sem
nenhuma restrição** — combinada com os mesmos grants completos a `anon`/`authenticated`. Isso permitia,
com a anon key pública (extraível de qualquer frontend Supabase), ler e escrever saldo/ledger de
carteira de IA de **qualquer empresa**, sem autenticação real. Diferente do Grupo A, aqui havia policy
válida do ponto de vista do Postgres — logo o acesso *era* de fato permitido pra quem tivesse a anon key.

**Corrigido em `20260811131500_harden_ai_wallet_open_policy.sql`**: mesmo padrão do Grupo A (REVOKE +
FORCE + policy `service_role_only`), substituindo a policy `true/true`. Confirmado antes de aplicar:
único acesso no código é via `createAdminClient()` em `lib/billing/aiWallet.ts`,
`app/api/admin/ai-wallet/*` e `app/api/billing/webhook`; nenhum uso client-side.

### Grupo C — convergido para `service_role_only` (2026-08-12)

`company_menu_profile`, `customer_channel_identities`, `dining_tables`, `marketplace_catalog_map`,
`marketplace_connections`, `marketplace_external_orders`, `menu_page_events`,
`meta_messaging_channels`, `table_session_items`, `table_sessions`.

Tinham policy company-scoped (`company_id in (select company_id from company_users where user_id =
auth.uid())`) + grants a `anon`/`authenticated`. Auditoria no código não encontrou SELECT/INSERT
client-side — acesso via `createAdminClient()` (API) ou RPC `SECURITY DEFINER` (mesa, identidade
omnichannel, analytics do cardápio).

**Decisão do dono (2026-08-12):** opção (b) — convergir para o padrão do resto do banco, sem manter
RLS direto "para uso futuro" de Realtime/browser.

**Corrigido em `20260812231500_harden_rls_grupo_c_service_role_only.sql`:** REVOKE de
`anon`/`authenticated`, `FORCE RLS` (já estava da migration anterior), drop das policies
company-scoped, policy única `rls_<t>_service_role_only`. Views genéricas `v_sec_*` **não** foram
recriadas (dropadas em `20260414072621` como lixo técnico; leitura de domínio continua em
views/RPCs específicas). Call sites TypeScript **não** mudaram — já eram service-role.

**Validação esperada:** exatamente 1 policy `..._service_role_only` por tabela; zero grants a
`anon`/`authenticated`.
