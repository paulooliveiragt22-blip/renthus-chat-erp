# Pipeline de processamento de mensagem (chatbot — produção)

Documento para **execução**: ordem real no código, responsabilidades, falhas prováveis.  
Relacionado: [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (fases, SLOs), [`structure_chatbot_prod.md`](./structure_chatbot_prod.md) (ficheiros e checklist).

---

## Legenda de entradas

| Entrada | Ficheiro |
|---------|----------|
| **A — Webhook Meta** | `app/api/whatsapp/incoming/route.ts` |
| **B — Worker fila** | `app/api/chatbot/process-queue/route.ts` → `processJob` |
| **C — Resolve API** | `app/api/chatbot/resolve/route.ts` (interno / sessão) |

Todas convergem em **`processInboundMessage`** (`lib/chatbot/processMessage.ts`).

---

## Escopo desta execução

- **Starter congelado:** manter como está (saudação, botões, catálogo, status, atendente, fluxo guiado).
- **Mudanças de refatoração focadas no PRO:** robustez de classificação/IA, tools, draft e fechamento de pedido.
- **Mudanças de infraestrutura compartilhada permitidas (Starter + PRO):** webhook/fila/worker podem mudar para ambos os tiers, sem regressão funcional do Starter.
- **Proibição neste ciclo:** não alterar UX/comportamento do Starter sem bug crítico.

---

## Governança operacional do pipeline

**Fase atual (teste, sem usuários reais):** owner único temporário = **Você** para Backend, Produto Chatbot (PRO) e SRE/DevOps.
Revisar e dividir ownership antes do primeiro cliente real em produção.

| Bloco | Owner primário | Sinal mínimo obrigatório |
|-------|----------------|---------------------------|
| Bloco 0 (ingresso/fila) | Backend Plataforma | `queue_depth`, idade p95 do job, taxa de 401/429 |
| Bloco 2/3 (classificação) | Produto Chatbot | taxa de `unknown`, distribuição de intents por `tier` |
| Bloco 4 PRO (pedido IA) | Produto Chatbot (PRO) | falha de finalização, rounds médios de tools, custo/token por pedido |
| Bloco 5 (envio Meta) | Backend Plataforma | taxa de erro de envio por empresa/canal |

**Definição objetiva de regressão Starter (gate de merge):**
- Não deve alterar resposta para: saudação inicial, `btn_catalog`, `btn_status`, `btn_support`, FAQ simples, handover.
- Não deve aumentar erro funcional nesses cenários (sem `unknown` inesperado).
- Se alterar qualquer um desses comportamentos: bloqueia merge, exceto bug crítico documentado.

### RACI mínimo (pipeline)

| Área | Responsible | Accountable | Consulted | Informed |
|------|-------------|-------------|-----------|----------|
| Bloco 0 (webhook/fila) | Backend Plataforma | Backend Plataforma (Tech Lead) | SRE/DevOps | Produto Chatbot |
| Bloco 3/4 PRO (classificação + pedido IA) | Produto Chatbot (PRO) | Produto Chatbot (Lead) | Backend Plataforma | Suporte/CS |
| Bloco 5 (envio Meta) | Backend Plataforma | SRE/DevOps (Tech Lead) | Produto Chatbot | Suporte/CS |
| Go/No-Go release | Backend Plataforma | Produto Chatbot (Lead) | SRE/DevOps | Suporte/CS |
| Taxonomia de intents compartilhada | Produto Chatbot | Produto Chatbot (Lead) | Backend Plataforma | Suporte/CS |
| Recalibração thresholds + regra 2/2/3 | Produto Chatbot | Produto Chatbot (Lead) | Backend Plataforma, SRE/DevOps | Suporte/CS |

**Aplicação durante a fase de teste atual:**
- Responsible/Accountable/Consulted: **Você**
- Informed: **N/A (sem operação CS ativa)**

### Thresholds operacionais (default)

**Escopo:** valores válidos para **produção**.

- `unknown_rate` (por `tier`):
  - warning: **> 15% por 30 min**
  - critical: **> 25% por 30 min**
- erro classificação IA (3e):
  - warning: **> 5% por 15 min**
  - critical: **> 10% por 15 min**
- falha de finalização PRO (4.P.3):
  - warning: **> 3% por 30 min**
  - critical: **> 8% por 30 min**
- rounds médios de tool PRO:
  - warning: **> 6** (janela 30 min)
  - critical: **> 9** (janela 30 min)

> **Início da contagem:** data do deploy de Fase 1 em produção.

---

## Visão linear (ordem exata)

Numeração contínua do pedido HTTP até resposta ao cliente.

### Bloco 0 — Transporte e persistência mínima (só entrada A ou job enfileirado)

**Estado atual (A):** o webhook faz este bloco **e** o Bloco 3 no mesmo request.

**Alvo produção:** o webhook faz só Bloco 0 + enqueue; Bloco 3 corre no worker (B).

| # | Etapa | Onde | Responsabilidade |
|---|--------|------|------------------|
| 0.1 | Rate limit por IP | `incoming/route.ts` + `lib/security/rateLimit.ts` | Mitigar abuso; **429** com `Retry-After`. |
| 0.2 | Config Meta | `incoming/route.ts` | `WHATSAPP_APP_SECRET` obrigatório; senão **500**. |
| 0.3 | Corpo bruto + assinatura HMAC | `incoming/route.ts` | `X-Hub-Signature-256`; falha → **401** `invalid_signature`. |
| 0.4 | JSON parse | `incoming/route.ts` | JSON inválido → **400**. |
| 0.5 | Iteração `entry.changes[].value.messages[]` | `incoming/route.ts` | Ignorar mensagens sem `from` / `id`. |
| 0.6 | Resolver canal | `whatsapp_channels` | `phone_number_id` → empresa + token; canal inexistente → log + skip (sem resposta). |
| 0.7 | Extrair texto | `incoming/route.ts` | `text` / `interactive` / `button`; pode ser vazio → mais abaixo não processa conversa. |
| 0.8 | Upsert thread | `incoming/route.ts` (`upsertThread`) | `company_id` + `phone_e164`; falha → skip. |
| 0.9 | Insert `whatsapp_messages` | `incoming/route.ts` | Dedup: **23505** em `provider_message_id` → mensagem já vista, **fim** (correto). Outro erro → log + skip. |
| 0.10 | Atualizar preview da thread | `incoming/route.ts` | Best-effort. |
| 0.11 | Texto vazio | `incoming/route.ts` | `continue` — **sem** motor. |
| 0.12 | `bot_active` + handover | `incoming/route.ts` | Se handover recente → **skip** (sem motor). Se timeout → reativar bot + mensagem fixa + **continua** para motor. |

**Entrada B (`processJob`) antes do motor:**

| # | Etapa | Onde | Responsabilidade |
|---|--------|------|------------------|
| 0.B.1 | Carregar canal Meta | `process-queue/route.ts` | `waConfig`, `catalogFlowId`; canal ausente usa env fallback (risco multi-tenant). |
| 0.B.2 | `bot_active` / handover | `process-queue/route.ts` | Handover ativo → **return** (job pode marcar-se `done` sem `processInboundMessage` — ver código); expirado → reativa + opcional mensagem + **apaga** `chatbot_sessions` (atenção a efeitos colaterais). |

**Falhas típicas (Bloco 0):** rede Meta duplicada (ok com 0.9), secret errado (401), DB indisponível (500 ou skip silencioso), canal desconfigurado (mensagem ignorada).

---

### Bloco 1 — Entrada do motor

| # | Etapa | Onde | Responsabilidade |
|---|--------|------|------------------|
| 1.1 | `processInboundMessage` | `lib/chatbot/processMessage.ts` | Única fachada pública do motor. |
| 1.2 | Resolver plano | `lib/chatbot/tier.ts` (`getChatbotProductTier`) | `starter` vs `pro`; falha de query → comportamento default do tier. |
| 1.3 | `runInboundChatbotPipeline` | `lib/chatbot/inboundPipeline.ts` | Orquestração completa abaixo. |

**Falhas:** exceção não tratada no webhook (A) → 200 já enviado ou não conforme ordem de awaits; no worker (B) → job `failed`/retry.

---

### Bloco 2 — Pipeline interno (`inboundPipeline.ts`)

Ordem **exata** no código.

| # | Etapa | Onde | Responsabilidade |
|---|--------|------|------------------|
| 2.1 | Normalizar / clamp input | `inboundPipeline.ts` + `utils.ts` (`clampChatbotInputForRegex`) | Texto vazio após clamp → **return** (sem resposta). |
| 2.2 | Bot ativo | `inboundPipeline.ts` | Query `chatbots`; sem bot ativo → log + **return**. |
| 2.3 | Carregar empresa + sessão | `getCompanyInfo`, `getOrCreateSession` | Contexto e `step`. Falha DB → exceção ou sessão inconsistente. |
| 2.4 | Modelo default | `inboundPipeline.ts` | `botConfig.model` ou Haiku default. |
| 2.5 | Step `handover` | `inboundPipeline.ts` | **return** imediato (atendimento humano). |
| 2.6 | **Regex / intents globais (sem IA de pedido)** | `lib/chatbot/middleware/intentDetector.ts` | Reset explícito (`limpar`, `reiniciar`, …); nome (`me chamo …`). Se `handled` → **return** (já respondeu). |
| 2.7 | Step `awaiting_flow` | `inboundPipeline.ts` (`handleAwaitingFlow`) | **Regex** `FLOW_ESCAPE_RE` ou timeout/stuck; senão lembrete de formulário. Resposta botões/texto. |
| 2.8 | Step `pro_escalation_choice` (só PRO) | `lib/chatbot/pro/handleProEscalationChoice.ts` | Escolha pós-confusão (catálogo / atendente / tentar de novo). |
| 2.9 | **Classificação de intenção (regex → Haiku curto)** | `lib/chatbot/middleware/intentClassifier.ts` | Mantida para Starter; ajustes neste ciclo só se impactarem o PRO sem regressão no Starter. |
| 2.10 | `switch (intent)` | `inboundPipeline.ts` | Desvia para menu, FAQ, status, handover, pedido Starter ou PRO. |

**Falhas (Bloco 2):** `waConfig` ausente em ramos que enviam WhatsApp → log + **sem** envio; classificador Haiku falha → intent `unknown` → menu boas-vindas; regex a classificar mal → fluxo errado (risco de produto, não de infra).

---

### Bloco 3 — Regex e IA na classificação (`intentClassifier.ts`)

Sub-ordem **dentro** do passo 2.9:

| Sub | Etapa | Mecanismo | Responsabilidade |
|-----|--------|-----------|-------------------|
| 3a | Rascunho PRO ativo | `confirmationPt` + regex curto pagamento | Manter `order_intent` para “sim”/“não”/“pix”/… não ser saudação. |
| 3b | IDs de botão Meta | Sets `btn_catalog`, etc. | Mapeamento fixo para intent. |
| 3c | Regex | `GREETING_PATTERNS`, `STATUS_PATTERNS`, `HUMAN_PATTERNS`, `FAQ_PATTERNS`, `ORDER_PATTERNS` | Intents baratos; ordem de teste importa (sobreposição possível). |
| 3d | Texto muito curto (≤3) | Heurística | Retorna `greeting`. |
| 3e | **IA (Haiku)** | `Anthropic.messages.create` (~10 tokens saída) | Só se nada acima casou; classifica intent em texto ambíguo. |

**Falhas:** API Anthropic (rede, 429, 5xx) → catch → **`unknown`**; resposta mal formatada → `unknown`.

---

### Bloco 3.1 — Contrato de fallback (obrigatório)

| Falha | Ação obrigatória | Proibido |
|-------|------------------|----------|
| Anthropic indisponível na classificação | Retornar `unknown` e cair em resposta curta segura (menu/handover conforme step) | Inventar intent/pedido |
| Ambiguidade alta no PRO | Pedir clarificação objetiva ou enviar para `pro_escalation_choice` | Seguir para `finalizeAiOrder` sem confirmação explícita |
| Falha de tool (`search_produtos`/draft) | Resposta de recuperação + opção de tentar de novo/catálogo/humano | Responder preço/produto sem fonte de verdade |
| Falha na finalização RPC | Não criar “pedido fantasma”; informar erro e pedir nova tentativa | Confirmar pedido ao cliente sem persistência confirmada |

**Critério objetivo para “ambiguidade alta” (PRO):**
- classificador retorna `unknown` por **2 mensagens consecutivas** na mesma thread, ou
- primeira resposta PRO retorna marcador de baixa confiança por **2 tentativas seguidas**, ou
- usuário alterna intenção sem progresso de pedido por **3 turnos**.

Ao atingir qualquer critério: entrar em `pro_escalation_choice`.
**Período inicial aprovado:** manter regra 2/2/3 por 30 dias a partir do deploy de Fase 1 em produção; reavaliar ao fim da janela.

---

### Bloco 4 — Processamento de pedido e ramos pós-intent

Depende de `intent` e `tier`:

| Intent | Starter (`tier !== "pro"`) | PRO |
|--------|---------------------------|-----|
| `greeting` / `unknown` | `sendWelcomeMenu` — horário, botões/lista (**sem refator neste ciclo**) | Mensagem PRO templates / texto |
| `order_intent` | `starterOrderFlow` — Flow catálogo ou menu (**sem refator neste ciclo**) | **`handleProOrderIntent`** — tools + Haiku + rascunho (**foco da refatoração**) |
| `status_intent` | Flow status ou `replyWithOrderStatus` (**sem refator neste ciclo**) | Idem |
| `human_intent` | `doHandover` (**sem refator neste ciclo**) | Idem |
| `faq` | `handleFAQ` (**sem refator neste ciclo**) | Idem |

**PRO — pedido (`handleProOrderIntent.ts` + satélites):**

| # | Etapa | Responsabilidade |
|---|--------|------------------|
| 4.P.1 | Loop tool / mensagens | `search_produtos`, `prepare_order_draft`, hints; truncagem `MAX_STORED_MESSAGES` / saneamento tool_use. |
| 4.P.2 | Confirmação PT-BR | `confirmationPt` + fluxo servidor. |
| 4.P.3 | Fecho | **`tryFinalizeAiOrderFromDraft`** → `finalizeAiOrder.ts` — **RPC** de criação de pedido (regra de negócio no servidor). |

**Falhas:** tool loop excedido; 400 Anthropic por histórico tool quebrado; RPC falha (estoque, política entrega, validação); cliente nunca confirma.

**Starter — pedido:** principalmente **WhatsApp Flow** + sessão (`awaiting_flow`); não é “IA de pedido” no mesmo sentido do PRO.  
**Decisão de escopo:** Starter fica congelado nesta entrega (somente correção de bug crítico).

---

### Bloco 5 — Resposta ao utilizador

| # | Etapa | Onde | Responsabilidade |
|---|--------|------|------------------|
| 5.1 | Texto | `botReply` → `lib/whatsapp/sendMessage.ts` | Persiste `whatsapp_messages` + envia Graph API. |
| 5.2 | Botões / listas / flows | `lib/whatsapp/send.ts`, `sendFlowMessage`, etc. | Templates Meta; requer `waConfig` válido. |
| 5.3 | Erro de envio | `botSend.ts` / send | Log `Falha ao enviar mensagem`; **cliente pode não ver** a resposta. |

**Falhas:** token revogado, número limitado, quality rating, payload inválido, timeout HTTP para Meta.

---

## Diagrama de fluxo (simplificado)

```
[0] Webhook / Worker pre-checks
        ↓
[1] processInboundMessage → tier
        ↓
[2] inboundPipeline
        clamp → bot? → session/company → handover? skip
        → intentDetector (regex global)
        → awaiting_flow? (regex escape)
        → pro_escalation_choice?
        → classifyIntent (regex + botões → Haiku?)
        → switch(intent)
                ↓
[4] handleFAQ | doHandover | starterOrderFlow | handleProOrderIntent | …
                ↓
[5] botReply / sendInteractive / sendFlowMessage → Meta
```

---

## Matriz rápida: falhas por etapa

| Zona | Sintoma | Causa comum |
|------|---------|-------------|
| 0 | 401/400 | Assinatura, JSON, rate limit IP |
| 0 | Sem resposta | Canal não encontrado, texto vazio, handover ativo |
| 0 | Duplicata “ok” | 23505 mensagem — intencional |
| 1–2 | Exceção | DB, bug pipeline |
| 3 | Sempre menu genérico | Haiku falhou → `unknown`; regex não cobre gíria |
| 3 | Intent errado | Regex ambíguo (ex. FAQ vs order) |
| 4 PRO | Sem pedido | Confirmação explícita não satisfeita |
| 4 PRO | Erro 400 Anthropic | Histórico tools truncado mal (mitigado no código; ainda possível) |
| 4 | Pedido rejeitado | RPC negócio (zona, mínimo, estoque) |
| 5 | Utilizador sem mensagem | Falha Graph API após DB gravado ou não |

**Idempotência obrigatória de fila (decisão):**
- índice único parcial em **`(company_id, message_id)`** quando `message_id IS NOT NULL`.
- objetivo: replay seguro por tenant sem acoplamento indevido entre empresas.
- remover índice legado apenas em `message_id` após validação da migração nova.

---

## Execução — o que alinhar com `CHATBOT_PROD`

1. **Fase 1:** mover execução pesada para fila/worker (webhook não aguarda motor) sem alterar UX do Starter — ver checklist em [`structure_chatbot_prod.md`](./structure_chatbot_prod.md).  
2. **Fase 2 (PRO only):** reduzir tokens e risco 400 em **4.P.1** (histórico `pro_anthropic_*`) independentemente da fila.  
3. **Métricas:** instrumentar 3e (latência/erro classificador), 4.P (rounds tools), 5 (falhas envio), segmentadas por `tier`.  
4. **Guarda de regressão Starter:** validar respostas padrão (saudação/botões/catálogo/status/atendente) antes de merge.

---

## Referência de ficheiros (pipeline)

| Bloco | Ficheiros principais |
|-------|----------------------|
| 0 | `app/api/whatsapp/incoming/route.ts`, `app/api/chatbot/process-queue/route.ts` |
| 1 | `lib/chatbot/processMessage.ts`, `lib/chatbot/tier.ts` |
| 2 | `lib/chatbot/inboundPipeline.ts`, `lib/chatbot/session.ts`, `lib/chatbot/db/company.ts` |
| 2.6 | `lib/chatbot/middleware/intentDetector.ts` |
| 2.9–3 | `lib/chatbot/middleware/intentClassifier.ts`, `lib/chatbot/pro/confirmationPt.ts` |
| 4 PRO | `lib/chatbot/pro/handleProOrderIntent.ts`, `prepareOrderDraft.ts`, `searchProdutos.ts`, `finalizeAiOrder.ts` |
| 5 | `lib/chatbot/botSend.ts`, `lib/whatsapp/sendMessage.ts`, `lib/whatsapp/send.ts` |
