# Chatbot — execução produção (`chatbot_prod`)

Documento de decisão e checklist para o time executar. Alinhado ao código atual (`processInboundMessage`, `chatbot_queue`, motor em `lib/chatbot/`).

**Ordem de leitura:** princípios → **arquitetura por horizonte (Hobby / médio prazo / escala)** → **pedido PRO / cérebro IA** → fases 0–3 → evidências / riscos → [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) (plano de refatoração).

---

## Objetivo

Suportar **muitas empresas e muitos pedidos em paralelo** sem acoplar o webhook ao tempo de IA/DB. Prioridade: **custo, latência, simplicidade** — sem microserviço nem fila externa até haver evidência de gargalo.

**Planejamento de carga (referência interna):** piloto com **3 empresas** da ordem de **~10 mil pedidos/mês cada**; meta de crescimento até **~100 empresas** nesse perfil (ex.: **12/26**). Para capacidade e custo de IA, planear em **mensagens inbound e chamadas ao modelo no pico**, não só em “pedidos/mês” médio — o funil gera **várias mensagens por pedido**.

---

## Arquitetura alvo (referência) — Webhook → fila → worker → pipeline → resposta

Fluxo canónico de processamento quando **`CHATBOT_QUEUE_ENABLED=1`**:

1. **Webhook** (`POST` Meta): validação, persistência mínima, **dedup** de curta janela (texto), **enqueue** em `chatbot_queue`, **200** rápido.
2. **Fila:** Postgres (`chatbot_queue`) com **claim exclusivo** (RPC / equivalente) e idempotência **`(company_id, message_id)`** onde aplicável.
3. **Worker** (`GET /api/chatbot/process-queue` autenticado): claim → **loop limitado** (batch + tempo dentro do `maxDuration`) → `processInboundMessage` → estado `done` / `failed` / retry.
4. **Pipeline:** `lib/chatbot/processMessage.ts` (PRO V2 quando flags ativas; senão legado).
5. **Resposta:** envio WhatsApp dentro do pipeline / camadas já existentes; manter idempotência de **efeito** (pedido, outbound).

**Gatilho do worker (decisão de produto, não detalhe de deploy):**

| Modo | Papel |
|------|--------|
| **Caminho feliz** | **Wake imediato** após enqueue (HTTP interno assíncrono / fire-and-forget para `process-queue` com o mesmo `CRON_SECRET`) para não depender do próximo tick do scheduler. |
| **Rede de segurança** | **Scheduler** (Vercel Cron quando o plano permitir frequência útil, ou serviço externo no Hobby) para jobs presos, falhas intermitentes do wake, ou burst. |

*Estado da implementação:* wake pós-enqueue está em `app/api/whatsapp/incoming/route.ts` via `after()` → `GET /api/chatbot/process-queue` com `Authorization: Bearer <CRON_SECRET>`. O scheduler externo/cron continua como **rede de segurança**. Desligar: `CHATBOT_QUEUE_WAKE_ENABLED=0`.

---

## Arquitetura por horizonte (decisão)

### Agora — **Vercel Hobby** (melhor esforço, uma pessoa)

- Manter **Postgres como fila** (`chatbot_queue`).
- **Worker HTTP** (`process-queue`) com **auth forte** (`CRON_SECRET`), **fail-fast** em claim crítico em produção quando aplicável.
- **Scheduler externo** (ex.: cron-job.org) na **menor cadência que o plano permitir** como **backup** obrigatório enquanto o cron nativo não for viável a cada minuto.
- **Loop limitado** no worker: drenar só o que couber em **tempo + batch** por invocação (nunca “loop infinito” num único request serverless).
- **Concorrência:** claim atômico obrigatório; múltiplas invocações (wake + cron) são **esperadas** — idempotência + lock no claim são o que evita custo/efeito duplicado.
- **Expectativa honesta:** Hobby não entrega SLA de chat “tempo real”; entrega **arquitetura correta com latência limitada pelo gatilho + IA**.

### Médio prazo — tráfego real / saída do Hobby

- **Wake imediato** após enqueue já é o **caminho feliz** implementado (`incoming` → `after()` → `GET /api/chatbot/process-queue`); nesta fase o foco passa a **confiabilidade e observabilidade** (logs, métricas, p95), não “ligar o wake”.
- Preferir **cron Vercel com frequência útil** quando o plano Pro permitir, **em conjunto** com wake (o scheduler externo deixa de ser tão crítico para UX, mas permanece como rede de segurança).
- Avaliar **fila com entrega** (ex.: QStash / Inngest / SQS) **só** quando métricas ou operação justificarem (profundidade, idade p95, falhas de poll, custo humano).
- **Fairness simples por `company_id`** (quota de jobs por ciclo ou por invocação) **antes** de investir em broker pesado — mitiga *noisy neighbor* com pouco código.

### Escala alvo — **~100 empresas × ~10k pedidos/mês** (~1M pedidos/mês agregado)

- Tratar **mensagens + rodadas de IA** como driver de carga, não “pedidos/mês” médio.
- **Tetos externos:** Anthropic (quota/RPM), Meta (rate limit / número), Postgres (contenção fila + OLTP).
- Evolução provável: **fila dedicada ou particionamento** da tabela de jobs + **pool de workers** com **concurrency limit** + **orçamento de IA** (timeout, max tool rounds, circuito em 429).
- **Postgres único** como fila + OLTP tem **teto**; acima dele, decisão consciente (réplica leitura, particionar, ou sair para fila gerenciada) com **ADR** e métricas.

---

## Limites conhecidos (auto-crítica; não superestimar)

- **Fila não aumenta capacidade de IA** — só desloca trabalho e protege o webhook; latência de modelo continua a dominar muitos casos.
- **Dedup de texto** cobre bem **duplo envio rápido / retry**; **não** substitui idempotência de **efeito** (criar pedido, cobrar, template) se outra camada reexecutar.
- **RPC claim atômico** é necessário, não suficiente: sob muitos consumers, o gargalo migra para **hot rows**, índices e taxa de `UPDATE` na fila.
- **Scheduler HTTP como único motor** gera UX de **até um intervalo entre mensagens**; por isso o wake + scheduler como rede de segurança é decisão explícita acima.

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
| Worker | `app/api/chatbot/process-queue` (ou job dedicado): `claim` atômico (RPC preferencial), processar, marcar `done` / `failed`, **backoff** em falha |
| **Execução do worker** | **Wake** após enqueue (caminho feliz) + **scheduler** como backup. Em **serverless**: **loop limitado** por batch e por tempo dentro de `maxDuration`; evitar “loop infinito”. Cron HTTP **esparso** sozinho não é arquitetura final para UX de chat |
| Idempotência | Unique ou guard clause em **(empresa, `message_id`)** antes de efeitos colaterais (pedido, outbound) |
| Índices / fila | Garantir **índice alinhado ao `claim`** (estado + ordenação); plano de **retenção/arquivamento** de jobs `done` antes da tabela virar problema operacional |

**Pronto:** teste com dezenas de mensagens concorrentes sem timeout no webhook; replay do mesmo `message_id` não duplica efeito colateral (pedido/resposta).

---

### Fase 2 — Sessão e IA

| Ação | Nota |
|------|------|
| `pro_anthropic_messages` | **Cap rígido** de turnos e/ou parar de persistir replay completo quando estado de negócio bastar (`ai_order_canonical`, step, `customer_id`) |
| Tool chain | Manter saneamento até cap estar validado em staging |
| Concorrência na IA | **Primeiro:** limite **global** de chamadas Anthropic em voo (evita martelar quota e 429 em cascata). **Depois**, com métrica de *noisy neighbor*: limite simples de jobs/concorrência **por `company_id`** no `claim` ou no estágio de chamada — evitar fila interna complexa na v1 |

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
- **Fairness por empresa:** no Hobby pode ficar só **limite global** + observabilidade; no **médio prazo / multi-tenant denso**, introduzir **quota simples por `company_id`** no claim ou no batch **antes** de broker externo (ver “Arquitetura por horizonte”).

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

### Plano de execução

**Estratégia de refatoração por fases** (ordem, gates, entregáveis, riscos): [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

### PRO Pipeline V2 — flags e fronteira com o legado

Entrada: `lib/chatbot/processMessage.ts` chama `runProPipeline` (`src/pro/pipeline/runProPipeline.ts`) **antes** de `runInboundChatbotPipeline` quando o plano é **PRO** e `CHATBOT_PRO_PIPELINE_V2=1`.

| Variável | Valor | Comportamento |
|----------|--------|----------------|
| `CHATBOT_PRO_PIPELINE_V2` | `1` | Executa o motor PRO V2 (além do plano PRO). |
| `CHATBOT_PRO_PIPELINE_V2_MODE` | `shadow` (omissão técnica) | Após o V2 com sucesso, **continua** no pipeline legado na mesma mensagem. **Uso pretendido:** homologação / comparação de métricas — **não** é alvo de produção (duplica trabalho, custo e latência). |
| `CHATBOT_PRO_PIPELINE_V2_MODE` | `active` | Após o V2 com sucesso, **encerra** o processamento da mensagem (não chama o legado). Se o V2 **lançar exceção**, há **fallback** para o legado com log. **Alvo de produção** para empresas PRO. |
| `PRO_PIPELINE_METRICS_STORE` | `supabase` | Grava eventos de métrica do PRO em `pro_pipeline_metric_events` (camada 2). Omitir ou outro valor ⇒ só `ConsoleMetricsAdapter` (log + ingest HTTP opcional). |

### Decisões operacionais (produção — aplicar)

1. **Um motor por mensagem (tenant PRO):** `CHATBOT_PRO_PIPELINE_V2=1` e **`CHATBOT_PRO_PIPELINE_V2_MODE=active`**. Manter `shadow` só em ambientes de **homologação** ou janelas curtas de comparação de telemetria — não como estado estável em produção.
2. **Fila ligada:** `CHATBOT_QUEUE_ENABLED=1` — o webhook não deve aguardar Anthropic nem pipeline completo (SLO de ingresso: secção *Critérios de aceite (release)* neste documento).
3. **Gates antes de confirmação:** não tratar “resumo bonito” no LLM como substituto de draft válido no servidor. Só pedir confirmação explícita (“sim” / “ok”) quando itens, endereço, pagamento e regras de entrega (zona, mínimo, etc.) estiverem consistentes no estado canónico / tool `prepare_order_draft`. Falha na criação (`create_order_with_items` / RPCs associadas): mensagem ao cliente **acionável** (o que falhou + o que fazer), evitando “erro técnico” genérico e evitando pedir de novo dados já persistidos sem motivo de domínio.
4. **Dedup de texto na fila:** `INBOUND_DEDUP_WINDOW_SECONDS` (default **20** no código) — suprime segundo job na mesma thread para o mesmo texto normalizado dentro da janela (double-tap / retry). Valores maiores reduzem duplicata e custo; valores excessivos atrasam reenvio intencional da mesma frase — ajustar só com métrica.
5. **Métricas PRO em painel:** `PRO_PIPELINE_METRICS_STORE=supabase` alinhado ao bloco «Métricas PRO pipeline» no Super Admin (`getProPipelineHealthStats`).
6. **Thresholds de alerta (UI):** `NEXT_PUBLIC_PRO_METRICS_ALERT_HARD_FAILURES_THRESHOLD` e `NEXT_PUBLIC_PRO_METRICS_ALERT_AMBIGUOUS_THRESHOLD` — defaults no código **3** e **2**; valores **maiores** (ex.: 5 e 3) diminuem alerta falso em tenant ruidoso; não há “valor certo” universal — calibrar após 1–2 semanas de tráfego.

**Checklist mínimo de env em produção (além das flags PRO/fila/métricas):**

| Variável | Papel |
|----------|--------|
| `CRON_SECRET` | Auth do `GET /api/chatbot/process-queue` e do **wake** (`Authorization: Bearer`). |
| Uma base URL pública ou interna | Wake: `CHATBOT_QUEUE_WAKE_URL` → `APP_INTERNAL_URL` → `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` (ver comentários em `app/api/whatsapp/incoming/route.ts`). Sem isso + secret, só o scheduler cobre latência. |
| `ANTHROPIC_API_KEY` | Motor PRO (e classificadores que usam Haiku). |
| Credenciais Meta / canal | Já exigidas pelo ingresso (`WHATSAPP_APP_SECRET`, tokens de canal, etc.). |

Estado persistido do V2: `session.context.__pro_v2_state` (ver adapter `session.repository.supabase`). O legado mantém o seu próprio `session.step` / `context.ai_order_canonical`; não misturar escritas de draft entre as duas stacks sem plano explícito (ver matriz R2 na estratégia).

Homologação manual: [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md). Matriz obrigatória de falhas simuladas: secção 10 de [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

### Telemetria PRO V2 — `tags.reason` (catálogo fechado)

Critério de produto: **nove** valores estáveis em `ProPipelineTelemetryReason` (`src/types/contracts.ts`), em métricas `pro_pipeline.*`. O `runProPipeline` envia cada contador para o **`MetricsPort`** (com `companyId` e `threadId` nas tags), e o adapter **`ConsoleMetricsAdapter`** (`src/pro/adapters/metrics/metrics.console.ts`) faz:
- log `[metrics.increment]` no worker;
- opcionalmente **POST** JSON para **`METRICS_INGEST_URL`** (e `METRICS_INGEST_TOKEN` se definido) — ponto de integração com Datadog / Grafana / ingest próprio.

**Super Admin (já existente):** rota **`/superadmin`** — bloco **«Saúde da fila Chatbot»** (`getQueueHealthStats` em `lib/superadmin/actions.ts`) lê **`chatbot_queue`**. Isso é **complementar** ao motor PRO: fila (throughput/erros) vs. **motivos** do pipeline (`tags.reason`).

#### Como trazer os 9 `tags.reason` para o mesmo painel (recomendação prática)

1. **Curto prazo (sem código novo no painel):** configurar **`METRICS_INGEST_URL`** para o vosso colector; no Datadog/Grafana filtrar `name` = `pro_pipeline.*` e `tags.reason` ∈ catálogo abaixo; opcionalmente alertas por `companyId`.
2. **Médio prazo (camada 2, implementado):** tabela **`pro_pipeline_metric_events`** (`created_at`, `company_id`, `thread_id`, `metric_name`, `value`, `tags` jsonb), RPC **`superadmin_pro_pipeline_metric_totals(p_window_minutes)`**, adapter **`SupabaseMetricsAdapter`** (`src/pro/adapters/metrics/metrics.supabase.ts`) com `insert` assíncrono + delegação ao **`ConsoleMetricsAdapter`** (log + `METRICS_INGEST_URL`). Ativar no worker com **`PRO_PIPELINE_METRICS_STORE=supabase`**. Super Admin: **`getProPipelineHealthStats`** em `lib/superadmin/actions.ts` e secção **«Métricas PRO pipeline (Supabase)»** em `app/superadmin/page.tsx` (mesma janela 15m / 1h / 24h que a fila).
3. **Alerta operacional básico (camada 2):** no bloco de métricas PRO, a UI exibe alerta por janela: **amarelo** quando `volume=0`, **vermelho** quando falhas duras (`pro_pipeline.order_failed` / `pro_pipeline.ai_provider_error` / `pro_pipeline.ai_rate_limited`) atingem threshold, e **amarelo** para pico de `confirmation_ambiguous`. Thresholds configuráveis por env pública: `NEXT_PUBLIC_PRO_METRICS_ALERT_HARD_FAILURES_THRESHOLD` (padrão `3`) e `NEXT_PUBLIC_PRO_METRICS_ALERT_AMBIGUOUS_THRESHOLD` (padrão `2`).
4. **Evitar duplicar contagem:** `pro_pipeline.outbound_count` continua a ser incrementado só em `persistAndEmit` (uma vez por mensagem após envio); o flush do `runProPipeline` **exclui** esse nome para não duplicar.

| `tags.reason` | Métrica típica | Nota |
|---------------|----------------|------|
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

## Estrutura de pastas (alvo de refator mínima)

Manter fronteiras claras sem microserviço:

- `app/api/whatsapp/incoming/` — ingresso, validação, enqueue apenas.
- `app/api/chatbot/process-queue/` — worker (claim/process/update).
- `lib/chatbot/` — motor; opcionalmente `parsers/` (determinístico: IDs Meta, normalização) vs `llm/` (chamada, tools, retries) quando o diff justificar.

---

## Referências no repositório

- Motor: `lib/chatbot/processMessage.ts`, `lib/chatbot/inboundPipeline.ts`; PRO V2: `src/pro/pipeline/`
- Fila: `app/api/chatbot/process-queue/route.ts`, migrações `chatbot_queue` / RPC `claim_chatbot_queue_jobs`
- Ingresso WhatsApp: `app/api/whatsapp/incoming/route.ts` — com `CHATBOT_QUEUE_ENABLED=1`, **enqueue e retorno rápido**; processamento pesado no worker
- Refatoração pedido PRO / IA: [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md)

---

## Decisão em uma linha

**Transporte:** Postgres como fila primeiro; worker com claim exclusivo + idempotência forte + loop limitado; wake imediato como caminho feliz e scheduler como rede de segurança; fila gerenciada / particionamento / workers dedicados só com métrica de dor ou meta de escala (100×10k).

**Pedido PRO:** estado e gates no servidor; IA para preenchimento e linguagem; confirmação e RPCs disciplinadas — detalhe em [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md).

Documentar exceções em ADR se desviarem deste arquivo.
