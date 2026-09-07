# ADR 0011 — Agente PRO: Order Worklist tipada (linhas de pedido)

**Status:** aceito (2026-09-07) — implementação em curso  
**Data:** 2026-09-07  
**Decisão qty (Fase 0):** **(A) `awaiting_qty`** — registada 2026-09-07 (dono)  
**Aceite D1–D6 + cutover:** 2026-09-07 (dono)  
**Escopo técnico:** motor PRO multi-item — estado de “o que o cliente pediu e ainda não fechou em SKU”, clarificação UN/CX, force-search, cutover de filas string.  
**Escopo comercial:** **não** muda preço, trial, `plan_features`, pagamento nem fulfillment. Só qualidade de coleta de itens no chat.  
**Predecessor:** [`ADR/0005-pro-agent-calibration-pillars.md`](./0005-pro-agent-calibration-pillars.md) (D1: *LLM interpreta; servidor decide*; P0.1 multi-item reaberto **estruturalmente** aqui — C2 mitigou never-wipe, não a fragmentação de filas)  
**Relacionados:** [`PRO_ORDER_SLOT_MACHINE.md`](../PRO_ORDER_SLOT_MACHINE.md), [`PLANO_MIGRACAO_VERCEL_AI_SDK.md`](../PLANO_MIGRACAO_VERCEL_AI_SDK.md), `src/pro/pipeline/pendingPickGroups.ts`, `src/pro/domain/orderWorklist/extractCandidateTerms.ts`  
**Bússola externa (sugestional):** [`.cursor/rules/agente-pro-referencias-calibracao.mdc`](../../.cursor/rules/agente-pro-referencias-calibracao.mdc) — trajetória de tools, pirâmide A→E, sem SaaS de eval antes de cassetes locais  
**Governança:** `projeto-pre-producao-radical.mdc` (cutover sem dual-path longo), `agente-pro-hexagonal.mdc`, `decisoes-negocio-antes-codigo.mdc` (sem decisão comercial nova)

---

## Contexto

### Sintoma de produto

Cliente pede vários produtos ambíguos na mesma mensagem (ex.: whisky + vodka + gin). O bot clarifica **só um** (whisky). Os demais somem ou ficam em filas paralelas que a clarificação **não lista**.

Causa imediata observada: `search_produtos` reescrevia `pendingTermsFromSearch` com `outros_produtos_pendentes` da IA (`[]` apagava o resto). Mitigação parcial já no código: `pendingSearchTerms.ts` (never-wipe + seed lexical conservador). Isso **não** resolve a fragmentação estrutural.

### Fragmentação atual (várias fontes de verdade)

| Artefato | Onde | Papel hoje | Problema |
|----------|------|------------|----------|
| `pendingOrderMentions: string[]` | `ProSessionState` | Carryover de termos não buscados | String solta; sem qty/status; IA podia zerar |
| `pendingTermsFromSearch` | `TurnState` | Espelho no turno | Duplicata da sessão + regras de merge |
| `outros_produtos_pendentes` | schema `search_produtos` | “Fonte” declarada pela IA | Modelo manda `[]` cedo demais |
| `pendingPickGroups` | sessão + turno | Ambiguidade UN/CX multi-produto | Só nasce **após** search; não representa “ainda não busquei” |
| `lastSearchPicks` | sessão | Clarify legado (botões, 1 produto) | Concorre com `pendingPickGroups` (`clarify_product_picks` vs `clarify_pending_picks`) |
| `bootstrapPendingClarifications` | sessão | Fila bootstrap antiga | Terceiro caminho de clarify |
| `pendingAskRepeatTerms` | sessão | Termo não achado | Fora da mesma máquina de estados |
| `pendingClarifyQuantity` / `Segment` | sessão | Qty/segmento do clarify legado | Órfãos se worklist não os absorver |
| `searchProdutoEmbalagemIds` | sessão | Allowlist de SKU | **Não** é fila de pedido — permanece separado |
| `OrderDraft.items` | sessão | Itens já no rascunho | Destino final; worklist deve apontar para cá |

### Princípio violado (ADR 0005)

> LLM interpreta; servidor decide.

Hoje a IA ainda **manda no lifecycle** da fila de menções (declara/zera pendentes). Clarificação e checkout leem **subconjuntos diferentes** do estado → UX incoerente.

---

## Decisão

### D1 — Uma worklist tipada é a fonte canônica de linhas de pedido em coleta

Introduzir `OrderWorklist` em `ProSessionState` (e espelho em `TurnState`):

- Cada menção do cliente vira **uma linha** com `id`, `rawTerm`, `quantity`, `status`, vínculo opcional a grupo de embalagem / SKU.
- A IA **não** sobrescreve a worklist. No máximo:
  1. **Uma** extração estruturada (`extract_order_lines`) quando a worklist precisa ser (re)semeada; ou
  2. Sinal fraco deprecated (`outros_produtos_pendentes`) só como *add* validado contra `userText`, até remoção.
- Lifecycle (`pending_search` → `ambiguous` | `in_draft` | `not_found` | …) é **só servidor**.

### D2 — `pendingPickGroups` sobe de “fila paralela” para **payload de opções** da linha `ambiguous`

Não apagar o motor de clarify já testado (`buildPickClarificationFreeText`, `resolvePendingPickGroupsFromFreeText`, safety-net de botões).  
Mudança de modelo mental:

| Antes | Depois |
|-------|--------|
| `pendingPickGroups[]` solto na sessão | Derivado / espelhado de `lines.filter(status === "ambiguous")` |
| Grupo sem dono de “linha de pedido” | `lineId` + `productKey` amarrados |
| Resolver pick só remove grupo | Resolver pick → line `in_draft` + merge draft |

`PendingPickGroup` ganha `lineId: string` (obrigatório no cutover). Options, labels, `requestedQuantity`, `unresolvedTurns` permanecem.

### D3 — Cutover radical dos artefatos string/legado de coleta

| Remover (após cutover) | Destino |
|------------------------|---------|
| `pendingOrderMentions` | lines `pending_search` / `not_found` |
| `pendingTermsFromSearch` + `pendingSearchTerms.ts` | `OrderWorklist` |
| `outros_produtos_pendentes` obrigatório | Remover do schema **ou** tornar opcional+ignorado no write path |
| `lastSearchPicks` como clarify de produto | Só cache efêmero de allowlist UI **ou** sumir; ambiguous → sempre via worklist/`pendingPickGroups` |
| `bootstrapPendingClarifications` | Migrar para lines `ambiguous` **ou** apagar se morto em prod |
| `pendingAskRepeatTerms` | lines `not_found` (+ mensagem canônica) |
| `pendingClarifyQuantity` / `pendingClarifySegment` | `line.quantity` + segmento no resolve |

**Não** absorver na worklist (permanecem no nível atual):

- `searchProdutoEmbalagemIds` / allowlist (segurança de prepare)
- `OrderDraft` (carrinho)
- Fulfillment / endereço / pagamento / confirmação HITL (slots ADR 0005 + `orderSlotStep`)

### D4 — Extract estruturado 1× por “selo” de mensagem

- Tool/port `extract_order_lines` (Zod) → `{ lines: [{ raw_term, quantity }] }` cap 5.
- Servidor gera `id`s, status `pending_search`, grava `sealedFromUserTextHash` (hash do inbound relevante).
- **Não** re-extrair a cada step do `generateText` enquanto o hash do turno for o mesmo.
- Re-extrair só se: worklist vazia + `order_intent`, ou usuário **adiciona** itens em mensagem nova (novo hash), ou fluxo “Corrigir / Adicionar produtos” limpa/parcialmente reabre worklist.

Seed lexical (`extractCandidatePendingTermsFromUserText`) **não** é canônico na worklist final — fica no máximo fallback offline/teste; preferir extract LLM schema-enforced (já alinhado ao padrão que substituiu heurística lexical em smoke).

### D5 — Prioridade de force-tools e checkout

Ordem canônica no `prepareStep` / `stopWhen` (e espelho em `resolveCheckoutTurnOutcome`):

1. Se há line `pending_search` **e** turno **não** está só respondendo clarify de pick já listado → force `search_produtos` (query = `rawTerm` da próxima line).
2. Se há lines `ambiguous` (carryover) e texto livre pode resolver → `resolve_pending_picks` / `serverResolvePendingPicks` (já existe).
3. Prepare unívoco / force prepare (regras atuais), **sem** prepare se ainda há `pending_search` ou `ambiguous` bloqueando.
4. `respond_to_customer` só quando worklist não exige mais search neste turno (cap de steps respeitado).

**Checkout / botões Entrega·Retirada bloqueados se:**

```text
exists line in { pending_search, ambiguous, awaiting_qty }
  OR (legado transitório) lastSearchPicks>=2 sem draft
```

**Clarify outbound:**

- Lista **todas** as lines `ambiguous` (via `pendingPickGroups` derivado).
- Opcional: rodapé canônico “Ainda vou localizar: …” para `pending_search` remanescentes se bateu `maxSteps` — evita silêncio.

**Turno em que o cliente responde índice/caixa** (`serverResolvePendingPicks` handled):

- **Não** force-search no mesmo turno (evita misturar “1” com busca de vodka).
- Lines `pending_search` ficam para o turno seguinte.

### D6 — Caps e anti-loop (mitiga gargalos)

| Cap | Valor sugerido | Motivo |
|-----|----------------|--------|
| Max lines na worklist | 5 (espelha cap atual de mentions) | Custo LLM/search |
| Max `pendingPickGroups` / ambiguous | 3 (`MAX_GROUPS` atual) | Mensagem WhatsApp legível |
| Max options/grupo | 4 | Já existe |
| Max `searchAttempts` por line | 1–2; depois `not_found` | Evita force-search até `maxSteps` |
| Searches forçados por turno | ≤ max(3, remaining pending_search) mas ≤ `maxToolRounds` | Latência |

Termo inventado pela IA (não substring de `userText` normalizado): **não** entra na worklist.

---

## Contrato (tipos)

Canonical em `src/types/contracts.ts` (e helpers puros em `src/pro/domain/orderWorklist/`).

```ts
type OrderWorklistLineStatus =
  | "pending_search" // citado; ainda sem search efetivo
  | "searching"      // opcional: search em voo no turno (efêmero; pode omitir se TurnState bastar)
  | "ambiguous"      // 2+ embalagens; options em PendingPickGroup
  | "awaiting_qty"   // search unívoco (ou pick feito) sem quantity — DECIDIDO (A)
  | "in_draft"       // produto_embalagem no OrderDraft
  | "not_found"      // catálogo vazio / irresolúvel
  | "abandoned";     // Corrigir / cancel / clearStale

type OrderWorklistLine = {
  id: string;
  rawTerm: string;
  quantity: number | null;
  status: OrderWorklistLineStatus;
  productKey?: string | null;
  produtoEmbalagemId?: string | null;
  searchAttempts: number;
  lastQuery?: string | null;
  /** Quando ambiguous — FK lógica para PendingPickGroup */
  pendingPickGroupKey?: string | null;
};

type OrderWorklist = {
  lines: OrderWorklistLine[];
  /** Hash do userText (ou inbound normalizado) que selou a extract */
  sealedFromUserTextHash?: string | null;
  updatedAtIso?: string | null;
};

// PendingPickGroup — extensão
type PendingPickGroup = {
  lineId: string;          // NOVO — obrigatório pós-cutover
  productKey: string;
  productLabel: string;
  options: PendingPickOption[];
  unresolvedTurns: number;
  requestedQuantity?: number | null;
};
```

### Invariantes

1. No máximo uma line `ambiguous` por `productKey` ativo.
2. Todo `PendingPickGroup` tem `lineId` apontando para line `ambiguous`.
3. Line `in_draft` ⇒ `produtoEmbalagemId` ∈ draft.items (após prepare ok).
4. Worklist **não** guarda preço/estoque — só referência de coleta.
5. Allowlist continua a única porta para `prepare_order_draft`.

### Transições

```text
(extract) → pending_search
pending_search + search 2+ rows → ambiguous (+ upsert PendingPickGroup)
pending_search + search 1 row + qty  → in_draft (via prepare)
pending_search + search 1 row + qty null → awaiting_qty (DECIDIDO A)
pending_search + search 0      → not_found (após searchAttempts)
ambiguous + pick/resolve + qty   → in_draft
ambiguous + pick/resolve + qty null → awaiting_qty
awaiting_qty + qty do cliente    → in_draft (via prepare)
* + Corrigir/clearStale/cancel    → abandoned ou worklist []
```

**Nota qty (fechada 2026-09-07):** search/pick unívoco com `quantity == null` → status **`awaiting_qty`** (opção A). Não reutilizar `pendingClarifyQuantity` como fila paralela; o ask de qty lê/atualiza a line `awaiting_qty`. Checkout também bloqueia enquanto existir line `awaiting_qty` (além de `pending_search` \| `ambiguous`).

---

## O que sobe ao nível da worklist (agregação)

| Recurso | Ação |
|---------|------|
| Menções multi-item / force-search | **Sobe** — lines `pending_search` |
| Clarify multi-embalagem | **Sobe vínculo** — lines `ambiguous` + groups |
| “Não achei” / pedir repetir | **Sobe** — `not_found` |
| Qty pedida na frase (“2 caixas de X”) | **Sobe** — `line.quantity` → `requestedQuantity` do group |
| Ack “Anotei: …” parcial | Permanece presenter; alimentado por lines resolvidas |
| Extract order lines | **Novo** — única escrita “ampla” da worklist |
| `resolve_pending_picks` / serverResolve | Atualizam line + group |
| `search_produtos` | Só **avança** line casada com `query`/`lineId` |
| Slot machine checkout | **Consome** worklist (bloqueio); não duplica fila |
| Allowlist / draft / pagamento | **Fora** — níveis adjacentes |

---

## Estrutura de pastas (alvo)

```text
src/types/contracts.ts                    # OrderWorklist* + PendingPickGroup.lineId

src/pro/domain/orderWorklist/
  orderWorklist.ts                        # create, seal, addLines, advance, abandon
  matchWorklistLine.ts                    # query ↔ line
  worklistInvariants.ts                   # asserts p/ testes

src/pro/ports/orderLinesExtract.port.ts   # extract(userText) → raw lines

src/pro/adapters/ai/tools/
  extractOrderLines.tool.ts
  searchProdutos.tool.ts                  # advance worklist; sem fila string
  resolvePendingPicks.tool.ts             # line → in_draft

src/pro/pipeline/orderWorklist/
  seedWorklistFromExtract.ts
  advanceWorklistAfterSearch.ts
  syncPendingPickGroupsFromWorklist.ts    # projection groups ↔ lines
  shouldForceSearchWorklist.ts
  worklistCheckoutGate.ts                 # used by resolveCheckoutTurnOutcome

src/pro/pipeline/pendingPickGroups.ts     # mantém clarify/resolve; usa lineId
src/pro/domain/orderWorklist/extractCandidateTerms.ts  # fallback lexical (não canônico)
src/pro/pipeline/bootstrapClarifyQueue.ts  # drain legado → worklist / clear on empty

tests/pro/orderWorklist*.test.ts
docs/ADR/0011-pro-order-worklist-typed-lines.md  # este arquivo
```

---

## Gargalos e mitigações (já na decisão)

| Gargalo | Mitigação (D5/D6) |
|---------|-------------------|
| Latência N searches no mesmo turno | Cap searches/turno; clarify do que já é `ambiguous`; resto no turno seguinte |
| Termo preso em force-search | `searchAttempts` → `not_found` |
| Extract ruim (faltou produto) | Usuário reenvia; novo hash reseeds; smoke + replay harness |
| Extract a mais (alucinação) | Filtrar termos ∉ `userText`; cap 5 |
| Concorrência search vs clarify “1” | D5: sem force-search no turno de resolve pick |
| Dual clarify (`lastSearchPicks` vs groups) | D3: um caminho só |
| `MAX_GROUPS=3` vs cap lines=5 | Dois `pending_search` podem esperar; mensagem esclarece |

---

## Conflitos a sanar no código (checklist de desenho)

- [x] `resolveCheckoutTurnOutcome`: um gate `worklist_blocks_checkout` (pending_search \| ambiguous).
- [x] `checkoutButtonsForState`: mesma condição; não só `pendingPickGroups`.
- [x] `orderSlotStep` / `isOrderSessionContinuityNeeded` / `clearStaleClarifyUiIfNoDraft`: ler worklist, não mentions/bootstrap.
- [x] `ai.service` system blocks: `buildPendingMentionsBlock` → `buildWorklistBlock`.
- [x] `AiServiceResult.updatedPendingOrderMentions` → `updatedOrderWorklist`.
- [x] Session repository hydrate: map one-shot mentions→worklist **só** no load de sessão legado, depois nunca gravar mentions.
- [x] Testes: `aiServicePendingOrderMentions.test.ts` → cenários worklist; manter regressão “skol e original”.
- [ ] Replay traces: campo novo no turn trace se flag `PRO_PIPELINE_TURN_TRACE`.

---

## Alternativas rejeitadas

| Alternativa | Por que não |
|-------------|-------------|
| Só never-wipe de strings (status quo mitigado) | Continua sem qty/status; clarify não lista “não buscados”; ADR 0005 incompleto |
| Heurística lexical como fonte canônica | Já falhou em smoke (falso + / falso −) |
| Dual-path longo mentions **e** worklist | Vedado por pré-prod radical; custo mental alto |
| Search 100% sem LLM no multi-item | Exige segmentação perfeita; extract 1× é meio-termo certo |
| Absorver allowlist/draft na worklist | Mistura segurança de SKU com coleta; piora blast radius |

---

## Consequências

**Positivas**

- Clarificação pode mostrar **todos** os ambiguous do pedido.
- Force-search deixa de depender de a IA “lembrar” pendentes.
- Um lugar para debug (“qual o status de cada linha?”).
- Alinha ADR 0005 pilar matching multi-item.

**Negativas / custo**

- Refactor médio em `ai.service`, tools, checkout, session.
- +1 tool call (`extract_order_lines`) em turnos de pedido multi/novo.
- Sessões in-flight: hydrate legacy uma vez.
- Risco de extract incompleto (mitigado por re-seal em mensagem nova).

---

## Checklist de cutover

### Fase 0 — Aprovação

- [x] Dono aprova este ADR D1–D6 + cutover (status → **aceito**) — 2026-09-07.
- [x] Decisão qty unívoco sem número: **(A) `awaiting_qty`** (2026-09-07).
- [x] `bootstrapPendingClarifications`: ainda referenciado no código (drain legado em `bootstrapClarifyQueue` / `sessionLegacyStrip`); **migrar para lines `ambiguous` no cutover Fase 3** (não apagar só no hydrate sem migração).

### Fase 1 — Domínio + contratos (sem ligar hot path)

- [x] Tipos em `contracts.ts` + `PendingPickGroup.lineId`.
- [x] `src/pro/domain/orderWorklist/*` + testes unitários de transição/invariantes.
- [x] Port `OrderLinesExtractPort` + fake para testes.

### Fase 2 — Wire pipeline (feature sempre on — sem flag longa)

- [x] Tool/port `extract_order_lines` (selo pré-loop via `LlmOrderLinesExtractAdapter` + `seedWorklistFromExtract`).
- [x] `search_produtos` chama `advanceWorklistAfterSearch`; worklist é fonte de pending.
- [x] `syncPendingPickGroupsFromWorklist` / groups com `lineId` após search/resolve.
- [x] `serverResolvePendingPicks` / `resolve_pending_picks` atualizam line → `in_draft`.
- [x] Gates checkout/slot usam worklist (`worklistCheckoutGate`).
- [x] System prompt / force-search leem lines `pending_search` (+ `pickResolveTurn`).
- [x] Persist `orderWorklist` na sessão (`aiStage` + hydrate mentions→worklist).
- [x] Remover writes restantes em `pendingTermsFromSearch` / mentions (Fase 3).

### Fase 3 — Remoções (radical)

- [x] Apagar `pendingOrderMentions` do tipo e de todos os writes.
- [x] Apagar `pendingSearchTerms.ts` e testes só dele (substituídos).
- [x] Remover ou esvaziar `outros_produtos_pendentes` do schema Zod + repair.
- [x] Remover caminho `clarify_product_picks` por `lastSearchPicks` **ou** reduzir `lastSearchPicks` a não-persistido.
- [x] Apagar/migrar `bootstrapPendingClarifications`, `pendingAskRepeatTerms`, `pendingClarifyQuantity|Segment`.
- [x] Atualizar `sessionOrderContext`, `aiStage`, repositório de sessão, traces.

### Fase 4 — Prova

**Unit / produto (A–B)**

- [x] Testes: multi-item todos ambiguous → N groups na mesma clarify. (`orderWorklist.trajectory.test.ts`)
- [x] Testes: IA manda `[]` / omite extract ruim → worklist selada não zera; ou re-extract só com novo hash.
- [x] Testes: resolve 1 de N → resto ambiguous; sem force-search no mesmo turno.
- [x] Testes: carryover `pending_search` no turno seguinte após pick.
- [x] Testes: `not_found` após attempts; não trava até maxSteps eterno.
- [x] Testes: gate checkout — bloqueio com line `pending_search` \| `ambiguous` \| `awaiting_qty`.

**Trajetória de tools (A/C — alinhado à rule de referências)**

Sequência canónica a assertar (subset/superset; estilo AgentEvals, **sem** LangChain no hot path):

```text
extract_order_lines (selo, 0–1× / hash)
  → search_produtos (force por line pending_search; caps D6)
  → resolve_pending_picks | serverResolve (turno de pick: SEM force-search)
  → prepare_order_draft (só se allowlist + sem pending_search|ambiguous bloqueando)
  → respond_to_customer
```

- [x] Fixture trajetória multi-item (nível A statuses/force) — `tests/pro/orderWorklist.trajectory.test.ts`.
- [x] Assert negativo: turno de resolve pick **não** force-search.
- [x] Assert: extract não reseeds no mesmo `sealedFromUserTextHash`.
- [ ] Métricas / reason codes no trace (flag `PRO_PIPELINE_TURN_TRACE`): searches/turno, extract incompleto, `pending_pick_abandon`, `worklist_blocks_checkout`.
- [x] **Não** propor Braintrust/Langfuse/SaaS de eval até cassetes locais + traces cobrirem N≥2 ambiguous (rule P1) — política registada.

**E2E / docs**

- [ ] Replay / smoke Ferrester: “quero A e B e C” (ambíguos) → lista completa + rodapé “ainda vou localizar” se cap de turno.
- [ ] Smoke E: critério de **latência/steps** — multi-item não estoura `maxToolRounds` / cap searches (D6) de forma sistemática.
- [x] `npm test` / `tsx --test` no pacote worklist + pending picks + trajectory verde.
- [ ] Deploy workers (`deploy-workers.ps1`) + smoke WhatsApp.
- [x] Atualizar `CHATBOT_PROD.md` / `PRO_ORDER_SLOT_MACHINE.md` com ponteiro a este ADR.
- [x] Emendar mapa documental do ADR 0005: P0.1 multi-item → reaberto estruturalmente neste ADR; ficheiro 0011 na tabela “qual ficheiro usar”.
- [x] Sync [`.cursor/rules/agente-pro-referencias-calibracao.mdc`](../../.cursor/rules/agente-pro-referencias-calibracao.mdc) se a trajetória mudar de novo.

### Fase 5 — Fechamento

- [ ] Status deste ADR → **aceito** com data de cutover.
- [ ] Entrada no mapa documental do ADR 0005 (tabela “qual ficheiro usar”).
- [ ] Remover docs/comentários que digam que `outros_produtos_pendentes` é fonte de verdade.

---

## Critérios de aceite (produto)

1. Pedido com **N≥2** produtos que precisam de embalagem: a **primeira** mensagem de clarificação lista opções de **todos** os que já foram buscados e ficaram ambíguos; nenhum some por `[]` da IA.
2. Itens ainda não buscados por cap de turno **não desaparecem** — voltam no turno seguinte (ou rodapé “ainda vou localizar”).
3. Após escolher 1 opção: ack com nome **canônico** do SKU + re-pergunta do restante (comportamento já desejado do ack parcial).
4. Checkout (Entrega/Retirada) **não** aparece enquanto houver line `pending_search`, `ambiguous` ou `awaiting_qty`.
5. Pedido single-item continua rápido (extract 1 linha ou bypass se unívoco).
5b. Search/pick unívoco sem qty → line `awaiting_qty` + pergunta de quantidade; ao receber qty → prepare/`in_draft` (decisão A).

## Critérios de aceite (calibração / eval — rule de referências)

6. Cassete A/C prova a **trajetória de tools** canónica (secção Fase 4), incluindo “no force-search no turno de pick”.
7. Worklist selada sobrevive a `outros_produtos_pendentes: []` / extract omisso no mesmo hash (servidor decide).
8. Trace (quando flag on) expõe status por line + motivo de bloqueio de checkout/search.
9. Nenhuma dependência nova de SaaS de eval é introduzida neste cutover; pirâmide local A→E basta para merge.

---

## Referência rápida de arquivos atuais a tocar

| Área | Arquivos |
|------|----------|
| Contratos | `src/types/contracts.ts` |
| AI loop | `src/pro/adapters/ai/ai.service.ts`, `tools/turnState.ts`, `tools/searchProdutos.tool.ts`, `tools/resolvePendingPicks.tool.ts` |
| Pipeline | `runProPipeline.ts`, `serverResolvePendingPicks.ts`, `pendingPickGroups.ts`, `resolveCheckoutTurnOutcome.ts`, `stages/checkoutPostProcess.ts`, `stages/aiStage.ts`, `sessionOrderContext.ts`, `orderSlotStep.ts` |
| Sessão | `adapters/supabase/session.repository.supabase.ts` |
| Mitigação a remover | `pipeline/pendingSearchTerms.ts` → `domain/orderWorklist/extractCandidateTerms.ts` (só fallback lexical) |
| Testes | `tests/pro/aiServicePendingOrderMentions.test.ts`, `pendingPickGroups.test.ts`, `serverResolvePendingPicks.test.ts`, novos `orderWorklist*.test.ts` |

---

## Pergunta de validação

Qty **(A)** já decidida. Aprova o restante do ADR (**D1–D6 + cutover Fases 0–5**) para status → **aceito** e início da implementação?
