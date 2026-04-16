# Estratégia de refatoração — pedido PRO e “cérebro” da IA

Este documento define **fases**, **entregáveis**, **gates** e **o que não fazer** para alinhar o motor PRO ao fecho de pedido, em coerência com:

- [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) — decisões de transporte (fila, worker, wake) e princípios do pedido PRO.
- [`pipeline_chatbot_prod.md`](./pipeline_chatbot_prod.md) — ordem dos blocos no código.
- [`structure_chatbot_prod.md`](./structure_chatbot_prod.md) — pastas e ownership.

**Escopo:** apenas **tier PRO** e caminhos que levam a **draft / confirmação / finalização**; Starter permanece congelado salvo bug crítico.

**Referências cruzadas:** [`structure_chatbot_prod.md`](./structure_chatbot_prod.md) (árvore), [`pipeline_chatbot_prod.md`](./pipeline_chatbot_prod.md) (blocos 0–5), [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md) (homologação), [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (decisões).

---

## 0. Arquivos no âmbito da refatoração (lista canónica)

Contratos partilhados: [`src/types/contracts.ts`](../src/types/contracts.ts) (`TenantRef`, `ProStep`, `ProSessionState`, `OrderDraft`, `IntentDecision`, `AiServiceResult`, `OrderServiceResult`, `ProPipelineInput` / `Output`, `SideEffect`).

Cada linha: **ficheiro** — contrato / nota.

### Contratos e entrada

| Ficheiro | Contratos / papel |
|----------|-------------------|
| [`src/types/contracts.ts`](../src/types/contracts.ts) | Fonte única de tipos V2; alterações aqui propagam-se a adapters e testes. |
| [`lib/chatbot/processMessage.ts`](../lib/chatbot/processMessage.ts) | Entrada `processInboundMessage`; flags PRO V2 — fronteira Starter/PRO. |
| [`lib/chatbot/inboundPipeline.ts`](../lib/chatbot/inboundPipeline.ts) | Orquestração legada; só toques na **fronteira** com PRO (Fase R2). |

### Pipeline PRO (`src/pro/pipeline/`)

| Ficheiro | Contratos / papel |
|----------|-------------------|
| [`runProPipeline.ts`](../src/pro/pipeline/runProPipeline.ts) | Orquestra estágios; `ProPipelineInput` → `ProPipelineOutput`. |
| [`context.ts`](../src/pro/pipeline/context.ts) | `PipelineContext`, `PipelinePolicies`, `buildPipelineContext`. |
| [`errors.ts`](../src/pro/pipeline/errors.ts) | `ProPipelineSessionLoadError` e type guards de falha do pipeline PRO. |
| [`orderDraftGate.ts`](../src/pro/pipeline/orderDraftGate.ts) | R1: pré-condição única de draft antes de `createFromDraft` (usado por `orderStage`). |
| [`proStepTransitions.ts`](../src/pro/pipeline/proStepTransitions.ts) | R1: `canTransition` / resolução de `ProStep` (IA, pedido, handover). |
| [`deps.factory.ts`](../src/pro/pipeline/deps.factory.ts) | Monta `PipelineDependencies` (adapters reais + `overrides` para testes). |
| [`stages/loadState.ts`](../src/pro/pipeline/stages/loadState.ts) | Carrega `ProSessionState` via `SessionRepository`; envolve erros em `ProPipelineSessionLoadError`. |
| [`stages/guardRails.ts`](../src/pro/pipeline/stages/guardRails.ts) | Pré-condições antes de intent/IA; `stopReason` para métrica `guard_stop`. |
| [`stages/intentStage.ts`](../src/pro/pipeline/stages/intentStage.ts) | `IntentDecision` via `IntentService`. |
| [`stages/orderStage.ts`](../src/pro/pipeline/stages/orderStage.ts) | Confirmação + `OrderService.createFromDraft` → `OrderServiceResult`. |
| [`stages/routeStage.ts`](../src/pro/pipeline/stages/routeStage.ts) | Roteamento modo IA / respostas diretas; transição `handover` via `canTransition`. |
| [`stages/aiStage.ts`](../src/pro/pipeline/stages/aiStage.ts) | `AiService.run` → `AiServiceResult`; fallback se resposta inválida; `ProStep` via `resolveStepAfterAiAction` + `aiTimeoutMs` das policies. |
| [`stages/persistAndEmit.ts`](../src/pro/pipeline/stages/persistAndEmit.ts) | Persistência sessão + envio `MessageGateway` + métricas. |

### Serviços e portas (`src/pro/services`, `src/pro/ports`)

| Ficheiro | Contratos / papel |
|----------|-------------------|
| [`services/ai/ai.types.ts`](../src/pro/services/ai/ai.types.ts) | Interface `AiService` alinhada a `AiServiceInput` / `AiServiceResult`. |
| [`services/ai/ai.service.ts`](../src/pro/services/ai/ai.service.ts) | Implementação base se existir. |
| [`services/intent/intent.types.ts`](../src/pro/services/intent/intent.types.ts) | `IntentService` + decisão. |
| [`services/intent/intent.service.ts`](../src/pro/services/intent/intent.service.ts) | Classificador PRO. |
| [`services/intent/intentClassifier.service.ts`](../src/pro/services/intent/intentClassifier.service.ts) | Regras auxiliares de intent. |
| [`services/order/order.types.ts`](../src/pro/services/order/order.types.ts) | `OrderService` ↔ `OrderServiceInput` / `OrderServiceResult`. |
| [`services/order/order.service.ts`](../src/pro/services/order/order.service.ts) | Camada de domínio pedido se aplicável. |
| [`ports/session.repository.ts`](../src/pro/ports/session.repository.ts) | Contrato sessão. |
| [`ports/message.gateway.ts`](../src/pro/ports/message.gateway.ts) | Contrato envio. |
| [`ports/metrics.port.ts`](../src/pro/ports/metrics.port.ts) | Contrato métricas. |
| [`ports/logger.port.ts`](../src/pro/ports/logger.port.ts) | Contrato logs. |

### Adapters (`src/pro/adapters/`)

| Ficheiro | Contratos / papel |
|----------|-------------------|
| [`adapters/ai/ai.service.full.ts`](../src/pro/adapters/ai/ai.service.full.ts) | Tooling / Haiku; timeouts `AiServiceResult.errorCode`. |
| [`adapters/ai/ai.service.basic.ts`](../src/pro/adapters/ai/ai.service.basic.ts) | Variante simples / testes. |
| [`adapters/order/order.service.v2.ts`](../src/pro/adapters/order/order.service.v2.ts) | `OrderServiceResult` a partir de Supabase/RPC. |
| [`adapters/order/order.service.legacy.ts`](../src/pro/adapters/order/order.service.legacy.ts) | Ponte legada — contrair quando V2 for único caminho. |
| [`adapters/supabase/session.repository.supabase.ts`](../src/pro/adapters/supabase/session.repository.supabase.ts) | Persistência `ProSessionState`. |
| [`adapters/whatsapp/message.gateway.whatsapp.ts`](../src/pro/adapters/whatsapp/message.gateway.whatsapp.ts) | Dedup outbound; `OutboundMessage`. |
| [`adapters/metrics/metrics.console.ts`](../src/pro/adapters/metrics/metrics.console.ts) | Implementação `MetricsPort`. |
| [`adapters/logger/logger.console.ts`](../src/pro/adapters/logger/logger.console.ts) | Implementação `LoggerPort`. |

### Testes (obrigatórios após cada alteração)

| Ficheiro | Papel |
|----------|--------|
| [`tests/pro/proPipeline.test.ts`](../tests/pro/proPipeline.test.ts) | Fluxos felizes + “falhas reais” (IA inválida, intent, pedido vazio). |
| [`tests/pro/proPipeline.failure-regression.test.ts`](../tests/pro/proPipeline.failure-regression.test.ts) | Regressão timeout / erros de pipeline. |
| [`tests/pro/orderDraftGate.test.ts`](../tests/pro/orderDraftGate.test.ts) | Pré-condição de draft (R1). |
| [`tests/pro/deps.factory.test.ts`](../tests/pro/deps.factory.test.ts) | Overrides de `makeProPipelineDependencies` (R2). |
| [`tests/pro/proStepTransitions.test.ts`](../tests/pro/proStepTransitions.test.ts) | `canTransition` e resolvers de passo PRO (R1). |
| [`tests/integration/chatbot-queue-e2e.test.ts`](../tests/integration/chatbot-queue-e2e.test.ts) | Fila + worker + `processInboundMessage` (não alterar Starter). |

### Documentação (manter sincronizado ao fechar fases)

| Ficheiro |
|----------|
| [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) (este) |
| [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) |
| [`pipeline_chatbot_prod.md`](./pipeline_chatbot_prod.md) |
| [`structure_chatbot_prod.md`](./structure_chatbot_prod.md) |
| [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md) |

**Ordem sugerida de refatoração no código (incremental):** `contracts.ts` → adapters de pedido (`order.service.v2.ts`) → estágios (`orderStage.ts`, `aiStage.ts`, …) → `runProPipeline.ts` → `deps.factory.ts` / serviços → testes → docs.

---

## 1. Objetivo da refatoração

1. **Uma fonte de verdade** para estado de pedido assistido por IA (draft canónico no servidor).
2. **Transições explícitas e testáveis** entre estados; **nenhuma** RPC de criação/fecho fora de gate.
3. **Fronteira clara** entre classificação legada (`lib/chatbot/middleware`, `inboundPipeline`) e **efeito de pedido** PRO (`src/pro/pipeline`, adapters) — sem duas semânticas concorrentes.
4. **Telemetria por motivo** (`draft_invalid`, `finalize_blocked`, `tool_round_exceeded`, …) para priorizar correções com dados.

**Não objetivo desta estratégia:** trocar de modelo LLM, introduzir segundo broker de fila, nem reescrever o Starter.

---

## 2. Diagnóstico resumido (ponto de partida)

| Risco | Sintoma |
|-------|---------|
| Dupla semântica | Intent/draft coerentes no classificador e incoerentes no PRO (ou o inverso). |
| Estado partido | Modelo “lembra” o que a BD já não reflete (ou snapshot desatualizado). |
| Gates implícitos | Finalização ou side-effects possíveis por caminhos não documentados. |
| Tools permissivas | JSON de tool aceite sem validação → dados impossíveis no draft. |
| Confirmação fraca | “pode”, “manda” disparam finalize no contexto errado. |

---

## 3. Fases de refatoração (ordem recomendada)

Cada fase deve terminar com **testes** (`npm test`, fluxos manuais do runbook) e **sem regressão** nos gates do Starter.

### Fase R0 — Instrumentação mínima (1 sprint curta)

**Entregáveis**

- Contadores ou logs estruturados com: `company_id`, `thread_id`, `reason` (enum estável), `pipeline_stage`.
- Lista fixa de `reason` inicial: `draft_validation_failed`, `finalize_blocked`, `confirmation_ambiguous`, `tool_output_rejected`, `ai_timeout` (alinhado ao que já existe onde aplicável).

**Estado (incremental):** tipo `ProPipelineTelemetryReason` em [`src/types/contracts.ts`](../src/types/contracts.ts); métrica `pro_pipeline.order_failed` com `tags.errorCode` + `reason: order_rejected` em [`runProPipeline.ts`](../src/pro/pipeline/runProPipeline.ts); códigos de erro explícitos em [`order.service.v2.ts`](../src/pro/adapters/order/order.service.v2.ts) (`PRODUCT_NOT_FOUND`, etc.); testes em [`tests/pro/proPipeline.failure-regression.test.ts`](../tests/pro/proPipeline.failure-regression.test.ts).

**Gate:** PR só mergeia se os novos campos **não** logarem PII além do necessário e não aumentarem custo de log de forma absurda.

---

### Fase R1 — Máquina de estados explícita (fundação)

**Entregáveis**

- Enum de **estado de pedido PRO** (ex.: `idle` → `collecting` → `ready_to_confirm` → `awaiting_confirmation` → `finalized` / `aborted`) — nomes ajustados ao código existente, não inventar 20 estados.
- Tabela ou módulo único `canTransition(from, event) → next | reject` com **testes unitários** para cada transição permitida e negada.
- **Um** ponto de entrada que aplica transição após validação (evitar `if` espalhados que duplicam regra).

**Gate:** nenhuma chamada a RPC de criar/fechar pedido fora deste módulo de transição.

**Onde tocar (referência):** `src/pro/pipeline/` (stages), adapters de order; evitar mudar contratos públicos sem atualizar [`contracts.ts`](../src/types/contracts.ts) quando aplicável.

**Estado (incremental):** [`orderDraftGate.ts`](../src/pro/pipeline/orderDraftGate.ts) + [`proStepTransitions.ts`](../src/pro/pipeline/proStepTransitions.ts) (`canTransition`, usado por `aiStage`, `orderStage`, `routeStage`). Evolução futura: um único `applyTransition(state, event)` que também mova contadores (`misunderstandingStreak`, etc.) se necessário.

---

### Fase R2 — Fronteira semântica (classificador vs PRO)

**Entregáveis**

- Documento curto no PR (ou secção neste ficheiro) com matriz: **quem decide intent** para mensagens que **não** alteram pedido vs mensagens que **alteram** draft.
- Regra desejada: **todo efeito estrutural em pedido** passa pelo pipeline PRO + draft canónico; o classificador legado **não** escreve campos de pedido concorrentes ao PRO.
- Ajustes mínimos em `processMessage.ts` / `inboundPipeline.ts` para **encaminhar** sem duplicar lógica de negócio.

**Gate:** testes de regressão `intent errado`, `pedido vazio`, `IA inválida` continuam verdes; novos testes para “mensagem de menu não apaga draft” se aplicável.

**Matriz incremental (piloto PRO V2):** o classificador legado (`intentClassifier` / `inboundPipeline`) continua a decidir fluxo Starter e metadados de alto nível; **efeito estrutural em pedido PRO** (draft canónico, passos `pro_*`, fecho) fica em `runProPipeline` + `SessionRepository` (chave `context.__pro_v2_state`). Com `CHATBOT_PRO_PIPELINE_V2_MODE=active`, `processInboundMessage` devolve após o PRO e não duplica escrita de draft no legado na mesma mensagem.

| Camada | Escreve `__pro_v2_state` / chama RPC de pedido PRO? |
|--------|-----------------------------------------------------|
| `processInboundMessage` → `runProPipeline` | Sim (via `persistAndEmit` / `OrderService`) |
| `makeProPipelineDependencies` | Não; só injeta portas (`overrides` em testes) |
| `inboundPipeline` após retorno PRO ativo | Não na mesma invocação (fluxo encerra) |

---

### Fase R3 — Confirmação forte e cópia ao cliente

**Entregáveis**

- Política de confirmação: só `finalize` com **sinal forte** no estado `awaiting_confirmation` (regex restrita + contexto, ou botão/ID Meta mapeado).
- **Resumo enviado ao WhatsApp** preferencialmente **montado a partir do snapshot** validado (preço, itens, taxa), não texto 100% livre do modelo.
- Mensagem de clarificação única quando ambíguo.

**Gate:** cenários manuais documentados no [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md) (atualizar passos se necessário).

---

### Fase R4 — Carga, quota e leitura de catálogo

**Entregáveis**

- **Quota por `company_id`** no worker ou no claim (quando existirem métricas de *noisy neighbor* — ver `CHATBOT_PROD.md` médio prazo).
- Cache leitura **curto** e **seguro** para views de catálogo **somente leitura** (opcional), com invalidação conservadora.
- Revisão de índices Supabase nas queries mais pesadas das tools (só após evidência em log/plan).

**Gate:** evidências em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md#como-obter-evidências-p95-carga-replay) (carga leve) sem 5xx no `incoming`.

---

## 4. O que **não** fazer (anti-padrões)

- Segundo modelo “só para confirmação” sem métrica de falha da confirmação atual.
- Regras de cardápio/preço/taxa **só** no system prompt.
- Novo microserviço “order-brain”.
- Expandir regex de pedido no Starter para “competir” com o PRO.

---

## 5. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| PR grande | Fases R0–R2 em PRs pequenos; R3–R4 só com base estável. |
| Regressão Starter | gate de merge existente em `pipeline_chatbot_prod.md`; testes `processMessageFlows` / integração. |
| Estado migrado | Se já existir coluna JSON de draft, **versionar** ou `updated_at` + rejeitar writes stale. |

---

## 6. Critérios de “feito” desta estratégia

- [x] Módulo de transição de estado com **cobertura de teste** das transições críticas (`proStepTransitions` + testes).
- [ ] **Zero** finalize fora de `awaiting_confirmation` (ou estado equivalente documentado).
- [ ] Telemetria com **&lt; 10 motivos** estáveis consultáveis no Super Admin ou logs.
- [ ] Runbook de smoke atualizado com **confirmação ambígua** e **replay** onde couber.
- [ ] Documentação: esta página + `CHATBOT_PROD.md` mantidos como fonte única de decisão até ADR específico.

---

## 7. Referências de código (ponto de partida)

- Entrada motor: `lib/chatbot/processMessage.ts`
- Pipeline legado: `lib/chatbot/inboundPipeline.ts`
- PRO V2: `src/pro/pipeline/`, `src/pro/adapters/`
- Contratos: `src/types/contracts.ts`

---

## 8. Progresso da execução (log)

| Data | Ficheiros | Nota |
|------|-----------|------|
| 2026-04-16 | `contracts.ts`, `order.service.v2.ts`, `runProPipeline.ts`, `proPipeline.failure-regression.test.ts`, esta doc | R0 parcial: `ProPipelineTelemetryReason`, `PRODUCT_NOT_FOUND`, métrica `pro_pipeline.order_failed`, testes IA inválida / PRODUCT_NOT_FOUND / DB_ERROR / `load` que falha. |
| 2026-04-16 | `orderStage.ts`, `aiStage.ts`, `persistAndEmit.ts`, `runProPipeline.ts`, `proPipeline.failure-regression.test.ts`, esta doc | Gates com `OrderStageOutcome`; métricas `order_precondition_failed` (`finalize_blocked` / `draft_validation_failed`), `confirmation_ambiguous`, `ai_invalid_response`; `persistAndEmit` regista `session_save_failed` antes de relançar; testes para sem rascunho, rascunho incompleto, confirmação fraca e falha de `save`. |
| 2026-04-16 | `errors.ts`, `loadState.ts`, `orderDraftGate.ts`, `orderStage.ts`, `session.repository.supabase.ts`, `deps.factory.ts`, `processMessage.ts`, `orderDraftGate.test.ts`, `deps.factory.test.ts`, esta doc | R1: `orderDraftGate` + uso em `orderStage`. Erro tipado `ProPipelineSessionLoadError` (`underlyingCause`) em `loadState`. Adapter: `CHATBOT_SESSION_PRO_V2_STATE_KEY`. R2: `makeProPipelineDependencies(..., { overrides })`, matriz no doc, log estruturado em `processMessage` para falha de load. |
| 2026-04-16 | `proStepTransitions.ts`, `aiStage.ts`, `orderStage.ts`, `routeStage.ts`, `guardRails.ts`, `runProPipeline.ts`, `contracts.ts` (`PipelinePolicies.aiTimeoutMs`, `invalid_state_transition`), `ai.service.full.ts`, `proStepTransitions.test.ts`, `proPipeline.failure-regression.test.ts`, esta doc | R1 fechado no motor: `canTransition` + helpers; `guard_stop` com `stopReason`; timeout IA alinhado às policies; Full AI: limite de tool rounds (`TOOL_FAILED`), 429/rate limit (`AI_RATE_LIMIT`), `AbortError` como timeout, tool desconhecido devolve `tool_result` estruturado; métricas `ai_tool_round_exhausted` / `ai_rate_limited`. |
| 2026-04-16 | `proStepTransitions.ts`, `orderStage.ts`, `proStepTransitions.test.ts`, esta doc | Alinhamento final R1: RPC `createFromDraft` executa via `executeOrderRpcTransition` (dentro do módulo de transição), preservando regra “sem finalize fora de transição válida”. |
| 2026-04-16 | `orderStage.ts`, `intentClassifier.service.ts`, `proPipeline.test.ts`, `proPipeline.failure-regression.test.ts`, `SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`, esta doc | R3 incremental: confirmação forte inclui `confirmar` e IDs (`confirmar_pedido`, `confirm_order`), bloqueia negação explícita em awaiting; smoke atualizado com passo 4.1 (confirmação forte/ambígua). |
| 2026-04-16 | `order.service.v2.ts`, `order.service.v2.message.test.ts`, esta doc | R3 cópia ao cliente: mensagem final de confirmação padronizada no servidor a partir do draft validado (itens, total, taxa, pagamento), com testes unitários de snapshot textual. |

**Próximo na sequência sugerida (§0):** Fase R3 (confirmação forte / cópia ao cliente) e atualização do [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md); opcional: fundir streaks de escalação no módulo de transição.

---

## 9. Revisão

Rever este documento **após cada deploy** em produção com tráfego real, ou a cada **4 semanas** em fase de piloto, para ajustar ordem das fases com base nas métricas de `reason` e na saúde da fila.
