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
| [`deps.factory.ts`](../src/pro/pipeline/deps.factory.ts) | Monta `PipelineDependencies` (adapters reais). |
| [`stages/loadState.ts`](../src/pro/pipeline/stages/loadState.ts) | Carrega `ProSessionState` via `SessionRepository`. |
| [`stages/guardRails.ts`](../src/pro/pipeline/stages/guardRails.ts) | Pré-condições antes de intent/IA. |
| [`stages/intentStage.ts`](../src/pro/pipeline/stages/intentStage.ts) | `IntentDecision` via `IntentService`. |
| [`stages/orderStage.ts`](../src/pro/pipeline/stages/orderStage.ts) | Confirmação + `OrderService.createFromDraft` → `OrderServiceResult`. |
| [`stages/routeStage.ts`](../src/pro/pipeline/stages/routeStage.ts) | Roteamento `pro_escalation_choice` / modo IA. |
| [`stages/aiStage.ts`](../src/pro/pipeline/stages/aiStage.ts) | `AiService.run` → `AiServiceResult`; fallback se resposta inválida. |
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

---

### Fase R2 — Fronteira semântica (classificador vs PRO)

**Entregáveis**

- Documento curto no PR (ou secção neste ficheiro) com matriz: **quem decide intent** para mensagens que **não** alteram pedido vs mensagens que **alteram** draft.
- Regra desejada: **todo efeito estrutural em pedido** passa pelo pipeline PRO + draft canónico; o classificador legado **não** escreve campos de pedido concorrentes ao PRO.
- Ajustes mínimos em `processMessage.ts` / `inboundPipeline.ts` para **encaminhar** sem duplicar lógica de negócio.

**Gate:** testes de regressão `intent errado`, `pedido vazio`, `IA inválida` continuam verdes; novos testes para “mensagem de menu não apaga draft” se aplicável.

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

- [ ] Módulo de transição de estado com **cobertura de teste** das transições críticas.
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

**Próximo na sequência sugerida (§0):** `orderStage.ts` (gates de confirmação), `aiStage.ts` (métrica `ai_invalid_response` quando aplicável), `persistAndEmit.ts`, depois serviços/adapters conforme R1–R2.

---

## 9. Revisão

Rever este documento **após cada deploy** em produção com tráfego real, ou a cada **4 semanas** em fase de piloto, para ajustar ordem das fases com base nas métricas de `reason` e na saúde da fila.
