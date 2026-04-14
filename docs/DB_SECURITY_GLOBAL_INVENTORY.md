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
