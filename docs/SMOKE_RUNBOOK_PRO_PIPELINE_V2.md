# Smoke Runbook - PRO Pipeline V2

Decisões de arquitetura (limites honestos): [`CHATBOT_PROD.md`](./CHATBOT_PROD.md).  
Transporte: **outbox Postgres → SQS FIFO → Lambda** ([ADR-0003](./ADR/0003-sqs-outbox-lambda.md)).

**Evidências para release (p95 do webhook, replay de `message_id`, carga leve):** ver em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md#como-obter-evidências-p95-carga-replay).

**Refatoração do fecho de pedido PRO:** [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

**Smoke do agent loop (prompts WhatsApp):** [`SMOKE_AGENT_LOOP_WHATSAPP.md`](./SMOKE_AGENT_LOOP_WHATSAPP.md) — cenários de pedido/HITL. Este runbook cobre **fila / SQS / dedup**.

## Objetivo
Validar em ambiente real que o fluxo assíncrono do PRO está saudável:
- `incoming` enfileira rápido (`chatbot_queue` + `SendMessage` SQS)
- Lambda inbound consome sem erro (`status=done`)
- chatbot responde sem duplicidade
- Orquestrador: saudação com botões, checkout/slots (`orderSlotStep` — [`PRO_ORDER_SLOT_MACHINE.md`](./PRO_ORDER_SLOT_MACHINE.md))

## Pré-requisitos obrigatórios
- Empresa com plano/crédito que resolva `tier === "pro"` (motor = `runProPipeline`)
- `CHATBOT_QUEUE_ENABLED=1` + `SQS_DISPATCH_ENABLED=1`
- Filas `SQS_INBOUND_QUEUE_URL` / `SQS_OUTBOUND_QUEUE_URL` + workers `renthus-inbound-worker` / `renthus-outbound-worker`
- `ANTHROPIC_API_KEY` (ou provider da empresa) no **Lambda**
- `INBOUND_DEDUP_WINDOW_SECONDS` (opcional, default `20`)
- `PRO_PIPELINE_METRICS_STORE=supabase` (opcional; Super Admin)
- Calibração staging: `PRO_PIPELINE_TURN_TRACE=1` no worker (ver `deploy-workers.ps1`)

**Removido no cutover ADR-0003:** `GET /api/chatbot/process-queue`, wake HTTP e cron-job.org nesse path. Rede de segurança = DLQ + reconciler EventBridge (`renthus-outbox-reconcile`).

### Env opcionais de pico / resiliência (defaults no código)
| Variável | Default | Papel |
|----------|---------|--------|
| `CHATBOT_QUEUE_MAX_PER_COMPANY` | `2` | Fairness no claim SQL |
| `CHATBOT_QUEUE_STALE_MINUTES` | `3` | Reclaim de `processing` stuck (reconciler) |
| `CHATBOT_BACKLOG_DEPTH` / `_AGE_SECONDS` / `_NOTICE_COOLDOWN_SEC` | `8` / `45` / `120` | Aviso WhatsApp de fila |
| `CHATBOT_CATALOG_CACHE_TTL_SEC` | `60` | Cache in-memory de busca |
| `ANTHROPIC_CHATBOT_MAX_IN_FLIGHT` / `ANTHROPIC_CIRCUIT_OPEN_MS` | `8` / `30000` | Gate + circuit Anthropic |
| `WHATSAPP_MIN_GAP_MS` / `WHATSAPP_429_MAX_RETRIES` | `100` / `3` | Throttle Meta Graph |

## Caminho feliz (produção / staging cutover)
1. Enviar mensagem no WhatsApp de teste.
2. Confirmar: webhook `incoming` 200 → row `chatbot_queue` com `sqs_enqueued_at` preenchido.
3. Lambda consome → `status=done`; resposta no WA.
4. Smoke sintético (sem LLM/WA): `npm run smoke:sqs-workers`.

## Plano de execução (15-20 min)

### Passo 1 - Sanidade inicial
1. Logs sem `server_misconfigured` / `invalid_signature`.
2. CloudWatch: Lambda inbound sem erro de config; reconciler sem backlog crónico.
3. Opcional: `npm run smoke:sqs-workers` → skip path OK.

**Aprovado se:** enqueue + consume sem 5xx no worker.

---

### Passo 2 - Enfileiramento inbound
1. Enviar no WA: `quero 2 heineken`
2. Verificar: webhook 200; `chatbot_queue` com `status` pending→processing→done; `sqs_enqueued_at` set.

**Aprovado se:** mensagem na outbox em até 2s e SQS enqueued.

---

### Passo 3 - Consumo da fila (Lambda)
1. Não chamar `process-queue` — esperar event source SQS (ou forçar mensagem via smoke script).
2. Conferir job: `chatbot_queue.status = done`, `failed = 0` na janela.

**Aprovado se:** job sai de `pending` para `done` sem intervenção HTTP.

---

### Passo 4 - Cenários críticos mínimos
Preferir a matriz em [`SMOKE_AGENT_LOOP_WHATSAPP.md`](./SMOKE_AGENT_LOOP_WHATSAPP.md) (incl. **C4.4**).
Mínimo rápido:
1. produto do catálogo (agent loop + tools)
2. draft completo: texto `sim` **não** finaliza (só botão `pro_confirm_order`)
3. draft incompleto na confirmação: não chama RPC

**Aprovado se:** alinhado aos testes + smoke agent-loop; sem 5xx.

---

### Passo 4.1 - Confirmação HITL (botão)
Com sessão em `pro_awaiting_confirmation` / confirmação inbox:
1. texto `sim` / `ok` / `CONFIRMAR` → **não** finaliza
2. botão `pro_confirm_order` → finaliza via RPC
3. botão cancelar / negação → não cria pedido

**Aprovado se:** zero finalize por prosa.

---

### Passo 4.2 - Matriz padrão de falhas reais
1. IA com JSON inválido  
2. `PRODUCT_NOT_FOUND`  
3. `AI_TIMEOUT` → degradado D6 / retry conforme política  
4. `INCONSISTENT_DRAFT`  

Conferir mensagem PT-BR sem vazar detalhe técnico + métrica.

---

### Passo 4.3 - Replay de `message_id` (idempotência)
Procedimento em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md#como-obter-evidências-p95-carga-replay).

**Aprovado se:** segundo POST não duplica pedido.

---

### Passo 5 - Duplicidade outbound
1. Repetir a mesma mensagem inbound rapidamente (2x).
2. Sem bolha duplicada óbvia; dedup/coalesce conforme política.
3. Métricas: `wa_incoming_dedup` / coalesce na outbox.

**Aprovado se:** sem duplicidade visível ao cliente.

---

## Critérios de GO / NO-GO

## GO
- Jobs `done` estáveis, `failed` baixo
- Sem duplicidade de resposta
- Sem 5xx recorrente no Lambda
- Tempo ponta a ponta aceitável

## NO-GO
- `failed > 5%` na janela de 15 min
- Erro de autorização/configuração recorrente
- Duplicidade frequente de outbound
- Respostas inconsistentes no fluxo de pedido
- Dependência de `process-queue` HTTP (caminho morto)

## Rollback mínimo
1. Investigar DLQ + reconciler; não reabrir wake HTTP.
2. Se necessário em emergência local: `CHATBOT_QUEUE_ENABLED=0` (dev only).
3. Corrigir e repetir smoke — sem motor PRO legado.

## Consultas rápidas sugeridas (opcional)
```sql
select count(*) from chatbot_queue where status='pending';
select count(*) from chatbot_queue where status='failed' and created_at > now() - interval '15 minutes';
select id, status, attempts, sqs_enqueued_at, created_at from chatbot_queue order by created_at desc limit 20;
-- C4.1 staging:
select count(*) from pipeline_turn_traces where created_at > now() - interval '1 hour';
```

## Checklist pós-migração de índices (dedup/queue)
1. Aplicar migration (`supabase` MCP / CLI).
2. Confirmar índices `chatbot_queue_%dedup%` / `chatbot_queue_coalesce_%`.
3. Smoke: repetir mensagem 2x ≤10s; esperado 1 efeito + Lambda `done`.

## Execução automatizada local (referência)
- `tests/integration/chatbot-queue-e2e.test.ts`
- `tests/pro/proPipeline.test.ts`
- `tests/pro/proPipeline.failure-regression.test.ts`
- `tests/pro/c4CassetteReplay.test.ts` (nível C)
- `npm run smoke:sqs-workers` (transporte)
