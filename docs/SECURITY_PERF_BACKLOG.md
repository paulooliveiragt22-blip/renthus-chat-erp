# Backlog — Security & Performance Advisors (Supabase)

Levantamento via MCP `supabase__get_advisors` em **2026-09-01** (projeto
`zwcfuvohxmvlxhdfbgxo` / `sa-east-1`). Itens **fora do escopo do ADR-0003**
(SQS + Lambda) — não bloqueiam cutover; ficam como ação posterior.

**Severidades:**

- 🔴 **ERROR** — risco de segurança real; tratar antes de produção com cliente real
- 🟡 **WARN** — risco ou degradação; tratar no próximo ciclo
- 🟢 **INFO** — melhoria de performance / organização

---

## 1. Performance (INFO / WARN)

### 1.1 Foreign keys sem índice de cobertura 🟢

`unindexed_foreign_keys` — identificado em várias tabelas. Adicionar índice
B-tree na coluna FK reduz table scans quando há `JOIN` ou `WHERE` por FK.

| Tabela | Coluna FK | Ação |
|---|---|---|
| `public.bills` | `chart_account_id` | `CREATE INDEX ON public.bills (chart_account_id);` |
| `public.broadcast_campaign_recipients` | `customer_id` | idem |
| `public.broadcast_campaigns` | `template_id` | idem |
| `public.cash_movements` | `company_id` | idem |
| `public.cash_movements` | `operator_id` | idem |

(continua para várias outras tabelas — ver lista completa via `get_advisors`)

### 1.2 Índices não utilizados 🟢

`unused_index` — candidatos a remoção. Em projeto pré-produção, **não remover
ainda**: muitos desses índices foram criados preventivamente e podem ser
ativados com carga real. Reavaliar após 1 mês em produção com 10+ empresas
ativas.

### 1.3 Índices duplicados 🟡

`duplicate_index` — `public.orders` tem `idx_orders_driver_id` E
`orders_driver_idx` com mesma definição. **Ação:** dropar um dos dois.

```sql
-- Validar antes:
SELECT pg_get_indexdef('public.idx_orders_driver_id'::regclass);
SELECT pg_get_indexdef('public.orders_driver_idx'::regclass);
-- Se idênticos, dropar o mais antigo:
DROP INDEX IF EXISTS public.idx_orders_driver_id;
```

### 1.4 Auth DB connection strategy 🟢

`auth_db_connections_absolute` — Auth usa 10 conexões fixas. Trocar para
percentual (`Percentage` strategy) no Dashboard Supabase → Auth → Settings →
"Database Connections".

---

## 2. Segurança (ERROR / WARN)

### 2.1 Views com `SECURITY DEFINER` 🔴

`security_definer_view` — views que executam com permissões do **dono da view**
em vez do usuário. Risco: bypass de RLS.

Views afetadas (lista parcial — verificar todas via `get_advisors`):

- `public.view_categories`
- `public.view_siglas_comerciais`
- `public.view_unit_types`
- `public.view_produto_embalagem_acompanhamentos`
- `public.view_pdv_produtos`
- (mais…)

**Ação recomendada:** recriar as views com `security_invoker = true` (Postgres 15+):

```sql
ALTER VIEW public.view_categories SET (security_invoker = true);
-- Repetir para cada view. Verificar antes que não há join que dependa de RLS
-- de tabelas com policies diferentes.
```

### 2.2 Funções `SECURITY DEFINER` chamáveis pelo role `authenticated` 🟡

`authenticated_security_definer_function_executable` — várias funções marcadas
como `SECURITY DEFINER` (executam com permissões do dono, bypassando RLS) são
acessíveis via `POST /rest/v1/rpc/<fn>` para qualquer usuário autenticado.

**Princípio:** se a função precisa ser chamada por usuário tenant, deve usar
`SECURITY INVOKER` + checar `auth.uid()` internamente. `SECURITY DEFINER` é
aceitável **somente** se a função for exclusiva de service role / admin.

**Ação sugerida:**

1. Auditar cada função listada no advisor.
2. Para cada uma que **realmente** precisa ser `DEFINER` (ex.: legada):
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM authenticated;
   -- Manter só em service_role
   ```
3. Para cada uma que **NÃO** precisa: `ALTER FUNCTION … SECURITY INVOKER;`.

### 2.3 Leaked Password Protection 🟡

`auth_leaked_password_protection` — feature de checagem contra HaveIBeenPwned
está **desabilitada**.

**Ação:** habilitar em Dashboard → Auth → Sign In/Up → "Password Strength"
→ ativar "Leaked Password Protection".

---

## 3. Não bloqueantes / já cobertos

- ✅ **`pg_cron chatbot-queue-drain`** removido (ADR-0003).
- ✅ **`claim_*` / `reclaim_*`** RPCs dropadas (ADR-0003).
- ✅ **Outbox SQS** colunas + índices criados (ADR-0003).
- ✅ **Lambda SQS** event source mapping (sem DLQ depth > 0 reportado nos advisors — Sentry).

---

## 4. Procedimento para revisar este backlog

1. Rodar `supabase__get_advisors` (security + performance) **antes de cada
   release** ou mensalmente.
2. Triar por severidade.
3. Itens 🔴 e 🟡 viram tasks no board.
4. Itens 🟢 viram melhorias coletadas em janela mensal.

---

## Resumo

| Categoria | Total itens | 🔴 | 🟡 | 🟢 |
|---|---|---|---|---|
| Performance | ~20+ (unindexed FK + unused idx + 1 dup) | 0 | 1 | 19+ |
| Segurança | ~10+ (views + fns + 1 auth) | 5+ | 5+ | 1 |

**Bloqueio para cutover SQS:** nenhum. **Bloqueio para produção com cliente
real (PRD open):** itens 🔴 da seção 2.1 (views SECURITY DEFINER) e 2.3
(leaked password).
