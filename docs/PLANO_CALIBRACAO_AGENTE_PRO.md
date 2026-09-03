# Plano — Calibração e fortalecimento do Agente PRO

**Canónico a partir de:** 2026-09-03  
**Decisão:** [`ADR/0005-pro-agent-calibration-pillars.md`](./ADR/0005-pro-agent-calibration-pillars.md) (emenda revisão + D6/D7/D8)  
**Não substitui:** [`CHATBOT_PROD.md`](./CHATBOT_PROD.md), [`ADR/0003`](./ADR/0003-sqs-outbox-lambda.md), [`PRO_ORDER_SLOT_MACHINE.md`](./PRO_ORDER_SLOT_MACHINE.md).

Cronologia de aplicação dos quatro pilares. Marcar `[x]` só com evidência. Emenda = linha na §5 + nota datada.

**Implementação em curso (2026-09-03):** C1–C4 eng feitos. Pendente: C4.4 smoke E (ops) + C5.

---

## 0. Princípio e ordem de correção

```
Mensagem → Prompts/tools → Matching/dados → Gates/políticas → efeito (pedido)
                ↑______________ Avaliação (pass/fail) ______________↑
```

Ao falhar: **Gates → Matching → Prompts → (só então) copy**.  
Calibração **≠** fine-tune.  
**Segurança do pedido:** ADR-0005 **D8** (botão, allowlist, RPC, um efeito, tokens TTL).

---

## 1. Estado documental

| Ficheiro | Usar para | Não usar para |
|----------|-----------|---------------|
| `CHATBOT_PROD.md` | Cérebro PRO, env, cutover | Checklist dia-a-dia deste plano |
| `structure_*` / `pipeline_*` | Mapa / histórico | Transporte; calibração IA |
| **Este plano + ADR-0005** | Fortalecimento + cronologia | — |

---

## 2. Alvo forte por pilar

### Pilar 1 — Gates e políticas

| Peça | Alvo | Código âncora |
|------|------|----------------|
| Slots | `ProStep` ← `OrderDraft` | `orderSlotStep.ts` |
| Confirmar / cancelar (bot **e** HITL) | **Só botão** (`pro_confirm_order` / `pro_cancel_order` + aliases) | `orderConfirmationText.ts`, `orderStage.ts`, `resolvePendingOrderConfirmation.ts` |
| Allowlist SKU | `search_allowlist` no hot path | `prepareOrderDraft.ts` |
| Draft completo | `isDraftStructurallyCompleteForFinalize` | `orderDraftGate.ts` |
| Canal checkout | R1–R2: WA default; web se outro/incompleto | `resolveCheckoutChannel` *(a criar)* + handoff |
| Degradação IA | D6: crédito/API → cardápio; **não** se paywall deny | `aiCapabilityProfile.ts`, `runProPipeline` |

### Pilar 2 — Prompts + tool schemas

| Peça | Alvo | Código âncora |
|------|------|----------------|
| System | Curto; proibições duras | `ai.service.ts` |
| Schemas / force path | Pendentes, SKU único, picks | `prepareStep` / tools |
| Guidance | `guidance_for_model_pt` em `ok:false` | prepare / search |
| Saída | `respond_to_customer`; botões no servidor | `checkoutPostProcess` |

### Pilar 3 — Matching e dados

| Peça | Alvo | Código âncora |
|------|------|----------------|
| Catálogo limpo | Sigla, volume, fator, preço, estoque | ERP + RPC search |
| Busca / desambiguação / hábitos / multi-item | Sem default silencioso de embalagem | search*, packaging*, habits, pending* |

### Pilar 4 — Avaliação

| Nível | Artefacto |
|-------|-----------|
| A–C | `tests/pro/*`, fixtures replay, cassetes |
| D–E | Replay live; `SMOKE_AGENT_LOOP_WHATSAPP.md` (SQS/Lambda) |

---

## 3. Cronologia de aplicação

Legenda: `[ ]` pendente · `[x]` feito · `[-]` N/A · `[~]` decisão só (sem código)

### C0 — Documentação

- [x] ADR-0005 + este plano + links canónicos
- [x] Emenda ADR: revisão G/I/S/M + D6/D7/D8 (2026-09-03)

### C1 — Gates (HITL + slots)

- [x] **C1.1** Decisão: HITL = só botão (igual bot)
- [x] **C1.2** Código: `detectStructuredCheckoutAction`; `send-confirmation` envia interactive buttons; coalescer só IDs de botão
- [x] **C1.3** Testes A: prosa não fecha; botão confirma/cancela (`orderConfirmationText`, HITL intent, `queueCoalesce`)
- [x] **C1.4** Matriz slots mensagens curtas (`orderSlotStep` C1.4)
- [x] **C1.5** Endereço / zona / mínimo alinhados a prepare + R2
  - `requires_address_flow_registration` só sem endereço completo utilizável
  - handoff `hc` só se `resolveCheckoutChannel` → `web_menu`
  - finalize exige `isAddressStructurallyComplete` (não só `Boolean(address)`)
- [x] **C1.6** Métricas outcome / slot / HITL
  - `pro_pipeline.order_outcome`, `slot_transition`, `checkout_turn`, `hitl_confirmation`

**Saída C1:** um contrato de finalize/cancel.

### C1b — Canal pós-itens (R1–R3)

- [x] **R1–R3** decisões (doc)
- [x] **C1b.1** `resolveCheckoutChannel` + testes A + wire em `checkoutPostProcess`
- [x] **C1b.2** Handoff `meta.fulfillment_type` (migration + API + CheckoutDrawer skip step)
- [x] **C1b.3** Consumir handoff + limpar draft WA após pedido web (`consumeCheckoutHandoffAfterWebOrder`)

**Retorno WebView / `wa.me` automático:** **TBD — a resolver. Não implementar.** Loop fiável atual: `notifyWebMenuOrder`.

### C1c — Falha IA → cardápio (D6 / R4)

- [x] Crédito vazio / IA off / erro provider (após retry) → oferecer cardápio (`cta_url` preferível a URL em texto)
- [x] 429 transitório → **retry fila**, não cardápio imediato (`AI_RATE_LIMIT` → `QueueRetryableError`)
- [x] Assinatura blocked/cancelled / TenantAccess deny → **não** usar este fallback (paywall / `canProcessInboundChannel`); `no_subscription` sem CTA web
- [x] **C1c.1** `degradedReason` discriminado (`ai_wallet_empty` | `ai_disabled` | `llm_error` | `no_subscription` | `profile_resolve_error`)
- [x] **C1c.2** CTA degradado alinhado a D6; métrica `pro_pipeline.ai_degraded` com `reason`
- [x] **C1c.3** Testes: wallet empty → outbound com web; `no_subscription` sem CTA

### C2 — Matching e dados (P0.1, P0.2)

- [-] **C2.1** Checklist dados loja piloto (ops: sigla, volume, fator, preço, estoque, EAN/código) — fora do hot path de código
- [x] **C2.2** Fixtures B: corpus versionado `matching-corpus.v1` (≥15 casos)
- [x] **C2.3** Pending picks → prepare allowlist-safe (texto / opção / hábito)
- [x] **C2.4** Métricas: `prepare_blocked_allowlist`, `search_hits_zero`, `pending_pick_abandon`

**Saída C2:** corpus mínimo no lab; allowlist nunca bypass no hot path.

### C3 — Prompts e tools

- [x] **C3.1** System curto / proibições: preamble alinhado (não listar opções); `SYSTEM_HARD_RULES_PT` + testes
- [x] **C3.2** Force path: prepare unívoco só com qty explícita; `resolve_pending_picks` sem qty=1 silencioso; `shouldForceResolvePendingPicks` exportado; nudge search sem repetir
- [x] **C3.3** Guidance `ok:false` já canónico (prepare/search) — sem afrouxar allowlist
- [x] **C3.4** `respond_to_customer` description: proíbe “pedido criado” / “digite sim”; botões no servidor (C1)

**Saída C3:** force-prepare alinhado a qty; allowlist/confirmação intactos.

### C4 — Avaliação / smoke

- [x] **C4.1** Trace: `PRO_PIPELINE_TURN_TRACE` em `CHATBOT_PROD` + `deploy-workers.ps1`; testes upsert mock; validação SQL staging documentada no runbook
- [x] **C4.2** ≥3 cassetes CI: `tests/fixtures/replay/cassettes.v1.json` + `c4CassetteReplay.test.ts` (nível C; threads PII = ops via `npm run replay`)
- [x] **C4.3** Smoke/runbook: caminho feliz = SQS + Lambda (ADR-0003); `process-queue` removido dos pré-voos
- [ ] **C4.4** Matriz E mínima (S1–S3 + S5/S5b + handover) executada no WA e datada na §5 — **ops / você**

**Saída C4 eng:** pirâmide A–C no repo; E checklist pronta; transporte alinhado.

### C5 — Resiliência de efeito

- [x] **C5.1** Idempotência: `create_order_with_items` usa `companyId:threadId:messageId` como chave — wamid único garante sem duplicata em redelivery SQS; `outbound_jobs` tem `dedup_key` + unique index; `processOutboundJobById` retorna `job_not_runnable` se já terminal. Testes de regressão em `c5Resilience.test.ts`.
- [x] **C5.2** `QueueRetryableError` + `isQueueRetryableError`: 429/rate-limit/circuit → retry com backoff exponencial (teto 120s); `runProInbound` propaga sem bolha falsa; circuit esgotado → `AI_RATE_LIMIT` → `QueueRetryableError` → D6 após redeliveries. Testes `c5Resilience` + `runQueueEntry` + `llmResilience` cobrem.
- [x] **C5.3** STT fail-safe: qualquer exceção em `tryTranscribeInboundAudio` → `null` (catch silencioso); transcrição vazia detectada no adapter (`SttProviderError`); wallet debit best-effort (warn sem bloquear); limites documentados em `CHATBOT_PROD`. Testes `c5Resilience`.

---

## 3b. Decisões de canal e degradação (congeladas)

| ID | Decisão | Implementar agora? |
|----|---------|-------------------|
| R1 | Pós-itens como cardápio | Policy + channel (C1b.1) |
| R2 | WA default; web se outro/incompleto | C1b.1 feito |
| R3 | Fecha no web | Já; C1b.3 limpa draft pendente |
| R4 / D6 | IA operacional falhou → web; não se paywall | Não (C1c) |
| Retorno WebView | TBD | **Não** |

---

## 4. Matriz sintoma → pilar

| Sintoma | Mexer primeiro |
|---------|----------------|
| Pedido sem botão / duplicado | Gates (+ C5) |
| SKU/preço inventado | Allowlist |
| Produto/CX errado | Matching |
| IA muda / crédito / API | D6 / C1c (não prompt) |
| Paywall / assinatura | TenantAccess — **não** cardápio “feliz” |
| Tom / qty esquecida | Prompts (depois gates) |

---

## 5. Registro de execuções

| Data | Fase | Evidência | Notas |
|------|------|-----------|-------|
| 2026-09-03 | C0 | ADR + plano | Baseline doc |
| 2026-09-03 | C1.1 | Owner | HITL = botão |
| 2026-09-03 | C1b | Owner R1–R3 | Policy only |
| 2026-09-03 | C1c / D6 | Owner | IA fail → web; exclui assinatura deny |
| 2026-09-03 | Revisão | ADR emenda | G/I/S/M; retorno WA = TBD |
| 2026-09-03 | C1.2–C1.3 | Código + 24 testes A verdes | HITL = botões; prosa `sim`/`CONFIRMAR` não fecha; smoke **S5b** p/ WA real |
| 2026-09-03 | C1.4 + C1b.1–2 | slots matrix + `resolveCheckoutChannel` + `menu_handoffs.meta` | |
| 2026-09-03 | C1b.3 | `consumeCheckoutHandoff` + 3 testes | Pedido web com `hc` limpa draft WA |
| 2026-09-03 | C1c | `degradedReason` + CTA `cta_url` + testes D6 | 429 continua retry; `no_subscription` sem CTA |
| 2026-09-03 | C1.5–C1.6 | R2 hints/handoff/finalize + métricas outcome/HITL | |
| 2026-09-03 | C2 eng | corpus v1 + métricas matching + volume/habit pending | C2.1 = ops loja |
| 2026-09-03 | C3 | preamble/force qty/respond description | allowlist intacta |
| 2026-09-03 | C4.1–C4.3 | trace env+test, cassettes.v1 CI, smoke SQS | C4.4 = smoke E manual |
| 2026-09-03 | C5.1–C5.3 | idempotência + retry + STT fail-safe + testes | `c5Resilience.test.ts` 14/14 |

---

## 6. Definição de pronto (épico)

- [x] C1 + C1b + C1c + C2–C5 eng com evidência na §5  
- [ ] P0.1–P0.5 e P0.11 fechados ou aceitos com data  
- [ ] Smoke E em SQS cutover  
- [ ] Nenhum caminho prosa fecha pedido; D6 não mascara paywall  

Fora de escopo agora: fine-tune; reescrever `pipeline_*`; retorno WebView; marketplace.

---

## 7. Referências de teste

| Área | Testes |
|------|--------|
| Slots / confirm / HITL | `orderSlotStep`, `orderConfirmationText`, `resolvePendingOrderConfirmation`, `hitlConfirmationMetrics` |
| Canal checkout / handoff / R2 | `checkoutChannelPolicy`, `consumeCheckoutHandoff`, `orderDraftGate` |
| D6 degradado | `aiCapabilityProfile.degraded` |
| Matching / corpus | `matchingCorpus`, `pendingPickPrepareAllowlist` |
| Prompts / force (C3) | `c3PromptsAndForcePaths`, `forcePrepareAfterEmbalagemChoice` |
| Avaliação C4 | `pipelineTurnTrace`, `c4CassetteReplay`, `replayRecorder`; smoke E: `SMOKE_AGENT_LOOP_WHATSAPP.md` §C4.4 |
| Resiliência C5 | `c5Resilience`; `runQueueEntry`; `llmResilience`; `agentSecurityResilience` |
| Pipeline / allowlist / picks | `proPipeline`, `prepareOrderDraftAllowlist`, `pendingPickGroups`, … |
| Degradado / capability | `aiCapabilityProfile` tests, `aiOrderModePolicy` |
| Handoff / menu | `tests/public-menu/*` |
| Replay | `replayRecorder`, `extractionBaseline`, `npm run replay` |
