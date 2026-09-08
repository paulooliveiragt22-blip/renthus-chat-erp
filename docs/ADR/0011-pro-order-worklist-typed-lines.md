# ADR 0011 — Agente PRO: Order Worklist tipada (linhas de pedido)

**Status:** aceito (2026-09-07) — implementação em curso  
**Data:** 2026-09-07  
**Decisão qty (Fase 0):** **(A) `awaiting_qty`** — registada 2026-09-07 (dono)  
**Aceite D1–D6 + cutover:** 2026-09-07 (dono)  
**Aceite D7 (fan-out/fan-in + coalesce prepare):** 2026-09-07 (dono)  
**Aceite D8 (clarify one-active-line):** 2026-09-08 (dono)  
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

- Tool/port `extract_order_lines` (Zod) → `{ lines: [{ raw_term, quantity }] }` cap 15.
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

- **D8 (2026-09-08, dono):** **uma** line `ambiguous` por vez (primeiro na ordem da worklist).
  Demais `ambiguous` / `pending_search` ficam persistidos; preamble “Já anotei… / Ainda falta…”.
- Índice numérico só vale para o grupo **ativo** (evita “3” cruzar produto).
- Rodapé “Ainda vou localizar: …” só para `pending_search` se ainda restar após o clarify ativo.

**Turno em que o cliente responde índice/caixa** (`serverResolvePendingPicks` handled):

- **Não** force-search **via LLM** no mesmo turno (evita misturar “1”/“3” com query de busca).
- **Sim** busca **paralela server-side** das lines `pending_search` remanescentes com `query = rawTerm` e `packagingContextText = ""` (nunca o texto do pick).
- Se a batch fechar tudo → checkout sem IA; se nascer `ambiguous` → clarify **só o primeiro** no mesmo turno; se ainda faltar → follow-up canônico.

**Primeiro turno multi-item (`order_intent`):** antes do loop de tools, mesma busca paralela (cap D6) com `packagingContextText = userText`. Se nascer `ambiguous`, **não** force-search LLM dos irmãos `pending_search` no mesmo turno (D8 — não queimar `searchAttempts`).

### D8 — Clarify one-active-line (HITL)

Smoke Ferrester (skol+jamel+whisk): batch deixava whisky `ambiguous` e queimava attempts de skol/jamel no mesmo turno → `not_found` sem clarify próprio.

| Regra | Comportamento |
|-------|----------------|
| Outbound clarify | `activeClarifyPickGroups` = 1º group alinhado (≥2 options) |
| Force-search LLM | **off** enquanto existir line `ambiguous` |
| Parallel batch | **off** se já há `ambiguous` de turnos anteriores (clarify-first); no 1º turno roda e depois respeita a regra acima |
| Resolve free-text | só contra o group **ativo** (índices 1..N da mensagem) |
| Persistência | todas as lines/`pendingPickGroups` continuam na sessão; só a UI pergunta 1 |
| Dedupe | upsert por `lineId`; não manter `whisk`+`whisky` duplicados |

Arquivo: `activeClarifyPickGroups` em `syncPendingPickGroupsFromWorklist.ts`.

### D7 — Fan-out / fan-in da busca paralela (hardening)

Decisão (2026-09-07, dono): paralelizar **só I/O idempotente**; serializar merge de estado; coalescer mutação de draft.

| Fase | O quê | Concorrência |
|------|--------|--------------|
| Preload | `BatchSearchContext`: 1× `loadCompanySiglas` (+ `AbortSignal` opcional) | 1 |
| Fan-out | N× `fetchCatalogRowsForAi` (`searchDetailed` + expand siblings + tag prefer) | ≤5 (`MAX_PARALLEL_PENDING_SEARCHES`) |
| Enrich | 1× `loadCustomerSiglaHabits` com union de `product_ids` | 1 |
| Finalize | `finalizeSearchProdutosForAi` + disambiguate (sync) | CPU |
| Fold | `applySearchResultToLine` na **ordem das lines** da worklist (não ordem de chegada) | serial |
| Coalesce | **1×** `prepare_order_draft` com todos os hits únicos+qty (`coalescePrepareUniqueHits`) | 1 |

**Coalesce + draft parcial (2026-09-08):** `prep.ok` = fullOk (itens+endereço+pagamento). Unique hits no batch só têm itens → draft **parcial** com `ok:false`. Mergear `prep.draft` (como `serverResolve`); **não** exigir `prep.ok` senão reverte → queima `searchAttempts` → `not_found` (smoke: jamel UN-only + cardápio).

**Mismatch embalagem na busca (2026-09-08):** cliente pediu sigla (CX) e o hit não tem essa sigla → `PendingPickGroup.unavailableRequestedSigla` + clarify (“Não trabalhamos com caixa… Opção disponível”) mesmo com 1 option; **não** auto-prepare. Resolve: `1` / `sim` / sigla disponível.

**Worklist pós-pedido (2026-09-08):** `order_created_ok` zera `orderWorklist` + `pendingPickGroups`. `reconcileWorklistLinesWithDraft` marca `in_draft` órfão (SKU fora do carrinho) como `abandoned` — evita `worklist_orphan_in_draft` silenciar botões de pagamento após endereço.

**Label P/M/G multi-item (2026-09-08):** `matchUniqueVariantByLabel` prioriza o `query`/`rawTerm` da line; só cai no `userText` do turno se o query não fechar. Evita empate m+g quando o cliente pede “3 marmitas m … e 2 marmitas g” no mesmo texto.

**Extract / worklist cap (2026-09-08):** `MAX_WORKLIST_LINES` + Zod extract = **15** (antes 5).

**Não paralelizar:** tools LLM no mesmo step (`parallelToolCalls: false`); N prepares; force-search LLM residual; clarify humano; checkout/RPC.

**Arquivos:**

```text
src/pro/pipeline/orderWorklist/
  batchSearchContext.ts
  applySearchResultToLine.ts          # sync (sem prepare)
  coalescePrepareUniqueHits.ts        # 1 prepare N items
  searchPendingWorklistLinesParallel.ts
  applyCatalogSearchToWorklistLine.ts # tool path = apply + coalesce(1)
```

**Métricas / degradação (P1):** `searchedLineIds`, `preparedLineIds`, `prepareCallCount`, `searchFailCount`; se ≥50% fails → follow-up canônico sem burn de force-search LLM.

### D6 — Caps e anti-loop (mitiga gargalos)

| Cap | Valor sugerido | Motivo |
|-----|----------------|--------|
| Max lines na worklist | 15 | Pedidos multi-item reais; custo LLM/search mitigado por parallel cap + searchAttempts |
| Max `pendingPickGroups` / ambiguous | 3 no estado; **1** no outbound (D8) | HITL WhatsApp |
| Max options/grupo | 4 | Já existe |
| Max `searchAttempts` por line | 1–2; depois `not_found` | Evita force-search até `maxSteps` |
| Force-search com `ambiguous` aberto | **0** (D8) | Não queimar irmãos |
| Searches forçados por turno | ≤ max(3, remaining pending_search) mas ≤ `maxToolRounds` | Latência |
| Parallel catalog fan-out | ≤5 (`MAX_PARALLEL_PENDING_SEARCHES`) | Pooler + latência turno |
| Prepare pós-batch | **1** call coalescida (N items) | Evita N× prepare serial |

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
| Extract a mais (alucinação) | Filtrar termos ∉ `userText`; cap 15 |
| Extract a menos (cap antigo 5) | Cap 15 + reseeds em mensagem nova / “Adicionar produtos” |
| Concorrência search vs clarify “1” | D5: sem force-search **LLM** no turno de pick; batch server usa `rawTerm` |
| Dual clarify (`lastSearchPicks` vs groups) | D3: um caminho só |
| `MAX_GROUPS=3` vs cap lines=15 | Ambiguous laterais esperam; D8 pergunta 1 por vez |

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

- Clarificação **HITL**: uma line `ambiguous` por mensagem (D8); demais ficam no estado.
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

- [x] Testes: multi-item todos ambiguous → N groups no estado; outbound **1** ativo (D8). (`orderWorklist.test.ts` + trajectory)
- [x] Testes: IA manda `[]` / omite extract ruim → worklist selada não zera; ou re-extract só com novo hash.
- [x] Testes: resolve 1 de N → resto ambiguous; sem force-search no mesmo turno.
- [x] Testes: carryover `pending_search` no turno seguinte após pick.
- [x] Testes: `not_found` após attempts; não trava até maxSteps eterno.
- [x] Testes: gate checkout — bloqueio com line `pending_search` \| `ambiguous` \| `awaiting_qty`.
- [x] D7: busca paralela fan-out/fan-in + pós-pick batch (`searchPendingWorklistLinesParallel`).
- [x] D7 P0: preload siglas 1× + habits coalescidos + `coalescePrepareUniqueHits`.
- [x] D8: `activeClarifyPickGroups` + force-search off com `ambiguous` + dedupe `lineId`.

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
- [x] Métricas / reason codes no trace (flag `PRO_PIPELINE_TURN_TRACE`): coluna `worklist_summary` (`byStatus`, `blocksCheckout`, `reasons`, terms); `searchAttemptsTotal` como proxy.- [x] **Não** propor Braintrust/Langfuse/SaaS de eval até cassetes locais + traces cobrirem N≥2 ambiguous (rule P1) — política registada.

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
