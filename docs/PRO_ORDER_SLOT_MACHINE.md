# Máquina de slots do pedido PRO (V2)

Este documento descreve **como o servidor mantém o passo (`ProStep`) alinhado ao rascunho (`OrderDraft`)**, para reduzir ambiguidade da IA e manter UX previsível (endereço salvo → confirmação → pagamento → troco → confirmação final).

**Relacionado:** [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (orquestrador e flags), [`REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md`](./REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md) (fases R0–R3), código em `src/pro/pipeline/orderSlotStep.ts` e `src/pro/pipeline/stages/checkoutPostProcess.ts`.

---

## 1. Princípio

- **Fonte de verdade do “onde estamos” no checkout:** o `OrderDraft` persistido (itens, endereço, pagamento, `pendingConfirmation`) + regras em `resolveProStepFromDraft`.
- **A IA** continua responsável por interpretar texto livre e chamar tools; o **motor** re-sincroniza `step` após cada turno relevante para que botões e gates batem com o estado real.

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
3. **Endereço estrutural incompleto:** `pro_collecting_order`.
4. **Sem `paymentMethod`:**
   - Se `step === pro_awaiting_payment_method` → mantém (cliente já confirmou endereço salvo e está a escolher pagamento).
   - Se `step === pro_awaiting_address_confirmation` → mantém (à espera do botão ou novo texto).
   - Se existe `address.enderecoClienteId` → `pro_awaiting_address_confirmation` (mostrar CTA de confirmar endereço salvo).
   - Caso contrário (endereço digitado / resolvido sem id salvo) → `pro_awaiting_payment_method`.
5. **`paymentMethod === cash`** e `changeFor == null` → `pro_awaiting_change_amount`.
6. **Draft completo para finalize** (`isDraftStructurallyCompleteForFinalize`) **e** `pendingConfirmation` → `pro_awaiting_confirmation`.
7. **Caso contrário:** `pro_collecting_order`.

---

## 4. Botões e prioridade de UI

- **`checkoutButtonsForState`:** não mostra PIX/Cartão/Dinheiro enquanto o passo for `pro_awaiting_address_confirmation` **ou** enquanto (em `pro_collecting_order`) houver `enderecoClienteId` sem pagamento — nesses casos só entra a UI de **confirmar endereço** (`buildAddressConfirmationMessage`).
- **`prioritizeInteractiveFirst`:** mensagens `buttons` / `flow` antes de `text` (WhatsApp).

---

## 5. Consistência com a IA (camada complementar)

Além desta máquina de slots:

- **`guidance_for_model_pt`** nas respostas das tools `search_produtos` e `prepare_order_draft` (`ai.service.full.ts` + `buildPrepareDraftGuidanceForModel` em `prepareOrderDraft.ts`).
- **`flow_reminder_pt`** no payload de `get_order_hints` (`orderHints.ts`).
- **System prompt** reforçado em `ai.service.full.ts` (seguir JSON das tools, não inventar catálogo, alinhar mensagens a `errors` quando `ok:false`).

Isto **não substitui** a máquina de slots: slots governam **passo + botões**; guidance governa **texto** que o modelo gera.

---

## 6. O que ainda pode evoluir (R4+)

- Unificar totalmente `applyAiStateTransition` com `resolveProStepFromDraft` para que **uma única** função defina `step` após IA (hoje a IA ainda pode propor `request_confirmation` e o checkout reconcilia no fim do turno).
- Métricas por `ProStep` (opcional) para ver quanto tempo em cada slot.
- Testes E2E de conversa multi-turno com ordem trocada (endereço primeiro, depois produto, etc.).

---

## 7. Testes

- `tests/pro/orderSlotStep.test.ts` — matriz de `resolveProStepFromDraft` / `withResolvedSlotStep`.
- `tests/pro/proPipeline.test.ts` — integração rápida (saudação, flow, troco).
- `tests/pro/prepareDraftGuidance.test.ts` — texto de orientação pós-`prepare_order_draft`.
