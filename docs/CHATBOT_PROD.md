# Chatbot — execução produção (`chatbot_prod`)

Documento de decisão e checklist para o time executar. Alinhado ao código atual (`processInboundMessage`, `chatbot_queue`, motor em `lib/chatbot/`).

---

## Objetivo

Suportar **muitas empresas e muitos pedidos em paralelo** sem acoplar o webhook ao tempo de IA/DB. Prioridade: **custo, latência, simplicidade** — sem microserviço nem fila externa até haver evidência de gargalo.

**Planejamento de carga (referência interna):** piloto com **3 empresas** da ordem de **~10 mil pedidos/mês cada**; meta de crescimento até **~100 empresas** nesse perfil (ex.: **12/26**). Para capacidade e custo de IA, planear em **mensagens inbound e chamadas ao modelo no pico**, não só em “pedidos/mês” médio — o funil gera **várias mensagens por pedido**.

---

## Princípios (não reabrir na implementação)

1. **Webhook não executa Anthropic nem o motor completo do chatbot.** Só valida, persiste o mínimo, enfileira; HTTP rápido.
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
| Worker | `app/api/chatbot/process-queue` (ou job dedicado): `claim` com `FOR UPDATE SKIP LOCKED`, processar, marcar `done` / `failed`, **backoff** em falha; **poll com jitter** para não martelar o DB |
| **Execução do worker** | Preferir **processo/cron estável** com tempo suficiente para drenar lotes. Em **serverless**, evitar “loop infinito” num único request: limitar jobs por invocação ou usar worker dedicado (VM/container) se o timeout for gargalo |
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
- **Fairness por empresa** antes de existir **métrica** de um tenant a degradar os outros — começar por limite global e idade da fila.

---

## Estrutura de pastas (alvo de refator mínima)

Manter fronteiras claras sem microserviço:

- `app/api/whatsapp/incoming/` — ingresso, validação, enqueue apenas.
- `app/api/chatbot/process-queue/` — worker (claim/process/update).
- `lib/chatbot/` — motor; opcionalmente `parsers/` (determinístico: IDs Meta, normalização) vs `llm/` (chamada, tools, retries) quando o diff justificar.

---

## Referências no repositório

- Motor: `lib/chatbot/processMessage.ts`, `lib/chatbot/inboundPipeline.ts`
- Fila: `app/api/chatbot/process-queue/route.ts`, migrações `chatbot_queue` / RPC `claim_*`
- Ingresso WhatsApp: `app/api/whatsapp/incoming/route.ts` (hoje pode ainda aguardar o motor — alvo da Fase 1)

---

## Decisão em uma linha

**Executar Fase 0 + Fase 1 já; Fase 2 em seguida; horizontalizar workers com tetos claros; fila externa e microserviços só com evidência em métrica ou operação.** Documentar exceções em ADR se desviarem deste arquivo.
