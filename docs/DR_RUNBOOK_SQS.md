# Runbook — SQS (ADR-0003) — DLQ, reconciler e incidente de fila

> **SUPERSEDED pela Fase 13 (2026-09-01).** A Fase 13 substitui SQS FIFO por Lambda direto do Vercel. Após o cutover, **a fila inbound `renthus-inbound.fifo` deixa de existir** (`npm run aws:cleanup:sqs-inbound`). O outbound continua usando SQS FIFO (DLQ ainda relevante). Este runbook é preservado como referência histórica e para diagnóstico da fila outbound. Para troubleshooting da nova arquitetura (Lambda direto + thread lock no Postgres), ver [ADR-0003 § Fase 13](./ADR/0003-sqs-outbox-lambda.md#fase-13--substituição-sqs-fifo--lambda-direto-do-vercel-pr-13--vigente) e este mesmo arquivo (seção 1-5).

> Complementa `DR_RUNBOOK_POSTGRES.md`. Aqui ficam o ciclo de vida de mensagens na
> fila SQS FIFO, o que fazer quando a DLQ dispara e como operar o reconciler Lambda.

**Projeto:** Renthus Chat + ERP
**Fila inbound (Fase 12 — descontinuada):** `renthus-inbound.fifo` (`MessageGroupId = thread_id`) — **deletada na Fase 13**
**Fila outbound (mantida):** `renthus-outbound.fifo` (`MessageGroupId = company_id`)
**DLQ inbound (descontinuada):** `renthus-inbound-dlq.fifo` — **deletada na Fase 13**
**DLQ outbound (mantida):** `renthus-outbound-dlq.fifo`
**Região:** `sa-east-1`

---

## 1. O que está em cada lugar

| Componente | Onde mora | Quem opera |
|---|---|---|
| Outbox transacional | `public.chatbot_queue`, `public.outbound_jobs` (Supabase) | Vercel (webhooks) enqueue; Lambda reconciler reenvia |
| Transporte | AWS SQS FIFO | Vercel envia via `lib/queue/sqsDispatch.ts` (`SQS_DISPATCH_ENABLED=1`) |
| Consumo | AWS Lambda (`renthus-inbound-worker`, `renthus-outbound-worker`) | Event source mapping da SQS |
| Reconciler | Lambda `renthus-outbox-reconcile` (a cada 5 min via EventBridge) | Limpa stuck + reenvia pendentes sem SQS |
| Cleanup diário | `pg_cron` `chatbot-queue-cleanup` (04:15 UTC) | Apaga jobs terminais `done`/`failed` > 24h |

**NÃO existe mais** (removidos na Fase 4):

- Rotas `GET /api/chatbot/process-queue` e `GET /api/chatbot/outbound-worker` na Vercel.
- Wake HTTP (`lib/chatbot/queueWorkerWake.ts`, `lib/chatbot/outbound/outboundWorkerWake.ts`).
- Cron externo cron-job.org para `process-queue`, `outbound-worker`, `reactivate`.
- `pg_cron` `chatbot-queue-drain` (10s) — deve estar `unscheduled` em prod.
- RPCs `claim_chatbot_queue_jobs` / `claim_outbound_jobs` / `reclaim_stuck_*` (dropados em `20260829020000_drop_claim_reclaim_queue_rpcs.sql`).

---

## 2. Estados de uma mensagem (outbox ↔ SQS ↔ Lambda)

```
webhook/UI ──enqueue──► outbox (PG, status=pending, sqs_enq=ts)
   ▲                       │
   │                       │ SendMessage
   │                       ▼
   │                   SQS FIFO (group/dedup/messageId)
   │                       │
   │                       │ entrega
   │                       ▼
   │                   Lambda (process*JobById → done/failed)
   │                       │
   │ retryable             │ maxReceiveCount excedido
   │ (visibility backoff)  ▼
   │                   DLQ (alarme CloudWatch)
   │
   └── reconciler Lambda (5 min) ── pending sem SQS > 2min → re-dispatch
                            ── processing stale > 3min → reclaim + re-dispatch
```

**Idempotência:** toda função do worker checa `status` antes de mutar. Reentrega do SQS
(at-least-once) **não** causa efeito duplicado quando o estado já é `done`/`failed`.

---

## 3. Alarmes (CloudWatch)

| Alarme | Métrica | Limiar | Ação |
|---|---|---|---|
| `SQS-Inbound-Age` | `ApproximateAgeOfOldestMessage` em `renthus-inbound.fifo` | `> 120s` por 5 min | Verificar reconciler; se DLQ crescendo → Seção 4. |
| `SQS-Outbound-Age` | mesma, em `renthus-outbound.fifo` | `> 180s` por 5 min | Idem; outbound depende do canal WA ativo. |
| `Lambda-Errors` | `Errors` em `renthus-inbound-worker` / `renthus-outbound-worker` | `> 5` em 5 min | CloudWatch Logs Insights → grep pelo `jobId` da Sentry. |
| `Lambda-Duration` | `Duration` p95 | `> 80%` do timeout (96s inbound / 48s outbound) | Considerar subir memory ou revisar gargalo. |
| `DLQ-Inbound-Depth` | `ApproximateNumberOfMessagesVisible` em `renthus-inbound-dlq.fifo` | `> 0` | Seção 4. |
| `DLQ-Outbound-Depth` | mesma, em `renthus-outbound-dlq.fifo` | `> 0` | Seção 4. |
| `Reconciler-Failure` | `Errors` em `renthus-outbox-reconcile` | `> 1` em 15 min | Verificar se a Lambda ainda tem permissão `sqs:SendMessage` e o IAM user Vercel não expirou. |

**Notificação:** alarme → SNS `renthus-ops` → e-mail do on-call.

---

## 4. DLQ disparou — o que fazer

### 4.1 Diagnóstico

```bash
# 1) Tamanho da DLQ
aws --profile renthus --region sa-east-1 sqs get-queue-attributes \
  --queue-url https://sqs.sa-east-1.amazonaws.com/696457893414/renthus-inbound-dlq.fifo \
  --attribute-names ApproximateNumberOfMessagesVisible

# 2) Inspecionar até 10 mensagens (sem deletar)
aws --profile renthus --region sa-east-1 sqs receive-message \
  --queue-url <DLQ_URL> \
  --max-number-of-messages 10 \
  --visibility-timeout 60 \
  --wait-time-seconds 5 \
  --message-attribute-names All

# 3) Cruzar com CloudWatch Logs do worker (mesmo período)
aws --profile renthus --region sa-east-1 logs filter-log-events \
  --log-group-name /aws/lambda/renthus-inbound-worker \
  --start-time <epoch_ms> --end-time <epoch_ms> \
  --filter-pattern "ERROR"
```

**O que procurar no envelope da DLQ:**

| Sinal | Causa provável | Mitigação |
|---|---|---|
| `kind: inbound` repetido para o mesmo `jobId` | LLM rate limit (429) sustentado | Subir `LLM_GLOBAL_MAX_IN_FLIGHT` ou `COMPANY_LLM_MAX_IN_FLIGHT`; verificar se Anthropic retornou circuit open. |
| `LastError: 23505` (unique violation) | Tentativa de inserir pedido duplicado | Já idempotente; só monitorar volume. |
| `LastError: missing_active_meta_whatsapp_channel` | Canal WA desativado/desconectado na empresa | Reativar canal via `/platform` ou em `whatsapp_channels.status`. |
| `LastError: company_worker_cap` | Upstash indisponível, fail-open não disparou | Checar `UPSTASH_REDIS_REST_URL/TOKEN` na Lambda. |
| `LastError: pool_timeout` / `ECONNREFUSED` para Supabase | DB indisponível ou esgotamento de conexões | Considerar `SUPABASE_DB_POOLER_URL` (porta 6543) na Lambda; ver `DR_RUNBOOK_POSTGRES.md`. |
| Mensagem antiga (> 1h) sem erro claro | Bug do worker | Replay abaixo. |

### 4.2 Replay manual (após corrigir a causa raiz)

```bash
# Para cada mensagem da DLQ, após corrigir a causa raiz, redeliver para a fila principal.
# CUIDADO: replay em massa só depois de saber que a falha raiz foi resolvida.

aws --profile renthus --region sa-east-1 sqs send-message \
  --queue-url https://sqs.sa-east-1.amazonaws.com/696457893414/renthus-inbound.fifo \
  --message-body "$(cat dlq-message.json)" \
  --message-group-id "<thread_id>" \
  --message-deduplication-id "<jobId>-replay-$(date +%s)"

# Depois, deletar da DLQ (só após confirmar processamento)
aws --profile renthus --region sa-east-1 sqs delete-message \
  --queue-url <DLQ_URL> \
  --receipt-handle "<receipt_handle>"
```

**Importante:** mudar o `MessageDeduplicationId` (`<jobId>-replay-<ts>`) para o SQS
aceitar (janela de 5 min em FIFO). O job no outbox já é idempotente — o worker ignora
se `status` já é `done`/`failed`.

### 4.3 Não fazer

- ❌ **Não drenar a DLQ para a fila principal em massa sem diagnóstico** — multiplica a causa raiz.
- ❌ **Não desabilitar alarme de DLQ** — é o único sinal de que a fila está "engasgada".
- ❌ **Não aumentar `maxReceiveCount` para "esmagar" DLQ** — só esconde o problema.
- ❌ **Não criar nova fila "v2"** — sem migrar consumidores, vira duas fontes de verdade.

---

## 5. Reconciler falhou / parou

```bash
# 1) Forçar invocação manual
aws --profile renthus --region sa-east-1 lambda invoke \
  --function-name renthus-outbox-reconcile \
  --invocation-type RequestResponse \
  --payload '{}' \
  output.json && cat output.json

# Esperado:
# {"ok":true,"stats":{"inboundNeverEnqueued":0,"outboundNeverEnqueued":0,
#  "inboundStuckReclaimed":0,"outboundStuckReclaimed":0,"dispatchErrors":0}}
```

Se retornar `ok: false` ou stats zerados com fila realmente pendurada:

1. Confirmar `SQS_DISPATCH_ENABLED=1` na Lambda (env da função, não da Vercel).
2. Confirmar IAM role tem `sqs:SendMessage` na fila principal + DLQ.
3. Confirmar `AWS_REGION` da Lambda = `sa-east-1` (região das filas).
4. Reagendar EventBridge:
   ```bash
   aws --profile renthus --region sa-east-1 events put-rule \
     --name renthus-outbox-reconcile-rule \
     --schedule-expression "rate(5 minutes)" \
     --state ENABLED
   ```

> **Setup inicial:** todos os 7 crons do ADR-0003 (incluindo o reconciler) são criados
> via `npm run scheduler:setup:apply` (script `scripts/setup-eventbridge-scheduler.ps1`).
> Ver `package.json` → `scheduler:setup*` e ADR-0003 seção "EventBridge Scheduler".

---

## 6. Cutover (rollout / rollback)

### 6.1 Habilitar SQS em uma empresa

Hoje o cutover é **global** (`SQS_DISPATCH_ENABLED=1` no Vercel), porque a Lambda
compartilha a mesma fila. Para rollout gradual, considerar ADR-0003 revisão:
introduzir `SQS_DISPATCH_COMPANY_ALLOWLIST` (CSV) e checar em `scheduleInboundAfterEnqueue`
antes do `SendMessage`.

**Workaround atual (sem ADR novo):** desligar SQS, manter wake **removido** significa
que a fila fica parada. Não há caminho intermediário estável. O cutover é binário.

### 6.2 Rollback (reverter para wake HTTP)

**Não recomendado** — wake HTTP foi removido. Se necessário em incidente grave
(provavelmente SQS indisponível por horas), o caminho é:

1. `SQS_DISPATCH_ENABLED=0` no Vercel (webhooks passam a só inserir outbox).
2. `vercel.json`: reativar crons `process-queue` e `outbound-worker` (código removido —
   precisa restaurar via `git revert`).
3. Aplicar `pg_cron` `chatbot-queue-drain` novamente (migration reversa).
4. **Não há P0.0 pronto pra isso.** ADR-0003 documenta como "decisão radical SQS-first";
   rollback está fora do escopo até métrica contrária.

Se a fila está parada **e** rollback é inviável: priorizar a Seção 5 (reconciler) e
Seção 4 (DLQ) — em geral o reconciler cobre gaps transitórios.

---

## 7. Responsável / on-call

| Papel | Responsável | Contato |
|---|---|---|
| Decide rollback | _(preencher)_ | _(preencher)_ |
| Executa drain / replay DLQ | _(preencher)_ | _(preencher)_ |
| Reagendar EventBridge / IAM | _(preencher)_ | _(preencher)_ |

---

## Resumo executivo

| Pergunta | Resposta hoje |
|---|---|
| Quem processa a fila? | AWS Lambda (event source mapping) |
| Como reentregamos mensagens falhadas? | Visibility timeout + reconciler Lambda 5 min + DLQ |
| Qual o RPO de mensagem? | ~0 (SQS persiste até DLQ; reconciler cobre falhas transitórias) |
| Qual o RTO? | minutos (reconciler cobre) — exceto DLQ, depende de causa raiz |
| O que faço se DLQ tem mensagens? | Seção 4 |
| Como sei se reconciler está saudável? | CloudWatch `Errors` em `renthus-outbox-reconcile` + stats por invocação |
| Onde vejo o estado da fila? | `/platform/observabilidade` (UI platform) ou `getQueueHealthStats` |

Documento existe (item cumprido — complementar a `DR_RUNBOOK_POSTGRES.md`). Drill
formal de DLQ e definição de on-call ficam como próxima ação — não bloqueiam
operação, mas precisam de decisão do responsável.

