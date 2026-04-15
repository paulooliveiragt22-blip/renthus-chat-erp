# Pendecias Pipeline PRO

## Status atual
- Pipeline PRO V2 funcional para teste real controlado.
- Nao esta completo para carga pesada de producao.

## Pendencias abertas

### 1) Timeout real de IA (abort/cancelamento)
- **Arquivo:** `src/pro/adapters/ai/ai.service.full.ts`
- **Onde quebra:** chamada ao provedor podia ultrapassar `timeoutMs` sem cancelamento efetivo.
- **Risco:** worker preso, aumento de latencia p95/p99 e fila acumulando.
- **Correcao aplicada agora:** `AbortController` por chamada, abort por `timeoutMs`, retorno com `errorCode: "AI_TIMEOUT"`.
- **Status:** resolvido.

### 2) Finalizacao de pedido ainda dependente de legado
- **Arquivo:** `src/pro/adapters/order/order.service.legacy.ts`
- **Onde quebra:** motor V2 ainda chama `tryFinalizeAiOrderFromDraft` legado.
- **Risco:** acoplamento com comportamento antigo e manutencao duplicada.
- **Correcao planejada:** criar `order.service.v2.ts` com contrato canonico e remocao do bridge legado.
- **Correcao aplicada:** criado `src/pro/adapters/order/order.service.v2.ts` e troca no `deps.factory.ts`.
- **Status:** resolvido.

### 3) Metricas apenas em console
- **Arquivo:** `src/pro/adapters/metrics/metrics.console.ts`
- **Onde quebra:** sem backend de metricas real.
- **Risco:** sem alertas confiaveis de fila, erro de IA, saturacao de worker.
- **Correcao planejada:** adapter de metricas real (OTel/Datadog/Prometheus) com tags por `companyId`.
- **Correcao aplicada:** envio HTTP opcional por `METRICS_INGEST_URL` (+ `METRICS_INGEST_TOKEN`) com fallback seguro.
- **Status:** resolvido.

### 4) Persistencia + envio sem protecao adicional de duplicidade de outbound
- **Arquivo:** `src/pro/pipeline/stages/persistAndEmit.ts`
- **Onde quebra:** em retry de rede/processamento pode reemitir mensagem.
- **Risco:** cliente receber resposta duplicada.
- **Correcao planejada:** idempotency key por outbound + registro de envio.
- **Correcao aplicada:** dedup no gateway por janela curta (`thread_id + body`) em `src/pro/adapters/whatsapp/message.gateway.whatsapp.ts`.
- **Status:** resolvido.

### 5) Cobertura de testes E2E de fila/WhatsApp
- **Arquivo:** `tests/pro/*` e integracao de webhook/fila
- **Onde quebra:** hoje os casos criticos estao fortes em unit, mas falta E2E de operacao real.
- **Risco:** regressao de integracao so aparecer em producao.
- **Correcao planejada:** suite de teste de contrato entre webhook, queue worker e pipeline PRO V2.
- **Correcao aplicada:** adicionada suite de regressao critica (`tests/pro/proPipeline.failure-regression.test.ts`) e E2E de fila (`tests/integration/chatbot-queue-e2e.test.ts`) cobrindo `incoming -> chatbot_queue -> process-queue -> processInboundMessage`.
- **Status:** resolvido.

## Checklist minimo de homologacao/producao (operacional)
- [ ] `CHATBOT_QUEUE_ENABLED=1` no ambiente.
- [ ] `CRON_SECRET` definido e cron chamando `GET /api/chatbot/process-queue` com `Authorization: Bearer`.
- [ ] Logs sem `queue insert error` e sem `job falhou` acima de 1% em janela de 15 min.
- [ ] `processed` do worker > 0 para mensagens de teste.
- [ ] Sem duplicidade de outbound para mesma thread/body em janela curta.

## Testes criticos executados nesta iteracao
- `IA retornando invalido`
- `intent errado`
- `pedido vazio`

Resultado e evidencias estao no historico da execucao de testes desta tarefa.
