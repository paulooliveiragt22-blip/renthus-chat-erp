# Plano: migração do agente PRO para Vercel AI SDK (corte total, sem dual-path)

Documento de execução. Premissa do dono: **app sem usuários reais em produção**. Nenhuma fase deste plano mantém implementação antiga "por segurança" — cada fase que introduz o novo caminho **apaga** o caminho antigo equivalente no mesmo commit. Não existe flag `AI_SERVICE_IMPL`, não existe `ai.service.full.ts` convivendo com `ai.service.ts`.

**Decisão de arquitetura (não reabrir sem motivo novo):** ver a análise completa no chat de 2026-08-07 (resumo abaixo). Se precisar da justificativa completa de por que Vercel AI SDK e não LangGraph, ou por que não manter `LlmPort`, está lá — não repita a discussão, só execute.

> **Status:** 🔄 em andamento — Fases 0–6 concluídas (2026-08-07/08). Próxima: Fase 7 (substituir `recording.llm.ts` por `replayRecorder.ts`). Atualize o cabeçalho de cada fase (⬜ → 🔄 → ✅) conforme avança. Se parar no meio de uma fase, deixe uma linha "Retomar em: ..." no topo da fase antes de encerrar a sessão.

---

## 0. Regras de execução (leia antes de cada sessão)

1. **Uma fase por vez, até `npm test` verde.** Não abra a fase N+1 com a fase N em `🔄`.
2. **Delete no mesmo commit que substitui.** Se a fase cria o arquivo novo que substitui um antigo, o antigo é deletado no mesmo commit — não em fase separada "de limpeza".
3. **Antes de deletar qualquer arquivo de `src/pro/adapters/llm/` ou `src/pro/ports/llm.port.ts`: rode a busca de referências** (comando na fase correspondente) e confirme zero resultado fora do próprio arquivo. Só então delete.
4. **Toda fase termina com `npm test` e, se tocar o loop de IA, um smoke test manual** seguindo `docs/SMOKE_AGENT_LOOP_WHATSAPP.md`.
5. **Verifique versão exata do pacote no npm antes de instalar** (`npm view ai versions`, `npm view @ai-sdk/anthropic versions` — em 2026-08-07 o provider Anthropic ainda usa tag `@beta` sobre `ai@6.0.0`). Não assuma a versão deste documento como definitiva.
6. **Migrations de banco:** esta migração é só código de aplicação — nenhuma fase aqui deveria tocar `supabase/migrations/`. Se alguma fase parecer exigir schema novo, pare e reavalie antes de aplicar (regra `supabase-migrations.mdc` continua valendo).

---

## 1. Referência de API validada (Vercel AI SDK v6, via Context7 em 2026-08-07)

Não reinvente a sintaxe — use exatamente este padrão:

```typescript
import { generateText, tool, stepCountIs, hasToolCall } from "ai";
import { z } from "zod";

const result = await generateText({
    model, // LanguageModel do @ai-sdk/anthropic ou @ai-sdk/openai
    system: buildEffectiveSystemPrompt(input),
    messages,
    tools: {
        search_produtos: tool({
            description: "...",
            inputSchema: z.object({ query: z.string(), category_hint: z.string().optional() }),
            execute: async (input) => { /* ... */ },
        }),
        get_order_hints: tool({ /* ... */ }),
        prepare_order_draft: tool({ /* ... */ }),
        respond_to_customer: tool({
            description: "Tool final obrigatória: use para enviar a resposta ao cliente.",
            inputSchema: z.object({
                reply_text: z.string(),
                address_free_text: z.boolean().default(false),
            }),
            execute: async (a) => a,
        }),
    },
    // para quando o modelo chamar respond_to_customer OU atingir 12 rodadas
    stopWhen: [hasToolCall("respond_to_customer"), stepCountIs(12)],
});
```

Pontos que substituem mecanismos antigos:
- `stopWhen: [hasToolCall(...), stepCountIs(...)]` substitui o contador manual `toolRoundsUsed` de `ai.service.full.ts`.
- Tool final `respond_to_customer` com `address_free_text: boolean` substitui os marcadores de texto `INTENT_OK`/`ADDR_FREE_TEXT` e todo `stripModelIntentSuffix.ts` — não há mais string pra raspar com regex.
- `generateObject` (mesmo pacote `ai`) substitui as chamadas de `LlmPort.chat()` sem tools em `intentClassifier.service.ts` e `structuredOrderExtract.ts`.

**Correção registrada na Fase 4 (não reabrir):** em `ai@6.0.246`, `generateObject` está `@deprecated` no próprio `.d.ts` — "Use `generateText` with an `output` setting instead". O substituto real de `LlmPort.chat()` sem tools é `generateText({ model, system, prompt, output })`, com `output` vindo do namespace `Output` (`Output.object(schema)`, `Output.choice({ options })`, `Output.array(...)`); `result.output` devolve o valor já tipado (não `result.object`, que é só do `generateObject` legado). Para escolha única entre labels fixos (caso do intent classifier), `Output.choice` é mais direto que `Output.object` com schema de 1 campo — dispensa `z.object({ intent: z.enum([...]) })` e o unwrap manual. Usar este padrão também na Fase 6 (`structuredOrderExtract.ts`), ajustando para `Output.object`/`Output.array` conforme o shape esperado ali.

---

## 2. Inventário — o que é criado, o que é deletado, o que fica

| Arquivo | Ação |
|---|---|
| `src/pro/adapters/ai/ai.service.full.ts` | **DELETADO** (fase 3) |
| `src/pro/adapters/ai/stripModelIntentSuffix.ts` | **DELETADO** (fase 3) |
| `src/pro/ports/llm.port.ts` | **DELETAR** (fase 8) |
| `src/pro/adapters/llm/createLlmPort.ts` | **DELETAR** (fase 8) |
| `src/pro/adapters/llm/anthropic.llm.ts` | **DELETAR** (fase 8) |
| `src/pro/adapters/llm/openai.llm.ts` | **DELETAR** (fase 8) |
| `src/pro/adapters/llm/recording.llm.ts` | **DELETAR** (fase 7, substituído) |
| `src/pro/adapters/llm/llmText.ts` | **DELETAR se sem uso após fase 8** (checar antes) |
| `src/pro/adapters/ai/modelProvider.ts` | **CRIAR** (fase 0) |
| `src/pro/adapters/ai/tools/prepareOrderDraft.tool.ts` | **CRIADO** (fase 3) |
| `src/pro/adapters/ai/tools/searchProdutos.tool.ts` | **CRIADO** (fase 3) |
| `src/pro/adapters/ai/tools/getOrderHints.tool.ts` | **CRIADO** (fase 3) |
| `src/pro/adapters/ai/tools/turnState.ts` | **CRIADO** (fase 3, não previsto no plano original — estado de turno por closure) |
| `src/pro/adapters/ai/blockedReasonPresenter.ts` | **CRIADO** (fase 1) |
| `src/pro/adapters/ai/ai.service.ts` | **CRIADO** (fase 3, substitui `ai.service.full.ts`) |
| `src/pro/adapters/ai/replayRecorder.ts` | **CRIAR** (fase 7, substitui `recording.llm.ts`) |
| `src/pro/ports/orderDraft.port.ts` | **REDESENHAR** `PrepareOrderDraftResult` (fase 1) |
| `src/pro/tools/prepareOrderDraft.ts` | **MANTÉM** lógica de cálculo (itens/entrega); só o shape de retorno muda (fase 1) |
| `src/pro/pipeline/packagingDisambiguation.ts`, `resolveSegmentPick.ts`, `orderDraftGate.ts`, `orderSlotStep.ts`, `checkoutPostProcess.ts`, `sanitizeAiVisibleOrderClaims.ts`, `aiHistoryBudget.ts` | **NÃO TOCAR** — lógica pura, reaproveitada como está |
| `src/pro/services/intent/intentClassifier.service.ts` | **MIGRADO** para `generateText`+`Output.choice` (fase 4) |
| `src/pro/adapters/ai/sessionMemory.llm.ts` | **MIGRADO** para `generateText` (fase 5); billing corrigido (antes nunca debitava) |
| `src/pro/replay/structuredOrderExtract.ts` | **MIGRADO** para `generateText` (fase 6, sem `Output` — parser tolerante) |
| `src/pro/pipeline/deps.factory.ts` | **ATUALIZADO** wiring, sem branch de flag (fase 3) |
| `src/pro/replay/runThreadReplay.ts` | **ATUALIZADO** (fase 3): `replayLlm`/cassete removidos, `useAi?: boolean` usa `AiServiceAdapter` real sem gravação — cassete volta na fase 7 |

---

## 3. Fases

### Fase 0 — Dependências + `modelProvider.ts` ✅

**Decisão registrada (não reabrir sem motivo novo):** a tag `latest` do pacote `ai` é a **v7**, que exige Node 22+ e é **ESM-only** (`require()` não suportado) — incompatível com este repo (`package.json` tem `"type": "commonjs"`, e o harness de teste roda `tsc` + `node --test` puro, sem bundler). Por isso foram fixadas as versões da linha **v6** (dist-tag `ai-v6`, que ainda publica dual CJS/ESM via `exports.require`):

```
ai@6.0.246
@ai-sdk/anthropic@3.0.107
@ai-sdk/openai@3.0.91
```

**Vulnerabilidade encontrada e corrigida:** `@ai-sdk/provider-utils@4.0.42` empacota `undici@5.29.0`, com múltiplas advisories moderate/high (DoS por descompressão, request smuggling, injeção via Set-Cookie — GHSA-g9mf-h72j-4rw9, GHSA-2mjp-6q6p-2qxm, GHSA-vrm6-8vpv-qv8q, entre outras). Não há versão 3.x/4.x mais nova do `@ai-sdk/provider-utils` fora de beta que corrija isso sem subir para a v7. Corrigido via `overrides` no `package.json` (mesmo padrão já usado no repo para axios/lodash/etc.): `"undici": "^8.10.0"`. Após o override, `npm audit` não lista mais `ai`/`@ai-sdk/*`/`undici` entre as vulnerabilidades — as 13 restantes são pré-existentes e não relacionadas a esta migração (next, sharp, postcss, ws, form-data, js-yaml, dompurify, fast-uri, @babel/core, @anthropic-ai/sdk, axios, brace-expansion).

- [x] Confirmadas versões via `npm view`/Context7.
- [x] Instalado `ai@6.0.246`, `@ai-sdk/anthropic@3.0.107`, `@ai-sdk/openai@3.0.91` com `--save-exact`.
- [x] Override `undici@^8.10.0` no `package.json`.
- [x] Criado `src/pro/adapters/ai/modelProvider.ts`: `getConfiguredLlmProviderName()` + `resolveLanguageModel(modelOverride?)`, mesmas env vars de `createLlmPort.ts` (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — não foram inventados nomes novos.
- [x] `tests/pro/modelProvider.test.ts` — seleção de provider, erro tipado sem API key, override de modelo.
- **Critério de pronto:** `npm test` → 626 pass / 25 fail (mesmo baseline pré-existente de antes desta fase — sem regressão nova). ✅

### Fase 1 — `prepare_order_draft` como tool tipada (o fix de negócio real) ✅

**Decisão registrada:** `errors: string[]` foi **mantido** (não é dual-path) — cobre o catálogo dinâmico de mensagens por item/estoque/UUID/catálogo, que não vale enumerar em código. O que foi removido foi `next_required_slot` (string solta), substituído por `blocked: PrepareOrderDraftBlockedReason | null` (união discriminada com payload tipado: `MISSING_ITEMS`, `ADDRESS_INCOMPLETE`, `OUT_OF_DELIVERY_ZONE{neighborhood}`, `BELOW_MIN_ORDER{missing,minOrder}`, `PAYMENT_MISSING`, `INVALID_CHANGE_FOR{grandTotal,changeFor}`, `FIX_ERRORS`). Prioridade igual à anterior (items → endereço → mínimo → pagamento → **troco novo** → fix_errors).

- [x] `src/pro/ports/orderDraft.port.ts` — `PrepareOrderDraftBlockedReason` + `PrepareOrderDraftResult.blocked` (substitui `next_required_slot`).
- [x] `src/pro/tools/prepareOrderDraft.ts` — validação nova: `payment_method === "cash" && change_for != null && change_for < grandTotal` → erro + `blocked.code = "INVALID_CHANGE_FOR"` (bug real relatado pelo dono, nunca validado antes). Também separa `ADDRESS_INCOMPLETE` de `OUT_OF_DELIVERY_ZONE` (antes os dois caíam no mesmo bucket "address").
- [x] `src/pro/adapters/ai/blockedReasonPresenter.ts` — `presentBlockedReasonForModel(blocked)`, extraído das antigas branches de `nextRequiredSlot` em `buildPrepareDraftGuidanceForModel` + branch nova para troco. **Não criado ainda** `tools/prepareOrderDraft.tool.ts` (Vercel AI SDK `tool()`) — isso é Fase 3 (precisa do loop novo pra ter sentido chamar `.execute()`; chamar `prepareOrderDraftFromTool` direto já é testável sem isso, então adiado pra não criar arquivo sem consumidor).
- [x] `buildPrepareDraftGuidanceForModel` atualizado para `opts.blocked` (era `opts.nextRequiredSlot`); `ai.service.full.ts` (2 pontos) e `tests/pro/prepareDraftGuidance.test.ts` atualizados no mesmo commit.
- [x] Testes novos: `tests/pro/prepareOrderDraftBlockedReason.test.ts` (7 casos, incl. `INVALID_CHANGE_FOR`), `tests/pro/blockedReasonPresenter.test.ts` (7 casos), +1 caso em `prepareDraftGuidance.test.ts`.
- **Critério de pronto:** `npm test` → 641 pass / 25 fail (mesmo baseline pré-existente; 15 testes novos, todos verdes). ✅

**Nota para a Fase 3:** `prepareOrderDraft.tool.ts` (wrapper Vercel AI SDK) será criado ali, chamando `prepareOrderDraftFromTool` (já com o shape novo) — não precisa redesenhar nada de novo nessa hora.

### Fase 2 — `search_produtos` e `get_order_hints` extraídos para funções reusáveis ✅

**Decisão registrada:** mesmo padrão de adiamento da Fase 1 (`prepareOrderDraft.tool.ts`) — criar `tool()` já agora seria wrapper sem consumidor real (o loop novo só existe na Fase 3) e sem poder testar a mecânica de `experimental_context` de verdade. Em vez disso: extraída a lógica de orquestração que hoje vive em métodos **privados** de `FullAiServiceAdapter` (`runSearchTool`/`runHintsTool` — acopladas a `this.catalog`/`this.admin` e a mutação por referência de `allowlistRuntime`/`searchMeta`) para funções **standalone** com deps explícitas e retorno de valor (sem mutação por referência). `ai.service.full.ts` passou a delegar a elas — comportamento idêntico, agora testável isoladamente (não havia nenhum teste direto de `runSearchTool`/`runHintsTool` antes, por serem privados).

- [x] `src/pro/adapters/ai/tools/searchProdutosForAi.ts` — `runSearchProdutosForAi(input, deps)`: chama `CatalogPort.searchDetailed`, desambiguação de embalagem (`disambiguatePackagingForSearchRows`/`isSamePackagingFamily`), monta `guidance_for_model_pt`; devolve `{ body, allowlistIds, lastSearchPicks, wasEmpty }` em vez de mutar `allowlistRuntime`/`searchMeta` por referência.
- [x] `src/pro/adapters/ai/tools/orderHintsForAi.ts` — `runOrderHintsForAi(deps)`: reaproveita `prefetchedOrderHints` do turno (com guidance) ou chama `buildOrderHintsPayload`.
- [x] `ai.service.full.ts`: `runSearchTool`/`runHintsTool` (privados) agora só chamam essas funções e fazem o wrap em `ToolResultBlock` (`tool_use_id`/`JSON.stringify`); método `resolvePackagingHabitForRows` e imports agora não usados (`toChatCatalogPublicItem`, `buildOrderHintsPayload`, `disambiguatePackagingForSearchRows`, `isSamePackagingFamily`, `loadCompanySiglas`, `loadCustomerSiglaHabits`) removidos deste arquivo.
- [x] Testes novos: `tests/pro/searchProdutosForAi.test.ts` (4 casos: item único, busca vazia, ambiguidade UN/CX, did_you_mean), `tests/pro/orderHintsForAi.test.ts` (2 casos: cache do turno, fallback via banco).
- **Critério de pronto:** `npm test` → 673 pass/fail totais, mesmo baseline de 25 falhas pré-existentes (sem regressão nova); 6 testes novos, todos verdes. ✅

**Nota para a Fase 3:** `searchProdutos.tool.ts`/`getOrderHints.tool.ts` (wrappers Vercel AI SDK) serão criados ali, chamando `runSearchProdutosForAi`/`runOrderHintsForAi` — a única peça nova na Fase 3 é decidir como o `execute()` recebe/devolve o estado de turno (`allowlistIds`/`lastSearchPicks`/`emptySearchStreak`) sem os métodos privados de classe: via `experimental_context` mutável passado a `generateText`, ou lendo os `tool-result` dos `steps` depois do loop terminar (preferir a 2ª opção — menos estado mutável compartilhado entre tools).

### Fase 3 — `ai.service.ts` (loop novo) + deletar `ai.service.full.ts` ✅

**Decisões registradas (não reabrir sem motivo novo):**
- `stopWhen` real é mais rico que o exemplo da Seção 1: não basta `hasToolCall("respond_to_customer")` porque o force-prepare (`shouldForcePrepareAfterEmbalagemChoice`/`shouldForcePrepareAfterUnambiguousSearch`, portadas sem reescrever) precisa poder **rejeitar** um `respond_to_customer` prematuro e forçar mais um step de `prepare_order_draft` antes de aceitar parar. Implementado como função custom em `stopWhen: [fn, stepCountIs(maxSteps)]`, com `TurnState.forceNudgeInjected` para não repetir o nudge indefinidamente.
- Estado de turno (`allowlistIds`/`lastSearchPicks`/`emptySearchStreak`/`currentDraft`/flags) passado por **closure** (`TurnState`, `src/pro/adapters/ai/tools/turnState.ts`) para as 3 tool factories, não por `experimental_context` — cada campo tem exatamente um tool "escritor", sem risco de corrida entre tool calls paralelas na mesma step.
- `prepare_order_draft` continua no `ToolSet` mesmo em `aiOrderMode: "info_only"` (`disabled: infoOnly` na tool factory, devolve `info_only_mode` sem tocar o banco) — key opcional no objeto de tools quebra a inferência de `TypedToolCall` do AI SDK (`toolCalls` vira `... | undefined`); manter a key sempre presente evita esse buraco de tipo.
- `providerOptions: { anthropic: { disableParallelToolUse: true } }` no `generateText` (ignorado pela OpenAI): sem isso o modelo pode devolver `respond_to_customer` em paralelo com `search_produtos`/`prepare_order_draft` no mesmo step — como tool calls paralelas rodam via `Promise.all` sem verem o resultado uma da outra, a resposta ao cliente saíria sem o resultado da tool de negócio.
- Circuit breaker/retry custom de `AnthropicLlmAdapter` (`runAnthropicWithResilience`) **não foi portado** — `generateText` usa `maxRetries: 3` nativo do SDK. Trade-off deliberado (sem usuários reais ainda); reavaliar se for reintroduzir 429 handling avançado.
- Replay cassette (`ReplayLlmPort` via `runThreadReplay({ replayLlm })`) foi **descontinuado** nesta fase (dependia de `FullAiServiceAdapter`); `runThreadReplay` agora aceita `useAi?: boolean` (stub sem custo por default, `AiServiceAdapter` real quando true, sem cassete). Replanejar cassete determinístico na Fase 7 se necessário.

- [x] Criado `src/pro/adapters/ai/tools/prepareOrderDraft.tool.ts`, `searchProdutos.tool.ts`, `getOrderHints.tool.ts` (wrappers `tool()` chamando as funções extraídas nas Fases 1/2).
- [x] Criado `src/pro/adapters/ai/ai.service.ts` implementando `AiService` com `generateText` + 4 tools + `stopWhen`/`prepareStep` customizados (ver decisões acima). `buildEffectiveSystemPrompt` e todos os blocos, `SYSTEM_PROMPT`/`SYSTEM_PROMPT_INFO_ONLY`, `shouldForcePrepareAfterEmbalagemChoice`/`shouldForcePrepareAfterUnambiguousSearch` portados sem reescrever a lógica de negócio.
- [x] `respond_to_customer` (`reply_text`, `address_free_text?`, `understood?`) substitui `INTENT_OK`/`INTENT_UNKNOWN`/`ADDR_FREE_TEXT`; `address_free_text`/`understood` alimentam `AiServiceResult.signals` direto, sem strip de marcador em texto.
- [x] Billing: `onStepFinish` mapeia `usage.inputTokens`/`usage.outputTokens` (camelCase, AI SDK) → `debitFromAnthropicUsage(..., { input_tokens, output_tokens }, meta)` (snake_case), com `meta.model` de `step.response.modelId` e `meta.provider` de `getConfiguredLlmProviderName()`. Debita por **step** (não só no fim do turno), preservando o comportamento antigo de billing incremental mesmo se o loop falhar no meio.
- [x] Deletados `src/pro/adapters/ai/ai.service.full.ts` e `src/pro/adapters/ai/stripModelIntentSuffix.ts` neste commit.
- [x] `src/pro/pipeline/deps.factory.ts` atualizado: `AiServiceAdapter` direto (sem `llm`/`createLlmPort` na construção do AI service; `createLlmPort` continua só para `LlmSessionMemoryAdapter`, que migra na Fase 5).
- [x] Testes migrados: `tests/pro/forcePrepareAfterEmbalagemChoice.test.ts` (import trocado para `ai.service`); `tests/pro/stripModelIntentSuffix.test.ts` **deletado** (testava só marcadores de texto, sem equivalente — `respond_to_customer` é tipado, não precisa de teste de regex).
- **Critério de pronto:** `npm test` → 640 pass / 25 fail / 1 cancelled (mesmo baseline de 25 falhas pré-existentes das fases anteriores; total caiu de 673 para 666 só pelos 7 testes removidos de `stripModelIntentSuffix.test.ts` — sem regressão nova). ✅ Smoke test manual (`docs/SMOKE_AGENT_LOOP_WHATSAPP.md` S1–S4b) ainda pendente de execução manual pelo dono antes de considerar a fase 100% fechada em produção.

### Fase 4 — `intentClassifier.service.ts` para `generateText`/`Output.choice` ✅

**Decisão registrada:** ver correção acima (Seção 1) — usado `generateText({ output: Output.choice({ options: INTENT_LABELS }) })` em vez de `generateObject` (deprecated nesta versão). `INTENT_LABELS: readonly Intent[]` amarra o enum ao tipo `Intent` já existente em `contracts.ts`; `result.output` já vem tipado como `Intent`, sem `fromLlmLabel`/parsing de texto — a função de mapeamento foi removida (SDK garante um dos valores do enum ou lança, capturado pelo `catch` que já existia e cai em `unknown`/`fallback_unknown`, mesmo comportamento de antes). Billing preservado: antes vinha de dentro de `AnthropicLlmAdapter.chat()` (implícito, via `this.admin`); agora é explícito no próprio `llmClassify` — mesmo mapeamento camelCase→snake_case e `source: "pro_intent_classifier"` usado em `ai.service.ts`.

- [x] Trocada a chamada `createLlmPort(...).chat(...)` por `generateText({ model: resolveLanguageModel(), system, prompt, output: Output.choice(...) })`.
- [x] Removido import de `createLlmPort`/`getConfiguredLlmProvider` (LLM Port) deste arquivo; passa a usar `resolveLanguageModel`/`getConfiguredLlmProviderName` de `modelProvider.ts`. Removido também `extractLlmPlainText` (sem uso após a troca) — `hasLlmApiKey` (genérico, de `llmText.ts`) mantido como guarda de API key.
- [x] Removida a função `fromLlmLabel` (sem uso — `Output.choice` já garante o enum).
- **Critério de pronto:** `npm test` → 640 pass / 25 fail / 1 cancelled (mesmo baseline; zero falha nova, nenhuma em `intentClassifier`). ✅

### Fase 5 — `sessionMemory.llm.ts` para `generateText` ✅

**Decisões registradas:**
- `LlmSessionMemoryAdapter` trocou a dependência de `LlmPort` (injetado no construtor) por `resolveLanguageModel()` chamado a cada `compactIfNeeded` — mesmo padrão de `intentClassifier.service.ts`. Adicionado um 3º parâmetro opcional `modelOverride?: LanguageModel` como seam de teste (injeta `MockLanguageModelV3` de `ai/test`, o helper oficial do SDK para isso — sem depender de rede nem de mocks caseiros de `LlmPort`).
- **Bug pré-existente corrigido, não só portado:** a versão antiga nunca passava `companyId` para `llm.chat()`, então `AnthropicLlmAdapter` nunca debitava a carteira de IA para os resumos de sessão (`this.admin && req.companyId` era sempre falso). `LlmSessionMemoryAdapter` agora recebe `admin`/`companyId` no construtor (`deps.factory.ts` passa `params.admin`/`params.companyId`) e debita via `debitFromAnthropicUsage` com `source: "pro_session_memory_summarize"`, mesmo padrão de `ai.service.ts`/`intentClassifier.service.ts`. Registrado aqui porque é uma mudança de comportamento (billing passa a acontecer), não simples troca de tecnologia — na filosofia "radical" do plano, não fazia sentido portar um bug de billing conhecido só para não abrir escopo.
- `result.text` (SDK) substitui `extractLlmPlainText(resp.content)` — `generateText` sem tools já concatena os blocos de texto da resposta.
- `deps.factory.ts`: removida a construção de `llm = createLlmPort(params.admin)` (não tem mais nenhum consumidor de `LlmPort` neste arquivo); `LlmSessionMemoryAdapter(params.admin, params.companyId)` direto.

- [x] Trocado `LlmPort.chat()` por `generateText({ model, system, prompt, maxOutputTokens, maxRetries, abortSignal })` usando `modelProvider.ts`.
- [x] Testes (`tests/pro/sessionMemory.test.ts`) migrados de mock caseiro de `LlmPort` para `MockLanguageModelV3` (`ai/test`); +1 teste novo (fallback extrativo quando o modelo lança).
- **Critério de pronto:** `npm test` → 641 pass / 25 fail / 1 cancelled (mesmo baseline de 25 falhas pré-existentes; 667 testes totais, +1 novo verde). ✅

### Fase 6 — `structuredOrderExtract.ts` (replay) para `generateText` ✅

**Decisões registradas:**
- **Achado:** `extractOrderLinesStructured` não tinha (e continua sem ter) nenhum caller em produção nem em `scripts/replay-thread.ts` — é infraestrutura offline reservada para uma futura ferramenta de divergência LLM×regex (`.cursor/rules/agente-pro-hexagonal.mdc` proíbe explicitamente reintroduzi-la no hot path). Migrada mesmo assim (não é dead code a remover — é contrato documentado para uso futuro), só a transporte LLM mudou.
- **Não usa `Output.object`/`Output.array`** (diferente das Fases 4/5, de propósito): `parseOrderLineExtractionJson` já faz reparo tolerante de JSON solto — aceita aliases PT-BR (`itens`/`troca`/`dialogo`), cerca de markdown e nomes alternativos de campo. Validação estruturada do SDK rejeitaria essas variações em vez de tolerá-las (é exatamente o cenário oposto ao do intent classifier, onde o valor é um enum fechado). Mantido `generateText` sem `output`, texto livre + parser tolerante existente.
- Ganhou o mesmo seam de teste das Fases 5/6 (`modelOverride?: LanguageModel`, via `MockLanguageModelV3` de `ai/test`) e o mesmo padrão de billing opcional (`admin`/`companyId` → `debitFromAnthropicUsage`, `source: "pro_structured_extract"`) — consistente com todos os outros call-sites de LLM já migrados, mesmo sem caller hoje.
- `textFromLlmContent` (helper local) removido — `result.text` do `generateText` já concatena os blocos de texto.

- [x] Trocado `LlmPort.chat()` por `generateText({ model, system, prompt, maxOutputTokens, maxRetries, abortSignal })`.
- [x] Criado `tests/pro/structuredOrderExtract.test.ts` (5 casos: texto vazio não chama o modelo, JSON válido, cerca de markdown + aliases PT-BR, "pergunta sem pedido" → null, erro do provider → null) — arquivo não tinha teste próprio antes.
- **Critério de pronto:** `npm test` → 646 pass / 25 fail / 1 cancelled (mesmo baseline; 672 testes totais, +5 novos verdes). ✅ (Sem smoke de replay real — função sem caller hoje; nada a regredir em `runThreadReplay.ts`.)

### Fase 7 — Substituir `recording.llm.ts` por `replayRecorder.ts` ⬜

- [ ] Criar `src/pro/adapters/ai/replayRecorder.ts`: wrapper de `LanguageModel` (proxy/decorator) que grava request/response em cassette, com a mesma finalidade de `RecordingLlmPort`/`ReplayLlmPort`.
- [ ] Atualizar `src/pro/replay/runThreadReplay.ts` para usar o novo recorder.
- [ ] Deletar `src/pro/adapters/llm/recording.llm.ts` neste commit.
- **Critério de pronto:** `npm test` verde, replay de pelo menos 1 thread gravado funcionando ponta a ponta.

### Fase 8 — Varredura final: deletar `LlmPort` e adapters ⬜

- [ ] `grep -rn "LlmPort\|createLlmPort\|llm\.port" src/` — deve retornar **zero** resultado fora dos próprios arquivos a deletar.
- [ ] Deletar `src/pro/ports/llm.port.ts`, `src/pro/adapters/llm/createLlmPort.ts`, `anthropic.llm.ts`, `openai.llm.ts`.
- [ ] Checar `src/pro/adapters/llm/llmText.ts` — se não sobrou nenhum consumidor, deletar também; se sobrou (ex.: helper de extração de texto reaproveitado em outro contexto), documentar por quê.
- **Critério de pronto:** `npm test` verde, `npm run build`/`tsc` sem erro de import quebrado.

### Fase 9 — Docs ⬜

- [ ] Atualizar `docs/CHATBOT_PROD.md` (seção "cérebro"/agent loop) para descrever o novo `ai.service.ts` e a ausência de `LlmPort`.
- [ ] Atualizar `.cursor/rules/agente-pro-hexagonal.mdc` (ports/adapters do módulo PRO) removendo referência a `LlmPort`.
- [ ] Marcar este documento como `✅ concluído` no topo.

---

## 4. Contexto para retomada rápida (se a sessão cair)

Se você (ou outra sessão do agente) perder o contexto, leia nesta ordem:
1. Este arquivo, seção 3, para achar a última fase marcada `🔄` ou a primeira `⬜`.
2. `git log --oneline -20` para ver o que já foi commitado (cada fase = 1+ commits, nunca fase parcial sem commit).
3. Seção 2 (inventário) para confirmar se um arquivo específico já existe/já foi deletado.
4. Não repita a discussão de "por que Vercel AI SDK, por que não LangGraph, por que deletar `LlmPort`" — isso já foi decidido; só execute.
