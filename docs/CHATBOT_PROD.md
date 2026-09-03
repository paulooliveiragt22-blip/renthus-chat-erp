# Chatbot — execução produção (`chatbot_prod`)

Documento de decisão e checklist para o time executar. Alinhado ao código atual (`processInboundMessage`, `chatbot_queue`, motor em `lib/chatbot/`).

**Ordem de leitura:** princípios → **arquitetura por horizonte (Hobby / médio prazo / escala)** → **pedido PRO / cérebro IA** → fases 0–3 → evidências / riscos → [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) (histórico de refatoração) → [`ADR/0005-pro-agent-calibration-pillars.md`](./ADR/0005-pro-agent-calibration-pillars.md) + [`PLANO_CALIBRACAO_AGENTE_PRO.md`](./PLANO_CALIBRACAO_AGENTE_PRO.md) (**calibração / fortalecimento vigente**).

> **Calibração do agente (vigente 2026-09-03):** quatro pilares (gates → matching → prompts → avaliação) e cronologia C0–C5 em [`PLANO_CALIBRACAO_AGENTE_PRO.md`](./PLANO_CALIBRACAO_AGENTE_PRO.md). Decisão: [`ADR-0005`](./ADR/0005-pro-agent-calibration-pillars.md). Transporte: [`ADR-0003`](./ADR/0003-sqs-outbox-lambda.md).
>
> **Plano de limpeza (histórico):** [`PLANO_LIMPEZA_AGENTE_IA.md`](./PLANO_LIMPEZA_AGENTE_IA.md) — Starter removido, replay/harness e handover (`applyProHandover`) em grande parte **feitos**; não usar o P0 de handover desse doc como bug ainda aberto.

---

## Objetivo

Suportar **muitas empresas e muitos pedidos em paralelo** sem acoplar o webhook ao tempo de IA/DB. Prioridade: **custo, latência, simplicidade**. Transporte de fila: **SQS + Lambda** (ADR-0003); outbox permanece no Postgres.

**Planejamento de carga (referência interna):** piloto com **3 empresas** da ordem de **~10 mil pedidos/mês cada**; meta de crescimento até **~100 empresas** nesse perfil (ex.: **12/26**). Para capacidade e custo de IA, planear em **mensagens inbound e chamadas ao modelo no pico**, não só em “pedidos/mês” médio — o funil gera **várias mensagens por pedido**.

---

## Arquitetura alvo (referência) — Webhook → outbox → SQS → Lambda → pipeline → resposta

Fluxo canónico de processamento quando **`CHATBOT_QUEUE_ENABLED=1`** ([ADR-0003](./ADR/0003-sqs-outbox-lambda.md)):

1. **Webhook** (`POST` Meta): validação, persistência mínima, **dedup** de curta janela (texto), **enqueue** em `chatbot_queue` (outbox), **200** rápido.
2. **Outbox + transporte:** Postgres (`chatbot_queue` / `outbound_jobs`) continua fonte de verdade (dedup, coalesce, ops); após insert, `after()` → `SQS SendMessage` (`lib/queue/afterEnqueue.ts` + `sqsDispatch.ts`) quando `SQS_DISPATCH_ENABLED=1`.
3. **Worker:** AWS Lambda (`renthus-inbound-worker` / `renthus-outbound-worker`) consome SQS FIFO → `processInboundJobById` / `processOutboundJobById`.
4. **Pipeline:** `lib/chatbot/processMessage.ts` — plano **PRO** → `runProPipeline` (`src/pro/`); **Starter** → `inboundPipeline`.
5. **Resposta:** envio WhatsApp dentro do pipeline / camadas já existentes; manter idempotência de **efeito** (pedido, outbound).

**Gatilho do worker (cutover SQS — Fase 4):**

| Modo | Papel |
|------|--------|
| **Caminho feliz** | Enqueue outbox → `SendMessage` SQS → Lambda (event source mapping). Sem wake HTTP na Vercel. |
| **Rede de segurança** | DLQ SQS + reconciler Lambda `renthus-outbox-reconcile` (EventBridge 5 min): `pending` sem `sqs_enqueued_at` > 2 min + reclaim `processing` stale; cleanup diário `chatbot-queue-cleanup` via `pg_cron`. |

*Estado da implementação (pós cutover ADR-0003):*
- Dispatch: `incoming` / producers outbound → `scheduleInboundAfterEnqueue` / `scheduleOutboundAfterEnqueue*` → SQS.
- Filas: `renthus-inbound.fifo` (MessageGroupId = `thread_id`), `renthus-outbound.fifo` (MessageGroupId = `company_id`).
- Rotas HTTP `process-queue` / `outbound-worker` e wake (`queueWorkerWake`) **removidas**.
- Crons Vercel/cron-job.org de drain de fila **removidos**; permanece `detect-abandoned-carts` (enfileira outbound).
- `pg_cron` job `chatbot-queue-drain` **unscheduled**; cleanup diário de outbox **mantido**.
- Fairness no worker: Upstash `companyWorkerCap` (+ teto LLM global). Coalesce inbound: Upstash `SET NX` + fallback PG (`coalesceRedis.ts`). RPCs claim/reclaim **removidas** (Fase 5).
- **Backlog UX:** se a fila da empresa estiver profunda/atrasada, `incoming` envia aviso PT-BR (cooldown por thread) via `lib/chatbot/backlogNotice.ts`.
- **Cache busca catálogo:** TTL in-memory em `src/pro/tools/catalogSearchCache.ts` (por instância).

### Scheduler externo

Após cutover, **não** use cron-job.org para `process-queue` / `outbound-worker` / `reactivate`. Job útil restante no Hobby: `detect-abandoned-carts` (e crons Vercel diários em `vercel.json`: billing, marketplace, platform alerts/audit). Crons de 5 min (reactivate, etc.) → EventBridge Scheduler quando migrar (ver ADR-0003).

---

## Arquitetura por horizonte (decisão)

### Agora — **Vercel + SQS + Lambda** (cutover ADR-0003)

- **Outbox** em Postgres (`chatbot_queue` / `outbound_jobs`) + **SQS FIFO** + **Lambda** workers.
- Vercel: webhooks, UI, APIs tenant, enqueue + `SendMessage` (`SQS_DISPATCH_ENABLED=1`).
- **Expectativa:** latência dominada por IA/Meta, não por poll HTTP de fila na Vercel.

### Médio prazo — tráfego real

- Observabilidade: CloudWatch (idade SQS, DLQ) + platform `getQueueHealthStats` na outbox.
- Reconciler outbox + coalesce Upstash (Fase 5 do ADR).
- Remover RPC claim/reclaim quando métrica confirmar zero consumidores HTTP.

### Escala alvo — **~100 empresas × ~10k pedidos/mês** (~1M pedidos/mês agregado)

- Tratar **mensagens + rodadas de IA** como driver de carga, não “pedidos/mês” médio.
- **Tetos externos:** Anthropic (quota/RPM), Meta (rate limit / número), Postgres (OLTP; fila quente já fora do claim SQL).
- Calibrar reserved concurrency Lambda vs `LLM_GLOBAL_MAX_IN_FLIGHT` (Service Quotas se conta nova).
- Postgres único como **outbox + OLTP** ainda tem teto de conexões — pooler `:6543` nas Lambdas é obrigatório.

---

## Limites conhecidos (auto-crítica; não superestimar)

- **Fila não aumenta capacidade de IA** — só desloca trabalho e protege o webhook; latência de modelo continua a dominar muitos casos.
- **Dedup de texto** cobre bem **duplo envio rápido / retry**; **não** substitui idempotência de **efeito** (criar pedido, cobrar, template) se outra camada reexecutar.
- **SQS at-least-once** exige disciplina idempotente na outbox + efeitos (já parcial no repo).
- **Reserved concurrency** em contas AWS novas pode falhar (mín. unreserved); calibrar depois.

---

## Princípios (não reabrir na implementação)

1. **Webhook não executa Anthropic nem o motor completo do chatbot** quando **`CHATBOT_QUEUE_ENABLED=1`:** só valida, persiste o mínimo, enfileira; HTTP rápido. Com fila desligada, o comportamento legado (processar no mesmo request) pode existir para transição — não é o alvo de produção PRO.
2. **Idempotência obrigatória** no processamento do inbound (mínimo: `message_id` do provedor + escopo **empresa** + thread). Duplicata ≠ segundo pedido ≠ segunda resposta. Se existirem **dois ingressos** (ex.: Meta + Twilio), o desenho do idempotente tem de cobrir **o mesmo evento de negócio** ou aceitar risco explícito documentado.
3. **Motor de domínio** permanece em `lib/chatbot/` (ex.: `processInboundMessage` / pipeline); muda apenas **quem invoca** (worker após dequeue).
4. **Pedidos**: mutação só por **RPC aprovada** (`create_order_with_items`, etc.). Sem SQL solto no worker para “consertar pedido”.
5. **Fila**: **`chatbot_queue` em Postgres primeiro**. SQS/Redis/serviço novo só após **métrica de dor** (profundidade, idade p95 do job, locks, manutenção da tabela).
6. **Multi-tenant:** toda leitura/mutação com **`company_id`** resolvido de forma auditável (canal → empresa); nunca processar thread sem amarrar tenant.

---

## Tetos externos (não “resolver só no código”)

| Sistema | Risco em escala |
|---------|------------------|
| **Anthropic** | **Quota/RPM/tokens** por tier são teto duro; fila não aumenta capacidade, só desloca no tempo. Tratar **limite de concorrência** de chamadas + **plano comercial** de uso em paralelo ao roadmap técnico. |
| **WhatsApp (Graph API)** | Rate limit por **número / app**; qualidade e retries. Muitas empresas **partem a carga** por `phone_number_id`, mas exige runbook e monitorização de erros de envio. |
| **Postgres (app + fila)** | Mesmo cluster a servir OLTP + fila: risco de **contenção e pool de conexões**; dimensionar pool e evitar explosão de consumers sem limite. |

---

## Fases de execução

### Fase 0 — Instrumentação (paralelizável)

| Ação | Nota |
|------|------|
| Métricas mínimas | `queue_depth`, **idade do job (p95/p99)**, sucesso/falha do worker, latência Anthropic, **429 / rate limit** Anthropic, erro envio WhatsApp, contador de duplicata suprimida |
| Alertas | Fila acima de limiar acordado; taxa de falha worker; opcional: idade p95 do job |

**Pronto:** logs estruturados ou painel consultável; pelo menos um alerta na fila.

---

### Fase 1 — Desacoplamento (prioridade máxima)

| Ação | Nota |
|------|------|
| `POST` webhook (ex.: `app/api/whatsapp/incoming`) | Após validação: **insert job** (`chatbot_queue` ou RPC equivalente), responder **200** sem `await` do motor |
| Worker | Lambda SQS → `processInboundJobById` (ADR-0003); marcar `done` / `failed`, **backoff** via visibility SQS |
| **Execução do worker** | **SQS event source** após enqueue (caminho feliz). Sem wake HTTP. Reconciler outbox (Fase 5) para `pending` sem `sqs_enqueued_at`. |
| Idempotência | Unique ou guard clause em **(empresa, `message_id`)** antes de efeitos colaterais (pedido, outbound) |
| Índices / fila | Garantir **índice alinhado ao `claim`** (estado + ordenação); plano de **retenção/arquivamento** de jobs `done` antes da tabela virar problema operacional |

**Pronto:** teste com dezenas de mensagens concorrentes sem timeout no webhook; replay do mesmo `message_id` não duplica efeito colateral (pedido/resposta).

---

### Fase 2 — Sessão e IA

| Ação | Nota |
|------|------|
| Histórico IA PRO | Em `__pro_v2_state.aiHistory` (não `pro_anthropic_messages`). Cap / “estado basta sem replay” ainda evolutivo. |
| Tool chain | Manter saneamento até cap estar validado em staging |
| Concorrência na IA | **Feito (por instância, isolado por provider):** `runLlmWithResilience(provider, ...)` = in-flight gate + retry 429 + circuit breaker, com estado separado pra Anthropic e OpenAI (`lib/chatbot/llmResilience.ts` + `anthropicInFlightGate.ts`) — saturar/abrir o circuito de um provider não afeta o outro. **Fairness de fila por `company_id`:** no **claim SQL** (`max_per_company`) — não é teto por tenant. **Ainda adiado:** Redis/semáforo **global entre réplicas**; teto **por `company_id`** só se métrica de *noisy neighbor* na IA (não na fila) justificar. |

**Pronto:** não reproduzir erro 400 `tool_use`/`tool_result` em conversas longas; degradação previsível sob carga (fila/latência), não falha opaca do webhook.

---

### Fase 3 — Só com Fase 1–2 verdes

| Ação | Nota |
|------|------|
| Horizontal | **Várias instâncias** do worker consumindo a mesma fila (`SKIP LOCKED`); cada instância com **teto** de concorrência para não esgotar pool/API |
| Postgres | Se profundidade/idade da fila ou manutenção justificarem: **partição por tempo** na tabela de jobs e/ou política agressiva de arquivo de `done` |
| ADR “sair da fila Postgres” | Só se **métricas ou operação** (locks, custo de poll, SRE) justificarem fila gerenciada — não por antecipação |

---

## Fora de escopo (explícito)

- Microserviço só do chatbot.
- Novo broker sem métrica de gargalo.
- Segundo modelo de IA “preventivo”.
- Reescrita do Starter/PRO em outra stack.

---

## Critérios de aceite (release)

Tabela de acompanhamento (método + placeholders): [`EVIDENCE_CHECKLIST_P14.md`](./EVIDENCE_CHECKLIST_P14.md).

- [ ] Webhook **p95 &lt; 2 s** sem esperar Haiku.
- [ ] **Zero** pedidos duplicados em teste de replay de `message_id` (e cenário de replay documentado por canal).
- [ ] Com fila acumulada: degradação por **latência**, não **500 em cascata** no webhook.
- [ ] Runbook de 1 página: fila parada → worker, secrets, **quota/rate limit Anthropic**, Graph API.
- [ ] (Escala) Capacidade de **vários consumers** documentada: como escalar réplicas do worker e onde está o **limite** (DB pool, Anthropic, Meta).

---

## Como obter evidências (p95, carga, replay)

Objetivo: fechar os checkboxes dos **critérios de aceite** com método repetível, sem adivinhar a partir de um único log.

### 1) Webhook **p95 &lt; 2 s** (só o `POST /api/whatsapp/incoming`)

1. Na **Vercel** → projeto → **Logs** (ou Observability / Speed Insights, se ativo).
2. Filtre **path** = `/api/whatsapp/incoming` e, se existir, **method** = `POST`.
3. Exporte ou copie uma **amostra** (mínimo sugerido: **100+** requests em janela de 24–72 h com tráfego normal).
4. Ordene as **durações totais** (ou só “Function duration”) e calcule **p95** (valor abaixo do qual ficam 95% das amostras).
5. **Passa** se p95 &lt; **2 s** e não houver `POST` ao Anthropic listado nesse mesmo request (confirma que o motor pesado está no worker).

*Atalho:* Speed Insights / APM com breakdown por rota substitui planilha manual quando disponível.

### 2) Replay de **`message_id`** (idempotência de efeito)

1. **Guardar** o body bruto JSON de um webhook real (uma mensagem que já processou) e o header `X-Hub-Signature-256` **ou** recalcular a assinatura com `WHATSAPP_APP_SECRET` (HMAC-SHA256 do body, formato Meta).
2. Enviar o **mesmo** `POST` duas vezes para `/api/whatsapp/incoming` (intervalo curto).
3. **Verificar no Supabase:** uma linha de efeito de negócio esperada (ex.: não duplicar pedido; `whatsapp_messages` / `chatbot_queue` coerentes com unique `(company_id, message_id)` onde aplicável).
4. **Documentar** o procedimento (URL, headers, o que medir) no runbook ou numa nota de homologação — critério de aceite pede cenário documentado.

*Nunca commite o secret nem o body com tokens em repositório.*

### 3) Carga leve (“fila acumulada → latência, não 500 no webhook”)

1. Em janela controlada (staging preferível; produção só com volume modesto), gerar **N mensagens** em sequência (vários utilizadores ou um script com rate limit respeitoso).
2. Em paralelo: **Logs** filtrados em `incoming` → percentagem de **5xx** deve permanecer **~0**; `process-queue` pode mostrar **503** se RPC falhar (investigar Supabase separadamente).
3. **Super Admin** (saúde da fila): observar `pending` subir e **voltar a descer**; falha em massa no worker aparece como `failed` / alertas.

*Carga pesada sintética (k6, Artillery)* só vale quando quiser número para capacidade; para o critério de aceite, muitas vezes basta **pico moderado real** + monitorização.

---

## Riscos aceitos (até nova decisão)

- Latência **primeira resposta** pode subir vs fluxo síncrono (troca intencional).
- Postgres como fila pode exigir índice/partição/manutenção em volume alto.
- Anthropic e Meta seguem sendo **SLAs externos**; fila não cria capacidade infinita.
- Picos de negócio geram **picos de mensagens** maiores que a média de pedidos/mês; capacidade tem de ser validada no **pico**, não na média.

---

## Simplificações explícitas (não fazer cedo)

- “Degradação automática para regex/Starter” na mesma entrega da Fase 1 — segundo motor de bugs/testes.
- “Resumo com LLM” antes de **cap + estado de pedido** — custo e complexidade sem necessidade comprovada.
- **Kafka / microserviço de fila** antes de **wake + loop limitado + métricas de profundidade/idade p95** — overengineering operacional.
- **Fairness de fila por empresa:** já no claim SQL (`CHATBOT_QUEUE_MAX_PER_COMPANY`) + interleave no batch — **não** reabrir como “próximo”. Ainda adiado: broker externo e Redis para teto Anthropic multi-réplica (só com métrica).

---

## Pedido PRO — “cérebro” da IA (decisões)

Complementa a arquitetura **Webhook → fila → worker**: o transporte já desacopla latência; esta secção fixa **como** o PRO fecha pedido sem virar “conversa solta”.

### Princípios (vinculativos para refatoração)

1. **Fonte única de verdade** do rascunho/pedido no **servidor** (BD / draft canónico). O modelo **propõe**; não é ledger de negócio.
2. **Máquina de estados explícita** (enum + transições permitidas **testáveis**). Mutação de pedido **só** através de **RPC aprovada** e **só** quando o **gate** do estado permitir.
3. **Uma fronteira semântica** para **efeito de pedido**: evitar duas “verdades” paralelas (classificador legado vs PRO V2) no mesmo caminho que cria/atualiza draft ou finaliza — ver plano em [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).
4. **Tools de catálogo** = **leitura** + contrato estrito + **validação server-side** do output. Texto ao cliente com valores sensíveis (preço, taxas) deve **preferencialmente refletir snapshot** já validado, não improvisação do modelo.
5. **Confirmação forte** no fecho (sinal inequívoco no contexto certo); ambiguidade → **clarificação**, não `finalize`.
6. **Orçamento de IA** (timeout, rodadas de tool, cap de tokens) como **teto** por mensagem; degradação estável (mensagem segura / retry) acima de “falha opaca”.

### O que não superestimar

- Estado canónico **reduz** risco de pedido fantasma; **não** elimina texto de bolha desalinhado se a UI verbal for 100% livre no LLM.
- Híbrido determinístico + IA **não** reduz custo de manutenção sem **dono** do diagrama de estado e testes de transição.

### Order Finalization Orchestrator (produção)

Decisão de UX/estado para PRO V2: o orquestrador deve resolver os passos de checkout com ações determinísticas antes de cair em ambiguidade de LLM.

- **Saudação contextual:** no início da conversa, distinguir primeiro acesso vs cliente recorrente e mostrar botões (`Cardápio`, `Meu pedido`, `Falar com atendente`).
- **Mensagem inicial já completa (itens + endereço + pagamento):** devolver resumo entendido e botões `Confirmar`, `Corrigir`, `Adicionar produtos`.
- **Pagamento:** botões interativos (`PIX`, `Cartão`, `Dinheiro`). Se `Dinheiro`, pedir `Troco pra quanto?` e persistir no draft.
- **Endereço:** se o servidor resolver rua+número+bairro+cidade+UF (salvo ou digitado), **não** pede “Confirma este endereço?” — avança para pagamento ou resumo. Corrigir endereço continua via `Corrigir`.
- **Resumo final:** card único do servidor com itens, **taxa**, total e botões `Confirmar` / `Corrigir` / `Adicionar produtos` (não depender da IA para R$). Clarificação de produto: só botões/lista do servidor; “Opção 2” mapeia para a embalagem.
- **Proibição de UX enganosa:** não emitir “pedido confirmado” antes de retorno `ok` do RPC de criação.

#### Estado no código (**já executado**)

**Cérebro de linguagem (produção):** agent loop em `AiServiceAdapter` (`src/pro/adapters/ai/ai.service.ts`, `aiStage`) — Vercel AI SDK `generateText` com `tools` (`search_produtos` / `get_order_hints` / `prepare_order_draft` / `respond_to_customer`) + `stopWhen`/`prepareStep` no lugar do loop manual de `tool_use`; `respond_to_customer` é a tool final obrigatória (carrega `reply_text`/`address_free_text`/`understood`, sem marcador de texto). `prepareStep` força `prepare_order_draft` (via `toolChoice`) quando o contrato tem SKU único. Pós-modelo: `resolveCheckoutTurnOutcome` + `checkoutPostProcess` roteiam UI por estado do draft (**sem** novo LLM). Finalize = botão `pro_confirm_order` (HITL) → RPC. Migração completa de `LlmPort`/`FullAiServiceAdapter` para o SDK: [`PLANO_MIGRACAO_VERCEL_AI_SDK.md`](./PLANO_MIGRACAO_VERCEL_AI_SDK.md).

**Smoke WhatsApp (agent loop):** checklist de prompts e GO/NO-GO em [`SMOKE_AGENT_LOOP_WHATSAPP.md`](./SMOKE_AGENT_LOOP_WHATSAPP.md). Fila/wake/dedup: [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md).

**Não** há extract/dialogue/bootstrap paralelo no hot path.

Implementação actual no PRO (`runProPipeline` — único motor para plano PRO):

| Peça | Onde | O que faz |
|------|------|-------------|
| Saudação + menu | `src/pro/pipeline/stages/routeStage.ts` | `greeting`, `faq` e **`unknown`**: uma mensagem `buttons` + CTA `cta_url` do cardápio (`webMenuUrl`) para `btn_catalog` / `btn_status`. |
| Quick actions (checkout) | `runProPipeline.ts` + `stages/checkoutPostProcess.ts` (`applyQuickAction`) | IDs `pro_edit_order`, `pro_add_items`, `pro_cancel_order`, `pro_pay_*`, `pro_confirm_saved_address`, `pro_confirm_typed_address`; troco em `pro_awaiting_change_amount`; texto `cancelar` / `desistir` cancela o rascunho. Após cada quick action, `withResolvedSlotStep` alinha `ProStep` ao draft. |
| Slots de checkout (passo explícito) | `src/pro/pipeline/orderSlotStep.ts` (`resolveProStepFromDraft`, `withResolvedSlotStep`) | Sincroniza `ProStep` com o draft: endereço estruturalmente completo sem pagamento → `pro_awaiting_address_confirmation` (salvo ou digitado); após confirmar endereço → `pro_awaiting_payment_method`; dinheiro sem troco → `pro_awaiting_change_amount`; draft completo → `pro_awaiting_confirmation`. |
| Pós-processamento UI | `stages/checkoutPostProcess.ts` | `buildAddressConfirmationMessage` com morada completa e sem pagamento (com ou sem `enderecoClienteId`); botões de pagamento só após confirmação de endereço; confirmação final em `pro_awaiting_confirmation`. Mensagens interactivas primeiro (`prioritizeInteractiveFirst`). |
| Consistência texto IA ↔ tools | `src/pro/adapters/ai/ai.service.ts` + `src/pro/tools/prepareOrderDraft.ts` + `src/pro/tools/orderHints.ts` | `guidance_for_model_pt` em `search_produtos` / `prepare_order_draft`; `flow_reminder_pt` em `get_order_hints`; system prompt reforçado; `sanitizeVisibleAgainstDraft` quando o modelo contradiz o draft. |
| Relevância catálogo | `src/pro/tools/searchRelevance.ts` + RPC `rpc_search_chat_produtos` | Rerank por long neck / CX / volume; remove 600ml quando o pedido pede long neck e há hit de descritor. |
| Classificação de botões | `src/pro/services/intent/intentClassifier.service.ts` | Mapeia IDs de botão para `order_intent` / `status_intent` / `human_intent` com alta confiança. |
| Passos no tipo | `src/types/contracts.ts` (`ProStep`) | `pro_awaiting_address_confirmation`, `pro_awaiting_payment_method`, `pro_awaiting_change_amount`, etc. |

**Testes:** `tests/pro/proPipeline.test.ts`, `tests/pro/orderSlotStep.test.ts`, `tests/pro/prepareDraftGuidance.test.ts`.

**Documentação de slots:** [`PRO_ORDER_SLOT_MACHINE.md`](./PRO_ORDER_SLOT_MACHINE.md).

#### Pendências honestas (evolução contínua)

- **Primeira mensagem “tudo numa frase”** com resumo + três botões: o orquestrador emite `Confirmar` / `Corrigir` / `Adicionar produtos` em `pro_awaiting_confirmation` quando o draft canónico e o `ProStep` estão coerentes; a qualidade do resumo na primeira volta continua a depender das tools / IA.
- **`proStepTransitions` + slots:** a IA **não** avança sozinha para confirmação; `applyAiStateTransition` só escala/streak e `aiStage` aplica `withResolvedSlotStep` (draft manda). Ver [`PRO_ORDER_SLOT_MACHINE.md`](./PRO_ORDER_SLOT_MACHINE.md).

### Plano de execução

**Estratégia de refatoração por fases** (histórico R0–R4): [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).  
**Calibração / fortalecimento (cronologia C0–C5):** [`PLANO_CALIBRACAO_AGENTE_PRO.md`](./PLANO_CALIBRACAO_AGENTE_PRO.md) · [`ADR-0005`](./ADR/0005-pro-agent-calibration-pillars.md).

### PRO Pipeline — env e fronteira

Entrada: `lib/chatbot/processMessage.ts` — se o plano for **PRO**, chama só `runProPipeline` (`src/pro/pipeline/runProPipeline.ts`) e **não** entra em `runInboundChatbotPipeline`. Se o V2 lançar exceção: **mensagem fixa** ao cliente (`botReply`) e fim (sem fallback Starter de pedido). Starter continua em `inboundPipeline`.

| Variável | Valor | Comportamento |
|----------|--------|----------------|
| `PRO_PIPELINE_METRICS_STORE` | `supabase` | Grava eventos de métrica do PRO em `pro_pipeline_metric_events` (camada 2). Omitir ou outro valor ⇒ só `ConsoleMetricsAdapter` (log + ingest HTTP opcional). |
| `PRO_PIPELINE_TURN_TRACE` | (off) | `1` / `true` / `on` grava turno em `pipeline_turn_traces` (replay). **Só staging / calibração** — custo de storage + PII no payload. Workers: incluir em `.env.local` e redeploy (`deploy-workers.ps1`). |
| `LLM_PROVIDER` | (omissão = **anthropic**) | Fallback global. **Cada empresa pode sobrescrever via `company_settings.llm_provider`** (Configurações → Chatbot → "Motor de IA", RBAC owner/admin — sem allowlist, qualquer empresa pode escolher `openai`/`groq`/…). Resolvido em `src/pro/adapters/ai/modelProvider.ts` (`resolveLanguageModel`, Vercel AI SDK); consumido por `AiServiceAdapter` (PRO), `intentClassifier.service.ts` (intent) e `sessionMemory.llm.ts`. Workers Lambda: propagado por `deploy-workers.ps1` a partir do `.env.local`. |
| `LLM_MODEL` | default do provider | Ex.: `claude-haiku-4-5-20251001` (Anthropic), `gpt-5-mini` (OpenAI) ou `openai/gpt-oss-120b` (Groq). |
| `OPENAI_API_KEY` | — | Obrigatório se provider efetivo = `openai` e/ou STT Whisper. |
| `GROQ_API_KEY` | — | Obrigatório se provider efetivo = `groq` (`hasLlmApiKey` + `resolveLanguageModel`). Plataforma (não por empresa). |
| `LLM_STT_PROVIDER` | auto | `openai` se houver `OPENAI_API_KEY`; `none` desliga. Transcreve áudio WhatsApp → texto no `incoming`. **Fail-safe C5.3:** qualquer falha de rede/API/transcrição vazia retorna `null` silenciosamente — pipeline continua sem texto de áudio, sem criar draft. |
| `LLM_STT_MODEL` | `gpt-4o-mini-transcribe` | Modelo STT OpenAI (`whisper-1`, `gpt-4o-transcribe`, …). Debita carteira IA por minuto. Débito best-effort: se carteira vazia, transcrição é pulada (`[stt] skipped: AI wallet empty`); se débito falhar pós-transcrição, loga warn e retorna texto normalmente (sem bloquear). |
| `ANTHROPIC_CHATBOT_MAX_IN_FLIGHT` | (omissão = **8**) | Teto de chamadas Anthropic em paralelo **por instância** (gate próprio, não compartilhado com OpenAI). Não substitui quota Anthropic nem coordena entre réplicas serverless. |
| `OPENAI_CHATBOT_MAX_IN_FLIGHT` | (omissão = **8**) | Mesmo teto acima, gate independente pra chamadas OpenAI (empresas com `llm_provider="openai"`). |
| `ANTHROPIC_CIRCUIT_OPEN_MS` | (omissão = **30000**) | Após 3× HTTP 429 seguidos numa chamada Anthropic, abre circuit breaker local por N ms (`anthropic_circuit_open`) — só afeta empresas no provider Anthropic. |
| `OPENAI_CIRCUIT_OPEN_MS` | (omissão = **30000**) | Mesmo mecanismo acima (`openai_circuit_open`), circuito independente pra chamadas OpenAI. |
| `WHATSAPP_MIN_GAP_MS` | (omissão = **100**) | Gap mínimo entre POSTs Graph por `phone_number_id` (throttle local). |
| `WHATSAPP_429_MAX_RETRIES` | (omissão = **3**) | Retries em 429 Meta (honra `Retry-After` quando presente). |
| `CHATBOT_QUEUE_MAX_PER_COMPANY` | (omissão = **2**) | Máx. jobs da mesma empresa por claim (fairness SQL). |
| `CHATBOT_QUEUE_CONCURRENCY` | (omissão = **3**) | Máx. threads/empresas processadas em paralelo no mesmo lote do worker. Jobs da mesma `thread_id` continuam sequenciais. Calibrar após compute/pool (Fase 0 de `PLANO_ESCALA_PICOS_PEDIDOS.md`). |
| `CHATBOT_BACKLOG_DEPTH` | (omissão = **8**) | Pending da empresa ≥ N ⇒ candidata a aviso de fila. |
| `CHATBOT_BACKLOG_AGE_SECONDS` | (omissão = **45**) | Idade do pending mais antigo ≥ N s ⇒ aviso. |
| `CHATBOT_BACKLOG_NOTICE_COOLDOWN_SEC` | (omissão = **120**) | Cooldown do aviso por thread. |
| `CHATBOT_CATALOG_CACHE_TTL_SEC` | (omissão = **60**) | TTL do cache in-memory de `search_produtos` (0 desliga). |

### Decisões operacionais (produção — aplicar)

1. **Um motor por mensagem (tenant PRO):** sempre `runProPipeline`. Não há modo shadow nem flags `CHATBOT_PRO_PIPELINE_V2*`.
2. **Fila ligada:** `CHATBOT_QUEUE_ENABLED=1` — o webhook não deve aguardar Anthropic nem pipeline completo (SLO de ingresso: secção *Critérios de aceite (release)* neste documento). Worker: em **`NODE_ENV=production`**, o claim **best-effort** da fila está **desligado** (só RPC atómica; fallback inseguro entre instâncias não corre, independentemente de variáveis antigas). Em produção o worker **falha o job** se não existir **canal Meta activo** resolvido para a empresa (não usa token global como substituto de tenant).
3. **Gates antes de confirmação:** não tratar “resumo bonito” no LLM como substituto de draft válido no servidor. Só pedir confirmação explícita (“sim” / “ok”) quando itens, endereço, pagamento e regras de entrega (zona, mínimo, etc.) estiverem consistentes no estado canónico / tool `prepare_order_draft`. Falha na criação (`create_order_with_items` / RPCs associadas): mensagem ao cliente **acionável** (o que falhou + o que fazer), evitando “erro técnico” genérico e evitando pedir de novo dados já persistidos sem motivo de domínio.
4. **Dedup de texto na fila:** `INBOUND_DEDUP_WINDOW_SECONDS` (default **20** no código) — suprime segundo job na mesma thread para o mesmo texto normalizado dentro da janela (double-tap / retry). Valores maiores reduzem duplicata e custo; valores excessivos atrasam reenvio intencional da mesma frase — ajustar só com métrica.
5. **Métricas PRO em painel:** `PRO_PIPELINE_METRICS_STORE=supabase` alinhado ao bloco «Métricas PRO pipeline» no Super Admin (`getProPipelineHealthStats`).
6. **Thresholds de alerta (UI):** `NEXT_PUBLIC_PRO_METRICS_ALERT_HARD_FAILURES_THRESHOLD` e `NEXT_PUBLIC_PRO_METRICS_ALERT_AMBIGUOUS_THRESHOLD` — defaults no código **3** e **2**; valores **maiores** (ex.: 5 e 3) diminuem alerta falso em tenant ruidoso; não há “valor certo” universal — calibrar após 1–2 semanas de tráfego.

**Checklist mínimo de env em produção (além de fila/métricas):**

| Variável | Papel |
|----------|--------|
| `SQS_DISPATCH_ENABLED` | `1` em produção — dispara SQS após outbox insert. |
| `SQS_INBOUND_QUEUE_URL` / `SQS_OUTBOUND_QUEUE_URL` | Filas FIFO AWS. |
| `AWS_REGION` + keys IAM (SendMessage only) | Credenciais Vercel → SQS. |
| `CRON_SECRET` | Auth de crons HTTP restantes (`detect-abandoned-carts`, billing, platform). |
| `ANTHROPIC_API_KEY` | Motor PRO (e classificadores que usam Haiku). |
| Credenciais Meta / canal | Já exigidas pelo ingresso (`WHATSAPP_APP_SECRET`, tokens de canal, etc.). |
| `UPSTASH_*` + `LLM_GLOBAL_MAX_IN_FLIGHT` | Cap LLM + fairness por company no worker Lambda. |

Estado persistido do PRO: `session.context.__pro_v2_state` (ver adapter `session.repository.supabase`). O motor PRO legado (`handleProOrderIntent` / `ai_order_canonical`) foi removido.

Homologação manual: [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md). Matriz obrigatória de falhas simuladas: secção 10 de [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

Checklist de arquitectura (escala / regressão): [`CHECKLIST_ARCH_PRO_SCALE.md`](./CHECKLIST_ARCH_PRO_SCALE.md).

### Telemetria PRO V2 — `tags.reason` (catálogo fechado)

Critério de produto: **dez** valores estáveis em `ProPipelineTelemetryReason` (`src/types/contracts.ts`), em métricas `pro_pipeline.*`. O `runProPipeline` envia cada contador para o **`MetricsPort`** (com `companyId` e `threadId` nas tags), e o adapter **`ConsoleMetricsAdapter`** (`src/pro/adapters/metrics/metrics.console.ts`) faz:
- log `[metrics.increment]` no worker;
- opcionalmente **POST** JSON para **`METRICS_INGEST_URL`** (e `METRICS_INGEST_TOKEN` se definido) — ponto de integração com Datadog / Grafana / ingest próprio.

**Super Admin (já existente):** rota **`/superadmin`** — bloco **«Saúde da fila Chatbot»** (`getQueueHealthStats` em `lib/superadmin/actions.ts`) lê **`chatbot_queue`**. Isso é **complementar** ao motor PRO: fila (throughput/erros) vs. **motivos** do pipeline (`tags.reason`).

#### Como trazer os 9 `tags.reason` para o mesmo painel (recomendação prática)

1. **Curto prazo (sem código novo no painel):** configurar **`METRICS_INGEST_URL`** para o vosso colector; no Datadog/Grafana filtrar `name` = `pro_pipeline.*` e `tags.reason` ∈ catálogo abaixo; opcionalmente alertas por `companyId`.
2. **Médio prazo (camada 2, implementado):** tabela **`pro_pipeline_metric_events`** (`created_at`, `company_id`, `thread_id`, `metric_name`, `value`, `tags` jsonb), RPC **`superadmin_pro_pipeline_metric_totals(p_window_minutes)`**, adapter **`SupabaseMetricsAdapter`** (`src/pro/adapters/metrics/metrics.supabase.ts`) com `insert` assíncrono + delegação ao **`ConsoleMetricsAdapter`** (log + `METRICS_INGEST_URL`). Ativar no worker com **`PRO_PIPELINE_METRICS_STORE=supabase`**. Super Admin: **`getProPipelineHealthStats`** em `lib/superadmin/actions.ts` e secção **«Métricas PRO pipeline (Supabase)»** em `app/superadmin/page.tsx` (mesma janela 15m / 1h / 24h que a fila).
   - **Segmentado por `provider`** (`anthropic`/`openai`, Fase 9 de `docs/PLANO_MULTI_PROVIDER_IA.md`): `runProPipeline.ts` inclui a tag `provider` (resolvida por empresa) em todas as métricas do run; `lib/chatbot/llmResilience.ts` emite `pro_pipeline.llm_circuit_open`/`llm_circuit_close` com a mesma tag via callback conectado em `deps.factory.ts` (`applyCircuitStateChangeToMetrics`, sem acoplar `lib/chatbot` a `src/pro/ports`). RPC e coluna `provider_key` na migration `20260810000000_pro_pipeline_metric_totals_provider.sql`; coluna própria na tabela do Super Admin.
3. **Alerta operacional básico (camada 2):** no bloco de métricas PRO, a UI exibe alerta por janela: **amarelo** quando `volume=0`, **vermelho** quando falhas duras (`pro_pipeline.order_failed` / `pro_pipeline.ai_provider_error` / `pro_pipeline.ai_rate_limited`) atingem threshold, e **amarelo** para pico de `confirmation_ambiguous`. Thresholds configuráveis por env pública: `NEXT_PUBLIC_PRO_METRICS_ALERT_HARD_FAILURES_THRESHOLD` (padrão `3`) e `NEXT_PUBLIC_PRO_METRICS_ALERT_AMBIGUOUS_THRESHOLD` (padrão `2`).
4. **Evitar duplicar contagem:** `pro_pipeline.outbound_count` continua a ser incrementado só em `persistAndEmit` (uma vez por mensagem após envio); o flush do `runProPipeline` **exclui** esse nome para não duplicar.

| `tags.reason` | Métrica típica | Nota |
|---------------|----------------|------|
| `confirmation_revision` | `pro_pipeline.confirmation_ambiguous` | Cliente pediu revisão em vez de confirmar (`checkoutEditHold`). |
| `draft_validation_failed` | `pro_pipeline.order_precondition_failed` | Rascunho incompleto na confirmação. |
| `finalize_blocked` | `pro_pipeline.order_precondition_failed` | Sem rascunho persistido na confirmação. |
| `confirmation_ambiguous` | `pro_pipeline.confirmation_ambiguous` | Texto não é confirmação forte. |
| `tool_output_rejected` | `pro_pipeline.ai_tool_round_exhausted` | Ex.: `TOOL_FAILED` / limite de tools. |
| `ai_timeout` | `pro_pipeline.ai_timeout` | |
| `ai_rate_limited` | `pro_pipeline.ai_rate_limited` | |
| `ai_provider_error` | `pro_pipeline.ai_provider_error` | |
| `ai_invalid_response` | `pro_pipeline.ai_invalid_response` | Resposta IA fora do contrato / sanitizada. |
| `order_rejected` | `pro_pipeline.order_failed` | `tags.errorCode` do pedido (ex.: `PRODUCT_NOT_FOUND`). |

Rejeições de máquina de estados **internas** (`canTransition` → `invalid_state_transition`) **não** usam este tipo; não entram em `tags.reason` do catálogo acima.

---

## Venda ativa — Fase 1: recuperação de carrinho (dentro da janela de 24h)

Mensagem proativa de **recuperação de carrinho** só quando o cliente falou com a loja há menos de 24h. Fora dessa janela a Meta exige template (HSM) aprovado.

**HSM (Fase 2 — entregue em Pro/Market):** feature `whatsapp_templates_broadcast` — sync/submit em `/templates`, envio 1:1 na inbox, campanhas em `/campanhas` via `outbound_jobs.purpose = broadcast_template`. Credenciais WABA do tenant em **Configurações → Canais** (mesmo Meta App / webhook da plataforma). A recuperação de carrinho abaixo permanece **dentro da janela 24h** (texto livre), sem depender de HSM.

### Fluxo

```
detect-abandoned-carts (cron ~5 min / diário Hobby)
  → RPC detect_abandoned_carts  → snapshot em abandoned_carts
  → enfileira em outbound_jobs (dedup_key = cart_recovery:<cart_id>)
  → after() → SQS outbound → Lambda renthus-outbound-worker

cliente toca «Finalizar pedido» (pro_recover_cart)
  → applyQuickAction retoma o draft da sessão; o card do passo certo vem do post-process
  → pedido criado → mark_abandoned_cart_recovered → status 'recovered' + recovered_order_id
```

### Base da janela de 24h

`whatsapp_threads.last_inbound_at`, preenchido pelo trigger `increment_thread_unread` em `whatsapp_messages`. **Não usar `last_message_at`**: ele é atualizado também por outbound e renovaria a janela indevidamente (era o bug do indicador da inbox). Função canónica: `isWithinCustomerServiceWindow` em `lib/whatsapp/customerServiceWindow.ts`, usada tanto pela UI quanto pelo worker.

### Gates (reavaliados no envio, não no enfileiramento)

Entre enfileirar e enviar o cliente pode ter fechado o pedido, um humano pode ter assumido a thread e a janela pode ter fechado. `evaluateOutboundGates` (`lib/chatbot/outbound/gates.ts`) é puro e testado: payload vazio, janela de 24h, `bot_active`/handover, estado do carrinho, horário da loja (`companies.settings.open_time`/`close_time`, fuso em `settings.timezone`, default `America/Sao_Paulo`; sem configuração aplica 08:00–22:00) e teto de frequência por cliente. `purpose = 'transactional'` ignora horário e teto, mas **não** a janela.

### Por que a mensagem é determinística

O texto sai do snapshot do rascunho (`buildCartRecoveryMessage`), sem passar por IA: valor em R$ não pode ser improvisado pelo modelo, e a mensagem precisa ser barata e previsível. A IA volta a atuar quando o cliente responde, pelo pipeline normal.

### Env

| Env | Default | Efeito |
|-----|---------|--------|
| `CART_RECOVERY_IDLE_MINUTES` | `25` | Rascunho parado há N min vira candidato a snapshot. |
| `CART_RECOVERY_DETECT_LIMIT` | `50` | Máx. snapshots por execução. |
| `CART_RECOVERY_MAX_AGE_HOURS` | `48` | Idade após a qual o carrinho vira `expired`. |
| `OUTBOUND_MAX_ATTEMPTS` | `3` | Tentativas antes de `failed` (Lambda). |
| `OUTBOUND_FREQUENCY_WINDOW_HOURS` | `72` | Janela do teto de frequência. |
| `OUTBOUND_MAX_PER_CUSTOMER` | `1` | Máx. proativas não-transacionais por cliente na janela. |
| `OUTBOUND_JOB_RETENTION_DAYS` | `30` | Limpeza de jobs terminais. |
| `SQS_DISPATCH_ENABLED` | `1` prod | Enfileira outbound no SQS após insert. |

Auth do detector: `Bearer CRON_SECRET`. Worker outbound = **Lambda** (`processOutboundJobById`), não rota HTTP.

**Allowlist do `proxy.ts`:** rotas de scheduler restantes (`detect-abandoned-carts`, `reactivate` se EventBridge, billing, platform) em `isTechnicalApiPublic` — liberadas **uma a uma** (não `/api/chatbot/*` por prefixo). Coberto por `tests/proxy.test.ts`.

### Risco a monitorar

O risco real não é técnico: marketing mal calibrado gera *block/report* e derruba o tier de mensagens da empresa na Meta, o que mata o canal inteiro — inclusive o transacional. Por isso o teto padrão é **uma** proativa por cliente a cada 72h.

**Consent / opt-out (entregue):** tabela `customer_message_consents`; no ingresso WhatsApp, keywords `PARAR|SAIR|STOP|CANCELAR` revogam MARKETING e `QUERO OFERTAS` / `QUERO PROMOÇÕES` opt-in. Envio de template MARKETING (1:1 e campanha) exige consent ativo; sem isso o job/API é bloqueado.

### Métricas

`[metric] cart_recovery_detect` (`detected`, `enqueued`, `discarded`, `expired`) e `[metric] outbound_worker` (`sent`, `skipped`, `failed`, `reclaimed`). Funil de negócio direto em `abandoned_carts`: `open` → `notified` → `recovered` com `grand_total` e `recovered_order_id`.

---

## Estrutura de pastas (alvo de refator mínima)

Manter fronteiras claras sem microserviço:

- `app/api/whatsapp/incoming/` — ingresso, validação, enqueue + SQS dispatch.
- `workers/inbound/` + `workers/outbound/` — Lambda handlers (esbuild → zip).
- `lib/chatbot/queue/` + `lib/queue/` — núcleo inbound + dispatch SQS; opcionalmente `parsers/` vs `llm/` quando o diff justificar.

---

## Referências no repositório

- Motor: `lib/chatbot/processMessage.ts`, `lib/chatbot/inboundPipeline.ts`; PRO V2: `src/pro/pipeline/` (orquestrador: `runProPipeline.ts`, `stages/routeStage.ts`, `stages/checkoutPostProcess.ts`, intents: `services/intent/intentClassifier.service.ts`)
- Checkout / CTAs: `src/pro/tools/checkoutPhasePolicy.ts` (scrub de botões vs fase; evita CTA misto endereço+confirmação)
- Busca catálogo: `src/pro/tools/searchProdutos.ts` + RPC `rpc_search_chat_produtos` (fuzzy/`pg_trgm`, migração `20260805080000_…`) + cache TTL `catalogSearchCache.ts`
- Clarificação de produto: `catalogProductHintFromPicks` (`src/pro/pipeline/catalogProductHint.ts`) — hint ao cliente vem do catálogo (`productName`/stem do label), não do texto digitado; swap/edição segue a mesma regra
- Tools PRO (ex-`lib/chatbot/pro`): `src/pro/tools/` — prepare draft, hints, allowlist, parsers de qty/endereço
- Replay: `npm run replay -- <companyId> <threadId>` (dump); `--run` dry-run; `--extract-diff` é **harness offline** (`src/pro/replay/`, baseline `tests/fixtures/replay/extraction-baseline.v1.json`) — **não** faz parte do hot path
- Pedido PRO (hot path): agent loop + tools (`AiServiceAdapter`, `src/pro/adapters/ai/ai.service.ts`, Vercel AI SDK); intent de linguagem livre via classificador quando há crédito — regex de oi/status/pedido só no degradado (IA off / sem crédito / limite de turnos)
- Ports CA: `CompanyPolicyPort`, `OrderHintsPort` (+ session/llm/metrics); `admin` residual só identity/handover/prepare-pick/trace
- LLM multi-provider: `src/pro/adapters/ai/modelProvider.ts` (`resolveLanguageModel`/`getConfiguredLlmProviderName`, `LanguageModel` do pacote `ai` sobre `@ai-sdk/anthropic`/`@ai-sdk/openai`); replay/teste: `src/pro/adapters/ai/replayRecorder.ts` (`createRecordingModel`/`createReplayModel`). Sem `LlmPort`/`createLlmPort` (deletados — [`PLANO_MIGRACAO_VERCEL_AI_SDK.md`](./PLANO_MIGRACAO_VERCEL_AI_SDK.md)).
- STT áudio: `src/pro/ports/speechToText.port.ts`, `adapters/stt/openai.whisper.ts`, `lib/chatbot/transcribeInboundAudio.ts`
- Resiliência: `lib/chatbot/anthropicResilience.ts`, `lib/whatsapp/metaGraphFetch.ts` (throttle + Retry-After)
- Fila / outbox: `lib/queue/sqsDispatch.ts`, `afterEnqueue.ts`, `processInboundJobById.ts`, `processOutboundJobById.ts`, `companyWorkerCap.ts`; ADR [`0003-sqs-outbox-lambda.md`](./ADR/0003-sqs-outbox-lambda.md)
- Ingresso: `app/api/whatsapp/incoming/route.ts` — enqueue + SQS + aviso de backlog (`after()`)
- Typing indicator (WA Cloud API): `lib/whatsapp/send.ts` (`sendTypingIndicator`, best-effort) disparado no núcleo do worker inbound antes de `processInboundMessage`, só quando o job vai ser efetivamente respondido (após o gate de handover). Marca a mensagem inbound como lida + "digitando..."; a Meta encerra sozinha ao enviarmos a resposta ou após 25s. Só WhatsApp (IG/Messenger usam mecanismo próprio, não implementado).
- Venda ativa: `app/api/chatbot/detect-abandoned-carts/route.ts`, `lib/chatbot/outbound/`, Lambda outbound; migration `20260805160000_active_sales_cart_recovery.sql`
- Templates HSM + campanhas (Pro/Market): `lib/whatsapp-templates/*`, `lib/campaigns/*`, `lib/channels/messageConsent*`, APIs `/api/admin/whatsapp-templates`, `/api/admin/campaigns`; UI `/templates`, `/campanhas`; Canais tenant em Configurações → Canais — checklists [`CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md`](./CHECKLIST_WHATSAPP_TEMPLATES_CAMPAIGNS.md), [`ENV_META_CHANNELS.md`](./ENV_META_CHANNELS.md)
- Refatoração pedido PRO / IA (histórico): [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md)
- Calibração agente PRO (vigente): [`ADR/0005-pro-agent-calibration-pillars.md`](./ADR/0005-pro-agent-calibration-pillars.md), [`PLANO_CALIBRACAO_AGENTE_PRO.md`](./PLANO_CALIBRACAO_AGENTE_PRO.md)
- Checklist escala: [`CHECKLIST_ARCH_PRO_SCALE.md`](./CHECKLIST_ARCH_PRO_SCALE.md)

---

## Decisão em uma linha

**Transporte:** outbox Postgres + SQS FIFO + Lambda ([ADR-0003](./ADR/0003-sqs-outbox-lambda.md)); idempotência forte na outbox e nos efeitos; wake HTTP / claim poll **removidos** do hot path.

**Pedido PRO:** estado e gates no servidor; IA para preenchimento e linguagem; confirmação e RPCs disciplinadas — detalhe em [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

Documentar exceções em ADR se desviarem deste arquivo.
