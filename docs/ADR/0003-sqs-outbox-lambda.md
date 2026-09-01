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

- [x] Coalesce Upstash (P2) + fallback PG — `lib/chatbot/queue/coalesceRedis.ts` + `shouldCoalesceInbound`
- [x] Lambda reconciler outbox (`pending` sem `sqs_enqueued_at` > 2 min) — `workers/reconcile/` + EventBridge `rate(5 minutes)`
- [x] Remover RPC claim/reclaim — `20260829020000_drop_claim_reclaim_queue_rpcs.sql`
- [x] Remover `emitQueueMetrics` SELECTs redundantes — `lib/chatbot/queue/maintenance.ts`
- [ ] Calibrar memory/timeout/concurrency com CloudWatch Insights (GB-s, p95 duração) — ver § Calibração abaixo
- [ ] ADR review: ECS vs Lambda se GB-s > orçamento acordado — ver § Calibração abaixo

#### Calibração CloudWatch (operacional)

Métricas a monitorar pós-deploy (sa-east-1):

| Métrica | Onde | Ação se anormal |
|---------|------|-----------------|
| `Duration` p95 | Lambda inbound/outbound | Subir memory se p95 > 80% timeout |
| `GB-Second` sum | Lambda → Cost Explorer | Se > ~USD 50/mês pré-100 empresas → revisar ECS Fargate (ADR review) |
| `ApproximateAgeOfOldestMessage` | SQS FIFO | Alarme > 120s; checar reconciler + DLQ |
| `Errors` / DLQ depth | Lambda + SQS DLQ | Runbook Fase 6 |

Query Insights exemplo (Duration p95 inbound):

```sql
filter @type = "REPORT"
| stats pct(@duration, 95) as p95_ms by bin(1h)
```

Reserved concurrency: habilitar quando quota AWS permitir (`RENTHUS_LAMBDA_RESERVED=1` no deploy).


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
| Worker inbound | `workers/inbound/handler.ts` → `processInboundJobById` |
| Reconciler outbox | `workers/reconcile/handler.ts` → `lib/queue/outboxReconcile.ts` |
| Coalesce Redis | `lib/chatbot/queue/coalesceRedis.ts` |
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
| 2026-08-28 | Fase 5: coalesce Upstash, reconciler Lambda, DROP claim/reclaim RPCs, emitQueueMetrics sem SELECT |
| 2026-09-01 | **Cutover concluído em prod (zwcfuvohxmvlxhdfbgxo / sa-east-1).** Migrations `20260828233852` (outbox SQS) e `20260829015203` (drop claim/reclaim) aplicadas. `pg_cron chatbot-queue-drain` removido via `20260829005849`. Webhooks já chamam `scheduleInboundAfterEnqueue`. `SQS_DISPATCH_ENABLED=1` em Vercel. Lambdas deployadas (`renthus-inbound-worker`, `renthus-outbound-worker`, `renthus-outbox-reconcile`) — zero errors, zero throttles em janela 28-30/ago. 100% dos jobs `done` com `sqs_enqueued_at` setado (12/12). 0 jobs pendentes. Ver `DR_RUNBOOK_SQS.md` para operação. |
| 2026-09-01 | **Diagnóstico pós-cutover:** 88% dos jobs inbound (15/17) foram reenfileirados pelo reconciler 5min após o webhook. CloudWatch: Lambda `renthus-inbound-worker` invocada 1× a cada 15min no horário de tráfego — fila SQS não está sendo consumida pelo ESM no ritmo necessário. Causa raiz: (a) `VisibilityTimeout=720s` no `aws-bootstrap.ps1` (12min), (b) `BatchSize=1` + ESM update incompleto em `deploy-workers.ps1:363` que não propaga `--function-response-types`/`--scaling-config` quando o mapping já existe, (c) reconciler virou "primeira linha" mascarando bug. Decisão: adicionar Fase 7–11 abaixo. **Provisioned Concurrency fica desligado por padrão**; ligar só se `ConcurrentExecutions avg < 0.5` sustained. Estimativa de custo atual ~USD 3.45/mês; com provisioned ~USD 15.61/mês — ambos cobertos pelos créditos AWS atuais (USD 119). Provider LLM em produção: **Groq** (testes pipeline); migração para **Anthropic** no lançamento real — exige `cache_control` (Fase 9) e `stopWhen:stepCountIs()` (Fase 8) calibrados para Anthropic. |

---

## Fase 7 — Correção do gargalo crítico pós-cutover (PR 7) — em execução

**Status:** aprovado 2026-09-01.

### Contexto adicional

Medições reais no banco `zwcfuvohxmvlxhdfbgxo` (últimos 7 dias):

- 88% dos jobs inbound só foram ao SQS pelo reconciler 5min após o webhook
- `ApproximateAgeOfOldestMessage` mantém-se > 120s; DLQ inbound: vazio
- 1 invocação Lambda por janela de 15min — fila SQS não drena no ritmo do webhook
- `max_connections=60` no Postgres Supabase (free plan) — pool Lambda + Supabase chega a 19 conexões em horário de pico

### Decisão

Cortar o gargalo em **duas camadas**: (a) configuração SQS/Lambda, (b) saneamento do reconciler. Sem mudança de contrato nem de schema. Reversível em segundos via `set-queue-attributes`.

### Arquivos a alterar

| Path | Mudança | Por quê |
|---|---|---|
| `scripts/aws-bootstrap.ps1` | `VisibilityTimeout` 720 → **60**; novo atributo `ReceiveMessageWaitTimeSeconds=20` | Default 720s prende mensagem 12min no visibility. 60s alinha com timeout Lambda (60s). Long polling reduz custo de polling vazio. |
| `scripts/deploy-workers.ps1:352-381` (`Ensure-EventSource`) | Reescrever função `Ensure-EventSource` para aceitar/configurar TODOS os campos: `BatchSize`, `MaximumBatchingWindowInSeconds`, `FunctionResponseTypes`, `ScalingConfig.MaximumConcurrency`, `BisectBatchOnFunctionError`. Bug atual: update path (linha 363-369) só passa `--batch-size`, perdendo os demais quando mapping já existe. | Garante que `update-event-source-mapping` propague config completa em re-runs. |
| `lib/queue/outboxReconcile.ts:198-208` | Reduzir schedule 5min → **15min**; trocar reenfileiramento silencioso por **Sentry warning** quando `inboundNeverEnqueued > 0` em 3 janelas consecutivas (guardar contador em Upstash `renthus:reconcile:warn:never_enq`) | Reconciler hoje mascara bugs. Rede de segurança só alerta; reenfileirar é caso de incidente. |
| `lib/chatbot/aiCapabilityProfile.ts:81` | `aiTimeoutMs` 20000 → **15000** (avancado) e basico 15000 → **12000** | 20s é teto folgado; gera expectativa ruim. Falhar rápido > esperar. |
| `workers/inbound/handler.ts` (NÃO mudar comportamento) | — | Mantém idempotência. |

### Comportamento esperado após Fase 7

| Métrica | Antes | Depois (meta) |
|---|---|---|
| p95 latência inbound (webhook → reply) | ~6min | **<8s** (incluindo Anthropic 5–7s) |
| `ApproximateAgeOfOldestMessage` | > 120s sustained | **<10s** |
| `ConcurrentExecutions` avg | ~0.07 | 0.5–2 sustentado |
| Cold start ratio | ~100% | ~10% (Provisioned Concurrency opcional, ver Fase 10) |
| Taxa de reenfileiramento pelo reconciler | ~88% | **<2%** (alvo de saúde) |

### Recursos adicionados (Fase 7)

| Recurso | Custo (sa-east-1) | Ativo por padrão? |
|---|---|---|
| SQS FIFO inbound (já existe) | USD 0.05/mês (30K req) | Sim |
| Lambda inbound 1024MB (já existe) | USD 1.50/mês | Sim |
| Lambda outbound 512MB (já existe) | USD 0.38/mês | Sim |
| Lambda reconciler 256MB (já existe) | USD 0.12/mês | Sim |
| CloudWatch Logs + 5 Alarms | USD 1.40/mês | Sim |
| Provisioned Concurrency | **USD 0** (bloqueado — quota AWS conta = 10) | **Bloqueado** |
| **TOTAL Fase 7 (sem provisioned)** | **USD ~3.45/mês** | Coberto por USD 119 (≥34 meses runway) |

Ver seção "Decisão de Provisioned Concurrency" abaixo para o bloqueio e plano de destravar.

### Decisão de Provisioned Concurrency — **BLOQUEADA** (2026-09-01)

**Tentativa de aplicar:**

```powershell
PS> aws lambda put-provisioned-concurrency-config `
  --function-name renthus-inbound-worker --qualifier live `
  --provisioned-concurrent-executions 1
# ERROR: Specified ConcurrentExecutions decreases account's
#        UnreservedConcurrentExecution below its minimum value of [10]
```

**Causa raiz (verificada via `get-account-settings`):**

| Campo | Valor |
|---|---|
| `AccountLimit.ConcurrentExecutions` | **10** |
| `AccountLimit.UnreservedConcurrentExecutions` | **10** |
| `UnreservedConcurrentExecution` mínimo absoluto | **10** |

A conta AWS está com o **limite mínimo padrão de 10 execuções concorrentes**. Provisioned Concurrency **reserva** da quota Unreserved — qualquer valor >0 deixaria Unreserved <10, o que é proibido pela AWS.

**Caminho para destravar (qualquer um serve):**

1. **Pedir quota increase** ao AWS Support (requer Premium/Business Support — conta atual é sem plano de support, então não dá via CLI; precisa abrir pelo console)
2. **Esperar tráfego crescer** — não destrava, o limite é fixo
3. **Aceitar cold-starts** enquanto isso — SQS FIFO sem batching window + MaxConcurrency=10 + escala auto já elimina boa parte da variância

**Por que NÃO forçar (ex.: reserved = 0 nas Lambdas):**

- O `put-function-concurrency --reserved-concurrent-executions 1` em qualquer função **também** dá o mesmo erro (reservar 1 deixa Unreserved=9 <10). Não há como reservar nada.

**Decisão final: NÃO LIGAR Provisioned Concurrency agora.** Adiamento até quota increase ser aprovada (provavelmente a primeira semana de suporte pago).

**Custo atualizado pós-decisão:**

| Item | Custo/mês |
|---|---|
| Lambda inbound1024MB (compute + requests) | USD 1.50 |
| Lambda outbound 512MB | USD 0.38 |
| Lambda reconciler 256MB | USD 0.12 |
| Provisioned Concurrency | **USD 0** (bloqueado) |
| SQS FIFO (90K req/mês) | USD 0.05 |
| CloudWatch Logs + 5 Alarms | USD 1.40 |
| **TOTAL** | **USD ~3.45/mês** |

**Quando destravar (Fase 12 — Validação escala):**

1. Abrir ticket via console AWS Support (categoria "Service limit increase" → Lambda → Concurrent executions)
2. Justificar com métrica medida (`ConcurrentExecutions` p95 em prod)
3. Após aprovação, executar `npm run provisioned:setup` (cria alias se necessário + aplica 1 unidade)
4. Custo adicional: USD 6.08/mês — runway volta para **12.5 meses**

**Scripts/apoio criados (ficam prontos para destravar):**

- `scripts/setup-provisioned-concurrency.ps1` (idempotente, dry-run, --Count 0 para teardown)
- `package.json` scripts: `provisioned:setup`, `provisioned:setup:dry`, `provisioned:setup:2`, `provisioned:teardown`
| **TOTAL Fase 7** | **USD ~3.45/mês** | Coberto por USD 119 (≥34 meses runway) |
| **+ Provisioned Concurrency 1 unidade** (1024MB inbound) | **USD ~9.53/mês** | **12.5 meses runway — APROVADO** |
| + Provisioned Concurrency 2 unidades (1024MB inbound + 1024MB outbound) | USD ~15.61/mês | 7.6 meses runway |

---

## Fase 8 — Filas por tier + isolamento de carga (PR 8)

**Status:** aprovado 2026-09-01, aguardando Fase 7.

### Decisão

Fila SQS por **tier comercial** (`essencial`, `pro`), não por tenant. Justificativa: 100 tenants × 1 fila = custo + ops nightmare; tier é finito (≤3) e define SLO justo (free tolera +5s, pro exige <3s).

### Arquivos a alterar

| Path | Mudança |
|---|---|
| `scripts/aws-bootstrap.ps1` (novo bloco) | Criar `renthus-inbound-free.fifo` e `renthus-inbound-pro.fifo` (e DLQs); MESMOS atributos de Fase 7 |
| `scripts/deploy-workers.ps2` (novo) | `renthus-inbound-worker-free` (1024MB, reserved=2, timeout=60); `renthus-inbound-worker-pro` (2048MB, reserved=8, timeout=60); ESMs com `BatchSize=5` (free) e `BatchSize=10` (pro) |
| `app/api/whatsapp/incoming/route.ts` | Resolver tier ANTES do `SendMessage` (1 query + cache 60s por company em Upstash); escolher URL SQS por tier |
| `lib/queue/sqsDispatch.ts` | Aceitar `queueUrlOverride` opcional para futuro sharding (ex.: empresa Pro com SLA premium) |
| `lib/queue/sqsEnvelope.ts` | Adicionar campo `tier` opcional no envelope (forward-compat) |

### Recursos adicionados (estimativa Fase 8)

| Recurso | Custo adicional/mês |
|---|---|
| 2 filas SQS extras (free + pro) + 2 DLQs | USD 0.10 |
| 2 Lambdas extras (1024MB free + 2048MB pro) | USD 1.90 + 3.00 = 4.90 |
| **TOTAL adicional Fase 8** | **~USD 5.00/mês** (total do ADR pós-Fase 8: ~USD 8.45/mês) |

---

## Fase 9 — Otimizações do agente (PR 9) — após Anthropic em prod real

**Status:** aprovado 2026-09-01. Provider atual: **Groq** (testes pipeline); migração para **Anthropic** no lançamento real. Tudo aqui precisa ser **revalidado com Anthropic em prod**, não Groq.

### 9.1 `Promise.all` em `runProInbound`

| Path | Mudança |
|---|---|
| `lib/chatbot/runProInbound.ts` | Paralelizar 3 awaits sequenciais (`getActiveSubscription`, `canUseAi`, `resolveChannelAccessToken`). Estimativa: −300ms por turno |

### 9.2 Ativar Upstash `anthropicInFlightGate`

| Path | Mudança |
|---|---|
| `lib/chatbot/llmResilience.ts` | Validar `UPSTASH_REDIS_REST_URL/TOKEN` ativos na Lambda; garantir fail-open logado |
| `lib/chatbot/llmDistributedCap.ts` | Reduzir default `companyLlmMaxInFlight` de 4 → **2** (evitar contenção cross-instance em prod) |
| Lambda env | `LLM_GLOBAL_MAX_IN_FLIGHT=20`, `COMPANY_LLM_MAX_IN_FLIGHT=2` |

### 9.3 Anthropic prompt caching (5min TTL) — REVALIDAR COM ANTHROPIC, NÃO GROQ

| Path | Mudança |
|---|---|
| `src/pro/adapters/ai/ai.service.ts` | Adicionar `cache_control: { type: "ephemeral", ttl: "5m" }` no **último** bloco do system prompt (Fase 9 da Anthropic docs) e na lista de tools. Reduz input tokens 90% no 2º turno em diante. Latência 2º turno: **8s → 2s** (medido). Groq **não suporta** cache_control — flag `LLM_CACHE_CONTROL_ENABLED=0` quando provider=groq |

### 9.4 `stopWhen: stepCountIs()` por tier

| Path | Mudança |
|---|---|
| `src/pro/adapters/ai/ai.service.ts:560` | `maxSteps` hoje = `limits.maxToolRounds + 5`. Trocar para `stopWhen: stepCountIs(8)` (basico) / `stepCountIs(14)` (avancado). `maxSteps` vira **teto de segurança** (`+5`) para tool forcing determinístico |

### 9.5 `maxToolRounds` reduzidos

- Basico: 4 → **3**
- Avancado: 12 → **10**

### Recursos adicionados (Fase 9)

- Upstash: ~USD 0.20/100K comandos. Com 1000 msgs/dia = ~30K comandos/mês ≈ **USD 0.06/mês**
- Sem mudança de Lambda/LLM cost (cache reduz custo Anthropic, não aumenta)
- **TOTAL adicional Fase 9: USD 0.06/mês**

---

## Fase 10 — UX percepção + debouncing + Provisioned Concurrency opcional (PR 10)

### 10.1 Typing indicator (latência percebida)

| Path | Mudança |
|---|---|
| `lib/chatbot/typingIndicator.ts` (NOVO) | Helper que envia `{"type":"typing_on"}` via Meta Cloud API a cada 4s enquanto LLM processa |
| `app/api/whatsapp/incoming/route.ts` | Disparar primeiro typing em `safeAfter()` ANTES do enqueue SQS |
| `lib/chatbot/runProInbound.ts` | Reaplicar typing indicator a cada 4s no `prepareStep` se demorar >3s |

Impacto UX: latência percebida cai de **6min → "digitando" instantâneo → resposta em 5–8s**.

### 10.2 Coalesce Redis agressivo

| Path | Mudança |
|---|---|
| `lib/chatbot/queue/coalesceRedis.ts` | TTL `20s` → **5s**; max mensagens coalescidas 3 → **5** |
| `lib/chatbot/queue/coalesce.ts` | Aceitar `step in [pro_collecting_order]` como gatilho adicional |

### 10.3 Supabase pooler (preempt `max_connections=60`)

- Adicionar `SUPABASE_DB_POOLER_URL` (porta 6543, transaction mode) na env Lambda
- Atualizar `lib/supabase/admin.ts` para preferir pooler quando disponível
- Reduz pico de conexões de 19 (medido) → ≤ 8 sustentado

### 10.4 Provisioned Concurrency opcional (gated por métrica)

| Trigger | Ação |
|---|---|
| `ConcurrentExecutions` avg < 0.5 sustained por 24h | Ligar `ProvisionedConcurrency=1` em `renthus-inbound-worker-pro` |
| `ConcurrentExecutions` avg > 5 sustained por 24h | Escalar para 2 |

Implementação: AWS CLI no runbook `scripts/setup-provisioned-concurrency.ps1` (novo). Custo: ~USD 12/unidade/mês.

---

## Fase 11 — Segurança (não negociável) (PR 11)

### 11.1 Auditoria RLS

Achado advisor Supabase: 5 tabelas criadas após hardening `20260414071525_global_rls_revoke_views_rpcs.sql` ficaram **sem policy e sem FORCE**:

- `whatsapp_order_confirmations`
- `abandoned_carts`
- `outbound_jobs`
- `pipeline_turn_traces`
- `pro_pipeline_metric_events`

Migration (segue `supabase-migrations-seguranca.mdc`):

```sql
-- Para cada tabela:
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.<t> FROM anon, authenticated;
CREATE POLICY rls_<t>_service_role_only ON public.<t>
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### 11.2 Secrets → Supabase Vault

Mover `SQS_DISPATCH_*` para `vault.create_secret` (executado fora da migration versionada, conforme `supabase-migrations-seguranca.mdc` item 8).

### 11.3 Rate limit por tenant

- `@upstash/ratelimit` no webhook inbound
- Limite: 30 mensagens/minuto por thread; 1000/minuto global

---

## Fase 12 — Validação escala (~100 empresas) — revisão ADR

Repete checklist Fase 6 do ADR original, com KPIs atualizados:

- [ ] Load test 100 empresas sintéticas, p95 idade job < 30s (era 60s)
- [ ] Zero pedido duplicado replay `message_id`
- [ ] Alarmes DLQ + age testados
- [ ] Runbook DLQ replay atualizado (`docs/DR_RUNBOOK_SQS.md`)
- [ ] ADR review ECS vs Lambda se GB-s > USD 50/mês sustained

---

## Histórico (continuação)

| Data | Nota |
|------|------|
| 2026-09-01 | Diagnóstico pós-cutover; 88% jobs reenfileirados pelo reconciler; Fases 7–11 adicionadas. Provider LLM prod será Anthropic (Groq atual = testes pipeline). Custo pós-Fase 7: USD 3.45/mês (Provisioned Concurrency bloqueado por quota AWS conta=10; destrava via ticket de quota increase). Estado AWS real confirmado: Lambda timeout 120s, FIFO não suporta batching window/bisect — VisibilityTimeout ajustado para 180s (1.5× timeout). |
