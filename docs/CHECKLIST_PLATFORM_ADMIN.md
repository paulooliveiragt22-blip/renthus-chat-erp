# Checklist — Platform Admin Renthus/Lysthub

Origem: definição técnica do console operacional da plataforma (2026-08-26). Este arquivo
existe para **não perder contexto** entre sessões. Atualizar `Estado` (`[ ]` → `[x]` + data)
ao concluir cada item.

**Processo:** uma fase por vez até `npm test` verde; migrations via MCP `apply_migration` +
validação `execute_sql`; postura pré-produção radical (sem dual-path legado após cutover P3).

**Validação remota (2026-08-26):** tabelas `platform_users` e `platform_audit_log` **não
existem**; audit fragmentado em `order_events`, `whatsapp_channel_credential_audit`,
`pro_pipeline_metric_events`, `pipeline_turn_traces`. Superadmin atual: cookie `sa_token` =
`SUPERADMIN_SECRET`, **404 em Vercel prod** (`proxy.ts`).

---

## Decisões arquiteturais (fechadas — CTO)

| # | Tema | Decisão | Motivo |
|---|------|---------|--------|
| D1 | **URL canônica** | `/platform/*` + redirect 308 de `/superadmin/*` até P3 | Namespace claro; desacopla de “hack dev”; redirect evita links quebrados |
| D2 | **Host produção** | Path `/platform` no domínio atual; `PLATFORM_ADMIN_HOST` **opcional** (só quando existir domínio dedicado) | Sem `lysthub.com.br` ainda — não bloquear P1; subdomínio fica pós-DNS |
| D3 | **Identidade** | Supabase Auth + tabela `platform_users` (1:1 `auth.users`) | MFA nativo (TOTP/aal2), auditoria por usuário, escalável para convites |
| D4 | **Deprecar legado** | Remover `SUPERADMIN_SECRET` / `sa_token` / `/api/superadmin/login` na **P3** | Segredo compartilhado não é auditável; radical pós-cutover |
| D5 | **MFA** | **Obrigatório** para roles `superadmin` e `ops` desde **P0** | Supabase Auth MFA TOTP + gate `aal2` no JWT (`auth.mfa.getAuthenticatorAssuranceLevel`) |
| D6 | **IP allowlist** | `PLATFORM_ADMIN_IP_ALLOWLIST` (CSV CIDR/IP) — **obrigatório em prod**, vazio = bypass só em `NODE_ENV=development` | Camada extra contra credential stuffing; ops remoto via VPN IP fixo |
| D7 | **Impersonação** | **Somente leitura** no tenant + banner persistente; **sem** mutações destrutivas (estorno, delete, billing, credenciais WA) | Menor blast radius; suporte diagnostica sem alterar dado |
| D8 | **Audit de leitura** | Registrar **só** ações sensíveis: `impersonation.started/ended`, `channel.credentials_viewed`, mutações | Evita ruído (milhares de `page.viewed`); compliance onde importa |
| D9 | **Backend platform** | Route Handlers `app/api/platform/*` + RPCs transacionais; **eliminar** server actions como boundary | Testável, versionável, guard único, audit no mesmo transaction |
| D10 | **Usuários iniciais** | Bootstrap via script `scripts/bootstrap-platform-user.mjs` (service role) + convite UI na P1 | P0 não bloqueia em UI de convite; seed controlado |
| D11 | **Roles platform** | `superadmin` \| `ops` \| `billing` \| `support` \| `readonly` | Matriz explícita espelhando padrão `capabilities.ts` tenant |
| D12 | **Retenção audit** | 24 meses hot Postgres; job mensual arquiva >24m para Storage (P2) | Balance custo/compliance SMB SaaS |
| D13 | **Feature flags** | Tabela `platform_feature_flags` escopo global + override por `company_id` (P2) | Kill switch sem redeploy |
| D14 | **Observabilidade** | Sentry (erros) + dashboard platform (métricas DB existentes) + `platform_audit_log` (ações humanas) | Três pilares sem duplicar fonte de verdade |

Referência MFA Supabase: TOTP enroll/challenge/verify; JWT claim `aal: aal2` após verify
(Context7 `/supabase/supabase` — guia auth MFA).

---

## Resumo de fases

| Fase | Escopo | Estado |
|------|--------|--------|
| **P0** | Schema platform + auth + guard + IP + MFA + audit + migrar empresas/canais | [x] 2026-08-27 |
| **P1** | Billing platform, observabilidade, impersonação read-only, prod (path /platform) | [x] 2026-08-27 |
| **P2** | Feature flags, alertas, export audit, retenção/arquivo, convites platform | [ ] |
| **P3** | Remover legado superadmin + docs + env vars obsoletas | [x] 2026-08-27 |

---

## Estado remoto relevante

| Objeto | Estado |
|--------|--------|
| `companies.is_active` | Existe — usar para suspend/reactivate |
| `subscriptions` + `plans` | Existe — billing platform estende APIs existentes |
| `whatsapp_channel_credential_audit` | Existe — manter; platform audit **complementa** |
| `order_events` | Existe — link na ficha pedido platform |
| `superadmin_pro_pipeline_metric_totals` RPC | Existe — reutilizar no dashboard |
| `platform_users` | **Não existe** |
| `platform_audit_log` | **Não existe** |
| `platform_impersonation_sessions` | **Não existe** |

---

## P0 — Fundação (bloqueante)

### P0.1 — Migration schema platform

**Arquivo:** `supabase/migrations/20260827000000_platform_admin_foundation.sql`

**Criar:**

```sql
-- platform_users
-- platform_audit_log (append-only)
-- platform_impersonation_sessions (P1 usa; criar já vazio OK)
-- índices + FORCE RLS + revoke anon/authenticated + policy service_role_only
-- RPC rpc_platform_record_audit(...) SECURITY DEFINER set search_path
-- RPC rpc_platform_suspend_company(...) com audit inline
```

**Colunas `platform_users`:**

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `auth_user_id` | uuid UNIQUE → auth.users | |
| `email` | text NOT NULL | denormalizado |
| `display_name` | text NOT NULL | |
| `role` | text CHECK IN (superadmin, ops, billing, support, readonly) | |
| `is_active` | boolean DEFAULT true | |
| `mfa_required` | boolean DEFAULT true | false só readonly se necessário |
| `last_login_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

**Colunas `platform_audit_log`:**

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `occurred_at` | timestamptz DEFAULT now() | |
| `actor_id` | uuid FK platform_users NULL | null = system |
| `actor_email` | text | |
| `actor_role` | text | |
| `action` | text NOT NULL | catálogo fechado (ver P0.8) |
| `resource_type` | text NOT NULL | |
| `resource_id` | text | |
| `company_id` | uuid FK companies NULL | |
| `request_id` | text NOT NULL | correlation |
| `ip_address` | inet | |
| `user_agent` | text | |
| `before_state` | jsonb | redacted |
| `after_state` | jsonb | redacted |
| `metadata` | jsonb DEFAULT '{}' | reason, ticket_id |
| `outcome` | text CHECK IN (success, failure, denied) | |

**Índices:** `(occurred_at DESC)`, `(company_id, occurred_at DESC)`,
`(actor_id, occurred_at DESC)`, `(action, occurred_at DESC)`.

**Segurança:** checklist `supabase-migrations-seguranca.mdc` — FORCE RLS, revoke,
policy `rls_platform_*_service_role_only`, funções com `set search_path = public, pg_temp`.

**Validação pós-apply:**

```sql
select tablename, policyname from pg_policies
  where tablename in ('platform_users','platform_audit_log');
select grantee from information_schema.role_table_grants
  where table_name = 'platform_audit_log' and grantee in ('anon','authenticated');
```

**Estado:** [x] 2026-08-27 — migration aplicada no remoto; RLS/policies OK
 (`src/platform/`)

**Criar:**

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/platform/domain/entities/PlatformUser.ts` | entidade + role enum |
| `src/platform/domain/entities/PlatformAuditEntry.ts` | |
| `src/platform/domain/ports/PlatformAuditRepository.ts` | |
| `src/platform/domain/ports/PlatformUserRepository.ts` | |
| `src/platform/application/use-cases/RecordPlatformAuditUseCase.ts` | |
| `src/platform/adapters/supabase/platformAudit.supabase.ts` | |
| `src/platform/adapters/supabase/platformUser.supabase.ts` | |

**Estado:** [ ]

---

### P0.3 — Guards e permissões (`lib/platform/`)

**Criar:**

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/platform/platformRoles.ts` | enum + normalize |
| `lib/platform/platformPermissions.ts` | matriz role → permission keys |
| `lib/platform/requirePlatformAccess.ts` | guard canônico (substitui cookie raw) |
| `lib/platform/checkPlatformMfa.ts` | exige JWT `aal === 'aal2'` se role exige MFA |
| `lib/platform/checkPlatformIpAllowlist.ts` | parse CSV env; prod strict |
| `lib/platform/audit/auditActionCatalog.ts` | enum actions |
| `lib/platform/audit/recordPlatformAudit.ts` | helper pós-mutação |
| `lib/platform/audit/redactAuditState.ts` | strip tokens/PII desnecessária |
| `lib/platform/requestContext.ts` | `requestId`, IP, UA from headers |

**Contrato `requirePlatformAccess`:**

1. Sessão Supabase válida (`createServerClient().auth.getUser()`)
2. Registro em `platform_users` ativo
3. IP allowlist (prod)
4. MFA aal2 se `mfa_required` (roles superadmin/ops sempre)
5. Permission key solicitada
6. Retorna `{ ok, actor, admin, requestId }`

**Estado:** [ ]

---

### P0.4 — Proxy e roteamento

**Alterar:** `proxy.ts`

| Mudança | Detalhe |
|---------|---------|
| Remover | Bloco `if (process.env.VERCEL_ENV) return 404` em superadmin |
| Adicionar | Branch `/platform` + `/api/platform` com checks: IP allowlist → sessão Supabase → cookie platform marker opcional |
| Manter temporariamente | Branch `/superadmin` redireciona login para `/platform/login` |
| Adicionar | Header `x-request-id` se ausente (uuid) |

**Alterar:** `components/AdminShell.tsx` — excluir `/platform` do shell tenant (como superadmin)

**Estado:** [ ]

---

### P0.5 — UI platform (migrar superadmin)

**Renomear/mover:**

| De | Para |
|----|------|
| `app/superadmin/layout.tsx` | `app/(platform)/platform/layout.tsx` |
| `app/superadmin/page.tsx` | `app/(platform)/platform/page.tsx` |
| `app/superadmin/empresas/**` | `app/(platform)/platform/empresas/**` |
| `app/superadmin/canais/**` | `app/(platform)/platform/canais/**` |
| `app/superadmin/pedidos/**` | `app/(platform)/platform/pedidos/**` |
| `app/superadmin/seguranca/**` | `app/(platform)/platform/seguranca/**` |
| `app/superadmin/login/page.tsx` | `app/(platform)/platform/login/page.tsx` |
| `components/superadmin/SuperAdminSidebar.tsx` | `components/platform/PlatformSidebar.tsx` |

**Novas telas P0:**

| Rota | Arquivo |
|------|---------|
| `/platform/login/mfa` | enroll + challenge TOTP |
| `/platform/audit` | lista paginada audit log |
| `/platform/usuarios` | lista platform_users (read); CRUD mínimo superadmin |

**Login P0:** email/senha Supabase (não mais password único); pós-login → MFA se aal1.

**Estado:** [ ]

---

### P0.6 — APIs platform (substituir server actions)

**Criar:** `app/api/platform/**`

| Método | Rota | Permission | Substitui action |
|--------|------|------------|------------------|
| GET | `/api/platform/me` | — | — |
| GET | `/api/platform/companies` | `platform.companies.read` | `getCompanies` |
| POST | `/api/platform/companies` | `platform.companies.write` | `createCompany` |
| GET | `/api/platform/companies/[id]` | read | `getCompany` |
| PATCH | `/api/platform/companies/[id]` | write | `updateCompany` |
| POST | `/api/platform/companies/[id]/suspend` | write | novo (usa `is_active`) |
| POST | `/api/platform/companies/[id]/reactivate` | write | novo |
| GET | `/api/platform/channels` | `platform.channels.read` | `getAllChannels` |
| PATCH | `/api/platform/channels/[id]` | write | `updateChannelIdentifier`, status |
| POST | `/api/platform/channels` | write | `createChannel` |
| PATCH | `/api/platform/channels/[id]/credentials` | write | `updateChannelCredentials` |
| GET | `/api/platform/orders` | `platform.orders.read` | `getAllOrders` |
| GET | `/api/platform/metrics/dashboard` | `platform.metrics.read` | `getDashboardStats` |
| GET | `/api/platform/metrics/queue` | metrics | `getQueueHealthStats` |
| GET | `/api/platform/metrics/pipeline` | metrics | `getProPipelineHealthStats` |
| GET | `/api/platform/security/ops-status` | superadmin | `getSecurityOpsStatus` |
| GET | `/api/platform/audit` | `platform.audit.read` | novo |

Todas mutações: `recordPlatformAudit` + redaction.

**Deprecar (não deletar até P3):** exports mutáveis em `lib/superadmin/actions.ts` → thin wrappers chamando APIs ou `@deprecated`.

**Estado:** [ ]

---

### P0.7 — MFA (Supabase Auth TOTP)

**Criar:**

| Arquivo | Responsabilidade |
|---------|------------------|
| `app/(platform)/platform/login/mfa/page.tsx` | challenge |
| `app/(platform)/platform/settings/mfa/page.tsx` | enroll (superadmin) |
| `app/api/platform/auth/mfa/status/route.ts` | AAL check |
| `lib/platform/checkPlatformMfa.ts` | usado em requirePlatformAccess |

**Fluxo:**

1. Login email/senha → sessão aal1
2. Se role exige MFA e `currentLevel !== nextLevel` → redirect `/platform/login/mfa`
3. `mfa.challenge` + `mfa.verify` → `refreshSession` → aal2
4. APIs recusam com `403 mfa_required` se aal2 ausente

**Estado:** [ ]

---

### P0.8 — Catálogo de audit actions (P0 mínimo)

```
platform.auth.login_success
platform.auth.login_failure
platform.auth.mfa_failure
platform.auth.logout
platform.company.created
platform.company.updated
platform.company.suspended
platform.company.reactivated
platform.channel.created
platform.channel.updated
platform.channel.credentials_updated
platform.channel.status_changed
platform.order.list_viewed          -- opcional: só se paginação cross-tenant
platform.user.created
platform.user.role_changed
platform.user.deactivated
platform.access.denied
```

**Estado:** [ ]

---

### P0.9 — Bootstrap primeiro usuário platform

**Criar:** `scripts/bootstrap-platform-user.mjs`

```
Usage: node scripts/bootstrap-platform-user.mjs --email x@renthus.com.br --role superadmin
```

- Cria auth user (invite) ou vincula existente
- Insere `platform_users`
- Documentar no checklist operacional (não commitar emails)

**Estado:** [ ]

---

### P0.10 — Env vars

**Adicionar:**

| Var | Obrigatório prod | Descrição |
|-----|------------------|-----------|
| `PLATFORM_ADMIN_IP_ALLOWLIST` | **Sim** | CSV: `203.0.113.10,198.51.100.0/24` |
| `PLATFORM_ADMIN_HOST` | Recomendado | `admin.lysthub.com.br` — validação Host header |

**Alterar:** `scripts/check-production-env.mjs`

- Warn se `PLATFORM_ADMIN_IP_ALLOWLIST` vazio em prod
- Remover check positivo de `SUPERADMIN_SECRET` após P3

**Manter até P3:** `SUPERADMIN_SECRET` (deprecated warning)

**Estado:** [ ]

---

### P0.11 — Testes

**Criar:**

| Arquivo | Casos |
|---------|-------|
| `tests/platform/requirePlatformAccess.test.ts` | sem sessão, sem platform_user, role insuficiente, IP blocked, MFA missing |
| `tests/platform/ipAllowlist.test.ts` | CIDR, single IP, dev bypass |
| `tests/platform/auditRedaction.test.ts` | tokens stripped |
| `tests/proxy.test.ts` | adicionar `/platform` routes; remover expect 404 vercel |

**Estado:** [ ]

---

## P1 — Operações e suporte

### P1.1 — Billing platform

**APIs:**

| Método | Rota | Permission |
|--------|------|------------|
| GET | `/api/platform/billing/subscriptions` | `platform.billing.read` |
| POST | `/api/platform/billing/subscriptions/[id]/change-plan` | `platform.billing.write` |
| POST | `/api/platform/billing/subscriptions/[id]/allow-overage` | billing.write |

**UI:** `app/(platform)/platform/billing/page.tsx` + aba billing em `empresas/[id]`

**RPC (migration):** `rpc_platform_change_subscription_plan(p_sub_id, p_plan_key, p_actor_id, p_reason)`

**Estado:** [x] 2026-08-27 — APIs billing + UI `/platform/billing` + RPCs aplicadas

---

### P1.2 — Observabilidade

**UI:** `app/(platform)/platform/observabilidade/page.tsx`

Painéis: health estendido, fila chatbot, PRO pipeline (RPC existente), trials expirando.

**API:** `GET /api/platform/health/extended` — compõe `/api/health` + queue + env checklist.

**Sentry:** tags `platform_actor_id`, `platform_role`, `request_id` em `lib/api/errors.ts` quando rota `/api/platform/*`.

**Estado:** [x] 2026-08-27

---

### P1.3 — Impersonação read-only

**Migration:** usar `platform_impersonation_sessions`:

| Coluna | Tipo |
|--------|------|
| `id` | uuid PK |
| `platform_user_id` | uuid FK |
| `company_id` | uuid FK |
| `reason` | text NOT NULL |
| `started_at` | timestamptz |
| `expires_at` | timestamptz |
| `ended_at` | timestamptz NULL |

**API:**

- `POST /api/platform/impersonate` — permission `platform.impersonate`; TTL 1h
- `DELETE /api/platform/impersonate` — encerra sessão

**Cookie:** `platform_impersonation` (httpOnly, Secure, SameSite=Strict)

**Alterar:** `lib/workspace/requireCompanyAccess.ts`

- Se cookie impersonation válido → permitir **somente** GET paths e capabilities read-only
- Bloquear POST/PATCH/DELETE tenant (lista explícita de rotas permitidas vazia para mutação)
- Banner: `components/platform/ImpersonationBanner.tsx` no `AdminShell`

**Audit:** `platform.impersonation.started`, `platform.impersonation.ended`

**Estado:** [x] 2026-08-27 — proxy bloqueia mutações tenant; banner no AdminShell

---

### P1.4 — Deploy produção

**Operacional (sem domínio Lysthub ainda):**

1. [x] Console em `/platform` no domínio Vercel atual (sem alias `admin.lysthub.com.br`)
2. [x] `PLATFORM_ADMIN_IP_ALLOWLIST` na Vercel Production
3. [ ] Bootstrap superadmin + enroll MFA
4. [ ] Smoke: login → MFA → listar empresas → audit entry gerada
5. [ ] Quando DNS Lysthub existir: alias + `PLATFORM_ADMIN_HOST` (opcional)

**Estado:** [~] 2026-08-27 — IP allowlist + login OK em prod; MFA enroll + smoke audit pendentes

---

## P2 — Governança avançada

### P2.1 — Feature flags

**Migration:** `platform_feature_flags` (key, enabled_global, metadata) +
`platform_feature_flag_overrides` (company_id, key, enabled)

**UI/API:** `/platform/feature-flags`

**Estado:** [x] 2026-08-27 — migration remota + RPC `rpc_platform_is_feature_enabled` + UI/API

---

### P2.2 — Audit export + retenção

- Export CSV (superadmin/ops)
- Cron `platform-audit-archive` → Storage bucket privado
- DELETE hot rows > 24 meses pós-arquivo

**Estado:** [x] 2026-08-27 — export CSV; bucket `platform-audit-archive` (privado);
`/api/platform/audit/archive` (mensal) + `rpc_platform_delete_audit_by_ids`

---

### P2.3 — Convites platform users

**API:** `POST /api/platform/users/invite` — Supabase invite + insert platform_users

**UI:** formulário em `/platform/usuarios`

**Estado:** [x] 2026-08-27 — invite API + form UI

---

### P2.4 — Alertas operacionais

Regras iniciais (cron ou check no dashboard):

- Fila chatbot pending > N por 10 min
- Webhook WhatsApp 5xx spike (Sentry)
- Empresa suspensa ainda recebendo mensagens WA

**Estado:** [x] 2026-08-27 — `evaluatePlatformAlerts` + `/api/platform/alerts` + UI Observabilidade;
cron `/api/platform/alerts/check` (5 min) → Sentry; inbound WA drop se `companies.is_active=false`;
suspend RPC desativa canais WA (metadata `suspended_by_platform`)

---

## P3 — Remoção legado (radical)

### Arquivos a **remover**

| Arquivo | Motivo |
|---------|--------|
| `app/api/superadmin/login/route.ts` | substituído por Supabase Auth |
| `app/superadmin/**` | migrado para `/platform` (após redirects temporários) |
| `lib/superadmin/actions.ts` | lógica em APIs + use cases |
| `components/superadmin/SuperAdminSidebar.tsx` | substituído |

### Código a **limpar**

| Arquivo | Mudança |
|---------|---------|
| `proxy.ts` | remover branch `sa_token` / `/superadmin` |
| `lib/superadmin/actions.ts` | deletar arquivo |
| `getSecurityOpsStatus` | remover check `SUPERADMIN_SECRET` |
| `lib/whatsapp/channelCredentials.ts` | actor `superadmin_service` → `platform:{userId}` |
| `scripts/check-production-env.mjs` | remover `SUPERADMIN_SECRET` |
| `docs/SECURITY_IMPROVEMENTS_CHECKLIST.md` | secção 6 atualizada |
| `.env.example` | remover `SUPERADMIN_SECRET`; add platform vars |

### Redirects (Next.js)

`next.config.js`: `/superadmin/:path*` → `/platform/:path*` 308 (1 release cycle, depois remover)

**Estado:** [x] 2026-08-27 — removidos `app/superadmin/**`, `app/api/superadmin/**`, `lib/superadmin/**`,
`components/superadmin/**`; redirects em `next.config.js` + `proxy.ts` mantidos 1 ciclo

---

## Matriz de permissões platform

| Permission | superadmin | ops | billing | support | readonly |
|------------|:----------:|:---:|:-------:|:-------:|:--------:|
| `platform.companies.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform.companies.write` | ✓ | ✓ | | | |
| `platform.companies.suspend` | ✓ | ✓ | | | |
| `platform.billing.read` | ✓ | | ✓ | | ✓ |
| `platform.billing.write` | ✓ | | ✓ | | |
| `platform.channels.read` | ✓ | ✓ | | ✓ | ✓ |
| `platform.channels.write` | ✓ | ✓ | | | |
| `platform.orders.read` | ✓ | ✓ | | ✓ | ✓ |
| `platform.orders.reverse` | ✓ | | | | |
| `platform.impersonate` | ✓ | | | ✓ | |
| `platform.users.manage` | ✓ | | | | |
| `platform.audit.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform.metrics.read` | ✓ | ✓ | | | ✓ |
| `platform.feature_flags.write` | ✓ | ✓ | | | |
| `platform.security.read` | ✓ | | | | |

Implementação: `lib/platform/platformPermissions.ts` (espelho de `capabilities.ts`).

---

## Ordem de execução

```
P0.1 migration
  → P0.2 domain
  → P0.3 guards
  → P0.6 APIs (read primeiro)
  → P0.7 MFA
  → P0.4 proxy
  → P0.5 UI migrate
  → P0.9 bootstrap user
  → P0.10 env
  → P0.11 tests
  → npm test verde
P1.* (billing, observabilidade, impersonate, deploy)
P2.* (flags, export, convites, alertas)
P3.* (delete legado)
```

---

## Inventário completo de arquivos

### Criar (novos)

```
supabase/migrations/20260827000000_platform_admin_foundation.sql
supabase/migrations/20260828000000_platform_billing_rpcs.sql          (P1)
supabase/migrations/20260829000000_platform_feature_flags.sql         (P2)

src/platform/domain/entities/PlatformUser.ts
src/platform/domain/entities/PlatformAuditEntry.ts
src/platform/domain/ports/PlatformAuditRepository.ts
src/platform/domain/ports/PlatformUserRepository.ts
src/platform/application/use-cases/RecordPlatformAuditUseCase.ts
src/platform/adapters/supabase/platformAudit.supabase.ts
src/platform/adapters/supabase/platformUser.supabase.ts

lib/platform/platformRoles.ts
lib/platform/platformPermissions.ts
lib/platform/requirePlatformAccess.ts
lib/platform/checkPlatformMfa.ts
lib/platform/checkPlatformIpAllowlist.ts
lib/platform/requestContext.ts
lib/platform/audit/auditActionCatalog.ts
lib/platform/audit/recordPlatformAudit.ts
lib/platform/audit/redactAuditState.ts

app/(platform)/platform/layout.tsx
app/(platform)/platform/page.tsx
app/(platform)/platform/login/page.tsx
app/(platform)/platform/login/mfa/page.tsx
app/(platform)/platform/empresas/page.tsx
app/(platform)/platform/empresas/[id]/page.tsx
app/(platform)/platform/canais/page.tsx
app/(platform)/platform/pedidos/page.tsx
app/(platform)/platform/seguranca/page.tsx
app/(platform)/platform/audit/page.tsx
app/(platform)/platform/usuarios/page.tsx
app/(platform)/platform/observabilidade/page.tsx                          (P1)
app/(platform)/platform/billing/page.tsx                                  (P1)

app/api/platform/me/route.ts
app/api/platform/companies/route.ts
app/api/platform/companies/[id]/route.ts
app/api/platform/companies/[id]/suspend/route.ts
app/api/platform/companies/[id]/reactivate/route.ts
app/api/platform/channels/route.ts
app/api/platform/channels/[id]/route.ts
app/api/platform/channels/[id]/credentials/route.ts
app/api/platform/orders/route.ts
app/api/platform/audit/route.ts
app/api/platform/metrics/dashboard/route.ts
app/api/platform/metrics/queue/route.ts
app/api/platform/metrics/pipeline/route.ts
app/api/platform/security/ops-status/route.ts
app/api/platform/auth/mfa/status/route.ts
app/api/platform/impersonate/route.ts                                       (P1)
app/api/platform/billing/subscriptions/route.ts                             (P1)
app/api/platform/health/extended/route.ts                                   (P1)

components/platform/PlatformSidebar.tsx
components/platform/ImpersonationBanner.tsx                                 (P1)

scripts/bootstrap-platform-user.mjs

tests/platform/requirePlatformAccess.test.ts
tests/platform/ipAllowlist.test.ts
tests/platform/auditRedaction.test.ts
```

### Alterar (existentes)

```
proxy.ts
components/AdminShell.tsx
lib/workspace/requireCompanyAccess.ts                                       (P1 impersonate)
lib/api/errors.ts                                                           (Sentry tags)
lib/whatsapp/channelCredentials.ts                                          (actor id)
scripts/check-production-env.mjs
tests/proxy.test.ts
next.config.js                                                              (redirects P3)
docs/SECURITY_IMPROVEMENTS_CHECKLIST.md
docs/DB_CURRENT_STATE.md
docs/ARCHITECTURE.md
.env.example
```

### Remover (P3)

```
app/superadmin/**                           (todo o diretório)
app/api/superadmin/login/route.ts
lib/superadmin/actions.ts
components/superadmin/SuperAdminSidebar.tsx
```

---

## Checklist operacional pré-go-live

1. [ ] Criar usuários Auth para equipe Renthus (emails corporativos)
2. [ ] Rodar `bootstrap-platform-user.mjs` para cada um
3. [ ] Enroll MFA TOTP (Google Authenticator / 1Password)
4. [ ] Configurar VPN ou IP fixo → `PLATFORM_ADMIN_IP_ALLOWLIST`
5. [ ] Alias DNS `admin.lysthub.com.br`
6. [ ] Confirmar Sentry `SENTRY_DSN` captura erros `/api/platform/*`
7. [ ] Smoke audit: suspender empresa teste → ver linha em `platform_audit_log`
8. [ ] Revogar/desativar `SUPERADMIN_SECRET` após P3

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-26 | Checklist criado; decisões D1–D14 fechadas; remoto validado (sem platform_* tables) |
| 2026-08-27 | P0 implementado: migration remota, lib/platform, APIs, UI /platform, proxy, bootstrap, tests |
| 2026-08-27 | P1: billing RPCs/UI, observabilidade, impersonação read-only; host Lysthub adiado (path /platform) |
| 2026-08-27 | P2.1 feature flags + P2.3 convites UI; forbidden page amigável; IP allowlist prod OK |
| 2026-08-27 | P2.4 alertas operacionais + gate WA empresa suspensa + suspend desativa canais |
| 2026-08-27 | P2.2 audit archive (bucket privado + cron mensal); P3 remove legado /superadmin |
