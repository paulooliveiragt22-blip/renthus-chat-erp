# Chatbot — execução produção (`chatbot_prod`)

Documento de decisão e checklist para o time executar. Alinhado ao código atual (`processInboundMessage`, `chatbot_queue`, motor em `lib/chatbot/`).

**Ordem de leitura:** princípios → **arquitetura por horizonte (Hobby / médio prazo / escala)** → fases 0–3 → riscos e limites honestos.

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

- Introduzir **wake imediato** após enqueue (caminho feliz).
- Preferir **cron Vercel com frequência útil** quando o plano Pro permitir, **em conjunto** com wake (scheduler deixa de ser único motor).
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

---

## Decisão em uma linha

**Postgres como fila primeiro; worker com claim exclusivo + idempotência forte + loop limitado; wake imediato como caminho feliz e scheduler como rede de segurança; fila gerenciada / particionamento / workers dedicados só com métrica de dor ou meta de escala (100×10k).** Documentar exceções em ADR se desviarem deste arquivo.
