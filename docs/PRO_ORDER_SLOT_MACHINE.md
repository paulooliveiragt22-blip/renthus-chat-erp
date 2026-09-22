# Máquina de slots do pedido PRO (V2)

Este documento descreve **como o servidor mantém o passo (`ProStep`) alinhado ao rascunho (`OrderDraft`)**, para reduzir ambiguidade da IA e manter UX previsível (endereço → **resumo** → pagamento → troco → persistência).

**Relacionado:** [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (orquestrador e flags), [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) (fases R0–R3), [`ADR/0011-pro-order-worklist-typed-lines.md`](./ADR/0011-pro-order-worklist-typed-lines.md) (coleta multi-item / `OrderWorklist` — bloqueia checkout com `pending_search` \| `ambiguous` \| `awaiting_qty`), [`ADR/0012-inbound-slot-envelope.md`](./ADR/0012-inbound-slot-envelope.md) (de onde vêm endereço/pagamento/troco/modalidade — ver §4.1), código em `src/pro/pipeline/orderSlotStep.ts` e `src/pro/pipeline/stages/checkoutPostProcess.ts`.

---

## 1. Princípio

- **Fonte de verdade do “onde estamos” no checkout:** o `OrderDraft` persistido (itens, endereço, pagamento, `pendingConfirmation`) + regras em `resolveProStepFromDraft`.
- **A IA** continua responsável por interpretar texto livre e chamar tools; o **motor** re-sincroniza `step` após cada turno relevante para que botões e gates batem com o estado real.
- **Intenção vs. menu inicial:** mensagens curtas (“uma caixa”, “2”) não contêm palavras da `ORDER_RE`; o Haiku de classificação recebia só o texto isolado. Mitigação: (1) `isOrderSessionContinuityNeeded` + `active_order_session` em `intentClassifier.service.ts`; (2) defesa em `routeStage.ts` (modo `ai` com pedido activo); (3) **`llmClassify`** passa a incluir bloco de contexto (`step`, resumo do draft, últimas falas do utilizador em `aiHistory`) no user prompt para desambiguar mesmo em `pro_idle` sem itens persistidos ainda.

---

## 2. Funções centrais

| Função | Ficheiro | Papel |
|--------|-----------|--------|
| `isAddressStructurallyComplete` | `orderSlotStep.ts` | Endereço mínimo (rua, número, bairro), alinhado à validação de `prepareOrderDraftFromTool`. |
| `resolveProStepFromDraft` | `orderSlotStep.ts` | Calcula o `ProStep` esperado a partir de `draft` + `step` actual (trata casos especiais; ver §3). |
| `withResolvedSlotStep` | `orderSlotStep.ts` | Aplica `resolveProStepFromDraft` a um `ProSessionState` completo. |
| `checkoutPostProcess` | `stages/checkoutPostProcess.ts` | Após modo `ai`: mensagem de confirmação de endereço salvo (se aplicável), **depois** `resolveProStepFromDraft`, **depois** botões (`checkoutButtonsForState`). |
| `withResolvedSlotStep` no pipeline | `runProPipeline.ts` | Após **quick actions** e após **orderStage** com `outboundText`, persiste o estado já sincronizado. |

---

## 3. Tabela de decisão (`resolveProStepFromDraft`)

Ordem de avaliação (simplificado):

1. **`handover`**, **`pro_escalation_choice`**, **`pro_awaiting_change_amount`:** mantêm-se (não sobrescrever pelo draft excepto onde o fluxo já mudou o passo).
2. **Sem itens no draft:** `pro_idle` se já estava idle; senão `pro_collecting_order`.
3. **Endereço estrutural incompleto** ou modalidade em aberto: `pro_collecting_order`.
4. **Já em `pro_awaiting_confirmation` com draft completo+pagamento:** mantém (high-value ou sessão legado a persistir).
5. **Pagamento efetivo** = `draft.paymentMethod` só se `cartReviewAcknowledged` (fingerprint itens+endereço+modalidade ainda bate). A IA não pula o resumo gravando PIX no prepare.
6. **Sem pagamento efetivo:**
   - Endereço UI explicitamente não confirmado → `pro_awaiting_address_confirmation`.
   - Senão, sem resumo confirmado → `pro_awaiting_cart_review`.
   - Resumo confirmado → `pro_awaiting_payment_method`.
7. **`paymentMethod === cash`** e `changeFor == null` (após resumo) → `pro_awaiting_change_amount`.
8. **Draft completo + resumo confirmado** → `pro_awaiting_confirmation` (persistência no mesmo turno do PIX/cartão/troco; high-value ainda pede Confirmar).
9. **Caso contrário:** `pro_collecting_order`.

---

## 4. Botões e prioridade de UI

- **`checkoutButtonsForState`:** endereço pronto sem `cartReviewAcknowledged` → card de **resumo** (Confirmar/Corrigir/Adicionar). Só depois do Confirmar aparecem PIX/Cartão/Dinheiro. `pro_confirm_order` no resumo **não** cria pedido.
- **`prioritizeInteractiveFirst`:** mensagens `buttons` / `flow` antes de `text` (WhatsApp).
- **Inbound (`checkoutInboundPolicy` + `strictCheckoutStructuredGate`):** conjunto fechado (dinheiro/estado) só aceita botão (ID ou título exacto). Dado inventável continua texto+botão.
- **Mensagem completa (itens + endereço + PIX):** `prepare` grava itens/endereço/pagamento; endereço completo **infere entrega** (sem card Entrega/Retirar); cidade/UF vêm da loja (+ ViaCEP por rua quando possível). Confirmar do **resumo** mantém PIX/cartão e persiste; dinheiro pede troco; sem pagamento → botões.

| Passo / overlay | Só botão | Texto + botão |
|---|---|---|
| `pro_awaiting_cart_review` | Confirmar; prosa fraca (`sim`, `pode fechar`) reenvia o card | Corrigir/Adicionar/cancelar + revisão real de itens |
| Entrega/Retirar (os dois modos) | IDs + títulos `Entrega` / `Retirar no local` | — |
| `pro_awaiting_payment_method` | PIX/Cartão/Dinheiro | cancelar |
| `pro_awaiting_confirmation` | Confirmar (ADR-0005) | Corrigir/Adicionar + revisão real |
| OOS Sim/Não | IDs + `Sim`/`Não` exactos | — |
| Oferta de endereços salvos | Confirmar/Novo + `1..N` | — |
| `pro_escalation_choice` | Atendente / Continuar pedido (`atendente` vale) | — |
| Coleta / telefone / troco / endereço livre | — | texto + botões de pick |

---

## 4.1 De onde vêm os slots (envelope do inbound — ADR 0012)

Esta máquina decide o **passo** a partir do draft; quem enche o draft é o `prepare`. E o `prepare` é chamado de **oito** lugares (tool do modelo, resolve picks, force prepare, batch multi-item, pick server-side, endereço salvo, pick de endereço). Cada um montava seu `PrepareDraftToolInput` com uma visão parcial do turno — `coalescePrepareUniqueHits` chegava a mandar `address: null` fixo, o que derrubava endereço e PIX de mensagens completas.

Decisão ([`ADR/0012`](./ADR/0012-inbound-slot-envelope.md)):

- **`extractInboundSlots(userText)`** — função pura (sem I/O, sem LLM) roda **1× por turno** e produz `InboundSlots`: linha de endereço + endereço estruturado, `paymentMethod`, `changeFor`, modalidade citada em texto livre e espelho lexical das linhas, com `sourceTextHash` (mesmo selo da worklist).
- **`PrepareTurnContext` (`slots` + `currentDraft`) é parâmetro obrigatório** de `prepareOrderDraftFromTool` / `OrderDraftPort.prepareFromToolInput`. Call site novo sem envelope não compila; `tests/pro/prepareCallSitesAudit.test.ts` cobre o `as any` e o inventário de caminhos. O envelope é calculado 1× em `runProPipeline`, chega às tools por `TurnState.inboundSlots` e ao serviço por `AiServiceInput.inboundSlots`.
- **Precedência única** em `resolvePrepareInput`: escolha explícita do fluxo (endereço salvo por botão/pick) > texto **deste** turno (envelope) > rascunho atual. O envelope vence o rascunho porque é evidência mais nova (cliente corrigindo o número da porta); o rascunho vence quando o turno não traz o slot. Na direção inversa, valor mandado pela LLM só passa se bater com envelope ou rascunho — é o `sanitizePreparePayment` (apagado) generalizado a endereço e troco.
- **Idempotência:** turno de pick/botão usa `EMPTY_INBOUND_SLOTS`; o envelope da mensagem anterior não reentra (hash diferente).
- **Alarme:** `pro_pipeline.slot_dropped{slot}` quando o slot estava no envelope e não está no draft ao fim do turno; `slot_conflict` quando a LLM divergiu do envelope.
- **Endereço salvo com placeholder** (`S/N`, `-`, `(completar)`) deixa de contar como completo em `isAddressStructurallyComplete` / `buildAiAddressFromSavedClienteRow` — não é oferecido nem aceito.

Efeito no passo: endereço estrutural completo vindo do envelope infere `delivery`, então `resolveProStepFromDraft` vai direto a `pro_awaiting_cart_review` sem passar pelo card Entrega/Retirar, e o pagamento citado sobrevive ao Confirmar do resumo.

---

## 5. Consistência com a IA (camada complementar)

Além desta máquina de slots:

- **`guidance_for_model_pt`** nas respostas das tools `search_produtos` e `prepare_order_draft` (`ai.service.ts` + `buildPrepareDraftGuidanceForModel` em `prepareOrderDraft.ts`).
- **`flow_reminder_pt`** no payload de `get_order_hints` (`orderHints.ts`).
- **System prompt** reforçado em `ai.service.ts` (seguir JSON das tools, não inventar catálogo, alinhar mensagens a `errors` quando `ok:false`).

Isto **não substitui** a máquina de slots: slots governam **passo + botões**; guidance governa **texto** que o modelo gera.

---

## 6. Evolução

- **Feito (2026-08):** após IA, `aiStage` = `applyAiStateTransition` (só escalate/streak) + `withResolvedSlotStep` (draft manda). `request_confirmation` da IA **não** salta para `pro_awaiting_confirmation`.
- Métrica `pro_pipeline.slot` com tag `step` em cada run do pipeline.
- **Em curso (2026-09-22):** envelope de slots do inbound obrigatório em todo `prepare` ([`ADR/0012`](./ADR/0012-inbound-slot-envelope.md), §4.1) — Fase 1 núcleo, Fase 2 métricas `slot_dropped`/`slot_conflict`, Fase 3 placeholder + limpeza de `enderecos_cliente`.
- Ainda aberto: testes E2E multi-turno com ordem trocada; STT (`speechToText.port.ts`) segue com port próprio (não migrado ao Vercel AI SDK).

---

## 7. Testes

- `tests/pro/orderSlotStep.test.ts` — matriz de `resolveProStepFromDraft` / `withResolvedSlotStep`.
- `tests/pro/proPipeline.test.ts` — integração rápida (saudação, flow, troco).
- `tests/pro/prepareDraftGuidance.test.ts` — texto de orientação pós-`prepare_order_draft`.
- `tests/pro/checkoutInboundPolicy.test.ts` — só-botão vs texto+botão.
- `tests/pro/checkoutPostProcess.quickActions.test.ts` — gates de resumo, Entrega/Retirar, escalação.
- `tests/pro/inboundSlots.test.ts` — tabela frase → envelope (ADR 0012 §4.1).
- `tests/pro/prepareInputMerge.test.ts` — precedência de slots + anti-alucinação da LLM.
- `tests/pro/prepareCallSitesAudit.test.ts` — auditoria estática: todo `prepare` recebe envelope.
