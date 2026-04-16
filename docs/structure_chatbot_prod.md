# Estrutura do chatbot (produção) — mapa + execução

Este ficheiro descreve **a estrutura real do repositório**, **fluxo entre módulos** e **o que executar** para cumprir [`CHATBOT_PROD.md`](./CHATBOT_PROD.md). Decisões de produto e fases detalhadas continuam no `CHATBOT_PROD.md`.

---

## 1. Documentos relacionados

| Ficheiro | Uso |
|----------|-----|
| [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) | **Decisões canónicas:** princípios, arquitetura por horizonte (Hobby / médio prazo / escala), gatilho wake + scheduler, **pedido PRO / IA**, fases 0–3, tetos externos, limites honestos, evidências p95/replay/carga |
| [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) | **Estratégia de refatoração** do fecho de pedido PRO: fases R0–R4, gates, anti-padrões, critérios de “feito” |
| Este ficheiro | Árvore de código, responsabilidades, fluxo atual vs alvo, checklist por ficheiro |

---

## 1.1 Escopo desta execução

- **Starter congelado:** manter comportamento atual de saudação + botões + catálogo + status + falar com atendente.
- **Refatoração funcional apenas no PRO:** limites de IA, robustez de tools e fechamento de pedido.
- **Infraestrutura compartilhada pode mudar (Starter + PRO):** ingresso webhook, fila e worker impactam os dois tiers; objetivo é não alterar UX do Starter.
- **Regra de proteção:** não alterar textos/menus/fluxos do Starter nesta entrega, exceto correções de bug crítico.

---

## 1.2 Governança de mudança (obrigatória)

**Fase atual (teste, sem usuários reais):** owner único temporário = **Você** para Backend, Produto Chatbot e SRE/DevOps.
Revisar e dividir ownership antes do primeiro cliente real em produção.

| Área | Owner primário | Owner secundário | Regra de aprovação |
|------|----------------|------------------|--------------------|
| `app/api/whatsapp/incoming/` | Backend Plataforma | Produto Chatbot | Mudança só entra com evidência de não-regressão Starter + replay idempotente aprovado |
| `app/api/chatbot/process-queue/` | Backend Plataforma | SRE/DevOps | Mudança só entra com métricas mínimas (`queue_depth`, idade p95, falha worker) |
| `lib/chatbot/pro/*` | Produto Chatbot (PRO) | Backend Plataforma | Mudança funcional exige teste de fluxo PRO (pedido + confirmação + finalização) |
| `lib/chatbot/middleware/*` | Produto Chatbot | Backend Plataforma | Qualquer alteração de intent exige validação Starter + PRO |
| `supabase/migrations/*chatbot_queue*` | Backend Plataforma | SRE/DevOps | Migração só entra com plano de rollback e verificação pós-deploy |

**Definição de bug crítico (Starter):**
- Queda de disponibilidade (erro 5xx persistente).
- Rota de pedido/status/atendente inacessível para mensagem comum.
- Duplicação de pedido ou mensagem incorreta de cobrança.
- Falha de segurança/isolamento de tenant.

### RACI mínimo (execução e incidente)

| Item | Responsible | Accountable | Consulted | Informed |
|------|-------------|-------------|-----------|----------|
| Migração idempotência fila `(company_id, message_id)` | Backend Plataforma | Backend Plataforma (Tech Lead) | Produto Chatbot, SRE/DevOps | Suporte/CS |
| Cron/worker produção (`process-queue`) + **wake** pós-enqueue (quando implementado) | Backend Plataforma | SRE/DevOps (Tech Lead) | Produto Chatbot | Suporte/CS |
| Alertas e thresholds | SRE/DevOps | SRE/DevOps (Tech Lead) | Backend Plataforma | Produto Chatbot |
| Regressão Starter (gate de merge) | Produto Chatbot | Produto Chatbot (Lead) | Backend Plataforma | Suporte/CS |
| Go/No-Go de release | Backend Plataforma | Produto Chatbot (Lead) | SRE/DevOps | Suporte/CS |
| Monitoramento pós-deploy (duplicatas/erro) | Backend Plataforma | Backend Plataforma (Tech Lead) | SRE/DevOps, Produto Chatbot | Suporte/CS |
| Taxonomia de intents compartilhada (`intentClassifier`) | Produto Chatbot | Produto Chatbot (Lead) | Backend Plataforma | Suporte/CS |
| Recalibração de thresholds e regra 2/2/3 | Produto Chatbot | Produto Chatbot (Lead) | Backend Plataforma, SRE/DevOps | Suporte/CS |

**Aplicação durante a fase de teste atual:**
- Responsible/Accountable/Consulted: **Você**
- Informed: **N/A (sem operação CS ativa)**

### Thresholds mínimos (default)

**Escopo:** valores válidos para **produção**.

- `queue_depth` alerta: **warning > 200 por 5 min**, **critical > 1000 por 5 min**.
- idade do job p95: **warning > 60s por 10 min**, **critical > 180s por 10 min**.
- falha de worker (`failed / processed`): **warning > 2% em 15 min**, **critical > 5% em 15 min**.
- erro outbound Meta: **warning > 2% em 15 min**, **critical > 5% em 15 min**.
- taxa de duplicata suprimida: alerta investigativo se **> 3% em 30 min**.

> Esses valores são defaults para iniciar operação. Ajustar por volume real após 2 semanas de produção.
> **Início da contagem:** data do deploy de Fase 1 em produção.

### Rollback mínimo (migração idempotência)

1. Deploy migração nova criando índice parcial `(company_id, message_id)` sem remover o índice antigo.
2. Validar 24h com métricas de duplicata e erros de insert.
3. Só então remover índice legado `message_id` isolado.
4. Se regressão: desativar caminho novo de enqueue por feature flag e manter processamento atual até correção.

---

## 2. Árvore relevante (nomes reais)

```
app/api/whatsapp/
  incoming/route.ts              ← Ingresso Meta Cloud API (ver §4 estado atual)
  send/route.ts
  upload/route.ts
  flows/route.ts
  media/[mediaId]/route.ts
  threads/
    route.ts
    create/route.ts
    [threadId]/bot-toggle/route.ts
    [threadId]/messages/route.ts
    [threadId]/read/route.ts
    [threadId]/read/threads-read-route.ts

app/api/chatbot/
  process-queue/route.ts        ← Worker cron: claim → processInboundMessage
  resolve/route.ts              ← POST: reprocessar (interno ou sessão)
  assistant-tools/route.ts
  reactivate/route.ts
  config/route.ts

app/superadmin/
  page.tsx                       ← Dashboard plataforma + «Saúde da fila Chatbot» (lib/superadmin/actions.ts)

lib/chatbot/
  processMessage.ts             ← processInboundMessage (entrada única do motor)
  inboundPipeline.ts            ← runInboundChatbotPipeline
  types.ts
  tier.ts
  session.ts
  botSend.ts
  utils.ts
  db/
    company.ts
    orders.ts
    variants.ts
  middleware/
    intentDetector.ts
    intentClassifier.ts
  handlers/
    handleMainMenu.ts
    handleFAQ.ts
  pro/                           ← Ramo PRO (IA, tools, pedido)
    handleProOrderIntent.ts
    handleProEscalationChoice.ts
    finalizeAiOrder.ts
    prepareOrderDraft.ts
    searchProdutos.ts
    typesAiOrder.ts
    orderHints.ts
    orderProgressHeuristic.ts
    parseAddressLoosePt.ts
    parseQtyPt.ts
    confirmationPt.ts
    resolveSavedAddress.ts
    resolveDeliveryZone.ts
  services/
    AlertService.ts

lib/whatsapp/
  send.ts                        ← sendWhatsAppMessage, interativos/flows
  sendMessage.ts
  channelCredentials.ts
  flowCrypto.ts
  getConfig.ts
  phone.ts
  graphUrlAllowlist.ts
  urlSafety.ts
  waMediaUrl.ts
  waConfigCache.ts
  extractMediaFromWaPayload.ts
  mediaIdPath.ts
  flows/
    catalogFlowHelpers.ts
    flowCartTypes.ts

lib/supabase/
  admin.ts                       ← createAdminClient (service role)

src/pro/                       ← Motor PRO Pipeline V2 (tier PRO + flags; ver CHATBOT_PROD)
  pipeline/
    runProPipeline.ts            ← Orquestra estágios
    deps.factory.ts              ← Monta portas (overrides em testes)
    context.ts, orderDraftGate.ts, proStepTransitions.ts, errors.ts
    stages/                      ← loadState, guardRails, intent, order, route, ai, persistAndEmit
  adapters/
    ai/                          ← ex.: ai.service.full.ts
    order/                       ← ex.: order.service.v2.ts
    supabase/session.repository.supabase.ts  ← estado `context.__pro_v2_state`
    whatsapp/, metrics/, logger/
  services/, ports/

lib/security/
  rateLimit.ts                   ← webhook incoming (IP)
  cronAuth.ts                    ← process-queue (Authorization)

supabase/migrations/
  20260320700001_chatbot_queue.sql
  20260320700002_chatbot_queue_rpc.sql

tests/chatbot/
  processMessageFlows.test.ts

tests/integration/
  webhook-integration.test.ts
  mocks/meta-webhook.mock.ts
```

**Nota:** Não existem pastas `lib/chatbot/parsers/` nem `lib/chatbot/llm/`; parsing PRO vive em `lib/chatbot/pro/*.ts`. Refator para `parsers/` / `llm/` só quando um PR justificar o churn.

---

## 3. Responsabilidades por pasta

| Local | Responsabilidade |
|-------|-------------------|
| `app/api/whatsapp/incoming/` | Webhook Meta: HMAC, rate limit, canal → `company_id`, upsert thread, insert `whatsapp_messages`, lógica de handover timeout, **alvo:** enqueue + 200 rápido. |
| `app/api/whatsapp/*` (resto) | APIs de aplicação (threads, envio, media); não substituem o burst do webhook. |
| `app/api/chatbot/process-queue/` | Consumer: `claim_chatbot_queue_jobs` (ou fallback), `processJob`, atualizar `done`/`failed`, limpeza de jobs antigos. |
| `app/superadmin/` | Dashboard operacional: fila `chatbot_queue`, falhas, dedup (`getQueueHealthStats`). |
| `lib/superadmin/actions.ts` | Server actions do superadmin (estatísticas globais + saúde da fila). |
| `app/api/chatbot/resolve/` | Caminho administrativo / service key para disparar o motor sem passar pelo webhook Meta. |
| `lib/chatbot/processMessage.ts` | Resolve tier (`tier.ts`); com `CHATBOT_PRO_PIPELINE_V2=1` e plano PRO corre `runProPipeline` antes do legado. **Produção:** `CHATBOT_PRO_PIPELINE_V2_MODE=active` (ver decisões operacionais em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md)). |
| `lib/chatbot/inboundPipeline.ts` | Orquestração legada: sessão, intents, steps Starter vs PRO, envio via `botSend` / `lib/whatsapp/send`. |
| `src/pro/pipeline/` | Motor PRO V2: estado `ProStep`, gates de pedido, métricas `pro_pipeline.*`, persistência `__pro_v2_state`. |
| `src/pro/adapters/` | IA, pedido (RPC), sessão Supabase, WhatsApp, métricas/log. |
| `lib/chatbot/middleware/` | Pré-roteamento antes de handlers/PRO. |
| `lib/chatbot/handlers/` | Menu, FAQ, handover, fluxos não-PRO. |
| `lib/chatbot/pro/` | Pedido assistido por IA, tools, endereço, finalização; manter mutações de pedido via **RPCs** já usadas no fluxo. |
| `lib/chatbot/db/` | Leituras de apoio ao domínio no motor. |
| `lib/whatsapp/` | Graph API: credenciais de canal, envio, flows. |
| `supabase/migrations/*chatbot_queue*` | Tabela `chatbot_queue` + função `claim_chatbot_queue_jobs`. |

---

## 4. Fluxo entre módulos

### 4.1 Estado atual (assíncrono por padrão no webhook)

```
Meta POST
  → app/api/whatsapp/incoming/route.ts
       → createAdminClient (lib/supabase/admin.ts)
       → upsert thread, insert whatsapp_messages (dedup 23505 em provider_message_id)
       → enqueue chatbot_queue (dedup/coalescing inbound em janela curta)
  → NextResponse 200 rápido
```

### 4.2 Caminho assíncrono já existente (cron)

```
Cron GET /api/chatbot/process-queue
  → validateCronAuthorization (lib/security/cronAuth.ts)
  → rpc("claim_chatbot_queue_jobs") ou runFallbackProcessing
  → processJob → processInboundMessage → mesmo pipeline da §4.1
```

### 4.3 Alvo (Fase 1 — alinhado a CHATBOT_PROD)

```
Meta POST → incoming/route.ts → insert chatbot_queue (+ payload mínimo) → 200 rápido
Cron      → process-queue/route.ts → claim → processInboundMessage → pipeline
```

O motor **não** muda de pasta: só **quem chama** `processInboundMessage` deixa de ser o webhook por defeito.

---

## 5. Checklist de execução (por fase)

Cruzar com checkboxes em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md).

### Fase 0 — Instrumentação

| # | Tarefa | Onde tocar |
|---|--------|------------|
| 0.1 | Log estruturado: profundidade da fila (count `pending`), duração do batch | `process-queue/route.ts` (+ query ou view, conforme política de DB) |
| 0.2 | Log: `processed`, `failed`, ms por invocação; opcional contador de duplicata | `process-queue/route.ts`, `incoming/route.ts` |
| 0.3 | Log/métrica: erros Anthropic (incl. 429) nos ficheiros que chamam a API | `lib/chatbot/pro/*.ts` (pontos de chamada ao modelo) |
| 0.4 | Alerta mínimo (externo: Vercel/Datadog/etc.) | Infra, não obrigatoriamente neste repo |

### Fase 1 — Desacoplamento (prioridade)

| # | Tarefa | Onde tocar |
|---|--------|------------|
| 1.1 | Após insert em `whatsapp_messages` com sucesso e texto não vazio: **insert `chatbot_queue`** com os mesmos campos que `processJob` espera (`company_id`, `thread_id`, `phone_e164`, `message_id`, `body_text`, `profile_name`, `metadata` se necessário para catálogo/canal) | `app/api/whatsapp/incoming/route.ts` |
| 1.2 | **Remover** `await processInboundMessage` do webhook (ou feature-flag até validação) | `incoming/route.ts` |
| 1.3 | Garantir idempotência obrigatória da fila com índice único parcial em **`(company_id, message_id)`** (`message_id IS NOT NULL`) + tratamento de conflito no insert | `supabase/migrations/` + `incoming/route.ts` (tratar 23505 como skip) |
| 1.4 | Confirmar RPC `claim_chatbot_queue_jobs` aplicada em **todos** os ambientes; evitar fallback em produção | `20260320700002_chatbot_queue_rpc.sql`, deploy Supabase |
| 1.5 | Cron Vercel (ou equivalente) a chamar `GET /api/chatbot/process-queue` com auth correta | `vercel.json` / painel + `cronAuth` |
| 1.6 | Aumentar `BATCH_SIZE` / frequência só após métricas; backoff em falhas já parcialmente via `attempts` | `process-queue/route.ts` |
| 1.7 | Testes: replay `message_id` não duplica pedido/resposta; carga concorrente no webhook | `tests/integration/webhook-integration.test.ts`, novos testes se preciso |
| 1.8 | Garantir que o comportamento Starter não mudou (snapshot de respostas principais) | `tests/chatbot/processMessageFlows.test.ts` (ou novo teste dedicado Starter) |
| 1.9 | Remover índice legado `UNIQUE (message_id)` quando migração nova estiver validada em produção | `supabase/migrations/` |

### Fase 2 — Sessão e IA

| # | Tarefa | Onde tocar |
|---|--------|------------|
| 2.1 | Cap rígido de histórico / persistência mínima para tools | Tabelas/serviços usados pelo PRO (ex. mensagens Anthropic); localizar writes em `lib/chatbot/pro/` |
| 2.2 | Limite global de concorrência para chamadas Anthropic (sem fairness por empresa na v1) | Wrapper de chamada ou semáforo no caminho PRO |
| 2.3 | Fairness por `company_id` só após métrica | `claim_*` ou camada antes da IA |
| 2.4 | Refinar somente Bloco PRO de classificação/ordenação sem alterar heurísticas do Starter | `lib/chatbot/pro/*`, com alterações mínimas em `inboundPipeline.ts` |

### Fase 3 — Escala

| # | Tarefa | Onde tocar |
|---|--------|------------|
| 3.1 | Múltiplas invocações do cron / workers com `SKIP LOCKED` (já na RPC) | Operação + `process-queue` |
| 3.2 | Retenção/partição de `chatbot_queue` | Migrações + job de limpeza (há `cleanupOldJobs` em `process-queue` — rever janela) |
| 3.3 | ADR fila externa | Só com evidência em `CHATBOT_PROD.md` |

---

## 6. Lacunas explícitas (código vs documento)

| Item | Situação |
|------|----------|
| Webhook aguarda motor | **Resolvido**: com `CHATBOT_QUEUE_ENABLED=1` o webhook só enfileira e responde rápido. |
| Unique na fila | **Resolvido**: unique parcial em `(company_id, message_id)` (`message_id IS NOT NULL`) aplicado; índice legado em `message_id` isolado removido. |
| Fallback do claim | Parcial: fail-fast em produção implementado por default; fallback fica restrito a dev/teste (ou env explícita). |

---

## 7. Critérios rápidos antes de merge da Fase 1

- [ ] `POST` `incoming` não excede p95 acordado sem esperar Anthropic/pipeline completo.
- [ ] Job duplicado (mesmo evento) não gera segundo efeito colateral: tratar conflito na fila + dedup em `whatsapp_messages`.
- [ ] `process-queue` processa fila com RPC ativa; teste manual com várias mensagens.
- [ ] Runbook atualizado (worker, secrets Meta, quota Anthropic) — pode ser secção no `CHATBOT_PROD.md` ou wiki ops.
- [ ] Regressão Starter aprovada com casos mínimos: saudação, `btn_catalog`, `btn_status`, `btn_support`, mensagem de FAQ, handover.

---

## 8. Decisão operacional (resumo)

**Motor:** `lib/chatbot/processMessage.ts` → `inboundPipeline.ts`.  
**Fila:** `chatbot_queue` + `claim_chatbot_queue_jobs`.  
**Escopo do ciclo atual:** Starter congelado; refatoração só no PRO.  
**Fase 1 (desacoplamento):** implementada no código com `CHATBOT_QUEUE_ENABLED=1` (`incoming` enfileira + wake opcional), worker em `process-queue`, idempotência `(company_id, message_id)` na fila e dedup em `whatsapp_messages` — alinhar com a §6 deste ficheiro.  
**Próximos passos:** fechar os critérios da §7 com evidência (p95 webhook, replay `message_id`, regressão Starter); depois Fases 0/2/3 em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (instrumentação, caps IA PRO, escala quando métricas justificarem).
