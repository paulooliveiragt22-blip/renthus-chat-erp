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

### Grupo C — policies company-scoped legítimas, sem `FORCE` (decisão pendente, não bloqueante)

`company_menu_profile`, `customer_channel_identities`, `dining_tables`, `marketplace_catalog_map`,
`marketplace_connections`, `marketplace_external_orders`, `menu_page_events`,
`meta_messaging_channels`, `table_session_items`, `table_sessions` — diferente dos outros dois grupos,
essas 10 têm policy real e bem escrita (`company_id in (select company_id from company_users where
user_id = auth.uid())`, algumas restringindo a `owner`/`admin`). É o padrão RLS "multi-tenant direto",
não o padrão `service_role_only` deste projeto. Grants a `anon`/`authenticated` continuam de pé, mas o
`with_check`/`using` protege — não é um buraco aberto como os grupos A/B.

Auditoria no código (`grep` por nome de tabela + por uso de `createBrowserClient`/`@/lib/supabase/client`
em `.tsx`) não encontrou nenhum componente client-side lendo essas tabelas direto hoje — todo o acesso
observado é via API routes com `createAdminClient()`. Ou seja, o design "RLS direto" existe mas não está
sendo usado; não há motivo conhecido para mantê-lo.

**Ação tomada agora:** apenas `FORCE ROW LEVEL SECURITY` (zero mudança de comportamento pra
`anon`/`authenticated`, que nunca são owner da tabela — fecha só o bypass teórico de owner/superuser).
**Não** removi as policies nem os grants dessas 10, porque isso é decisão de arquitetura (manter RLS
direto para uso futuro client-side/Realtime vs. migrar 100% para `v_sec_*`/RPC como o resto do banco),
não um patch de segurança — precisa de sinal do dono do produto antes de descartar um padrão que
alguém decidiu implementar de propósito.

**Pendente (decisão do usuário):** escolher entre (a) manter RLS direto nessas 10 e documentar como
padrão alternativo aceito, ou (b) convergir para `service_role_only` + `v_sec_*`/RPC como as demais 77
tabelas, exigindo trocar os call sites que hoje passam por `createAdminClient()` — sem regressão
funcional esperada já que nenhum client-side depende disso hoje.
