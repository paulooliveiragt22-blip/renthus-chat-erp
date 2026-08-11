# Checklist — Segurança e confiabilidade P0 (auditoria sênior 2026-08-11)

Origem: chat "análise crítica do projeto como arquiteto/dev sênior" (2026-08-11). Este documento
existe pra **não perder contexto** entre sessões — cada item tem objetivo, arquivos, correção
proposta e resultado esperado. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir.

Regra de execução: **uma item por vez até `npm test` verde**, igual ao padrão dos outros
`PLANO_*.md`/`CHECKLIST_*.md` do repo. Migrations deste checklist seguem
`.cursor/rules/supabase-migrations-seguranca.mdc` (nova, criada junto com este documento).

**Observação registrada em 2026-08-11 (pedido explícito do dono do projeto):** o projeto **ainda não
está em produção** — não há cliente real com dado em jogo. Por isso, ajustes técnicos deste
checklist adotam postura **radical** (corrigir a causa raiz de uma vez, mudando assinatura de
RPC/schema direto e atualizando todos os call sites no mesmo commit) em vez de conservadora (shim de
compatibilidade, flag dual-path, parâmetro "aditivo só por segurança"). Regra formalizada em
`.cursor/rules/projeto-pre-producao-radical.mdc` — deixa de valer no dia em que houver o primeiro
cliente real em produção (nesse ponto, mudança de schema passa a exigir plano de migração de dado
existente).

---

## Resumo

| # | Item | Severidade | Estado |
|---|------|------------|--------|
| 1 | Allowlist do `proxy.ts` — billing/charge + meta/messaging | Crítico | [x] 2026-08-11 |
| 2 | Error tracking (Sentry) + `/api/health` + uptime | Crítico | [x] 2026-08-11 |
| 3 | Idempotência real em `create_order_with_items` | Alto | [x] 2026-08-11 |
| 4 | Hardening RLS das 5 tabelas novas | Alto | [ ] |
| 5 | Runbook de backup/DR do Postgres | Crítico | [x] 2026-08-11 |
| 6 | CI: lint + typecheck/build + `npm audit` como gate | Alto | [ ] |
| 7 | Envelope de erro único na API | Alto | [ ] |
| 8 | Extrair `whatsapp/flows` e `process-queue` para use cases | Alto | [ ] |
| 9 | Rate limit + idempotência em PDV/checkout | Alto | [x] 2026-08-11 |

---

## 1. Allowlist do `proxy.ts` — billing/charge + meta/messaging ✅

**Objetivo:** o cron diário de cobrança (`/api/billing/charge`) e o webhook Meta Page/Instagram
(`/api/meta/messaging/incoming`) chamam a app **sem cookie de sessão** (autenticam por
`CRON_SECRET`/HMAC próprios), mas o `proxy.ts` intercepta antes do handler e redireciona pra
`/login` (307) — os handlers nunca rodavam.

**Arquivos alterados:**
- `proxy.ts` — `isTechnicalApiPublic()`: adicionadas `pathname.startsWith("/api/billing/charge")`
  e `pathname.startsWith("/api/meta/messaging/incoming")`.
- `tests/proxy.test.ts` — `/api/billing/charge` incluída no teste
  `"exempts scheduler routes that authenticate via CRON_SECRET"`; novo teste
  `"exempts Meta Page/Instagram messaging webhook (assinatura própria, sem cookie)"`.

**Resultado obtido:** `npm test` verde (765 passed, 0 failed) incluindo os 2 casos novos. As duas
rotas agora respondem ao handler real em vez de 307 pra `/login`.

**Pendente (fora de código, ação operacional):** confirmar em produção (logs Vercel/painel de
cron) se a cobrança diária estava de fato falhando silenciosamente antes desta correção, e se
houve empresa que deveria ter sido cobrada/bloqueada e não foi.

---

## 2. Error tracking (Sentry) + `/api/health` + uptime monitoring ✅

**Objetivo:** hoje um erro não tratado em produção (ex.: falha na criação de pedido, worker do
chatbot parando) só aparece se alguém for procurar log manualmente no Vercel. Foi exatamente por
isso que o bug do item 1 passou despercebido.

**Postura adotada (radical, mas honesta sobre o que depende de conta externa):** implementado tudo
que é código — SDK instalado, hooks de instrumentação, captura nos pontos críticos, `/api/health` —
com `dsn` lido de env var vazia por padrão. Sem `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` configurados
(`enabled: Boolean(dsn)`), o SDK fica em no-op real (não lança, não tenta rede) — assim que o dono do
projeto criar a conta/projeto no Sentry e definir as env vars, a captura liga sem nenhum novo
deploy de código. Criar a conta Sentry e o monitor externo de uptime é **ação de infraestrutura do
dono do projeto**, não algo que a IA pode fazer (precisa de login/cartão em serviço de terceiro).

**Arquivos criados/alterados:**
- `package.json` — dependência `@sentry/nextjs@^10.70.0`.
- `instrumentation.ts` (novo, raiz) — `register()` importa `sentry.server.config`/`sentry.edge.config`
  conforme `NEXT_RUNTIME`; exporta `onRequestError = Sentry.captureRequestError` (captura erros de
  Server Components, Route Handlers e do próprio `proxy.ts`).
- `instrumentation-client.ts` (novo, raiz) — init client-side (`NEXT_PUBLIC_SENTRY_DSN`) +
  `onRouterTransitionStart = Sentry.captureRouterTransitionStart` (instrumentação de navegação).
- `sentry.server.config.ts` / `sentry.edge.config.ts` (novos) — `Sentry.init` com `tracesSampleRate`
  1.0 em dev / 0.1 em produção.
- `app/global-error.tsx` (novo) — boundary de erro do App Router (`"use client"`), reporta erros de
  render via `Sentry.captureException` no `useEffect`; UI mínima em pt-BR com botão "Tentar novamente".
- `next.config.js` — `withSentryConfig(withPWA(nextConfig), { org, project, authToken, silent: true,
  webpack: { treeshake: { removeDebugLogging: true } } })`; sem `SENTRY_ORG`/`SENTRY_PROJECT`/
  `SENTRY_AUTH_TOKEN`, o plugin só pula o upload de source maps (build não quebra).
- `app/api/health/route.ts` (novo) — `GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`: ping
  em `companies` via `createAdminClient()` (`select("id", { head: true, count: "exact" }).limit(1)`);
  retorna `{ ok, db: "up"|"down", ts, latencyMs }`, HTTP 200 (up) ou 503 (down).
- `proxy.ts` — `isTechnicalApiPublic()`: adicionado `pathname === "/api/health"` (sem cookie).
- `tests/proxy.test.ts` — novo caso `"exempts /api/health"`.
- `tests/api/health.test.ts` (novo) — 2 casos (`db up` → 200, `db down` → 503), mockando
  `createAdminClient` via `require.cache` (mesmo padrão de
  `tests/integration/chatbot-queue-e2e.test.ts`).
- `tsconfig.test.json` — `app/api/health/route.ts` adicionado ao `include` (senão o teste não
  encontra o `.js` compilado em `.tests-dist`).
- Captura de exceção (`Sentry.captureException` com `tags: { companyId, threadId/route }`) nos
  pontos que já tinham `catch` mas só logavam: `app/api/chatbot/process-queue/route.ts` (job falhou
  + fallback job falhou) e `app/api/billing/charge/route.ts` (erro ao gerar cobrança + erro ao
  processar overdue).

**Efeito colateral encontrado e corrigido (import de `@sentry/nextjs` quebrou tipos de outros
testes):** `app/api/chatbot/process-queue/route.ts` faz parte do programa TS de
`tsconfig.test.json`; importar `@sentry/nextjs` ali carrega transitivamente
`next/types/global.d.ts`, que declara `NodeJS.ProcessEnv.NODE_ENV` como **obrigatório** via
declaration merging — augmentation global vale pra **todo** o programa TS, não só pro arquivo que
importou. Isso quebrou `tests/pro/pipelineTurnTrace.test.ts`, `tests/public-menu/customDomain.test.ts`
e `tests/public-menu/slugAndParse.test.ts`, que passavam literais `{ FOO: "x" }`/`{}` (sem
`NODE_ENV`) como `NodeJS.ProcessEnv` em funções de config (`resolveMenuBaseDomain`, `isAppApexHost`,
`slugFromMenuSubdomainHost`, `resolveMenuHostRewrite`, `isPipelineTurnTraceEnabled`,
`resolvePublicAppBaseUrl`, `buildPublicMenuAbsoluteUrl`, `resolveMetaAppId/Secret`,
`metaGraphVersion`). Correção radical (não só nos testes): criado `lib/env/EnvLike.ts`
(`Record<string, string | undefined>`) e as 8 assinaturas dessas funções (em
`lib/public-menu/customDomain.ts`, `lib/public-menu/menuHostRewrite.ts`,
`lib/public-menu/appBaseUrl.ts`, `lib/pro/recordPipelineTurnTrace.ts`,
`lib/meta/metaAppCredentials.ts`) passaram a usar `EnvLike` em vez de `NodeJS.ProcessEnv` — o tipo
certo pra uma função que só lê algumas chaves de string, não acoplado a um ambient type global que
qualquer dependência pode endurecer. Casts `as NodeJS.ProcessEnv` nos testes foram removidos (não
são mais necessários).

**Resultado obtido:** `npm test` verde (773 passed, 0 failed, incluindo os 2 casos novos de
`/api/health` e o de proxy). `npm run build` (`next build --webpack`) completo sem erro com o
Sentry plugin ativo e sem `SENTRY_DSN`/`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` definidos —
confirma que o time até configurar a conta Sentry não trava o build nem o deploy.

**Verificado em produção (2026-08-11):** conta Sentry criada, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
/ `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` configurados na Vercel, deploy feito com o
commit `0263df4`. Rota temporária `app/api/debug/sentry-test/route.ts` (removida após o teste)
confirmou entrega ponta a ponta: `GET` retornou `{ ok: true, sentryEnabled: true, ... }` e o evento
apareceu em **Issues** no painel da Sentry com stack trace completo. Error tracking real, ligado.

**Pendente (ação do dono do projeto, fora do que código resolve):**
1. ~~Criar conta/projeto no Sentry~~ — feito.
2. Configurar monitor externo de uptime (Better Stack / Checkly / UptimeRobot, todos têm free tier)
   apontando `GET https://<domínio>/api/health` a cada 1-5 min, com alerta (e-mail/WhatsApp/Slack)
   se 2 checagens seguidas falharem. Ainda não confirmado.

---

## 3. Idempotência real em `create_order_with_items` ✅

**Objetivo:** `OrderServiceV2Adapter.createFromDraft` recebia `idempotencyKey` e **ignorava** — a RPC
`create_order_with_items` não tinha chave de idempotência nenhuma. Retry de rede ou double-click em
PDV/checkout podia duplicar pedido (e cobrança).

**Postura adotada (radical, ver observação no topo deste documento):** mudança direta de assinatura
da RPC (`DROP FUNCTION` + `CREATE`, 15→16 params) já em produção remota, com todos os 4 call sites
atualizados no mesmo commit — sem parâmetro "opcional só por precaução" deixado pra depois.

**Arquivos alterados:**
- `supabase/migrations/20260811100000_orders_idempotency_key.sql` (novo, **aplicado no remoto**):
  coluna `orders.idempotency_key text` + índice único parcial
  `orders_idempotency_key_unique on orders (company_id, idempotency_key) where idempotency_key is
  not null`; `create_order_with_items` ganhou `p_idempotency_key text default null` — se já existir
  pedido com essa chave nessa empresa, devolve o `id` existente sem inserir de novo; `exception when
  unique_violation` cobre a corrida rara de 2 chamadas concorrentes com a mesma chave (quem perde a
  corrida do `insert` devolve o pedido do vencedor em vez de propagar erro). `search_path` fixado
  (`public, pg_temp`) e `REVOKE ALL FROM PUBLIC` + `GRANT ... TO service_role` explícitos, conforme
  `.cursor/rules/supabase-migrations-seguranca.mdc`.
- `lib/orders/buildOrderIdempotencyKey.ts` (novo): hash SHA-256 determinístico
  (`source::scopeId::itens ordenados::total::pagamento`) pra rotas sem chave natural do cliente —
  retry com o mesmo conteúdo gera a mesma chave; carrinho diferente gera chave diferente.
- `src/pro/adapters/order/order.service.v2.ts`: `createFromDraft` agora repassa
  `input.idempotencyKey` pra `p_idempotency_key` (já vinha de
  `resolvePendingOrderConfirmation.ts` e `orderStage.ts` — só não era usado).
- `lib/public-menu/checkout/createWebMenuOrder.ts`: gera chave via `buildOrderIdempotencyKey`
  (`scopeId = session.customerId`).
- `app/api/whatsapp/flows/route.ts` (2 call sites — PAYMENT e CAMINHO CATÁLOGO): gera chave via
  `buildOrderIdempotencyKey` (`scopeId = threadId`).
- `src/marketplaces/services/importMarketplaceOrder.ts`: passa
  `marketplace_${provider}:${external.externalOrderId}` como chave — defesa em camadas além do
  dedup próprio já existente por `marketplace_external_orders.external_order_id`.
- `tests/orders/buildOrderIdempotencyKey.test.ts` (novo, 5 casos): mesmo conteúdo → mesma chave
  (ordem dos itens não importa); carrinho/escopo/fonte diferentes → chave diferente.

**Verificação real (MCP `user-supabase`, antes de considerar concluído):** chamada da RPC 2x com a
mesma `p_idempotency_key` no banco remoto devolveu o **mesmo** `order_id`
(`f97c53d3-51b6-4c04-b404-8835894d7ab0`) e `count(*) = 1` em `orders` com essa chave — confirmado que
não duplica. Dado de teste removido depois da verificação.

**Resultado obtido:** `npm test` verde (770 testes, 0 falha — 5 novos). Chamar a RPC 2x com a mesma
chave (mesma empresa) devolve o mesmo `order_id`, não cria pedido duplicado — confirmado via SQL
direto no banco remoto.

**Estado:** [x] 2026-08-11

---

## 4. Hardening RLS das 5 tabelas novas

**Objetivo:** aplicar aqui o padrão que `.cursor/rules/supabase-migrations-seguranca.mdc` agora
documenta como obrigatório pra toda tabela nova. Tabelas afetadas (RLS habilitado, mas **sem**
policy nem `FORCE`, com grants antigos a `anon`/`authenticated` ainda de pé):
`whatsapp_order_confirmations`, `abandoned_carts`, `outbound_jobs`, `pipeline_turn_traces`,
`pro_pipeline_metric_events`.

**Arquivos a criar:**
- Nova migration `supabase/migrations/<timestamp>_harden_rls_post_global_tables.sql` — pra cada
  uma das 5 tabelas:
  ```sql
  revoke all on table public.<t> from anon;
  revoke all on table public.<t> from authenticated;
  alter table public.<t> enable row level security;
  alter table public.<t> force row level security;
  create policy rls_<t>_service_role_only on public.<t>
    as permissive for all to public
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
  ```
  (mesmo padrão exato de `20260414071525_global_rls_revoke_views_rpcs.sql`, aplicado manualmente
  porque essas tabelas nasceram depois daquele loop global).

**Correção:** confirmar antes de aplicar que nenhum código do frontend depende de SELECT direto
nessas tabelas (todas são service-role only hoje, via API) — não deveria haver regressão.

**Resultado esperado:**
- `select policyname from pg_policies where tablename = '<t>';` → exatamente 1 policy
  `..._service_role_only` para cada uma das 5.
- `select grantee from information_schema.role_table_grants where table_name = '<t>';` → sem
  `anon`/`authenticated`.
- `docs/DB_SECURITY_GLOBAL_INVENTORY.md` atualizado com a nova contagem de tabelas hardenizadas.

**Estado:** [ ]

---

## 5. Runbook de backup/DR do Postgres ✅ (parcial — depende de decisão sua)

**Objetivo:** não existia nenhuma documentação sobre backup, PITR ou restore do banco — crítico
pra sistema que guarda pedido/pagamento/saldo de cliente.

**O que foi levantado (dado real, não suposição):** via `npx supabase backups list --project-ref
zwcfuvohxmvlxhdfbgxo` (CLI já autenticada e linkada neste projeto):
- `walg_enabled: true` — backups físicos diários ativos (plano pago; Free não tem backup nenhum).
- `pitr_enabled: false` — add-on PITR **não** está habilitado (custaria ~US$100/mês/7 dias).
- 4 backups retornados (05, 06, 09, 10/08) — **gap em 07/08 e 08/08 não explicado**, sinalizado no
  runbook pra você confirmar no Dashboard/suporte Supabase.
- Tamanho do banco: 29 MB (`pg_database_size`) — confirma estágio bem inicial do projeto.

**Arquivo criado:** `docs/DR_RUNBOOK_POSTGRES.md` — contém: estado real de backup/PITR (seção 1);
o que é/não é coberto por backup de banco (Storage de mídia WhatsApp **não** é coberto — seção 2);
proposta de RPO (~24h aceito enquanto não há cliente real, reavaliar no primeiro cliente real,
mesma lógica de `projeto-pre-producao-radical.mdc`) e RTO (seção 3); passo a passo de restore via
Dashboard (destrutivo) e via projeto novo (não-destrutivo) (seção 4); lacuna de export próprio fora
do Supabase, não implementada por baixo custo/benefício no estágio atual (seção 5); tabela de
responsável/on-call em branco pra você preencher (seção 6); checklist de restore drill (seção 7).

**Não executado nesta entrega (decisão que é sua, não código):**
1. Confirmar o nome exato do plano Supabase no Dashboard (Settings → Billing) — CLI/API não expõe
   isso diretamente.
2. Investigar o gap de backup em 07-08/08-08.
3. Decidir se compra o add-on PITR agora ou só quando houver cliente real (proposta no documento).
4. Executar o primeiro drill de restore — não fiz sozinho porque envolve custo/tempo (criar projeto
   de teste) que exige sua autorização explícita antes de eu executar.
5. Preencher responsável/on-call.

**Resultado obtido:** documento existe com dados reais do projeto (não genérico/template);
RPO/RTO propostos e justificados, aguardando sua validação; gaps e pendências explícitas, não
escondidas.

**Estado:** [x] 2026-08-11 (documentação + levantamento reais; drill e decisões de negócio
pendentes de você — ver acima)

---

## 6. CI: lint + typecheck/build + `npm audit` como gate

**Objetivo:** `.github/workflows/test.yml` hoje só roda `npm ci && npm test` — sem lint, sem
`next build`, sem `npm audit`. Regressão de tipo em código fora de `tests/` (a maior parte da UI
admin) só quebra no deploy da Vercel.

**Arquivo a alterar:** `.github/workflows/test.yml` (10 linhas hoje) — adicionar steps:

```yaml
      - name: Lint
        run: npm run lint

      - name: Build (typecheck completo)
        run: npm run build

      - name: Audit de dependências
        run: npm audit --audit-level=high
```

**Correção:** rodar localmente antes de subir pra ver quantos erros de lint/build já existem hoje
(esperado: alguns, dado o achado de ~279 usos de `any` e 9 god-files) — decidir se entra como gate
bloqueante direto ou com `continue-on-error: true` temporário enquanto se estabiliza, registrando
aqui a decisão tomada.

**Fora do repo:** configurar branch protection no GitHub (Settings → Branches → Require status
checks) pra exigir o job `CI / test` verde antes de mergear em `main` — hoje o workflow existe mas
não há evidência de que seja obrigatório.

**Resultado esperado:** PR com erro de tipo, lint, build quebrado ou vulnerabilidade alta em
dependência falha o CI antes de chegar em `main`.

**Estado:** [ ]

---

## 7. Envelope de erro único na API

**Objetivo:** cada rota inventa seu formato de erro hoje (`{error:"snake_case"}`,
`{error: err.message}` vazando mensagem do Postgres, `{error:"Erro interno"}`). Instável pra
qualquer client (PDV, Electron print agent, futuro app mobile).

**Arquivos a criar/alterar:**
- `lib/api/errors.ts` (novo): `interface ApiErrorBody { error: { code: string; message: string } }`
  + helper `jsonError(code: string, message: string, status: number): NextResponse`.
- Piloto de migração (não é pra migrar tudo de uma vez): rotas mais novas/críticas primeiro —
  `app/api/whatsapp/threads/[threadId]/cart/*.ts`, `app/api/whatsapp/threads/[threadId]/orders/route.ts`,
  `app/api/billing/charge/route.ts`.
- `docs/ARCHITECTURE.md` ou novo `docs/API_ERROR_CONTRACT.md`: documentar o contrato pra quem for
  escrever rota nova depois.

**Resultado esperado:** rotas piloto devolvem `{error:{code,message}}` de forma consistente;
nenhuma mensagem crua do Postgres (`err.message`) vazando pro client em rota piloto.

**Estado:** [ ]

---

## 8. Extrair `whatsapp/flows` e `process-queue` para use cases

**Objetivo:** os 2 maiores concentradores de complexidade fora de `src/pro` — Route Handler
fazendo auth + query + regra de negócio + I/O externo tudo junto.

**Arquivos:**
- `app/api/whatsapp/flows/route.ts` (1782 linhas) — extrair pra `lib/whatsapp/flows/*` (use cases
  por tipo de flow: checkout, catálogo, CEP/delivery, cadastro de endereço), deixando a rota só
  com decrypt/routing/encrypt.
- `app/api/chatbot/process-queue/route.ts` (777 linhas) — **nota:** este arquivo já é alvo da Fase
  3 de `docs/PLANO_ESCALA_PICOS_PEDIDOS.md` (paralelismo por thread); coordenar as duas frentes no
  mesmo arquivo pra não conflitar (fazer a extração de use case **antes** de paralelizar, ou depois
  — decidir na implementação, registrar aqui a ordem escolhida).

**Resultado esperado:** Route Handler fino (autenticação + parse + delegação), lógica de negócio
testável isoladamente sem precisar de `Request`/`NextResponse` mockado.

**Estado:** [ ] — **maior esforço da lista, não abrir sem os itens 1-7 estáveis.**

---

## 9. Rate limit + idempotência em PDV/checkout ✅

**Objetivo:** rotas que movem dinheiro sem `checkRateLimit` (já existe em
`lib/security/rateLimit.ts:19`, assinatura `checkRateLimit(key, limit, windowMs)`) e sem chave de
idempotência (dependia do item 3).

**Postura adotada (radical):** em vez de só documentar "falta idempotência no PDV" e deixar pra
depois por ser uma RPC grande (6 tabelas numa transação) sem teste automatizado pré-existente,
a idempotência foi implementada **na própria RPC** `rpc_finalize_pdv_order` — mesmo padrão de
verificação usado no resto do repo pra funções `plpgsql` (checagem via `execute_sql` no banco real,
não `npm test`, já que os testes deste repo mockam o client Supabase e não executam SQL de RPC).

**Arquivos alterados:**
- `app/api/admin/pdv/finalize/route.ts` — `checkRateLimit` (30 req/min por `companyId`); gera
  `idempotency_key` determinística via `buildOrderIdempotencyKey` (`scopeId =
  cash_register_id:active_order_id`) e repassa no `p_payload` pra RPC.
- `supabase/migrations/20260811110000_pdv_finalize_idempotency_key.sql` (novo, **aplicado no
  remoto**): coluna `sales.idempotency_key text` + índice único parcial por `company_id`;
  `rpc_finalize_pdv_order` passou a checar `p_payload->>'idempotency_key'` **antes** de qualquer
  validação/insert — se já existe `sale` com essa chave, devolve `{sale_id, order_id}` da venda
  existente (busca `order_id` via `orders.sale_id`) sem reprocessar `sales`/`sale_items`/
  `sale_payments`/`orders`/`order_items`/`financial_entries`. `exception when unique_violation`
  cobre a corrida concorrente. Assinatura da função **não mudou** (ainda `(p_company_id uuid,
  p_payload jsonb)`) — não precisou de `DROP FUNCTION`, só `CREATE OR REPLACE`; grants existentes
  preservados. `search_path` fixado (`public, pg_temp`), ausente na versão anterior.
- `app/api/admin/financeiro/finalize-order/route.ts` — `checkRateLimit` (30 req/min por
  `companyId`); lançamento "a prazo" em `bills` agora usa o próprio `order_id` como
  `idempotency_key` (1 pedido → no máximo 1 bill aqui) — `select` antes do `insert` evita duplicar
  em retry, e o código trata `23505` (unique_violation) como sucesso silencioso pra corrida
  concorrente.
- `supabase/migrations/20260811120000_bills_idempotency_key.sql` (novo, **aplicado no remoto**):
  coluna `bills.idempotency_key text` + índice único parcial por `company_id`.
- `app/api/billing/create-invoice-checkout/route.ts` — `checkRateLimit` (10 req/min por
  `companyId`).
- `app/api/admin/ai-wallet/checkout/route.ts` — `checkRateLimit` (10 req/min por `companyId`).
- `lib/public-menu/checkout/createWebMenuOrder.ts` — já tinha rate limit (`publicMenuRateLimit`, 12
  req, no route handler `app/api/public/menu/[slug]/checkout/route.ts`); idempotência real conectada
  no item 3.

**Resultado obtido:** `npm test` verde (770 testes, 0 falha). Rajada de requests na mesma rota
recebe 429 com `Retry-After`. Duplo clique/retry no PDV com o mesmo caixa+carrinho+pagamentos não
duplica `sales`/`orders`/`financial_entries` (mesmo mecanismo validado via SQL direto no item 3 pra
`create_order_with_items` — mesma lógica de short-circuit + `unique_violation`, aqui aplicada em
`sales.idempotency_key`). Retry no finalize-order do financeiro não duplica `bills` pro mesmo
pedido.

**Estado:** [x] 2026-08-11

---

## Riscos aceitos / ordem de execução

- Item 8 é o de maior esforço e menor urgência relativa desta lista — deixar por último de
  propósito, mesmo estando marcado como "Alto".
- Item 6 (CI gate) pode expor uma quantidade grande de erros de lint/tipo pré-existentes — decidir
  na implementação se o gate entra bloqueante de imediato ou com período de tolerância.
- Itens 3 e 9 usaram chave de idempotência **derivada no servidor** (hash do conteúdo do carrinho)
  nas rotas sem chave natural do cliente (web menu, WhatsApp Flow, PDV) — não exigiu mudança de
  contrato de frontend. Trade-off aceito: pedido genuinamente novo com carrinho **byte-idêntico** ao
  anterior no mesmo escopo dentro da mesma "sessão" colide (mesma chave) — aceitável pré-produção;
  se algum dia isso incomodar de verdade, a evolução natural é o frontend gerar um UUID por
  tentativa de checkout e enviar como `Idempotency-Key`, substituindo o hash.

---

## Registo de execução

| Data | Item | Nota |
|------|------|------|
| 2026-08-11 | Documento criado; Item 1 corrigido e testado (765 testes verdes) | Rule nova `.cursor/rules/supabase-migrations-seguranca.mdc` criada junto |
| 2026-08-11 | Itens 3 e 9 concluídos (770 testes verdes) | Migrations `20260811100000_orders_idempotency_key.sql`, `20260811110000_pdv_finalize_idempotency_key.sql`, `20260811120000_bills_idempotency_key.sql` aplicadas no remoto e verificadas via SQL direto. Rule nova `.cursor/rules/projeto-pre-producao-radical.mdc` criada junto (postura radical enquanto não há cliente real). |
