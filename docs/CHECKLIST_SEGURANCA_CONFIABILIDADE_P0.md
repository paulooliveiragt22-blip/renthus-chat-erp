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
| 2 | Error tracking (Sentry) + `/api/health` + uptime | Crítico | [ ] |
| 3 | Idempotência real em `create_order_with_items` | Alto | [x] 2026-08-11 |
| 4 | Hardening RLS das 5 tabelas novas | Alto | [ ] |
| 5 | Runbook de backup/DR do Postgres | Crítico | [ ] |
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

## 2. Error tracking (Sentry) + `/api/health` + uptime monitoring

**Objetivo:** hoje um erro não tratado em produção (ex.: falha na criação de pedido, worker do
chatbot parando) só aparece se alguém for procurar log manualmente no Vercel. Foi exatamente por
isso que o bug do item 1 passou despercebido.

**Arquivos a criar/alterar:**
- `instrumentation.ts` (novo, raiz) — hook do Next.js pra inicializar Sentry server-side.
- `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` (novos, gerados
  pelo wizard `npx @sentry/wizard@latest -i nextjs`).
- `app/api/health/route.ts` (novo) — `GET`: ping simples no Postgres via `createAdminClient()`
  (`select 1` ou equivalente barato) + retorna `{ ok, db: "up"|"down", ts }`; deve estar na
  allowlist do `proxy.ts` (`isTechnicalApiPublic`) pra responder sem sessão.
- `proxy.ts` — adicionar `/api/health` à allowlist.
- Variáveis novas: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (build, source maps).
- Fora do repo: configurar monitor externo (Better Stack / Checkly / UptimeRobot) apontando pra
  `/api/health`, com alerta de downtime.

**Correção:** capturar exceções não tratadas nos Route Handlers (especialmente
`app/api/chatbot/process-queue/route.ts`, `app/api/whatsapp/incoming/route.ts`,
`app/api/billing/charge/route.ts`) com tag `companyId`/`threadId` quando disponível — mesmo padrão
de tags já usado em `flushPipelineRunMetrics` (`src/pro/pipeline/runProPipeline.ts`).

**Resultado esperado:** exceção não tratada em produção aparece no Sentry com stack trace em
minutos, não só quando um cliente reclama; `/api/health` retorna 200/503 conforme saúde do banco;
alerta automático dispara se o app cair ou o cron parar de bater.

**Estado:** [ ]

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

## 5. Runbook de backup/DR do Postgres

**Objetivo:** não existe hoje nenhuma documentação sobre backup, PITR ou restore do banco —
crítico pra sistema que guarda pedido/pagamento/saldo de cliente.

**Arquivos a criar:**
- `docs/DR_RUNBOOK_POSTGRES.md` (novo): documentar (1) qual plano Supabase está ativo e a janela
  de PITR incluída nele; (2) RPO/RTO alvo aceitável pro negócio; (3) passo a passo de restore
  (dashboard Supabase → Database → Backups, ou `pg_restore` se aplicável); (4) o que **não** é
  coberto por PITR (Storage — mídia do WhatsApp, prints — precisa de estratégia própria); (5)
  responsável/on-call; (6) checklist de restore drill (executar 1x, registrar resultado e data).

**Correção:** não é código — é levantar a informação real do plano contratado (via dashboard ou
suporte Supabase) e documentar, depois agendar o primeiro drill de restore num ambiente de teste.

**Resultado esperado:** documento existe, RPO/RTO estão definidos (mesmo que a resposta inicial
seja "aceitamos o padrão do plano X"), e há registro de ao menos 1 drill de restore executado.

**Estado:** [ ]

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

## 9. Rate limit + idempotência em PDV/checkout

**Objetivo:** rotas que movem dinheiro sem `checkRateLimit` (já existe em
`lib/security/rateLimit.ts:19`, assinatura `checkRateLimit(key, limit, windowMs)`) e sem chave de
idempotência (depende do item 3).

**Arquivos a alterar:**
- `app/api/admin/pdv/finalize/route.ts` — adicionar `checkRateLimit` por `companyId`/sessão +
  aceitar/gerar `idempotency_key` no body, repassar pra RPC (item 3).
- `app/api/admin/financeiro/finalize-order/route.ts` — mesma coisa (hoje sem idempotência, retry
  pode duplicar `bills`).
- `lib/public-menu/checkout/createWebMenuOrder.ts` — já tem rate limit no cardápio público
  (confirmar) mas sem idempotência real; conectar à chave do item 3.
- `app/api/billing/create-invoice-checkout/route.ts`, `app/api/admin/ai-wallet/checkout/route.ts` —
  adicionar `checkRateLimit`.

**Resultado esperado:** rajada de requests repetidos na mesma rota/sessão recebe 429; duplo clique
no botão "Finalizar" não cria 2 pedidos/cobranças (mesma `idempotency_key`).

**Estado:** [ ] — depende do item 3 (chave de idempotência precisa existir antes de ser usada aqui).

---

## Riscos aceitos / ordem de execução

- Itens 3 e 9 são **dependentes** (9 usa a chave que 3 cria) — não abrir 9 sem 3 concluído.
- Item 8 é o de maior esforço e menor urgência relativa desta lista — deixar por último de
  propósito, mesmo estando marcado como "Alto".
- Item 6 (CI gate) pode expor uma quantidade grande de erros de lint/tipo pré-existentes — decidir
  na implementação se o gate entra bloqueante de imediato ou com período de tolerância.

---

## Registo de execução

| Data | Item | Nota |
|------|------|------|
| 2026-08-11 | Documento criado; Item 1 corrigido e testado (765 testes verdes) | Rule nova `.cursor/rules/supabase-migrations-seguranca.mdc` criada junto |
