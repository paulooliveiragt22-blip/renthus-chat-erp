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

- [ ] Portar `doHandover` completo para o PRO (ver §2)
- [ ] Teste de handover PRO: bot desligado + ticket criado + reactivate elegível
- [ ] Definir comportamento sem plano/crédito de IA (ver §7)
- [ ] Apagar motor Starter + `tier.ts` + ramo em `processMessage.ts`
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

## 7. Decisão aberta que trava a Fase 0

Hoje, empresa sem plano, com IA desligada, **sem crédito** ou com erro na resolução do tier cai no Starter (`tier.ts:23-35`). Apagando o Starter, isso precisa de destino definido.

Saída natural: **modo degradado dentro do próprio PRO**. O `routeStage` já responde menu, catálogo, status e handover sem chamar LLM nenhum (`routeStage.ts:60-189`, todos `mode: "direct_reply"`). Nesse desenho, sem crédito o bot serve menu e handover, e só o fechamento de pedido por conversa fica indisponível.

Alternativas: só handover; ou bot desligado.

---

## 8. Regras que este plano preserva

Do `.cursorrules` e da governança:

- Frontend nunca acessa tabela crua: leitura por view, mutação por RPC/API server-side.
- Mensagens ao cliente em português do Brasil.
- Migration criada **e** aplicada no remoto na mesma entrega.
- Entrega respeita política ativa da empresa (cidade, modo, regras por bairro).
