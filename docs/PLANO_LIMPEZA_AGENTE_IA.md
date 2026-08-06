# Plano: limpeza de legado + interpretação por LLM + harness de replay

Documento de execução. Premissa do dono: **app ainda sem clientes reais em produção** — toda mudança apaga o legado em vez de manter compatibilidade.

Decisões canónicas de arquitetura ficam em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md). Este arquivo é o **plano de corte e construção**, com o estado verificado no código em 2026-08-06.

**Ordem de leitura:** estado real → bug P0 → reaproveitar → apagar → adicionar → fases.

---

## 1. Estado real (verificado no código, não nos docs)

### Dois motores inbound

`processInboundMessage` escolhe entre dois pipelines por `getChatbotProductTier`:

| Motor | Entrada | Quando |
|-------|---------|--------|
| **PRO** | `lib/chatbot/runProInbound.ts` → `src/pro/pipeline/runProPipeline.ts` | Plano ativo **e** `ai_enabled` **e** crédito de IA |
| **Starter** | `lib/chatbot/inboundPipeline.ts` | Sem plano, IA off, sem crédito, **ou erro na resolução** |

`lib/chatbot/tier.ts:32-35` — qualquer exceção cai em `starter`. Não é caminho morto: é o fallback de falha.

### A IA já interpreta intenção — em dois lugares

Ao contrário do que o enquadramento "regex vs IA" sugere, o LLM já está no fluxo:

1. **`ProIntentClassifierService`** (`src/pro/services/intent/intentClassifier.service.ts`) — regex primeiro, LLM (`maxTokens: 12`, sem tools) só no ambíguo.
2. **`FullAiServiceAdapter`** (`src/pro/adapters/ai/ai.service.full.ts`) — loop conversacional com tool calling, até 12 rodadas, 3 tools.

### O problema real é ordenação, não ausência de IA

`runProPipeline.ts` tem **dez pontos de curto-circuito antes do `aiStage`**. O bootstrap multi-item (linha ~278) responde direto ao cliente e retorna — o LLM nunca vê o turno. A interpretação nesse caminho quente é 100% regex.

Volume de interpretação determinística hoje:

| Onde | Aproximado |
|------|-----------|
| `src/pro/pipeline/` (5 arquivos core) | ~400 LOC |
| `src/pro/services/intent/intentClassifier.service.ts` | ~160 LOC |
| `lib/chatbot/middleware/intentClassifier.ts` (Starter) | duplicata do anterior |

**Três lugares adivinhando a mesma coisa.**

---

## 2. P0 — Bug vivo de handover no PRO

Independente de qualquer limpeza. Afeta **todo cliente pagante** (tier PRO é o default de quem tem plano e crédito).

### O que acontece hoje

Cliente pede atendente humano → `routeStage.ts:60-68`:

```ts
if (decision.intent === "human_intent") {
    const tr = canTransition(state.step, { type: "intent_human_handover" });
    const step = tr.ok ? tr.to : "handover";
    return {
        mode: "direct_reply",
        state: { ...state, step },
        outbound: [{ kind: "text", text: "Vou te encaminhar para um atendente humano." }],
    };
}
```

Só isso. Compare com o Starter (`lib/chatbot/handlers/handleMainMenu.ts:25-51`), que faz **três** coisas: `bot_active = false` + `handover_at = now()`, cria `support_tickets`, e responde.

### Cadeia de consequências (verificada)

1. `whatsapp_threads.bot_active` continua `true` → `incoming` e `process-queue` seguem enfileirando e processando.
2. `guardRails.ts:21-23` vê `step === "handover"` → `stop: true`, `stopReason: "handover_hold"`.
3. `runProPipeline.ts:213-228` retorna **sem** `persistAndEmit` — nenhuma resposta, nenhum save.
4. **Nenhum ticket** em `support_tickets` → ninguém é avisado que há cliente esperando.
5. O cron `/api/chatbot/reactivate` filtra `bot_active = false AND handover_at < now()-5min`. Como o PRO nunca setou esses campos, **a thread nunca é elegível**.
6. Na inbox, `WhatsAppInbox.tsx` mostra o toggle como **"Ativo"** — o operador não tem sinal visual nenhum.

**Resultado:** o cliente pede atendente, recebe "vou te encaminhar", e o bot fica **mudo por 2 horas** (`chatbot_sessions.expires_at`, default `now() + 2h`). Nesse período nada responde e ninguém é notificado. Passadas as 2h a sessão expira, `getOrCreateSession` cria uma nova em `pro_idle`, e o bot volta a falar como se nada tivesse acontecido.

O toggle manual da inbox **não resolve**: `bot-toggle/route.ts` mexe em `bot_active`/`handover_at` mas não apaga `chatbot_sessions`, então `step` continua `"handover"` e o `guardRails` segue barrando.

### Correção

Portar o efeito completo do `doHandover` para o PRO, como side effect do `routeStage` (ou em `persistAndEmit`, via `sideEffects`):

- [ ] `whatsapp_threads`: `bot_active = false`, `handover_at = now()`
- [ ] `support_tickets`: insert com dedupe por `(company_id, customer_phone, status in open/in_progress)`
- [ ] Manter `step = "handover"` na sessão
- [ ] Garantir que `reactivate` volte a ser elegível (consequência automática do item 1)
- [ ] Teste: handover no PRO desliga bot, cria ticket, e reactivate reativa após 5 min

> Isto é **pré-requisito** de apagar o Starter: hoje o `doHandover` correto só existe lá.

---

## 3. Reaproveitar — não encostar

| Peça | Onde | Por quê |
|------|------|---------|
| **`search_allowlist`** | `lib/chatbot/pro/prepareOrderDraft.ts:33-35`, L270-318 | Impede o LLM de usar `produto_embalagem_id` que não veio de busca real, rejeita slug inventado, recusa prepare sem busca. É a peça anti-alucinação mais valiosa do repo. |
| **Totais no servidor** | `prepareOrderDraft` + `resolveDeliveryForNeighborhood` | Preço, taxa, `grandTotal` nunca vêm da IA. |
| **Sanitização de saída** | `sanitizeAiVisibleOrderClaims.ts`, `ai.service.full.ts:851-868` | Remove UUID vazado, substitui alegação falsa de "pedido confirmado", troca erro genérico pelos erros reais do prepare. |
| **`makeProPipelineDependencies` + overrides** | `src/pro/pipeline/deps.factory.ts:13-47` | Permite rodar o pipeline inteiro sem banco e sem LLM. **É o que viabiliza o harness.** |
| **`LlmPort`** | `src/pro/ports/llm.port.ts:44-46` | Provedor já abstraído (Anthropic/OpenAI). O harness pluga um adapter de replay aqui. |
| **`resolveSegmentPick`** | `src/pro/pipeline/resolveSegmentPick.ts` | É **matching de catálogo**, não interpretação de linguagem. Continua no servidor depois da migração. |
| **IDs estruturados de botão** | `pro_pick_emb:`, `pro_confirm_order`, `pro_pay_*` | Botão clicado é dado, não texto. Mandar para LLM é custo e risco sem ganho. |
| **`whatsapp_messages`** | schema | Fonte canónica do replay: `direction`, `created_at`, `body`, e `raw_payload` bruto da Meta no inbound. |
| **Resiliência Anthropic** | `lib/chatbot/anthropicResilience.ts` | In-flight gate, retry 429, circuit breaker. |

---

## 4. Apagar

### 4.1 Risco zero — sem consumidor algum

Tabelas criadas por migration e **nunca lidas nem escritas** por TypeScript:

- `bot_intents`, `bot_logs` (`20260104175517`)
- `parser_alerts` (`20260320500001`)

Arquivos órfãos (zero imports fora de testes que só existem para eles):

- `lib/chatbot/services/AlertService.ts` (único consumidor de `parser_alerts`)
- `lib/chatbot/pro/resolveDeliveryZone.ts`
- `lib/chatbot/db/variants.ts`
- `lib/chatbot/pro/confirmationPt.ts`
- `tests/chatbot/highValueConfirm.legacy.test.ts`

Lixo de raiz:

- `lib/chatbot.zip`, `generate-report.js`, `diagnostico-renthus.pdf`
- `.tmp-mcp-migration.json`, `scripts/_mcp_*.json`
- `CHATBOT_FLUXO_*.pdf` (regeneráveis por `scripts/generateFluxoPedidoChatbotPdf.mjs`)

Código morto dentro de arquivo vivo:

- `PAYMENT_WORD_ONLY_RE` (`checkoutPostProcess.ts:151`) — definido, nunca testado
- `shouldHoldAwaitingAddressUi` (`orderSlotStep.ts:41-46`) — `@deprecated`, sempre `false`; o ramo em `orderStage.ts:134-146` nunca executa
- `invalidateFAQCache` (`handleFAQ.ts:48`) — exportado, nunca importado
- Bloco `describe.skip` em `tests/integration/webhook-integration.test.ts:285-345`

### 4.2 Motor Starter inteiro (depois do P0)

- `lib/chatbot/inboundPipeline.ts`
- `lib/chatbot/middleware/intentClassifier.ts` e `intentDetector.ts`
- `lib/chatbot/handlers/handleFAQ.ts` e `handleMainMenu.ts`
- `lib/chatbot/offerCatalog.ts`
- `lib/chatbot/tier.ts` + ramo em `processMessage.ts:28-46`
- Flag `CHATBOT_TEST_FORCE_TIER` e testes que simulam Starter

### 4.3 Docs que descrevem código inexistente

| Arquivo | Problema |
|---------|----------|
| `docs/CHATBOT_IMPLEMENTACAO.md` | `OrderParserService`, Fuse.js, steps `catalog_categories`, webhook `/api/whatsapp/webhook` (rota não existe — a real é `/api/whatsapp/incoming`), Twilio |
| `docs/DIAGNOSTICO_CHATBOT.md` | Mesmos erros; aponta para o anterior |
| `docs/CHATBOT_TIERS.md` | Diz que PRO mora em `lib/chatbot/pro/*`; o motor é `src/pro/` |
| `CONTEXTO.md` (raiz) | `parserChain`, `handleCatalog` |
| `docs/DB_CURRENT_STATE.md` | Seções de chatbot descrevem `bot_intents`/`bot_logs` como motor ativo |
| `docs/ARCHITECTURE.md`, `docs/PROJECT_SPEC.md`, `ADR/0002` | Twilio como decisão vigente; `incoming/route.ts` é Meta-only |

### 4.4 Caminhos de flag sem uso real

- `CHATBOT_QUEUE_ENABLED != "1"` — processa inline no webhook; só dev
- Claim fallback inseguro em `process-queue/route.ts:33` (`NODE_ENV !== "production"`)

---

## 5. Adicionar

### 5.1 Harness de replay

Não existe nada: `replay`, `harness`, `golden` dão **zero** ocorrências em `tests/`. O que os docs chamam de replay é procedimento manual de reenviar o mesmo `message_id`.

Lacuna crítica: **não há snapshot histórico de estado por turno**, só o estado atual em `chatbot_sessions.context.__pro_v2_state`. O replay tem que **recomputar** o estado turno a turno a partir do inicial — o que é aceitável e até desejável, porque é exatamente o que o pipeline faz em produção.

### 5.2 Trace por turno

Hoje a métrica guarda contador e tag, o logger guarda metadado do draft, e `whatsapp_messages` guarda o texto. Nada guarda o par (estado antes, saída depois). Sem isso o replay só compara string, que quebra a cada ajuste de copy.

### 5.3 Extração estruturada

Substituir `parseMultiItemOrderSegments`, `inferPaymentFromText` e `editIntentParse` por uma passada de LLM que devolve **termo de busca e quantidade** — nunca ID, nunca preço, nunca nome de catálogo. O servidor continua dono da busca, do ranking e do total.

---

## 6. Fases

### Fase 0 — P0 handover + limpeza

- [x] Portar `doHandover` completo para o PRO (`applyProHandover` + `runProPipeline`) — 2026-08-06
- [x] bot-toggle reativa limpando `chatbot_sessions` (evita `handover_hold` eterno)
- [x] Teste unitário `tests/pro/applyHandover.test.ts`
- [x] Preço por modelo na carteira (§7.2) — `lib/billing/llmPricing.ts` + `model` no débito (2026-08-06)
- [x] `resolveAiCapabilityProfile` substituindo o papel de `getChatbotProductTier` (§7.1)
- [x] Perfil `degradado` sem crédito: sem LLM / bootstrap / fechamento; menu/status/handover ok
- [x] Apagar motor Starter (`inboundPipeline`, handlers, intent middleware, `offerCatalog`) + `processMessage` só PRO
- [x] Políticas do pipeline derivadas do perfil (`policiesFromAiCapability`); STT já gated por `canUseAi`
- [ ] Migration DROP: `bot_intents`, `bot_logs`, `parser_alerts`
- [ ] Apagar órfãos de §4.1
- [ ] Apagar lixo de raiz de §4.1
- [ ] Apagar docs de §4.3
- [ ] Forçar fila sempre (remover caminho inline do webhook)
- [ ] Consolidar num classificador de intent só (`src/pro/services/intent/`)

### Fase 1 — Harness de replay

- [ ] Migration: tabela de trace por turno (inbound, estado antes, outbound, draft, telemetria)
- [ ] Gravar trace em `persistAndEmit`, atrás de flag
- [ ] Loader: `whatsapp_messages` → conversa ordenada por thread
- [ ] Runner: reprocessa turno a turno via `makeProPipelineDependencies` com overrides
- [ ] `LlmPort` de replay (grava e reproduz respostas — roda sem custo e determinístico)
- [ ] Comparador: diff de outbound, draft final e telemetria
- [ ] Baseline versionada com conversas reais
- [ ] `npm run replay`

### Fase 2 — Interpretação por LLM

- [ ] Contrato JSON alinhado a `PrepareDraftToolInput`
- [ ] Extrator estruturado (modelo barato, uma passada, sem histórico)
- [ ] Rodar em sombra: só logar divergência vs bootstrap atual
- [ ] Medir divergência no replay antes de inverter
- [ ] Inverter prioridade; bootstrap regex vira atalho de alta confiança
- [ ] Apagar `parseMultiItemOrderSegments`, `inferPaymentFromText`, `editIntentParse`

### Fase 3 — Consolidação

- [ ] `productHint` derivado do catálogo, não do texto do cliente (vale também para `serverSwapEdit.replaceHint`)
- [ ] Mover `lib/chatbot/pro/*` para `src/pro/` (ownership único)
- [ ] Remover `SELECT_LEGACY` de `searchProdutos.ts` após validar a view
- [ ] Acentuação nas mensagens restantes (`checkoutPostProcess`, `order.service.v2`, `ai.service.full`, `orderStage`)
- [ ] Atualizar `CHATBOT_PROD.md`, `CHATBOT_TIERS.md`, seções de chatbot do `DB_CURRENT_STATE.md`

---

## 7. IA por plano — um motor, três perfis de capacidade

Decisão do dono (final): **mesmo modelo nos três planos**; diferenciar por orçamento (`maxToolRounds` / `maxHistoryTurns`) e por features de produto (canais Market). O perfil *suporta* `model` por plano para o futuro, mas não se usa essa alavanca no lançamento (§7.5).

Isto **não** significa manter dois motores. O motor Starter (`inboundPipeline.ts`) continua sendo apagado.

### 7.1 Colisão de nomes a resolver primeiro

Hoje a palavra "pro" significa duas coisas diferentes:

| Tipo | Valores | Significado |
|------|---------|-------------|
| `CommercialPlanKey` (`planCatalog.ts:6`) | `essencial` \| `pro` \| `market` | Plano comercial. `"starter"` é **alias legado de `essencial`** (`normalizePlanKey:86`) |
| `ChatbotProductTier` (`tier.ts:9`) | `starter` \| `pro` | Motor de chatbot |

E hoje **o plano não afeta a IA em nada**: `tier.ts:30-31` dá motor `pro` para os três planos, desde que haja crédito. O tier binário só reflete "tem crédito e IA ligada".

Substituir `ChatbotProductTier` por um perfil derivado do plano:

```ts
type AiCapabilityTier = "degradado" | "basico" | "avancado";

interface AiCapabilityProfile {
    tier: AiCapabilityTier;
    provider: "anthropic" | "openai";
    model: string;
    maxToolRounds: number;
    maxHistoryTurns: number;
    aiTimeoutMs: number;
    tools: Array<"search_produtos" | "get_order_hints" | "prepare_order_draft">;
    sttEnabled: boolean;
}
```

| Plano / estado | Perfil | Desenho |
|----------------|--------|---------|
| Sem plano, IA off, **sem crédito**, ou erro | `degradado` | Zero LLM. `routeStage` já serve menu, catálogo, status e handover em `direct_reply` (`routeStage.ts:60-189`) |
| `essencial` | `basico` | `maxToolRounds` 4, `maxHistoryTurns` 8, STT ligado |
| `pro`, `market` | `avancado` | `maxToolRounds` 12, `maxHistoryTurns` 24, STT ligado |

Os três fecham pedido. `PLAN_CATALOG.essencial.features` inclui `ai_parser` e `assisted_mode`, e a descrição vende "IA com crédito" — tirar o fechamento esvazia o plano.

**STT não é diferencial de plano** (ver §7.6). Fica ligado nos três, debitando da carteira como qualquer uso de IA.

### 7.2 Bloqueador: a carteira só sabe cobrar Haiku

`lib/billing/aiWallet.ts:12-33` tem o preço do Haiku **fixo no código**, e `debitFromAnthropicUsage:353` chama `estimateHaikuCostBrlCents` **sem parâmetro de modelo**. A mesma função debita o uso do adapter OpenAI.

Consequência de trocar o modelo por plano sem mexer nisso: Pro e Market queimam tokens de modelo caro cobrados a preço de Haiku. Como `canUseAi` é justamente o que decide se há IA, o cliente **nunca esgota o crédito quando deveria** e a margem some sem aparecer em lugar nenhum.

Correção obrigatória **antes** de ligar perfis:

- [x] Tabela de preço por modelo (input/output USD por 1M) — `llmPricing.ts`
- [x] `estimateLlmCostBrlCents(model, input, output)` (`estimateHaikuCostBrlCents` vira wrapper)
- [x] `debitFromAnthropicUsage` recebe `model` via meta dos adapters
- [x] Fallback conservador (Sonnet-class) para modelo desconhecido
- [x] Registrar `model` em `debitAiUsage` meta

### 7.3 Onde o perfil pluga

| Ponto | Hoje | Mudança |
|-------|------|---------|
| `createLlmPort.ts:12-24` | Provider só por env, global | Recebe o perfil; env vira default/override |
| `DEFAULT_PRO_POLICIES` (`context.ts:23-34`) | Constante única | Derivada do perfil (`maxToolRounds`, `maxHistoryTurns`, `aiTimeoutMs`) |
| Tools em `ai.service.full.ts:79-120` | Fixas (menos `info_only`) | Filtradas pelo perfil |
| `createSttPort` | Por env | Sem mudança — STT igual nos três planos (§7.6) |
| `tier.ts` | `getChatbotProductTier` binário | `resolveAiCapabilityProfile(admin, companyId, botConfig)` |
| Telemetria | Sem tag de plano | Tag `profile` em `pro_pipeline_metric_events` para comparar qualidade entre tiers |

### 7.4 O que **não** varia por plano

A camada de segurança é idêntica nos três perfis. Modelo mais fraco precisa de **mais** proteção, não menos:

- `search_allowlist` (`prepareOrderDraft.ts:270-318`)
- Preço, taxa e total calculados no servidor
- Sanitização de saída (`sanitizeAiVisibleOrderClaims`)
- Gates de checkout e confirmação

### 7.5 Recomendação: **mesmo modelo nos três planos**

O perfil deve *suportar* modelo por plano, mas a recomendação é **não usar** essa alavanca por enquanto. Três razões, nesta ordem:

**1. Tiering de modelo não protege margem nenhuma.** A exposição de custo é limitada por `aiIncludedCents` (10% da mensalidade), que é um teto duro por empresa/mês. Modelo 3× mais caro não aumenta o teto — só faz o cliente chegar nele 3× mais rápido. Depois do teto, ele compra pack.

**2. Packs são repasse a custo, sem margem.** `creditAiPack` credita 1000/2000/5000 centavos como saldo 1:1 (`aiWallet.ts:286-307`). O cliente paga R$ 10 e recebe R$ 10 de token. Modelo caro não te custa mais no pack — custa mais **ao cliente**.

> Ambos dependem de §7.2 estar corrigido. Enquanto a carteira cobrar Sonnet a preço de Haiku, o teto não segura e a diferença sai do seu bolso.

**3. O modo de falha do modelo fraco é *pedido errado*, não *pedido lento*.** O `search_allowlist` impede inventar produto inexistente, mas **não** impede escolher o produto real errado — Coca 2L no lugar da 350ml é entrega errada, estorno e cliente irritado. Esse risco cairia justo no plano mais barato, com o cliente menos tolerante e a menor receita para absorver churn.

Ordem de grandeza para o `essencial` (R$ 19,70 inclusos, ~R$ 0,22/conversa em Haiku vs ~R$ 0,66 em Sonnet, estimativa grosseira): cerca de 90 contra 30 conversas no crédito incluso. Real, mas resolvido com pack de R$ 10 — barato demais para justificar arriscar corretude.

**Diferencie por orçamento, não por inteligência.** `maxToolRounds` e `maxHistoryTurns` menores falham de forma **segura**: a IA desiste antes e passa para humano. Modelo fraco falha de forma **errada**: responde confiante e monta o draft trocado.

**A boa notícia sobre o encanamento:** `LlmRequest` já tem campo `model`, e os dois adapters honram `req.model` antes do env (`anthropic.llm.ts:30`, `openai.llm.ts:190`). Então modelo por plano é preencher um campo, não refatorar. Dá para construir o perfil com `model` desde já, subir tudo no mesmo modelo, e trocar o `basico` depois — **se** o harness de replay da Fase 1 mostrar que o modelo barato aguenta as conversas reais.

---

### 7.6 Por que STT não deve ser exclusivo do Market

**Custo.** Transcrição roda a ~US$ 0,006/min. Um áudio de 20s custa ~R$ 0,01 — cerca de 5% do custo de uma conversa inteira (~R$ 0,22). Já é metered pela carteira. Não há custo a recuperar com o gate; é embalagem pura.

**Risco.** No Brasil, áudio no WhatsApp não é conveniência, é modo primário de comunicação de boa parte dos clientes. Bot sem STT no Essencial e no Pro **falha visivelmente** num tipo de mensagem comum, e o cliente final culpa o produto, não o plano. Gate quase de graça que produz falha visível é troca ruim.

**As features do Market são travadas por segmento, não por porte.** iFood e Aiqfome só valem para quem já está no iFood; mesa só vale para quem tem mesa. Um delivery de bebidas fora de marketplace tira zero valor delas. Ou seja, Market não é upgrade natural do Pro — é **outro segmento**. Falta ao Market um puxador horizontal, e a tentação é fabricar um travando feature barata. Isso machuca os planos de baixo mais do que ajuda o de cima.

**Alavanca melhor, se quiser puxador horizontal:** `aiIncludedCents` é hoje mecanicamente 10% da mensalidade nos três (`planCatalog.ts:38,56,78`), o que dá R$ 27,90 contra R$ 34,90 entre Pro e Market — diferença que ninguém percebe. Escalonar o percentual (ex.: 10% / 15% / 20%) tem exposição limitada por teto, é visível no marketing ("Market inclui 3× mais conversa de IA") e não cria nenhum modo de falha.

### 7.7 Preço: o problema não é o Pro

| Passo | Delta | O que entrega |
|-------|-------|---------------|
| essencial → pro | **+R$ 82** (+42%) | PDV completo, impressão automática, estoque full, financeiro full |
| pro → market | **+R$ 70** (+25%) | iFood, Aiqfome, IG/Messenger, mesa, app mobile |

O maior salto compra 4 módulos que você **constrói uma vez**. O menor salto compra integrações de marketplace que você **mantém para sempre** contra APIs de terceiro que quebram (já há `api/admin/marketplace/ifood/orders/poll`). O custo recorrente de engenharia está no degrau mais barato — está invertido.

Além disso, `pro` é `popular: true`: é a âncora da tabela. Âncora **deve** ser a melhor relação custo-benefício, é o mecanismo funcionando. Se algo se move, é o Market para cima, não o Pro.

### 7.8 Mas **não** suba o Market agora — 3 das 5 features são placeholder

Estado real das features do Market em `configuracoes/page.tsx`:

| Feature | Estado |
|---------|--------|
| `marketplace_ifood` | **Real** — `MarketplaceIfoodSettings`, rotas, sync, poll, migrations |
| `marketplace_aiqfome` | **Real** — `MarketplaceAiqfomeSettings`, rotas, sync |
| `omnichannel_ig_messenger` | Placeholder: *"Em breve na próxima versão"* (`:2665-2667`) |
| `table_service` | Placeholder: *"Em breve na próxima versão"* (`:2674-2676`) |
| `mobile_app` | Placeholder: *"Em breve na próxima versão — app Dart/Flutter"* (`:2683-2685`) |

Não há adapter de Instagram/Messenger em lugar nenhum — só o gate de UI e a linha no catálogo.

Hoje o `+R$ 70` compra **iFood + Aiqfome**, e só. Para quem está em marketplace isso se paga sozinho (a comissão do iFood é ordens de grandeza maior que a mensalidade), então o preço atual está adequado ao produto atual. Subir agora seria cobrar mais por três cartões "Em breve".

**Risco de lançamento:** cliente que pagar R$ 349 e encontrar três "Em breve" dentro da aba que ele acabou de comprar tem motivo de reembolso. Antes de abrir para clientes reais: construir, ou tirar do texto comercial.

### 7.9 IG/Messenger deve ficar no Market

É a **única feature horizontal** do Market. iFood e Aiqfome só valem para quem está em marketplace; mesa só vale para quem tem salão. Instagram, todo mundo tem. É o único puxador que funciona para um cliente Pro fora do segmento marketplace — e hoje ele não existe, que é a razão real de o Market parecer fraco.

E é o **tipo certo de gate**, ao contrário do STT (§7.6): disponibilidade binária de canal, não degradação dentro de um canal que o cliente já usa. O WhatsApp dele funciona perfeito; ele só não tem Instagram junto. Sem modo de falha, fácil de explicar.

Sequência recomendada:

1. **Agora:** não mexer no preço.
2. **Construir IG/Messenger** — provavelmente o mais barato dos três placeholders (mesma Graph API, mesmo pipeline, adapter de canal novo) e o de maior alcance comercial.
3. **No lançamento dele:** subir o Market para ~**R$ 397**, mantendo a escada geométrica de ~42% por degrau (197 → 279 → 397). O aumento passa a ter motivo visível, e os degraus deixam de decrescer.

Ainda vale o timing: sem cliente real, mexer em preço é grátis. O que muda é que a mudança deve vir **junto com** a entrega, não antes.

### 7.10 IG/Messenger é bloqueador de lançamento — consequências

Decisão do dono: **o app só é lançado depois do IG/Messenger integrado.** Isso o coloca no caminho crítico e muda três coisas.

**a) Não existe mais "evento de aumento".** Lança direto em **197 / 279 / 397**. Sem cliente antigo, sem grandfathering, sem comunicar reajuste. Simplesmente atualizar `PLAN_CATALOG` antes de abrir.

**b) Placeholders no lançamento (B7 aprovado):** `mobile_app` sai do `PLAN_CATALOG` / cópia comercial (roadmap externo). **`table_service` (mesa) fica** e deve estar **implementado antes do lançamento** — não pode aparecer como "Em breve" na aba paga. A aba que o cliente comprou não pode ter "Em breve".

**c) Fase 0 tem que vir ANTES do adapter de canal.** Hoje há dois motores inbound (§1). Construir Instagram agora significa ligá-lo nos dois, ou construir contra código que está marcado para deleção. Consolidar primeiro, plugar o canal uma vez só.

#### Identidade: sim, chavear por IGSID — e clean arch **não** substitui isso

Duas camadas diferentes:

| Camada | O que resolve | Clean architecture ajuda? |
|--------|---------------|---------------------------|
| **Transporte** (enviar/receber mensagem, janela, HSM) | Adapter por canal | **Sim** — portas já existem ou são triviais |
| **Identidade** (quem é o cliente entre canais) | Modelo de dados + vínculo | **Não** — porta não cria chave; só consome |

##### Modelo recomendado

Não colocar `igsid` como coluna única em `customers` no lugar do telefone. Colocar uma tabela de identidades de canal:

```text
customer_channel_identities
  company_id
  customer_id          → customers.id
  channel              ('whatsapp' | 'instagram' | 'messenger')
  external_id          (phone E.164 | IGSID | PSID)
  UNIQUE (company_id, channel, external_id)
```

- `customers.id` continua sendo a pessoa (UUID estável).
- WhatsApp cria/resolve por `(whatsapp, phoneE164)`.
- IG cria/resolve por `(instagram, igsid)` **sem telefone**.
- No checkout (1ª vez no IG/Messenger), pede telefone e **vincula** ao mesmo `customer_id` (merge se phone já existir). Bot **nunca** oferece a prazo.
- `phone` em `customers` vira atributo **opcional no schema** (hoje é NOT NULL — ver §9.2 I1), útil para entrega/PDV/status; não é o ID do canal.
- Pré-requisito: tornar `customers.phone` nullable + unique parcial antes de criar cliente só com IGSID.

##### O que precisa mudar (impacto real)

| Área | Hoje | Depois |
|------|------|--------|
| `getOrCreateCustomer` (`lib/chatbot/db/orders.ts:20`) | Lookup/insert só por `phone` | `getOrCreateCustomerByChannelIdentity(channel, externalId)` |
| `enrichProSessionCustomerFromPhone` | Assume `phoneE164` | Vira enrich por identidade da thread |
| `TenantRef.phoneE164` (`contracts.ts:32`) | Obrigatório | Vira `channelUserId` + `channel`, phone opcional |
| `whatsapp_threads.phone_e164` | NOT NULL / identidade da thread | `channel` + `external_id` (phone pode espelhar no WA) |
| `abandoned_carts` / `outbound_jobs` | `phone_e164` NOT NULL | Despacho por `thread_id` → canal da thread |
| Pedido / a prazo / favoritos | Muitos joins por phone | Por `customer_id` (já é o certo); phone só onde for regra de negócio |
| Inbox / suporte | Exibe phone | Exibe label do canal + external_id / phone se houver |

##### O que clean architecture **já** resolve (transporte)

| Preocupação | Porta / adapter |
|-------------|-----------------|
| Enviar texto/botões | `MessageGateway` — hoje só `WhatsAppMessageGateway`; adicionar `InstagramMessageGateway` / `MessengerMessageGateway` (ou um Meta adapter com `channel`) |
| Factory | `deps.factory.ts` escolhe gateway pelo `ActorRef.channel` da thread |
| Janela de atendimento | Extrair porta `CustomerServiceWindowPort` (ou strategy por canal). WhatsApp: 24h + HSM. IG/Messenger: janela própria, **sem** HSM → fora da janela = não envia (ou só se Meta permitir free-form) |
| Recuperação de carrinho | Worker não chama WhatsApp direto: carrega canal da thread → `MessageGateway.send`. `sendOutboundPayload` vira adapter-agnóstico |
| Onda de tipos | Alargar `ActorRef.channel` força o compilador a listar todo site — audit automático |

Resumo: **sim, dá para chavear por IGSID**; clean arch faz o envio e a política de janela ficarem limpos; o trabalho duro é a tabela de identidades + trocar os pontos que hoje tratam telefone como se fosse o ID universal do cliente.

##### Decisão aprovada (dono) — fluxo de identidade IG/Messenger

1. **Canal é conhecido na entrada.** Webhook Meta e thread carregam `channel` (`whatsapp` | `instagram` | `messenger`). O bot não “adivinha”; o adapter seta `ActorRef.channel` e a factory escolhe o `MessageGateway` certo.
2. **1ª compra no IG/Messenger:** no checkout, se a identidade ainda não tem telefone vinculado → pedir telefone → criar/atualizar `customers.phone` e inserir (ou linkar) `customer_channel_identities` `(instagram|messenger, IGSID|PSID) → customer_id`. Se já existir customer com aquele phone na mesma empresa, **merge** no mesmo `customer_id`.
3. **2ª compra em diante:** resolve só por `(channel, external_id)` → já tem `customer_id`, endereços, histórico. Não pede telefone de novo (salvo se o vínculo falhou / foi apagado).
4. **WhatsApp:** continua resolvendo por phone (que já é o `external_id` do canal). Sem pedir telefone.
5. **Bot nunca aceita “a prazo”.** Pagamentos do chatbot: só `pix` | `cash` | `card`. “A prazo” / crédito fica exclusivo do PDV com cliente selecionado. Não oferecer no menu, não inferir de texto, rejeitar se o cliente pedir. (Já alinhado às regras de negócio do repo; reforçar no checkout PRO e na cópia do bot.)

##### Cardápio web — mesma identidade (aprovado)

Hoje o menu só identifica por telefone: link `?wm=<HMAC>` com `phoneE164` (`lib/public-menu/sessionToken.ts`) ou formulário manual no checkout (`CheckoutDrawer` step `identify`). UTM `whatsapp` é só analytics. Meta **não** injeta IGSID na URL do browser — o bot precisa assinar o token no link, igual ao WA.

Extensão (mesmo `customer_channel_identities`):

1. Token v2: `{ companyId, slug, channel, externalId, exp }` assinado (WA=phone, IG=IGSID, Messenger=PSID). Sem IGSID cru na query.
2. Bot gera o link do cardápio com o `external_id` do canal da thread + `utm_source` correspondente.
3. Session API: resolve/cria por `(channel, externalId)`. Se já tem phone vinculado → checkout identificado. Se não → `needsPhone: true`.
4. 1º checkout IG/Messenger: pede telefone → linka ao IGSID/PSID (merge se phone já existir).
5. 2º acesso: token com IGSID resolve tudo; não pede telefone de novo.
6. Pedido web continua `source=web_menu`; opcional gravar `origin_channel` (instagram|messenger|whatsapp) para atribuição.

---

## 8. Regras que este plano preserva

Do `.cursorrules` e da governança:

- Frontend nunca acessa tabela crua: leitura por view, mutação por RPC/API server-side.
- Mensagens ao cliente em português do Brasil.
- Migration criada **e** aplicada no remoto na mesma entrega.
- Entrega respeita política ativa da empresa (cidade, modo, regras por bairro).

---

## 9. Auditoria do plano (2026-08-06) — contratos, inconsistências, decisões, subestimações

Fontes: schema remoto (MCP Supabase), código local, Meta Developer Policies (Messenger/IG, atualizado Abr/2026), Zod docs (Context7).

### 9.1 Contratos com tipagem forte (adicionar)

Hoje `src/types/contracts.ts` é TypeScript puro (interfaces). `.cursorrules` cita Zod, mas **Zod não é dependência direta** do app (`package.json`) — só transitiva via outras libs (`zod@4.3.6` no lock). Para omnichannel + tokens + merge, TS sozinho não valida bordas (webhook, query `wm`, RPC).

**Recurso:** adicionar `zod` como dependência direta e um módulo canônico `src/domain/contracts/` (ou `src/types/schemas/`) com schemas → `z.infer`.

#### Enums / branded IDs

```ts
// canal de conversa (Meta)
export const MessagingChannel = z.enum(["whatsapp", "instagram", "messenger"]);
export type MessagingChannel = z.infer<typeof MessagingChannel>;

// origem do pedido (orders.channel / source — hoje text solto)
export const OrderChannel = z.enum([
  "whatsapp", "instagram", "messenger", "web", "pdv", "ifood", "aiqfome",
]);
export const OrderSource = z.enum([
  "chatbot", "web_menu", "pdv", "admin", "marketplace",
]);

// identidade de canal (nunca misturar phone com IGSID sem brand)
export const PhoneE164 = z.string().regex(/^\+[1-9]\d{7,14}$/).brand<"PhoneE164">();
export const IgSid = z.string().min(5).brand<"IgSid">();
export const MessengerPsid = z.string().min(5).brand<"MessengerPsid">();
export const CustomerId = z.string().uuid().brand<"CustomerId">();
export const ThreadId = z.string().uuid().brand<"ThreadId">();
export const CompanyId = z.string().uuid().brand<"CompanyId">();

export const ChannelIdentity = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("whatsapp"), externalId: PhoneE164 }),
  z.object({ channel: z.literal("instagram"), externalId: IgSid }),
  z.object({ channel: z.literal("messenger"), externalId: MessengerPsid }),
]);
```

#### Refs do pipeline (substituir `TenantRef` / `ActorRef` atuais)

```ts
export const TenantRef = z.object({
  companyId: CompanyId,
  threadId: ThreadId,
  messageId: z.string().min(1),
  identity: ChannelIdentity,
  /** Preenchido só depois do vínculo / se canal = whatsapp */
  phoneE164: PhoneE164.optional(),
});

export const ActorRef = z.object({
  channel: MessagingChannel,
  source: z.enum(["meta_webhook", "internal", "web_menu"]),
  profileName: z.string().nullable().optional(),
});
```

#### Token do cardápio (v1 legado + v2)

```ts
export const WebMenuLinkPayloadV1 = z.object({
  v: z.literal(1),
  companyId: CompanyId,
  phoneE164: PhoneE164,
  slug: z.string().min(1),
  exp: z.number().int(),
});

export const WebMenuLinkPayloadV2 = z.object({
  v: z.literal(2),
  companyId: CompanyId,
  slug: z.string().min(1),
  identity: ChannelIdentity,
  exp: z.number().int(),
});

export const WebMenuLinkPayload = z.discriminatedUnion("v", [
  WebMenuLinkPayloadV1,
  WebMenuLinkPayloadV2,
]);
```

Verificação na borda: `WebMenuLinkPayload.safeParse(decoded)` — hoje `verifyWebMenuLinkToken` só checa campos truthy.

#### Pagamento do bot (já decidido)

```ts
export const BotPaymentMethod = z.enum(["pix", "cash", "card"]);
// Nunca incluir "prazo" / "credit" aqui.
```

#### Perfil de IA

```ts
export const AiCapabilityTier = z.enum(["degradado", "basico", "avancado"]);
export const AiCapabilityProfile = z.object({
  tier: AiCapabilityTier,
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1),
  maxToolRounds: z.number().int().min(0).max(24),
  maxHistoryTurns: z.number().int().min(0).max(48),
  aiTimeoutMs: z.number().int().positive(),
  tools: z.array(z.enum(["search_produtos", "get_order_hints", "prepare_order_draft"])),
  sttEnabled: z.boolean(),
});
```

#### Janela de atendimento (porta tipada)

```ts
export const ServiceWindowPolicy = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("whatsapp"),
    freeFormHours: z.literal(24),
    templateOutsideWindow: z.literal(true), // HSM
  }),
  z.object({
    channel: z.literal("instagram"),
    freeFormHours: z.literal(24),
    templateOutsideWindow: z.literal(false),
    humanAgentTagDays: z.literal(7), // Message Tag HUMAN_AGENT — resposta humana, não bot promo
  }),
  z.object({
    channel: z.literal("messenger"),
    freeFormHours: z.literal(24),
    templateOutsideWindow: z.literal(false),
    humanAgentTagDays: z.literal(7),
    oneTimeNotification: z.literal(true), // OTN existe no Messenger; NÃO no IG (Meta policy Abr/2026)
  }),
]);
```

Meta (policy overview, Abr/2026): janela padrão 24h em Messenger e IG; Message Tags (incl. Human Agent ~7 dias) fora da janela; **One-time Notification e Sponsored Messages não existem no IG**. Bots automatizados no Messenger: resposta em até **30s** a qualquer input — impacto direto na fila/worker.

#### Trace de replay / outbound

```ts
export const PipelineTurnTrace = z.object({
  v: z.literal(1),
  companyId: CompanyId,
  threadId: ThreadId,
  channel: MessagingChannel,
  inboundMessageId: z.string(),
  stateBefore: z.unknown(), // ProSessionState serializado — validar com schema próprio depois
  stateAfter: z.unknown(),
  outbound: z.array(z.object({
    kind: z.enum(["text", "buttons", "list"]),
    text: z.string().optional(),
  })),
  draftSnapshot: z.unknown().nullable(),
  telemetryReason: z.string().nullable(),
  aiProfile: AiCapabilityTier.nullable(),
  createdAt: z.string().datetime(),
});
```

### 9.2 Inconsistências (plano × schema × código)

| # | Onde | Problema | Impacto |
|---|------|----------|---------|
| I1 | `customers.phone` | **NOT NULL** no remoto + `UNIQUE(company_id, phone)` | Plano diz criar cliente IG sem telefone — **impossível hoje**. Precisa `phone` nullable + unique parcial `WHERE phone IS NOT NULL` |
| I2 | `support_tickets.customer_phone` | NOT NULL | Handover IG sem phone quebra insert. Precisa `customer_id` (+ phone opcional) |
| I3 | `whatsapp_threads.phone_e164` | NOT NULL; sem coluna `channel` / `external_id` | Thread IG não modelada. `channel_id` hoje aponta para `whatsapp_channels` (WABA), não para tipo de rede social |
| I4 | `abandoned_carts` / `outbound_jobs` | `phone_e164` NOT NULL | Recovery assume WA. Despacho deve ser por `thread_id` + canal |
| I5 | `lib/public-menu/resolveWebCustomer.ts:59` | Insere `origem: "web_menu"` | Constraint histórica `customers_origem_check` só `'chatbot'\|'admin'` (verificada em migration/estado). Dados atuais: só `origem=chatbot`. Risco: create de cliente web falha silenciosamente (`return null`) |
| I6 | `ActorRef.channel` / `ChatbotTier` | Só `"whatsapp"` / `"starter"\|"pro"` | Colisão com `CommercialPlanKey.pro`; docs e código divergem |
| I7 | Token menu v1 | Obrigatório `phoneE164` | Bloqueia fluxo IGSID até v2 |
| I8 | Pedido web | `p_channel: "web"`, sem `origin_channel` | Perde atribuição IG→cardápio |
| I9 | Carteira IA | Preço Haiku fixo; débito sem `model` | Bloqueador §7.2 — ainda aberto |
| I10 | Plano §7 intro | Ainda diz “IA mais fraca no Essencial…” | Decisão final foi **mesmo modelo**; texto da intro ficou defasado |
| I11 | `whatsapp_channels` | Só WABA/Meta WhatsApp | Market IG precisa de tabela de conexão Page/IG Business (ou generalizar channels) |
| I12 | Zod | Citado nas regras, não está em `dependencies` | Contratos fortes sem lib canônica no app |

### 9.3 Decisões de negócio — **aprovadas** (2026-08-06)

| ID | Decisão | Status |
|----|---------|--------|
| **B1** | 1º checkout IG/Messenger: telefone **sempre obrigatório** (mesmo retirada) | Aprovado |
| **B2** | Phone já existe na empresa → **merge automático** no mesmo `customer_id` (admin pode desfazer no ERP) | Aprovado |
| **B3** | Recovery de carrinho abandonado no lançamento: **só WhatsApp**; IG/Messenger = inbound + pedido | Aprovado |
| **B4** | Fora da janela 24h no IG: **silêncio no bot**; tag `HUMAN_AGENT` só para operador humano | Aprovado |
| **B5** | Cardápio sem token (link público): **continua pedindo telefone**; canal efetivo = `web` | Aprovado |
| **B6** | Preço de lançamento: **197 / 279 / 397** (Market R$ 397) | Aprovado |
| **B7** | No lançamento: tirar **somente `mobile_app`** do catálogo/cópia comercial. **`table_service` (mesa) permanece** — será implementado **antes** do lançamento | Aprovado (ajuste do dono) |
| **B8** | Crédito IA incluso: **manter 10%** nos três planos no lançamento | Aprovado |
| **B9** | Disclosure de bot na 1ª mensagem do thread (IG/Messenger, BR): **sim** | Aprovado |
| **B10** | Inbox sem phone: **profile name** da Meta; fallback “Cliente Instagram” / “Cliente Messenger” | Aprovado |

### 9.4 Subestimado / aprimorar

| Item | Por que está subestimado | Ajuste |
|------|--------------------------|--------|
| **`customers.phone` nullable** | Não é “só uma tabela nova” — quebra UNIQUE, PDV, favoritos, tickets, sync triggers | Migration dedicada + RPC de merge + testes de PDV/a prazo (a prazo continua PDV-only) |
| **Conexão IG/Messenger (OAuth Page)** | Plano fala em adapter de mensagem; falta produto de **onboarding** (conectar Page, permissões `instagram_manage_messages`, webhooks) | Fase própria: settings UI + tokens criptografados (padrão `whatsapp_channels`) |
| **Inbox omnichannel** | `WhatsAppInbox` assume phone | Threads por canal, badge de canal, janela 24h per-channel, busca sem phone |
| **SLA 30s (Messenger automated bots)** | Fila atual + cron 60s pode violar policy Meta | Wake imediato (já existe padrão) **obrigatório** para IG/Messenger; medir p95 |
| **Merge de clientes** | “linkar phone” parece 1 UPDATE | Endereços, saldo_devedor, pedidos, favoritos, threads — precisa RPC transacional `merge_customers(from, to)` |
| **Cardápio + bot identidade** | Dois caminhos de session | Um `IdentityService` / RPC `resolve_channel_identity` usado por bot e por `/api/public/menu/.../session` |
| **Venda ativa no IG** | Recovery atual é WA-shaped | Explicitamente **fora** do MVP IG, ou redesenhar gates sem HSM |
| **Harness de replay** | “diff de string” | Precisa schema de trace + baselines versionadas **antes** de mudar modelo/regex |
| **Fase 0 vs IG** | IG é bloqueador de lançamento; Fase 0 ainda lista muita limpeza cosmética | Separar **P0 lançamento** (handover, wallet model price, identity schema, um motor, IG adapter) de **P1 higiene** (docs mortos, zip, PDF) |
| **Tipagem `orders.channel`** | text livre | CHECK ou enum PG alinhado a `OrderChannel` Zod |
| **Testes de contrato** | Poucos | `safeParse` nos webhooks Meta mock + tokens menu + merge |

### 9.5 Recursos a adicionar (checklist técnico)

**Dependências / libs**

- [x] `zod` como dependency direta (`^4.3.6`)
- [ ] (opcional) geração de tipos DB: `supabase gen types` no CI

**Schema / RPC (Supabase)**

- [x] `customer_channel_identities` + RLS + RPC `resolve_or_create_customer_by_identity` (2026-08-06)
- [x] `customers.phone` NULLABLE + unique parcial
- [x] `link_customer_channel_phone` (merge automático B2)
- [x] Ampliar `customers.origem` (`web_menu` \| `instagram` \| `messenger` \| …)
- [ ] `support_tickets.customer_id` (+ phone opcional); dedupe por customer_id/thread
- [x] `whatsapp_threads`: `channel` + `external_id` (phone_e164 nullable)
- [x] Tabela/conexão Meta Page+IG (`meta_messaging_channels`) + webhook `/api/meta/messaging/incoming`
- [ ] `pipeline_turn_traces` (Fase 1 harness)
- [x] Preço por modelo LLM + STT na carteira

**Portas / adapters (clean arch)**

- [x] `MessageGateway` por canal (`WhatsAppMessageGateway` | `MetaMessageGateway`)
- [x] `CustomerServiceWindowPort` / política domínio por canal (B4 no MetaMessageGateway)
- [x] Helper `lib/chatbot/db/channelIdentity.ts` + Zod `src/domain/contracts/identity.ts`
- [ ] `OutboundDispatcher` por `thread.channel`
- [ ] Schemas Zod restantes: menu session v2, prepare_order_draft wire

**Produto / ops**

- [x] UI Configurações: conectar Instagram/Messenger (`MetaMessagingSettings`)
- [x] Remover só `mobile_app` do catálogo comercial no lançamento (B7)
- [x] Implementar `table_service` (mesa) MVP — `/mesa` + RPCs (B7); evoluções (split/QR) depois
- [x] Atualizar `PLAN_CATALOG` Market → `39700` (B6)
- [x] Disclosure de bot na 1ª mensagem IG/Messenger (B9)
- [ ] Métricas: p95 latência inbound IG/Messenger; taxa merge; `needsPhone` conversion

### 9.6 Ordem de execução revisada (caminho crítico de lançamento)

```text
P0a  Handover PRO completo
P0b  Carteira: preço por modelo (§7.2)
P0c  Um motor só (apagar Starter) + AiCapabilityProfile (mesmo modelo)
P0d  Contratos Zod + Identity schema (phone nullable, channel_identities) — schema/RPC + plug bot/menu; threads.channel/external_id aplicados
P0e  IG/Messenger: conexão + webhook + MessageGateway + pedir phone no checkout — fatia vertical feita (OAuth Page ainda manual via token)
P0f  Cardápio token v2 + needsPhone — token v2 + session API + UI identify (checkout bloqueia sem phone)
P0g  Limpeza comercial (tirar mobile_app; preço Market 397) — feito
P0g2 Mesa (`table_service`) MVP (`/mesa`, open/items/close via PDV finalize) — feito; polish depois
P0h  Smoke + política Meta (janela 24h IG silêncio; inbox label B10) — feito

// paralelo após P0c
P1   Harness de replay + traces
P1   Higiene (docs mortos, zip, DROP bot_intents…)
P2   Extração estruturada LLM (sombra → cutover)
```

### 9.7 Correções editoriais neste documento

- Intro §7: alinhar texto à decisão “mesmo modelo nos três planos”.
- Remover menção a “a prazo” no fluxo de vínculo IG (já proibido no bot) — phone pede-se por entrega/PDV/identidade, não por crédito.
- Explicitar I1 (`phone` NOT NULL) como pré-requisito da tabela de identidades.

### 9.8 STT na carteira IA — preços e débito (implementado)

Fonte oficial: [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) (coluna *Estimated cost* / minute) + model card Whisper ($0.006/min).

| Modelo (`LLM_STT_MODEL`) | USD / minuto | ~BRL / min (câmbio 5.5) | ~BRL / 20s |
|--------------------------|--------------|-------------------------|------------|
| `gpt-4o-mini-transcribe` | **$0.003** | ~R$ 0,02 | ~R$ 0,01–0,02 |
| `gpt-transcribe` | **$0.0045** | ~R$ 0,03 | ~R$ 0,01 |
| `whisper-1` | **$0.006** | ~R$ 0,04 | ~R$ 0,02 |
| `gpt-4o-transcribe` | **$0.006** | ~R$ 0,04 | ~R$ 0,02 |

**Default do produto (dono):** `gpt-4o-mini-transcribe` (`LLM_STT_MODEL` / default no adapter).

Não é a mesma API do chat: STT = `POST /v1/audio/transcriptions`; texto = chat/responses. Mesma `OPENAI_API_KEY`.

**Fórmula (código):** `lib/billing/sttPricing.ts`

```text
durationSec = ceil(API.duration || bytes/2000)   // mín. 1s
costUsd     = (durationSec / 60) × usdPerMinute(model)
costCents   = max(1, ceil(costUsd × AI_USD_BRL_RATE × 100))
```

**Fluxo de abatimento:**

1. Antes do STT: `canUseAi` — sem saldo → **não transcreve** (áudio vira mensagem vazia / sem texto).
2. Após sucesso: `debitFromSttUsage` → `debitAiUsage` com `meta.kind = "stt"`, `duration_sec`, `model`.
3. Ledger: mesmo `company_ai_ledger` do LLM (incluso → prepaid).

Arquivos: `sttPricing.ts`, `aiWallet.debitFromSttUsage`, `openai.whisper.ts` (verbose_json → duration), `transcribeInboundAudio.ts` (gate + débito).
