# Plano: seleção de provider de IA por empresa (Claude ↔ GPT-5 mini)

Documento de execução. Decisão de produto já tomada: **coexistência** — cada empresa escolhe
`anthropic` (Claude Haiku 4.5) ou `openai` (GPT-5 mini); default global continua Anthropic.
Não é migração total (Plano B foi descartado nesta rodada).

**Origem da decisão:** chat "Comparação e migração de IA no agente delivery" (2026-08-09).
Não reabra a discussão "por que duas IAs, por que GPT-5 mini e não gpt-4o-mini" — já decidido lá.
Se precisar do raciocínio completo (custo/pedido, benchmarks de tool-calling, contras de cada
opção), está no histórico daquele chat, não repita aqui.

> **Status:** 🔄 Fases 0-8 concluídas (✅) — feature já **ligada de verdade** (atrás de allowlist
> de piloto). Próximas: Fase 9 (observabilidade) e Fase 10 (docs/smoke final).

---

## 0. Regras de execução (leia antes de cada sessão)

1. **Uma fase por vez, até `npm test` verde.** Não abra a fase N+1 com a fase N em `🔄`.
2. **Cada fase lista um conjunto fechado de arquivos.** Se durante a implementação você sentir
   necessidade de tocar um arquivo fora da lista da fase atual, pare e registre por quê antes de
   continuar (evita escopo subindo por inércia / alucinação de "já que estou aqui...").
3. **Fases 0–4 não mudam comportamento em produção** (só tipos, tabela de preço, leitura de campo
   que ainda não é escrito por ninguém). Isso é proposital: dá pra mergear/testar sem risco antes
   de qualquer coisa ficar "viva". Só a partir da Fase 5 o comportamento realmente muda.
4. **Migrations:** aplicar no remoto no mesmo commit (regra `supabase-migrations.mdc`), sempre via
   MCP `user-supabase` ou `npx supabase db push --linked --yes`.
5. **Ao retomar sessão perdida:** leia a Seção 5 (contexto de retomada) antes de mexer em código.

---

## 1. Inventário — arquivos por fase (visão geral)

| Fase | Arquivos tocados | Muda comportamento? |
|---|---|---|
| 0 | 1 migration nova + `lib/billing/llmPricing.ts` | Não |
| 1 | `src/types/contracts.ts` | Não |
| 2 | `src/pro/adapters/ai/modelProvider.ts` + `tests/pro/modelProvider.test.ts` | Não (função nova aditiva) |
| 3 | `lib/chatbot/aiCapabilityProfile.ts` | Não (campo lido mas ninguém escreve `llm_provider` ainda) |
| 4 | `lib/chatbot/runProInbound.ts`, `src/pro/pipeline/context.ts` | Não |
| 5 | `src/pro/adapters/ai/ai.service.ts`, `src/pro/pipeline/deps.factory.ts`, `src/pro/services/intent/intentClassifier.service.ts` | **Sim** (mas equivalente ao atual enquanto ninguém tem override) |
| 6 | `src/pro/adapters/ai/ai.service.ts` (mesmo arquivo, trecho diferente) | **Sim** |
| 7 | `lib/chatbot/anthropicInFlightGate.ts` (+ novo gate OpenAI), `lib/chatbot/anthropicResilience.ts` → `llmResilience.ts` (circuit breaker religado por provider), `src/pro/adapters/ai/ai.service.ts`, `src/pro/pipeline/runProPipeline.ts` (comentário), `docs/CHATBOT_PROD.md` | **Sim** |
| 8 | `app/api/admin/company-settings/route.ts`, `app/(admin)/configuracoes/page.tsx` (reaproveita + remove select morto "Modelo de IA" de `bots.config.model`) | **Sim — aqui a feature fica ligada de verdade** |
| 9 | `src/pro/adapters/metrics/metrics.console.ts`, `metrics.supabase.ts`, `src/pro/pipeline/runProPipeline.ts`, `app/superadmin/page.tsx`, `lib/superadmin/actions.ts` | Não (só observabilidade) |
| 10 | `docs/CHATBOT_PROD.md`, `docs/SMOKE_AGENT_LOOP_WHATSAPP.md` (execução manual) | Não |

---

## 2. Fases

### Fase 0 — Fundação de dados: preço do GPT-5 mini + coluna (sem lógica)

**Objetivo:** ter o preço certo cadastrado e a coluna existindo no banco antes de qualquer código
depender dela. Zero risco — nada lê essa coluna ainda.

- [x] Migration nova (`supabase/migrations/20260809140000_company_settings_llm_provider.sql`):
  `llm_provider TEXT CHECK (... IN ('anthropic','openai'))` em `company_settings`. RLS existente
  reaproveitada (sem policy nova).
- [x] Aplicada no remoto — `db push --linked` bateu em `LegacyDbPushMissingLocalError` (histórico
  remoto divergente, esperado por `supabase-migrations.mdc`); aplicado via
  `supabase db query --linked -f <arquivo>` e confirmado via `information_schema.columns`
  (coluna `llm_provider text NULL` presente em `company_settings`).
- [x] `lib/billing/llmPricing.ts`: `gpt-5-mini` e `gpt-5-mini-2025-08-07` em `LLM_RATES`
  (`0.25`/`2` USD por 1M) + heurística `includes("gpt-5-mini")` antes do fallback caro.
- [x] `tests/billing/llmPricing.test.ts` (já existia): caso novo cobrindo exato, snapshot e
  variação não catalogada de `gpt-5-mini`.
- **Critério de pronto:** ✅ migration aplicada e confirmada; `npm test` verde (709 testes, 0 fail).
- **Não tocado:** nenhum arquivo de runtime do agente.

---

### Fase 1 — Tipos (`contracts.ts`) — puro contrato, zero lógica

**Objetivo:** os campos existem no tipo, ninguém ainda os lê/escreve de verdade.

- [ ] `src/types/contracts.ts`, dentro de `ProPipelineInput.aiCapability` (~linha 326-334):
  adicionar `provider: "anthropic" | "openai";`.
- [ ] `src/types/contracts.ts`, dentro de `PipelinePolicies` (~linha 364-377): adicionar
  `aiProvider?: "anthropic" | "openai"; aiModel?: string;`.
- **Critério de pronto:** `tsc`/`npm test` compila sem erro (nada quebra porque os campos são
  novos e opcionais/adicionados só em um lugar que ninguém preenche ainda — exceto
  `aiCapability.provider`, que é obrigatório no tipo mas ainda não é passado por
  `runProInbound.ts`; **por isso a Fase 1 sozinha vai quebrar o build** — rode-a **junto** com a
  Fase 4 no mesmo commit, ou marque o campo como opcional (`provider?:`) nesta fase e torne
  obrigatório só depois que a Fase 4 preencher todo caminho. Recomendo opcional agora,
  obrigatório na Fase 4.
- **Não tocar:** nenhuma lógica, nenhum `.ts` fora de `contracts.ts`.

---

### Fase 2 — `modelProvider.ts`: aceitar provider explícito (função aditiva)

**Objetivo:** dar ao `resolveLanguageModel` uma forma de resolver "provider X, modelo Y" sem
depender do env global — mas sem quebrar as 4 chamadas existentes que já usam a assinatura antiga.

- [ ] `src/pro/adapters/ai/modelProvider.ts`:
  - Exportar `DEFAULT_ANTHROPIC_MODEL`/`DEFAULT_OPENAI_MODEL` (hoje privados) — evita duplicar
    o literal `"claude-haiku-4-5-20251001"`/`"gpt-4o-mini"` em `aiCapabilityProfile.ts` (que hoje
    duplica esse hardcode — inconsistência latente já mapeada).
  - Trocar `DEFAULT_OPENAI_MODEL = "gpt-4o-mini"` → `"gpt-5-mini"`.
  - Nova assinatura retrocompatível:
    `resolveLanguageModel(modelOverrideOrOpts?: string | { provider?: LlmProviderName; model?: string })`
    — se receber string, comportamento idêntico ao atual (compat com os 4 call-sites existentes
    sem tocá-los ainda); se receber objeto com `provider`, usa esse provider em vez de
    `getConfiguredLlmProviderName()`.
- [ ] `tests/pro/modelProvider.test.ts`: casos novos — override de provider explícito ignora env;
  sem override usa env; `DEFAULT_OPENAI_MODEL` é `gpt-5-mini`.
- **Critério de pronto:** `npm test` verde; nenhum call-site existente (`ai.service.ts`,
  `intentClassifier.service.ts`, `sessionMemory.llm.ts`, `structuredOrderExtract.ts`) muda de
  comportamento (todos ainda chamam a forma antiga).
- **Não tocar:** os 4 call-sites — isso é Fase 5.

---

### Fase 3 — `aiCapabilityProfile.ts`: ler override da empresa

**Objetivo:** `resolveAiCapabilityProfile` passa a saber o provider real da empresa — mas o valor
ainda não sai deste arquivo (ninguém consome `profile.provider` de verdade ainda).

**Decisão de latência (achado ao revisar `runProInbound.ts`):** essa função já faz 2 queries
sequenciais internamente (`getActiveSubscription` → `canUseAi`). Ela **não** deve buscar
`company_settings` sozinha (seria uma 3ª query sequencial em toda mensagem de WhatsApp). Em vez
disso, quem busca `company_settings.llm_provider` é o **chamador** (`runProInbound.ts`, em paralelo
com a query de `chatbots` que já existe lá — `Promise.all`), igual já acontece com `botConfig` hoje
(também buscado pelo chamador e passado como parâmetro). `aiCapabilityProfile.ts` só recebe o valor
pronto, sem fazer I/O novo.

- [ ] `lib/chatbot/aiCapabilityProfile.ts`:
  - `configuredProvider()` ganha parâmetro opcional `companyOverride?: string | null` — se for
    `"anthropic"`/`"openai"` válido, usa; senão cai no env global (comportamento atual).
  - Usar `DEFAULT_ANTHROPIC_MODEL`/`DEFAULT_OPENAI_MODEL` de `modelProvider.ts` (Fase 2) em vez
    dos literais duplicados.
  - `resolveAiCapabilityProfile` ganha 4º parâmetro opcional `companyLlmProvider?: string | null`
    (**sem query própria** — ver decisão de latência acima) e repassa pra `configuredProvider()`.
- [ ] Teste (criar `tests/chatbot/aiCapabilityProfile.test.ts` se não existir): sem override usa
  env; com `companyLlmProvider="openai"`, `profile.provider === "openai"`; valor inválido (defesa)
  cai no env.
- **Critério de pronto:** `npm test` verde. Comportamento em produção **idêntico ao atual**
  porque nenhuma empresa tem a coluna preenchida ainda (Fase 8 é quem expõe escrita).
- **Não tocar:** `runProInbound.ts`/`contracts.ts` (isso é Fase 4) — aqui é só a função resolver
  certo, ainda isolada.

---

### Fase 4 — Fechar o fio até o pipeline

**Objetivo:** o `provider` resolvido na Fase 3 finalmente sai de `aiCapabilityProfile.ts` e chega
em `PipelineContext.policies` — mas ainda sem nenhum consumidor real (Fase 5).

- [ ] `lib/chatbot/runProInbound.ts` (~linha 47-61): trocar o `await` isolado da query de
  `chatbots` por `Promise.all` incluindo a nova query de `company_settings` (`select llm_provider
  eq company_id`), **em paralelo**, sem virar 2 round-trips sequenciais. Passar o
  `llm_provider` lido como `companyLlmProvider` pra `resolveAiCapabilityProfile` (Fase 3).
- [ ] `lib/chatbot/runProInbound.ts` (~linha 93-101): incluir `provider: aiCapability.provider`
  no objeto `aiCapability` passado a `runProPipeline`.
- [ ] `src/pro/pipeline/context.ts`, função `policiesFromAiCapability` (~linha 44-62): copiar
  `capability.provider` → `aiProvider` e `capability.model` → `aiModel` no retorno.
- [x] ~~Se a Fase 1 deixou `aiCapability.provider` opcional: torná-lo obrigatório agora~~ —
  **desviado na execução**: `src/pro/replay/runThreadReplay.ts` e 2 arquivos de teste também
  constroem esse objeto sem `provider`, fora do escopo desta fase; mantido opcional (fallback pro
  env global já é seguro). Registrado aqui pra não reabrir sem motivo.
- [ ] Teste: `tests/pro/` — caso de `policiesFromAiCapability` garantindo que `aiProvider`/`aiModel`
  propagam (criar teste se `context.ts` não tiver um arquivo de teste dedicado).
- **Critério de pronto:** `npm test` verde. `PipelineContext.policies.aiProvider` reflete a
  empresa; ainda não é lido por `ai.service.ts`/`intentClassifier`/`sessionMemory` (Fase 5).

---

### Fase 5 — Consumir nos 3 call-sites de LLM (aqui o comportamento passa a poder mudar)

**Objetivo:** os 3 lugares que hoje chamam `resolveLanguageModel()` "surdos" passam a usar o
provider/modelo da empresa. Ainda sem risco de produção real porque nenhuma empresa tem override
configurado (Fase 8 não rodou) — mas é a fase que efetivamente conecta o circuito.

- [x] `src/pro/adapters/ai/ai.service.ts`: `AiServiceOptions.providerOverride`/`modelNameOverride`;
  construtor guarda os dois; `run()` usa `hasLlmApiKey(this.providerOverride)`,
  `resolveLanguageModel({ provider, model })`, `this.providerOverride ?? getConfiguredLlmProviderName()`.
- [x] `src/pro/pipeline/deps.factory.ts`: `MakeProPipelineDependenciesOptions.aiCapability?`;
  passa `providerOverride`/`modelNameOverride` pro `AiServiceAdapter`. **Desvio da execução**:
  `LlmSessionMemoryAdapter` **não** resolve o modelo eager no construtor (achado durante a
  implementação: isso arriscaria `LlmProviderConfigError` síncrono em toda mensagem de WhatsApp,
  mesmo nas que nunca acionam compactação de histórico) — ganhou 4º/5º parâmetro
  `providerOverride?`/`modelNameOverride?` e resolve preguiçosamente dentro de `compactIfNeeded`
  (já protegido por try/catch com fallback extrativo, comportamento seguro preservado).
- [x] `lib/chatbot/runProInbound.ts`: passa `aiCapability: { provider, model }` pra
  `makeProPipelineDependencies`.
- [x] `src/pro/services/intent/intentClassifier.service.ts`, `llmClassify`: usa
  `context.policies.aiProvider`/`aiModel` em `resolveLanguageModel`/`hasLlmApiKey`; billing usa
  `context.policies.aiProvider ?? getConfiguredLlmProviderName()`.
- [x] Testes de retrocompat confirmados verdes sem alteração de asserts.
- [x] Teste novo (`tests/pro/aiServiceProviderOverride.test.ts`): guarda de API key e
  `providerOptions` usam `providerOverride`, não o env — 4 casos (2 por Fase 5, 2 por Fase 6).
- **Critério de pronto:** ✅ `npm test` verde (731 testes, 0 fail).

---

### Fase 6 — `providerOptions` dual (o fix do bug real de parallel tool call)

**Objetivo:** parar de expor o cliente ao bug documentado (`respond_to_customer` em paralelo com
tool de negócio) quando o provider resolvido for OpenAI.

- [x] `src/pro/adapters/ai/ai.service.ts` `providerOptions` dual implementado (Anthropic
  `disableParallelToolUse`; OpenAI `parallelToolCalls: false` + `reasoningEffort: "minimal"` +
  `textVerbosity: "low"`, tipado com `OpenAILanguageModelResponsesOptions` de `@ai-sdk/openai`).
- [x] Teste novo em `tests/pro/aiServiceProviderOverride.test.ts` (mesmo arquivo da Fase 5):
  confirma `parallelToolCalls:false` sem `anthropic` quando `provider="openai"`, e
  `disableParallelToolUse:true` sem `openai` quando `provider="anthropic"` (via
  `model.doGenerateCalls.at(-1).providerOptions`).
- **Critério de pronto:** ✅ `npm test` verde. Smoke manual real com `OPENAI_API_KEY` de produção
  ainda pendente (fica pra depois da Fase 8, quando houver empresa piloto de fato em openai).

---

### Fase 7 — Resiliência: gate por provider + circuit breaker religado por provider

**Objetivo:** parar de compartilhar um único semáforo de concorrência entre os dois providers, e
religar o circuit breaker (hoje código morto) com estado **isolado por provider** — decisão
confirmada com o dono: Opção B (ver Seção 5).

- [x] `lib/chatbot/anthropicInFlightGate.ts`: generalizado com `createInFlightGate(envVarName,
  defaultCap)`; `runWithAnthropicInFlightSlot` e novo `runWithOpenAiInFlightSlot`
  (`OPENAI_CHATBOT_MAX_IN_FLIGHT`, cap 8) como instâncias.
- [x] `lib/chatbot/anthropicResilience.ts` → `lib/chatbot/llmResilience.ts` (arquivo antigo
  deletado, não só renomeado). Estado por provider (`Record<LlmProviderName, CircuitState>`).
  Exports: `isLlmRateLimitError`, `getCircuitOpenRemainingMs(provider)`,
  `resetCircuitForTests(provider?)`, `runLlmWithResilience(provider, fn, opts?)` — envolve o gate
  in-flight certo internamente; circuito aberto barra antes do gate.
- [x] Novo env `OPENAI_CIRCUIT_OPEN_MS` (default 30_000).
- [x] `src/pro/adapters/ai/ai.service.ts`: `runWithAnthropicInFlightSlot(...)` →
  `runLlmWithResilience(provider, ...)`, com `provider` já resolvido pela Fase 5. Erro de circuito
  aberto mantém `status: 429` → `AI_RATE_LIMIT` → `QueueRetryableError`, `runProPipeline.ts`
  inalterado além do comentário.
- [x] `src/pro/pipeline/runProPipeline.ts` (~linha 958-961): comentário corrigido.
- [x] `docs/CHATBOT_PROD.md`: seção "Concorrência na IA" + tabela de env atualizadas (2 gates + 2
  circuitos independentes documentados).
- [x] `tests/chatbot/anthropicResilience.test.ts` deletado → `tests/chatbot/llmResilience.test.ts`
  criado: casos parametrizados pelos dois providers + teste de isolamento (circuito Anthropic
  aberto não afeta chamada OpenAI concorrente, nem consome sua vaga do gate).
- [x] `tests/chatbot/inFlightGate.test.ts` (novo): cap respeitado + 2 gates independentes não
  compartilham contador.
- **Desvio da execução (registrado, não é bloqueio):** o item "emitir evento de métrica via
  `MetricsPort` no circuit open/close" foi **adiado pra Fase 9** — `AiServiceAdapter` não recebe
  `MetricsPort` hoje (só `catalog`/`orderDraft`/`sessionMemory`), injetar isso agora expandiria o
  escopo de arquivos desta fase. Manteve-se `console.warn` estruturado com tag de provider
  (`[llm:${provider}] circuit open`) — suficiente pra grep manual até a Fase 9 cobrir observabilidade.
- **Critério de pronto:** ✅ `npm test` verde (731 testes, 0 fail); doc corrigida no mesmo commit;
  teste de isolamento entre providers passando pro gate e pro circuit breaker.

---

### Fase 8 — `company_settings`: escrita real + UI + permissão correta

**Objetivo:** aqui a feature fica **ligada de verdade** — é a única fase que expõe escolha pro
cliente final. Rodar só depois de 0-7 verdes.

**Achado a tratar aqui (autocrítica desta sessão):** já existe um seletor **"Modelo de IA"** na aba
Chatbot de `app/(admin)/configuracoes/page.tsx` (~linha 2126, opções
`claude-haiku-4-5-20251001`/`claude-sonnet-4-6`), salvo em `chatbots.config.model` via
`PATCH /api/chatbot/config`. Hoje é **código morto** — `aiCapabilityProfile.ts` nunca lê
`botConfig.model`. Não dá pra deixar duas UIs de "qual IA" (uma real em `company_settings`, essa
morta em `bots.config`) — confunde o cliente. Resolver **nesta fase**, não depois:

- [x] `app/api/admin/company-settings/route.ts`: `llm_provider` no `select` do GET (+ campo novo
  `openaiProviderAllowed`) e no `PATCH`, com gate de permissão (owner/admin) e allowlist de piloto
  extraídos em `validateLlmProviderPatch`/`isCompanyAllowedOpenAiProvider` (mantém complexidade
  cognitiva da rota dentro do lint).
- [x] `app/(admin)/configuracoes/page.tsx`, aba Chatbot: select antigo "Modelo de IA" (dead code
  confirmado, `bots.config.model`) **removido por completo** (estado `chatbotModel` deletado, campo
  parou de ser enviado em `saveChatbot`); reaproveitada a mesma posição/estilo com label "Motor de
  IA", 2 opções (`anthropic` sempre visível; `openai` só se `openaiProviderAllowed || llmProvider
  === "openai"`), texto curto de trade-off. `saveChatbot()` agora dispara `PATCH
  /api/chatbot/config` e `PATCH /api/admin/company-settings` em paralelo (`Promise.all`), erro de
  qualquer um dos dois aparece na mesma mensagem — 1 clique, 1 botão, como antes.
- [x] **Rollout — decidido na execução (sem usar `plan_features`):** `plan_features` é por **tier
  comercial** (essencial/pro/market), não por empresa específica — não encaixa pra "só estas N
  empresas do piloto". Em vez disso: allowlist simples via env
  `OPENAI_PROVIDER_PILOT_COMPANY_IDS` (CSV de `company_id`), checada no servidor (rota
  `company-settings`, PATCH rejeita `llm_provider="openai"` se a empresa não estiver na lista;
  `anthropic` sempre permitido — é o comportamento atual, zero risco novo). UI: opção "GPT-5 mini"
  some do select se a empresa não estiver na allowlist (função pura, testável, sem round-trip
  novo — a checagem de "está na allowlist" acontece no GET que já roda). Reversível: remover o
  check é 1 linha quando não precisar mais gatear.
- [x] Teste (`tests/admin/companySettingsLlmProvider.test.ts`): staff recebe 403 em `llm_provider`
  mas continua podendo alterar outros campos; owner seta `anthropic` sempre; admin fora da
  allowlist recebe 403 em `openai`; admin dentro da allowlist consegue; valor inválido → 400; GET
  devolve `llm_provider` + `openaiProviderAllowed`.
- **Critério de pronto:** ✅ `npm test` verde (738 testes, 0 fail). **Pendente (manual, fora do
  `npm test`):** smoke com `docs/SMOKE_AGENT_LOOP_WHATSAPP.md` numa empresa piloto real depois de
  configurar `OPENAI_PROVIDER_PILOT_COMPANY_IDS` + `OPENAI_API_KEY` em produção; confirmação visual
  de que só existe 1 seletor de IA na aba Chatbot.

---

### Fase 9 — Observabilidade (tag `provider`)

**Objetivo:** conseguir comparar qualidade/custo Claude×GPT por empresa no Super Admin, não só via
grep de log.

- [ ] `src/pro/pipeline/runProPipeline.ts`: incluir `provider` nas `tags` enviadas ao `MetricsPort`
  (mesmo padrão de `companyId`/`threadId` já presente).
- [ ] `src/pro/adapters/metrics/metrics.supabase.ts` / migration de
  `pro_pipeline_metric_events` (se `tags` for coluna jsonb já genérica, não precisa migration —
  confirmar antes de assumir).
- [ ] `lib/superadmin/actions.ts` (`getProPipelineHealthStats`) + `app/superadmin/page.tsx`:
  segmentar o card "Métricas PRO pipeline" por `provider`.
- [ ] **Pendência trazida da Fase 7**: emitir evento de métrica (`circuit_open`/`circuit_close`,
  tag `provider`) quando `lib/chatbot/llmResilience.ts` abrir/fechar o circuito. Como
  `AiServiceAdapter` não recebe `MetricsPort` hoje, decidir: (a) injetar `MetricsPort` opcional no
  construtor só pra esse evento, ou (b) `llmResilience.ts` expor um callback/emitter simples
  (`onCircuitStateChange?`) que `deps.factory.ts` conecta ao `MetricsPort` já disponível ali — (b)
  evita acoplar `lib/chatbot` a `src/pro/ports`. Até então, só `console.warn` estruturado.
- **Critério de pronto:** `npm test` verde; card do Super Admin mostra split quando há dado de
  ambos os providers (validar com a empresa piloto da Fase 8).

---

### Fase 10 — Docs finais + smoke

- [ ] `docs/CHATBOT_PROD.md`: tabela de env ganha `OPENAI_CHATBOT_MAX_IN_FLIGHT`; seção do motor
  de IA menciona seleção por empresa; remover qualquer menção residual ao circuit breaker morto
  (se Fase 7 escolheu deletá-lo).
  - `LLM_MODEL` (default do provider) - atualizar exemplo de `gpt-4o-mini` para `gpt-5-mini`.
- [ ] `docs/SMOKE_AGENT_LOOP_WHATSAPP.md`: rodar checklist completo em 1 empresa Anthropic + 1
  empresa OpenAI antes de considerar a feature pronta pra mais que o piloto.
- [ ] Marcar este documento como `✅ concluído` no topo.

---

## 3. O que fica fora de escopo aqui (não abrir sem métrica/pedido novo)

- BYOK (empresa trazer a própria API key) — precisaria de `lib/security/credentialCrypto.ts` pra
  guardar a chave; não foi pedido.
- Coordenação de concorrência entre réplicas (Redis/semáforo global) — continua exigindo métrica
  de multi-réplica antes de justificar, igual já registrado em `CHATBOT_PROD.md`.
- Terceiro provider (Gemini etc.) — a estrutura das Fases 1-5 já suporta adicionar sem redesenho,
  mas não é escopo desta entrega.
- Troca de provider no meio de uma conversa em andamento — aplicar override só em conversas novas
  é o comportamento natural (perfil é resolvido 1x por mensagem, no início do `runProInbound`),
  não precisa de tratamento especial adicional.

---

## 4. Riscos aceitos (registrados, não bloqueiam)

- Cap inicial de `OPENAI_CHATBOT_MAX_IN_FLIGHT` (Fase 7) é um chute (8, igual Anthropic) — sem
  dado real de rate limit da conta OpenAI usada. Calibrar depois do piloto.
- Reasoning effort `"minimal"` (Fase 6) é uma escolha inicial pra latência — se qualidade cair
  demais no piloto, subir pra `"low"` é 1 linha, não replanejamento.

---

## 5. Contexto para retomada rápida (se a sessão cair)

1. Leia este arquivo, Seção 2, ache a última fase marcada `🔄` ou a primeira `⬜`.
2. `git log --oneline -20` — cada fase = 1+ commits.
3. Achado que motivou este plano (não redebater): `resolveLanguageModel()`/`getConfiguredLlmProviderName()`
   eram chamados sem nenhum override em `ai.service.ts`, `intentClassifier.service.ts`,
   `sessionMemory.llm.ts` — `aiCapabilityProfile.ts` calculava `provider`/`model` por empresa mas o
   valor morria em `runProInbound.ts` (só `model` seguia adiante, `provider` nunca). Fases 1-5
   existem pra fechar exatamente esse fio.
4. Decisão já confirmada com o dono (não reabrir): religar o circuit breaker morto
   (`runAnthropicWithResilience` → `runLlmWithResilience`), agora com estado **isolado por
   provider** (Opção B). Motivo: a Fase 7 já mexe no mesmo ponto (gate in-flight por provider),
   custo marginal de fazer os dois juntos é baixo. Desenho está detalhado na própria Fase 7.
5. Modelo OpenAI escolhido: **GPT-5 mini** (`gpt-5-mini`), não `gpt-4o-mini` — decisão por
   tool-calling mais confiável a um custo ainda bem abaixo do Haiku. Não reabrir sem benchmark novo.
6. Decisão já confirmada com o dono (não reabrir): fonte de verdade do provider é
   `company_settings.llm_provider` (não `bots.config`), apesar de já existir um seletor "Modelo de
   IA" morto em `bots.config.model` (achado nesta sessão, ao revisar a aba Chatbot de
   `configuracoes/page.tsx`). Consequências já refletidas nas Fases 3/4/8: (a) `company_settings`
   é buscado em paralelo (`Promise.all`) com a query de `chatbots` em `runProInbound.ts`, nunca
   como query sequencial nova; (b) o select morto de `bots.config.model` é **removido/reaproveitado**
   na Fase 8, não deixado ao lado do novo — não pode existir 2 seletores de IA na mesma tela.
