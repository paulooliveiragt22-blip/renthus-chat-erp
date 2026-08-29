# ADR-0003 — Fila SQS (outbox Postgres) + Lambda workers

## Status

**Aceito** (2026-08-28) — pré-produção, decisão radical SQS-first.

## Contexto

O chatbot inbound/outbound usa hoje:

| Peça | Implementação atual |
|------|---------------------|
| Enqueue | `INSERT` em `chatbot_queue` / `outbound_jobs` |
| Claim | RPC `claim_chatbot_queue_jobs` / `claim_outbound_jobs` (fairness SQL) |
| Worker | `GET /api/chatbot/process-queue` e `GET /api/chatbot/outbound-worker` na **Vercel** (`maxDuration=60`) |
| Gatilho | `after()` → HTTP wake (`queueWorkerWake`, `outboundWorkerWake`) + cron-job.org + crons diários em `vercel.json` + (planejado) `pg_cron` drain 10s |
| Dedup/coalesce/backlog | Queries em `chatbot_queue` (`incoming`, `coalesce.ts`, `backlogNotice.ts`, `getQueueHealthStats`) |

**Problemas no desenho atual (confirmados no repo):**

1. **Fila e OLTP no mesmo Postgres** — claim/poll quente compete com pedidos/sessões.
2. **Worker serverless** — self-wake em cadeia (`CHATBOT_QUEUE_DRAIN_MAX`), cold start, teto 60s, GB-hours na Vercel.
3. **Três schedulers** para a mesma fila (wake, cron externo, `pg_cron` drain) — complexidade ops sem ganho após SQS.
4. **Fairness e single-flight** estão no SQL — migrar “só SendMessage” perde comportamento se não for redesenhado.
5. **Lambda free tier não cobre** carga real (~100 empresas) — SQS sim; compute precisa de sizing consciente.

**Meta de escala:** ~100 empresas × ~10k pedidos/mês; driver de carga = **mensagens + turnos LLM**, não pedidos/mês.

**Princípio (pré-produção):** uma migração radical, sem dual-path prolongado. Outbox Postgres mantém dedup, coalesce, observabilidade platform; SQS transporta trabalho; Lambda executa.

---

## Decisão

1. **Outbox transacional:** continuar `INSERT` em `chatbot_queue` / `outbound_jobs` (fonte de verdade + idempotência + UI ops).
2. **Transporte:** após insert bem-sucedido, `SendMessage` SQS (fire-and-forget via `after()` no webhook).
3. **Consumo:** **AWS Lambda** com event source mapping (não polling HTTP na Vercel).
4. **Filas FIFO** inbound (ordem por conversa) e outbound (ordem por empresa); DLQ dedicada por fila.
5. **Remover** wake HTTP, self-drain, claim RPC no hot path, crons Vercel/pg_cron de **drain** de fila.
6. **Manter** na Vercel: webhooks, UI, APIs tenant, crons **sem fila** (billing, marketplace, platform alerts) via **EventBridge Scheduler → HTTP**.
7. **Upstash obrigatório** em prod: rate limit + `LLM_GLOBAL_MAX_IN_FLIGHT` + fairness auxiliar por `company_id`.

---

## Arquitetura alvo

```
┌─────────────────────────────────────────────────────────────────┐
│ Vercel (Next.js)                                                │
│  POST /api/whatsapp/incoming | /api/meta/messaging/incoming    │
│    1. validação Meta + dedup whatsapp_messages                  │
│    2. INSERT chatbot_queue (status=pending, outbox)             │
│    3. after() → SQS SendMessage({ v, kind, jobId, ... })        │
│    4. 200 rápido                                                │
│  enqueue outbound_jobs + after(SQS) nos produtores existentes   │
└────────────────────────────┬────────────────────────────────────┘
                             │ SendMessage (IAM user / keys Vercel)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ AWS SQS FIFO                                                    │
│  rethus-inbound.fifo   (MessageGroupId = thread_id)             │
│  rethus-outbound.fifo  (MessageGroupId = company_id)            │
│  *.dlq.fifo                                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ event source mapping
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ AWS Lambda                                                      │
│  rethus-inbound-worker   (PRO pipeline, 1024MB, timeout 120s)   │
│  rethus-outbound-worker  (Meta send, 512MB, timeout 60s)        │
│    → lib/chatbot/queue/* | lib/chatbot/outbound/* (reuse)       │
│    → Supabase service role via pooler :6543                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Supabase Postgres                                               │
│  chatbot_queue / outbound_jobs (estado, audit, coalesce, ops)   │
│  pg_cron: cleanup_chatbot_queue_old_jobs (diário) — MANTER      │
└─────────────────────────────────────────────────────────────────┘

EventBridge Scheduler ──HTTP──► Vercel /api/billing/*, /api/marketplace/*,
                               /api/platform/alerts/*, /api/chatbot/reactivate,
                               /api/chatbot/detect-abandoned-carts
                               (Bearer CRON_SECRET)
```

---

## Contratos de mensagem SQS

### Envelope comum (body JSON, UTF-8, ≤ 256 KB)

```json
{
  "v": 1,
  "kind": "inbound",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "companyId": "uuid",
  "threadId": "uuid",
  "enqueuedAt": "2026-08-28T18:00:00.000Z"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `v` | sim | Versão do contrato (`1`) |
| `kind` | sim | `inbound` \| `outbound` |
| `jobId` | sim | PK da outbox (`chatbot_queue.id` ou `outbound_jobs.id`) |
| `companyId` | sim | Tenant; usado em métricas e fairness Upstash |
| `threadId` | inbound: sim; outbound: sim | FIFO group inbound |
| `enqueuedAt` | sim | ISO8601; debug/latência |

**Não** enviar no SQS: `body_text`, payload Meta, tokens — o worker carrega da outbox por `jobId` (payload já persistido).

### Atributos FIFO

| Fila | `MessageGroupId` | `MessageDeduplicationId` |
|------|------------------|---------------------------|
| `renthus-inbound.fifo` | `thread_id` | `jobId` (UUID único por job) |
| `renthus-outbound.fifo` | `company_id` | `jobId` |

### Semântica de entrega

- **At-least-once** — worker idempotente via estado outbox + coalesce + idempotência de efeito (pedido/RPC).
- **Ordem:** garantida **por thread** (inbound) e **por empresa** (outbound), não global entre tenants.
- **Retry:** visibility timeout + redrive para DLQ (`maxReceiveCount`, ver envs).
- **Backoff retryable (429 LLM):** worker **não** deleta mensagem; `ChangeMessageVisibility` com delay OU re-`SendMessage` com `DelaySeconds` (≤ 900) após atualizar `attempts`/`scheduled_at` na outbox.

---

## Filas AWS (naming canônico)

| Recurso | Nome sugerido | Notas |
|---------|---------------|-------|
| Fila inbound | `renthus-inbound.fifo` | High throughput mode se >300 msg/s/grupo |
| DLQ inbound | `renthus-inbound-dlq.fifo` | Alarm CloudWatch |
| Fila outbound | `renthus-outbound.fifo` | Worker separado (menor memória) |
| DLQ outbound | `renthus-outbound-dlq.fifo` | |
| Lambda inbound | `renthus-inbound-worker` | Reserved concurrency ligada ao teto LLM |
| Lambda outbound | `renthus-outbound-worker` | Concurrency maior, memória menor |
| Reconciler (opc.) | EventBridge → Lambda 5 min | Jobs `pending` sem `sqs_enqueued_at` |

**Região:** mesma de menor latência Vercel↔Supabase (ex. `sa-east-1` se Supabase estiver próximo; validar latência real).

---

## Outbox Postgres (alterações de schema)

Migration única (radical — sem dual-path eterno):

```sql
-- chatbot_queue + outbound_jobs
ALTER TABLE chatbot_queue
  ADD COLUMN IF NOT EXISTS sqs_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sqs_message_id text;

ALTER TABLE outbound_jobs
  ADD COLUMN IF NOT EXISTS sqs_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sqs_message_id text;

CREATE INDEX IF NOT EXISTS chatbot_queue_outbox_pending_idx
  ON chatbot_queue (created_at ASC)
  WHERE status = 'pending' AND sqs_enqueued_at IS NULL;

CREATE INDEX IF NOT EXISTS outbound_jobs_outbox_pending_idx
  ON outbound_jobs (created_at ASC)
  WHERE status = 'pending' AND sqs_enqueued_at IS NULL;
```

**Fluxo de estados (`chatbot_queue`):**

```
pending (+ sqs_enqueued_at set após SendMessage OK)
  → processing (Lambda inicia, attempts++)
  → done | failed
  → pending (retry retryable: re-enqueue SQS ou visibility)
```

**Manter:** unique `(company_id, message_id)`, índices coalesce/dedup, RPCs de reclaim **deprecated** após cutover (remover em migration posterior).

---

## Variáveis de ambiente

### Vercel (prod)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `AWS_REGION` | sim | ex. `sa-east-1` |
| `AWS_ACCESS_KEY_ID` | sim | IAM user **só** `sqs:SendMessage`, `sqs:GetQueueUrl` nas 2 filas |
| `AWS_SECRET_ACCESS_KEY` | sim | |
| `SQS_INBOUND_QUEUE_URL` | sim | URL `renthus-inbound.fifo` |
| `SQS_OUTBOUND_QUEUE_URL` | sim | URL `renthus-outbound.fifo` |
| `SQS_DISPATCH_ENABLED` | sim | `1` prod; `0` dev local sem AWS |
| `UPSTASH_REDIS_REST_URL` | sim prod | Rate limit + LLM cap |
| `UPSTASH_REDIS_REST_TOKEN` | sim prod | |
| `LLM_GLOBAL_MAX_IN_FLIGHT` | sim prod | ex. `20` — alinhar reserved concurrency Lambda |
| `COMPANY_LLM_MAX_IN_FLIGHT` | sim | ex. `4` |
| `CRON_SECRET` | sim | EventBridge → rotas HTTP restantes |

**Remover / ignorar após cutover:**

| Variável | Motivo |
|----------|--------|
| `CHATBOT_QUEUE_WAKE_URL` | Sem wake HTTP |
| `CHATBOT_QUEUE_WAKE_ENABLED` | idem |
| `CHATBOT_QUEUE_DRAIN_MAX` | idem |
| `OUTBOUND_WORKER_WAKE_ENABLED` | idem |

### Lambda (inbound + outbound)

| Variável | Obrigatório |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | sim |
| `SUPABASE_DB_POOLER_URL` | sim — **Transaction mode :6543** (reduz conexões) |
| `UPSTASH_*`, `LLM_*`, `ANTHROPIC_*`, `WHATSAPP_*` | sim (mesmo conjunto do worker atual) |
| `SENTRY_DSN` | recomendado |
| `AWS_REGION` | sim (SDK default) |

**Não** colocar `AWS_ACCESS_KEY_ID` na Lambda — role IAM com `sqs:ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility`, `GetQueueAttributes`.

### EventBridge Scheduler

| Job | Schedule | Target |
|-----|----------|--------|
| `reactivate` | `rate(5 minutes)` | `GET https://app.renthus.com.br/api/chatbot/reactivate` |
| `detect-abandoned-carts` | `rate(5 minutes)` | `GET .../api/chatbot/detect-abandoned-carts` |
| `billing-charge` | `cron(0 11 * * ? *)` | `GET .../api/billing/charge` |
| `marketplace-sync` | `cron(0 4 * * ? *)` | `GET .../api/marketplace/sync-catalog` |
| `platform-alerts` | `rate(15 minutes)` | `GET .../api/platform/alerts/check` |
| `platform-audit-archive` | `cron(0 5 1 * ? *)` | `GET .../api/platform/audit/archive` |
| `outbox-reconcile` (opc.) | `rate(5 minutes)` | Lambda leve: scan outbox pending sem SQS |

Header comum: `Authorization: Bearer ${CRON_SECRET}`.

---

## Mudanças de código — ganhos reais (re-análise)

Itens **não** enfatizados na proposta inicial e com impacto direto:

### P0 — Extrair núcleo do worker (obrigatório)

| Ação | Ganho |
|------|-------|
| Criar `lib/chatbot/queue/processInboundJobById.ts` — carrega row, `runQueueEntryWithOutcome`, retorno estruturado | Lambda e testes **sem** NextRequest/NextResponse |
| Criar `lib/chatbot/outbound/processOutboundJobById.ts` — extrair loop de `outbound-worker/route.ts` | Mesmo benefício; outbound Lambda **512MB** vs inbound **1024MB** |
| Pacote `workers/inbound/` e `workers/outbound/` (esbuild → zip Lambda) | Deploy independente; **GB-s outbound ~4× menor** |

### P0 — Dispatch SQS

| Ação | Ganho |
|------|-------|
| `lib/queue/sqsDispatch.ts` — `dispatchChatbotJob(jobRow)`, `dispatchOutboundJob(jobRow)` | Um ponto de enqueue; testável |
| Após `SendMessage` OK → `UPDATE sqs_enqueued_at`, `sqs_message_id` | Outbox reconciliável |
| `SQS_DISPATCH_ENABLED=0` → no-op (dev/test) | Paridade com testes atuais |

**Call sites a alterar:**

- `app/api/whatsapp/incoming/route.ts` — trocar `scheduleQueueWorkerWake()` por `after(dispatch)`
- `app/api/meta/messaging/incoming/route.ts` — idem
- `lib/chatbot/outbound/outboundWorkerWake.ts` → substituir por dispatch
- `app/api/admin/orders/route.ts`, `detect-abandoned-carts`, `lib/campaigns/enqueueCampaign.ts`

### P0 — Remover caminho HTTP worker (reduz custo/latência)

| Remover | Ganho |
|---------|-------|
| `lib/chatbot/queueWorkerWake.ts` | Elimina invocações Vercel em cascata no pico |
| Self-wake + `parseDrainDepth` em `process-queue/route.ts` | Sem taxa N× invocações por batch |
| `runFallbackProcessing` + `ALLOW_CLAIM_FALLBACK` | Superfície de double-process removida |
| Chamadas RPC `claim_chatbot_queue_jobs` no runtime prod | Poll quente removido do Postgres |

Rotas `GET /api/chatbot/process-queue` e `GET /api/chatbot/outbound-worker`: **deletar** após cutover (ou 410 Gone 1 release).

### P1 — Retry alinhado ao SQS (substitui reclaim parcial)

| Hoje | Novo |
|------|------|
| `scheduled_at` + reclaim RPC + re-claim | Retryable: visibility timeout / re-send SQS com delay mapeado de `queueRetryDelayMs` |
| `reclaim_stuck_chatbot_queue_jobs` | Backup: reconciler marca `processing` stale → `pending` + re-dispatch |

Ajustar `runQueueEntry.ts`: em retry retryable, **não** só `status=pending` — chamar `sqsDispatch.redispatch(jobId, delaySec)`.

### P1 — Fairness multi-tenant (substitui SQL claim)

| Hoje | Novo |
|------|------|
| `max_per_company` no claim SQL | Upstash `renthus:worker:company:{id}` INCR com TTL + limite `CHATBOT_QUEUE_MAX_PER_COMPANY` antes de processar |
| `interleaveQueueJobsByCompany` pós-claim | Desnecessário com FIFO + semáforo |

Implementar em `lib/chatbot/queue/companyWorkerCap.ts` (fail-open se Upstash down, log warn).

### P2 — Coalesce (reduz queries PG por job)

| Hoje | Novo |
|------|------|
| `hasRecentEquivalentProcessed` — 3 SELECTs em `chatbot_queue` | Upstash `SET rethus:coalesce:{key} 1 EX 20 NX` — se falhar SET, coalesce; manter fallback PG 1 release |

Proteções de confirmação de pedido (`isCriticalOrderConfirmationText`) **inalteradas**.

### P2 — Métricas

| Hoje | Novo |
|------|------|
| `emitQueueMetrics` — 2 SELECT extra **toda** invocação wake | Emitir só no Lambda; CloudWatch `ApproximateAgeOfOldestMessage` + `getQueueHealthStats` (platform) |

### P2 — Conexão Supabase na Lambda

Usar client com URL pooler (`6543`, transaction mode) — **obrigatório** antes de subir `CHATBOT_QUEUE_CONCURRENCY` equivalente.

### P3 — Webhook (fora deste ADR, registrar)

Mover parsing pesado para worker (`raw_payload` column) — só se p95 webhook >2s **medido**; não bloquear SQS cutover.

---

## O que dropar (checklist referência)

### `vercel.json` — **remover** entradas

```json
{ "path": "/api/chatbot/process-queue", "schedule": "0 3 * * *" }
{ "path": "/api/chatbot/outbound-worker", "schedule": "20 3 * * *" }
```

**Manter** (ou migrar para EventBridge, crons diários OK no Hobby):

- `/api/billing/charge`
- `/api/chatbot/detect-abandoned-carts` → preferir EventBridge 5 min
- `/api/marketplace/sync-catalog`
- `/api/platform/alerts/check` → preferir EventBridge 15 min
- `/api/platform/audit/archive`

### `pg_cron` — **não aplicar / remover**

| Migration / job | Ação |
|-----------------|------|
| `20260812233000_pg_cron_chatbot_queue_drain.sql` (`chatbot-queue-drain`, 10s) | **Não aplicar** em prod; se já aplicado → migration `unschedule('chatbot-queue-drain')` |
| `20260825150000_chatbot_queue_cleanup_cron.sql` (`chatbot-queue-cleanup`, diário) | **MANTER** — retenção outbox, independente de SQS |

### Código — **remover após cutover**

- `lib/chatbot/queueWorkerWake.ts`
- `lib/chatbot/outbound/outboundWorkerWake.ts`
- `app/api/chatbot/process-queue/route.ts`
- `app/api/chatbot/outbound-worker/route.ts`
- Testes e docs que referenciam wake/drain HTTP como caminho feliz
- Entradas em `proxy.ts` `isTechnicalApiPublic` para `process-queue` e `outbound-worker` (opcional manter 410)

### Serviços externos

- **cron-job.org** — remover jobs `process-queue`, `outbound-worker`, `reactivate` (substituídos por EventBridge)

### RPC Postgres — **deprecar** (migration posterior)

- `claim_chatbot_queue_jobs`
- `reclaim_stuck_chatbot_queue_jobs` (substituir por reconciler app-side)
- `claim_outbound_jobs` / `reclaim_stuck_outbound_jobs`

---

## Lambda — parâmetros iniciais (calibrar com métricas)

| Parâmetro | Inbound | Outbound |
|-----------|---------|----------|
| Memory | 1024 MB | 512 MB |
| Timeout | 120 s | 60 s |
| Batch size | 1 (FIFO ordem) | 5 (grupos diferentes) |
| Reserved concurrency | = `LLM_GLOBAL_MAX_IN_FLIGHT` + 5 | 20 |
| Visibility timeout | 6 × timeout = 720 s | 360 s |
| `maxReceiveCount` → DLQ | 3 | 3 |

**Partial batch failure:** habilitado no inbound se batch > 1 no futuro.

---

## Segurança

- IAM user Vercel: policy mínima `sqs:SendMessage` + `GetQueueUrl` nas 2 filas.
- Lambda role: consume + delete + change visibility na fila principal; read DLQ para alarmes.
- Secrets (`CRON_SECRET`, Supabase) só env/Lambda config — não Parameter Store pago.
- DLQ: alarm SNS → e-mail ops; runbook replay manual.

---

## Consequências

**Positivas**

- Fila quente fora do Postgres; claim SQL removido do hot path.
- Worker desacoplado da Vercel — sem self-wake, cold start no webhook, teto 60s no PRO.
- Observabilidade platform (`getQueueHealthStats`) preservada via outbox.
- EventBridge cobre crons Hobby sem Pro.

**Negativas / riscos**

- Ops AWS (filas, Lambda, IAM, alarms) — complexidade nova.
- At-least-once exige disciplina idempotente (já parcialmente no repo).
- Custo Lambda **não** é free em escala — monitorar GB-s.
- Migração big-bang exige testes integração + reconciler outbox.

---

## Alternativas rejeitadas

| Alternativa | Motivo |
|-------------|--------|
| SQS sem outbox (payload só na fila) | Quebra coalesce, dedup pré-enqueue, platform ops |
| pgmq | Mesmo Postgres; reescreve fairness sem isolar OLTP |
| ECS Fargate agora | Sem free tier; Lambda suficiente até métrica contrária |
| Manter wake + SQS | Dupla entrega, race, custo Vercel |
| Fila Standard inbound | Perde ordem por thread |
| ElastiCache | Upstash já integrado (`rateLimitDistributed`, `llmDistributedCap`) |

---

## Checklist de migração

Legenda: `[ ]` pendente · `[x]` feito · `[-]` N/A

### Fase 0 — Pré-requisitos (ops, sem cutover)

- [ ] Supabase: Compute + Supavisor `:6543` documentado (`PLANO_ESCALA` Fase 0)
- [ ] Upstash prod + `LLM_GLOBAL_MAX_IN_FLIGHT` + `COMPANY_LLM_MAX_IN_FLIGHT`
- [ ] AWS: criar filas FIFO + DLQ (inbound/outbound)
- [x] AWS: Lambda inbound + outbound + event source mappings
- [x] AWS: IAM user Vercel (SendMessage only) + Lambda execution role `renthus-lambda-sqs-worker`
- [ ] AWS: CloudWatch alarm `ApproximateAgeOfOldestMessage` > 120s (inbound)
- [ ] AWS: SNS alarm DLQ depth > 0
- [ ] EventBridge Scheduler: jobs listados na seção envs (exceto process-queue/outbound-worker)
- [ ] Confirmar **`20260812233000_pg_cron_chatbot_queue_drain.sql` NÃO aplicado** em prod
- [ ] Documentar região AWS escolhida + latência Supabase

### Fase 1 — Schema + libs (PR 1)

- [x] Migration: colunas `sqs_enqueued_at`, `sqs_message_id` + índices outbox pending
- [x] Aplicar migration remoto (MCP/CLI) + validar índices
- [x] `lib/queue/sqsDispatch.ts` + testes unitários (mock SDK)
- [x] `lib/chatbot/queue/processInboundJobById.ts`
- [x] `lib/chatbot/outbound/processOutboundJobById.ts`
- [x] `lib/chatbot/queue/companyWorkerCap.ts` (Upstash fairness)
- [x] Env docs / `scripts/check-production-env.mjs` (aviso SQS + required se `SQS_DISPATCH_ENABLED=1`)
- [x] `npm test` verde (sqsDispatch + runQueueEntry — 9/9)

### Fase 2 — Produtores (PR 2)

- [x] `whatsapp/incoming`: `after(dispatch)` via `scheduleInboundAfterEnqueue` (wake até cutover)
- [x] `meta/messaging/incoming`: idem
- [x] Outbound producers: `enqueueCampaign`, `detect-abandoned-carts`, `admin/orders` → afterEnqueue
- [x] `SQS_DISPATCH_ENABLED=0` default em test/dev; dual-path até `SQS_WORKER_CUTOVER=1`
- [x] Testes de contrato producers + flags
- [x] Vercel Production: env vars SQS/AWS (confirmado pelo dono — MCP Vercel sem tool de env)

### Fase 3 — Lambda workers (PR 3)

- [x] `workers/inbound/handler.ts` — consome SQS, chama `processInboundJobById`
- [x] `workers/outbound/handler.ts` — consome SQS, chama `processOutboundJobById`
- [x] Retry: `queueRetryDelayMs` → `ChangeMessageVisibility` + `ReportBatchItemFailures`
- [x] Bundle esbuild + script deploy (`npm run build:workers` / `deploy:workers`)
- [x] Deploy Lambda `sa-east-1` + event source mappings (inbound batch 1, outbound batch 5)
- [ ] Reserved concurrency alinhada a `LLM_GLOBAL_MAX_IN_FLIGHT` (conta AWS: Unreserved mínimo 10 — setar depois com `RENTHUS_LAMBDA_RESERVED=1` ou Service Quotas)
- [ ] Smoke: mensagem synthetic jobId real outbox → Lambda → `done` (script `npm run smoke:sqs-workers` — skip path validado)

### Fase 4 — Cutover produção (PR 4)

- [x] Vercel prod: envs AWS + `SQS_DISPATCH_ENABLED=1` (dono confirmou envs; flag via dashboard/CLI no deploy)
- [x] Remover cron-job.org (process-queue, outbound-worker, reactivate) — #7490619 + #8221331 removidos; reactivate não existia na conta
- [x] Atualizar `vercel.json` — remover crons process-queue e outbound-worker
- [x] Migration `unschedule('chatbot-queue-drain')` se existir
- [x] Deletar rotas `process-queue` e `outbound-worker`
- [x] Deletar `queueWorkerWake.ts`, `outboundWorkerWake.ts`
- [x] Remover entradas `isTechnicalApiPublic` obsoletas em `proxy.ts`
- [x] Atualizar `docs/CHATBOT_PROD.md`, `PLANO_ESCALA_PICOS_PEDIDOS.md` (wake/drain obsoletos → SQS)
- [x] Smoke script `npm run smoke:sqs-workers`
- [ ] Platform `/platform/observabilidade`: confirmar KPIs fila OK (pós-deploy)

### Fase 5 — Otimizações pós-cutover (PR 5+)

- [ ] Coalesce Upstash (P2) + fallback PG
- [ ] Lambda reconciler outbox (`pending` sem `sqs_enqueued_at` > 2 min)
- [ ] Remover RPC claim/reclaim (migration DROP FUNCTION)
- [ ] Remover `emitQueueMetrics` SELECTs redundantes
- [ ] Calibrar memory/timeout/concurrency com CloudWatch Insights (GB-s, p95 duração)
- [ ] ADR review: ECS vs Lambda se GB-s > orçamento acordado

### Fase 6 — Validação escala (~100 empresas)

- [ ] Load test: fila synthetic N mensagens paralelas, p95 idade job < 60s
- [ ] Zero pedido duplicado replay `message_id` (critério `CHATBOT_PROD.md`)
- [ ] Alarmes DLQ e age testados
- [ ] Runbook DLQ replay documentado em `docs/DR_RUNBOOK_POSTGRES.md` ou novo `DR_RUNBOOK_SQS.md`

---

## Referências no repo

| Área | Path |
|------|------|
| Enqueue inbound | `app/api/whatsapp/incoming/route.ts` |
| Worker atual | `app/api/chatbot/process-queue/route.ts` |
| Claim SQL | `supabase/migrations/20260805100000_claim_chatbot_queue_jobs_fair_company.sql` |
| Coalesce | `lib/chatbot/queue/coalesce.ts` |
| Outbound | `app/api/chatbot/outbound-worker/route.ts` |
| Platform stats | `lib/platform/services/platformOps.ts` → `getQueueHealthStats` |
| Upstash LLM cap | `lib/chatbot/llmDistributedCap.ts` |
| Crons Vercel | `vercel.json` |
| pg_cron drain (dropar) | `supabase/migrations/20260812233000_pg_cron_chatbot_queue_drain.sql` |
| pg_cron cleanup (manter) | `supabase/migrations/20260825150000_chatbot_queue_cleanup_cron.sql` |

---

## Histórico

| Data | Nota |
|------|------|
| 2026-08-28 | Aceito — SQS outbox + Lambda; substitui wake/claim HTTP; EventBridge para crons restantes |
| 2026-08-28 | Fase 4 cutover: rotas/wake/cron-job drain removidos; docs CHATBOT_PROD + PLANO_ESCALA atualizados |
