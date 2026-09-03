# ADR 0005 — Calibração do Agente PRO: quatro pilares + ordem de correção

**Status:** aceito (emenda 2026-09-03 — revisão de furos + fallback IA→cardápio)  
**Data original:** 2026-09-03  
**Emenda:** 2026-09-03 — decisões R1–R4; HITL botão-only; retorno WebView TBD; revisão de segurança/gargalos  
**Escopo:** motor PRO de delivery (`src/pro/`, `lib/chatbot/runProInbound.ts`) — qualidade de pedido por linguagem natural, sem fine-tune do modelo.

---

## Contexto

O agente de delivery já tem agent loop (Vercel AI SDK + tools), máquina de slots (`orderSlotStep`), allowlist de SKU em `prepare_order_draft`, handoff cardápio (`menu_handoffs` + `hc`), confirmação HITL (a unificar em botão) e harness de replay. O risco restante **não** é “falta de IA”; é **calibrar e fortalecer** quatro camadas sem misturar com transporte (ADR-0003) nem com legado Starter.

Este ADR **fixixa decisões**; cronologia e checkboxes: [`PLANO_CALIBRACAO_AGENTE_PRO.md`](../PLANO_CALIBRACAO_AGENTE_PRO.md).

### Mapa documental (qual ficheiro usar)

| Documento | Papel | Atualidade |
|-----------|--------|------------|
| [`CHATBOT_PROD.md`](../CHATBOT_PROD.md) | Decisões canónicas de produto + cérebro PRO + env | **Mais atual** p/ motor IA + cutover SQS |
| [`ADR/0003-sqs-outbox-lambda.md`](./0003-sqs-outbox-lambda.md) | Transporte outbox → SQS → Lambda | **Canónico** fila |
| [`PRO_ORDER_SLOT_MACHINE.md`](../PRO_ORDER_SLOT_MACHINE.md) | Slots draft ↔ `ProStep` | Atual p/ gates checkout |
| [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](../REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) | Histórico R0–R4 | **Não** é plano de calibração |
| [`PLANO_LIMPEZA_AGENTE_IA.md`](../PLANO_LIMPEZA_AGENTE_IA.md) | Corte Starter / replay / handover | Em grande parte feito |
| [`structure_chatbot_prod.md`](../structure_chatbot_prod.md) / [`pipeline_chatbot_prod.md`](../pipeline_chatbot_prod.md) | Mapa / blocos | **Secundários** (pipeline mais obsoleto no gatilho worker) |
| **Este ADR + plano** | Fortalecimento + cronologia | **Canónico** calibração desde 2026-09-03 |

---

## Decisão

### D1 — Quatro pilares (ordem ao corrigir)

1. **Gates e políticas** — slots, botão confirmar, allowlist SKU, draft gate, canal WA vs web.  
2. **Matching e dados** — catálogo, siglas, hábitos, UN/CX, multi-item.  
3. **Prompts + tool schemas** — system curto, schemas, force-tool, guidance nas tools.  
4. **Avaliação** — pirâmide A→E.

**Princípio:** *LLM interpreta; servidor decide; avaliação prova.*  
Texto livre **nunca** cria efeito financeiro no bot PRO nem no HITL atendente→cliente após C1 (finalize/cancel = **só botão**).

### D2 — Calibração ≠ treinar o modelo

Fine-tune / RLHF fora de escopo. Corpus real → fixtures/cassetes.

### D3 — Pirâmide de avaliação

| Nível | O quê | Quando |
|-------|--------|--------|
| **A** | Unit gates/confirm/allowlist/slots | Todo PR em `src/pro/` |
| **B** | Golden matching/extract | PR relevante |
| **C** | Replay cassete | CI / nightly |
| **D** | Replay LLM live (taxa) | Pré-release |
| **E** | Smoke WhatsApp | Antes piloto / release |

Bug em E desce para A/B/C.

### D4 — P0 baseline (abertos)

| ID | Tema | Nota |
|----|------|------|
| P0.1 | Multi-item + embalagem ambígua | |
| P0.2 | Matching catálogo | |
| P0.3 | HITL regex → **só botão** | Decisão tomada; código pendente C1.2 |
| P0.4 | Slots vs mensagens curtas | |
| P0.5 | Endereço / zona / mínimo | Alinhar a R1–R2 |
| P0.6 | Idempotência efeito (SQS) | |
| P0.7 | LLM 429 / falha API | Ver **D6** (retry vs cardápio) |
| P0.8 | STT | |
| P0.9 | Traces | |
| P0.10 | Smoke ≠ `process-queue` | ADR-0003 |
| P0.11 | Reason codes de degradação | Hoje `degradado` mistura sem plano / sem crédito / IA off — ver D6 |

Handover e Starter: **não** reabrir como P0.

### D5 — Fronteiras

- Transporte: ADR-0003.  
- Dados: views/RPC; mutação pedido só RPC.  
- Radical pré-prod: sem dual-path de finalize.  
- Hot path: `agente-pro-hexagonal.mdc`.

### D6 — Falha de IA → cardápio web (não paywall)

**Decisão de produto (2026-09-03):** se a IA **não puder** atender o turno por motivo **operacional de IA**, oferecer **cardápio web** (`cta_url` / `webMenuUrl` + handoff se houver draft), **sem** inventar pedido no chat.

| Situação | Comportamento |
|----------|----------------|
| Crédito IA esgotado / `canUseAi=false` | → cardápio web (+ menu/status/atendente) |
| IA desligada no bot (`ai_enabled`) | → cardápio web |
| Falha de provider (timeout, 5xx, chave, circuito aberto esgotado) | → cardápio web **após** política de retry da fila |
| 429 / rate limit **transitório** | **Retry** (`QueueRetryableError` / backoff) — **não** spammar cardápio a cada 429 |
| Limite de turnos `info_only` | → cardápio (já parcialmente no código) |
| **Assinatura bloqueada / cancelada / sem TenantAccess** (`deny`) | **Não** é este fallback. Ingresso já barrado em `canProcessInboundChannel` / paywall. Não mascarar paywall com “pede no cardápio” se a loja não deve operar. |
| Sem `webMenuUrl` configurado | Mensagem degradada + atendente; sem URL inventada |

**Invariante de segurança:** fallback **não** chama `create_order_with_items` nem afrouxa allowlist/botão. Só desvia o cliente para um canal que já valida no servidor (`createWebMenuOrder`).

**Implementação:** `degradedReason` em `AiCapabilityProfile` (`no_subscription` | `ai_wallet_empty` | `ai_disabled` | `profile_resolve_error` | `llm_error`); `buildAiDegradedOutbound` + métrica `pro_pipeline.ai_degraded` com `reason`. Paywall (`no_subscription`) **não** recebe CTA de cardápio.

### D7 — Canal pós-itens (R1–R3) + retorno WebView

| ID | Decisão |
|----|---------|
| **R1** | Pós-produtos: espírito do cardápio (modalidade → endereço se entrega → pagamento → fechar). |
| **R2** | WA default com endereço salvo ok; web (`hc`) só em outro endereço / incompleto / sem cadastro. |
| **R3** | No web, pedido fecha no cardápio (`createWebMenuOrder`), como hoje. |
| **R4** | = D6 (falha IA → web, exceto paywall). |

**Retorno automático ao WhatsApp após sucesso no web:** **TBD / a resolver** — **não implementar** nesta etapa. Hoje: `notifyWebMenuOrder` na thread é o loop fechado fiável. Deep link `wa.me` / fechar WebView = discussão futura.

### D8 — Invariantes de segurança do pedido (não negociáveis na calibração)

1. Finalize bot e HITL: **só ID de botão** (após C1).  
2. SKU no draft: **allowlist** de `search_produtos` (+ itens já no draft).  
3. Totais/taxa/zona/mínimo/estoque: **servidor** (`prepare_order_draft` / RPC).  
4. Um efeito: handoff consumido / draft WA limpo quando pedido nasce no web.  
5. Token `hc` / `wm`: assinado, TTL, sem carrinho na query string.  
6. Fallback D6 e handoff R2 **não** bypassam RPC nem TenantAccess.  
7. Prosa do modelo nunca é ledger.

---

## Revisão (2026-09-03) — gargalos, inconsistências, furos, melhorias

### Gargalos

| # | Achado | Mitigação no plano |
|---|--------|-------------------|
| G1 | Latência LLM + tools domina; fila não cria capacidade | Cap in-flight + D6 após falha real; métricas p95 |
| G2 | Force-tools multi-item aumentam rounds/timeout | C2 + tetos `aiTimeoutMs` já por perfil |
| G3 | Handoff + Meta CTA em todo turno com draft pode custar inserts | Criar `hc` só quando `resolveCheckoutChannel` = web |
| G4 | Trace off por default → calibração às cegas | C4.1 staging |

### Inconsistências (doc × doc × código)

| # | Achado | Correção |
|---|--------|----------|
| I1 | Plano dizia HITL “hoje regex” e C1.1 “só botão” | Pilar 1 = alvo botão; código = C1.2 |
| I2 | `degradado` = sem plano **ou** sem crédito **ou** IA off | D6 + reason codes (P0.11) |
| I3 | 429 = retry na fila vs “jogar pro cardápio” | Retry primeiro; cardápio se LLM indisponível no turno |
| I4 | Copy degradada pede digitar “cardápio” em vez de `cta_url` forte | Melhoria C5/D6: preferir botão/CTA URL |
| I5 | CHATBOT_PROD ainda menciona confirmação “sim/ok” em trechos antigos | Alinhar quando tocar esse doc (não bloquear C1) |

### Furos de segurança / efeito

| # | Achado | Severidade | Ação |
|---|--------|------------|------|
| S1 | HITL ainda fecha com `sim/ok` | Alta | C1.2 obrigatório |
| S2 | Fallback degradado sem distinguir paywall | Média | P0.11 + não oferecer checkout se TenantAccess deny |
| S3 | Pedido web + draft WA vivo → risco de segundo finalize | Média | Consumir handoff + limpar draft (R3) |
| S4 | Allowlist `unrestricted` se reintroduzido | Alta | Proibido no hot path (D8) |
| S5 | SQS at-least-once sem idempotência de efeito | Alta | C5.1 |
| S6 | STT lixo → tools com termo errado | Média | C5.3; não afrouxar gates |

### Melhorias significativas (sem afrouxar segurança)

| # | Melhoria | Notas |
|---|----------|--------|
| M1 | `resolveCheckoutChannel` puro + testes A | R1–R2 |
| M2 | Meta no handoff (`fulfillment_type`) | Evita reescolher Entrega no web |
| M3 | CTA `cta_url` no degradado (não só texto com URL) | D6 UX |
| M4 | Helper único `detectStructuredCheckoutAction` | Bot + HITL |
| M5 | Reason tag em métricas `pro_pipeline.ai_degraded` | Observabilidade |
| M6 | Retorno WebView / `wa.me` | **TBD — não implementar agora** |

---

## Consequências

### Positivas

- Um contrato de finalize; fallback comercial quando IA cai sem abrir paywall.  
- Canal web reutilizado (`createWebMenuOrder`) em vez de segundo motor de pedido no chat.  
- Revisão explícita reduz calibração “no feeling”.

### Negativas / custo

- Fixtures/cassetes; reason codes na resolução de perfil.  
- Disciplina: não usar cardápio para esconder assinatura vencida.

### Proibido

- Finalize por prosa (bot ou HITL pós-C1).  
- Allowlist off no hot path.  
- Calibrar só com smoke E.  
- Implementar “fechar WebView / voltar automático” antes de fechar TBD.  
- Oferecer cardápio como substituto de TenantAccess deny.

---

## Cronologia (resumo)

| Fase | Objetivo |
|------|----------|
| **C0** | Docs + ADR (feito) |
| **C1** | Gates + HITL botão + slots (R1–R2 policy no doc) |
| **C1b** | `resolveCheckoutChannel` + handoff meta + consume `hc` (feito) |
| **C1c** | D6 reason codes + CTA degradado → web (feito) |
| **C2** | Matching/dados |
| **C3** | Prompts/tools |
| **C4** | Avaliação / smoke ADR-0003 |
| **C5** | Idempotência, 429→retry, STT |

Detalhe: [`PLANO_CALIBRACAO_AGENTE_PRO.md`](../PLANO_CALIBRACAO_AGENTE_PRO.md).

---

## Referências

- Código: `orderSlotStep.ts`, `orderDraftGate.ts`, `orderConfirmationText.ts`, `prepareOrderDraft.ts`, `ai.service.ts`, `aiCapabilityProfile.ts`, `createCheckoutHandoff.ts`, `createWebMenuOrder.ts`, `notifyWhatsApp.ts`, `canProcessInboundChannel.ts`
- Smoke: `SMOKE_AGENT_LOOP_WHATSAPP.md`
- Rules: `agente-pro-hexagonal.mdc`, `governanca-seguranca-negocio.mdc`, `projeto-pre-producao-radical.mdc`
