# ADR 0012 — Agente PRO: envelope de slots do inbound (interpretação única por turno)

**Status:** aceito (2026-09-22) — Fase 1 implementada e publicada (workers `renthus-inbound-worker:live` v76, 2026-09-22); smoke de produção pendente
**Data:** 2026-09-22
**Aprovação do dono:** 2026-09-22 (estrutura aprovada; fases 1–3 abaixo)
**Escopo técnico:** como itens, endereço, pagamento, troco e modalidade saem do texto do cliente e chegam ao `OrderDraft` — uma interpretação canônica por turno, obrigatória em todo caminho de `prepare`.
**Escopo comercial:** **não** muda preço, taxa de entrega, política de pagamento, fluxo de confirmação nem catálogo. Só elimina perda silenciosa de slot.
**Predecessor:** [`ADR/0011-pro-order-worklist-typed-lines.md`](./0011-pro-order-worklist-typed-lines.md) (worklist tipada resolveu **itens**; este ADR faz o mesmo para os **demais slots**), [`ADR/0005-pro-agent-calibration-pillars.md`](./0005-pro-agent-calibration-pillars.md) (D1: *LLM interpreta; servidor decide*)
**Relacionados:** [`PRO_ORDER_SLOT_MACHINE.md`](../PRO_ORDER_SLOT_MACHINE.md), [`CHATBOT_PROD.md`](../CHATBOT_PROD.md), `src/pro/tools/prepareOrderDraft.ts`, `src/pro/domain/inboundSlots/`
**Governança:** `projeto-pre-producao-radical.mdc` (parâmetro obrigatório, sem opcional de compatibilidade), `agente-pro-hexagonal.mdc`, `decisoes-negocio-antes-codigo.mdc` (sem decisão comercial nova)

---

## Contexto

### Sintoma de produto (2026-09-21/22)

Cliente manda tudo numa frase:

```text
manda duas caixas de original lata e 3 caixa de Heineken longneck
aqui na rua tangara 850, sao mateus. pagamento no pix
```

O bot monta o carrinho com os dois itens e depois **pergunta Entrega ou Retirada**, ignora o PIX e chega a oferecer endereço salvo corrompido (`S/N`, `(completar)`). Endereço e pagamento estavam na mensagem; o rascunho nasceu sem eles.

Três correções já entraram antes deste ADR e **não** fecharam o caso: promoção de intent `unknown` → `order_intent` no gate de pedido, recorte de endereço/pagamento no extrator lexical, e injeção de `addressRaw` na tool `prepare_order_draft`. A terceira só cobre o caminho da tool — e, em mensagem multi-item, quem monta o rascunho é o servidor.

### Causa estrutural: oito montadores do mesmo contrato

`PrepareDraftToolInput` é montado em oito lugares independentes, cada um com uma visão parcial do turno:

| Call site | O que sabe passar | Slots que perde |
|---|---|---|
| `adapters/ai/tools/prepareOrderDraft.tool.ts` | itens, endereço, pagamento, troco | — |
| `adapters/ai/tools/resolvePendingPicks.tool.ts` | itens do pick | endereço, pagamento |
| `adapters/ai/ai.service.ts` (force prepare) | itens | endereço, pagamento |
| `pipeline/orderWorklist/coalescePrepareUniqueHits.ts` | itens (`address: null` fixo) | **endereço, pagamento** |
| `pipeline/serverResolvePendingPicks.ts` | itens do pick | endereço novo do turno |
| `pipeline/serverPrepareAfterPick.ts` | itens + endereço/pagamento **do draft** | slot novo do turno |
| `pipeline/serverPrepareAfterAddressPick.ts` | endereço escolhido | pagamento novo do turno |
| `pipeline/serverOfferDeliveryAddress.ts` | endereço salvo + pagamento do draft | — |

Mais o adapter (`adapters/supabase/orderDraft.supabase.ts`) e dois wrappers que repassam o prepare do batch (`orderWorklist/searchPendingWorklistLinesParallel.ts`, `orderWorklist/applyCatalogSearchToWorklistLine.ts`) — este último só apareceu quando o compilador cobrou o parâmetro novo, o que é a prova do problema: nem o inventário manual tinha os nove caminhos.

Oito montadores ⇒ oito chances de esquecer um slot, e o esquecimento é **silencioso**: o `prepare` retorna `ok:false` por "falta endereço", o que é indistinguível do caso legítimo em que o cliente realmente não informou. Foi exatamente o caminho `coalescePrepareUniqueHits` que venceu a corrida no sintoma acima.

### Princípio violado

O ADR 0005 fixou *"LLM interpreta; servidor decide"*. Hoje, para endereço e pagamento, o servidor **só decide se a LLM tiver chamado a tool certa**. Quando o servidor resolve o carrinho sozinho (batch multi-item, pick, endereço salvo), ele não olha o texto do cliente — interpreta apenas itens.

### Cascata observada

1. Endereço e pagamento somem do rascunho.
2. `fulfillmentType` fica nulo → card **Entrega / Retirar** aparece sem necessidade.
3. Fluxo cai na oferta de endereço salvo, que aceita registro com placeholder (`isAddressStructurallyComplete` e `buildAiAddressFromSavedClienteRow` só checam string não vazia).
4. Se o cliente aceita o salvo corrompido, bairro inexistente entra no rascunho → risco de taxa de entrega errada.
5. Resumo do carrinho pede pagamento de novo, depois de o cliente já ter dito PIX.

---

## Decisão

### D1 — Uma interpretação canônica do inbound por turno (`InboundSlots`)

Função **pura**, sem I/O e sem LLM, executada **1× por turno** na borda do pipeline:

```text
extractInboundSlots(userText) → InboundSlots
```

Reúne num único objeto o que hoje está espalhado: `extractAddressLineFromText` + `tryParseAddressOneLine` (endereço), `parsePaymentMethodFromUserText` + `parsePtMoneyInput` (pagamento/troco), detecção de modalidade em texto livre, e `extractCandidatePendingTermsFromUserText` (linhas — já canônico pelo ADR 0011, aqui só espelhado para as guardas).

O envelope é **evidência do que o cliente disse**, não decisão. Quem decide continua sendo `prepareOrderDraftFromTool` + `resolveProStepFromDraft`.

### D2 — Envelope é parâmetro **obrigatório** de todo prepare

`prepareOrderDraftFromTool` e `OrderDraftPort.prepareFromToolInput` passam a exigir `slots: InboundSlots`. Sem valor padrão, sem opcional: os oito call sites são atualizados no mesmo commit (pré-produção radical). O nono call site **não compila** sem passar o envelope.

### D3 — Política única de merge e anti-alucinação

Uma função pura (`resolvePrepareInput`) decide o valor efetivo de cada slot, com precedência fixa:

```text
escolha explícita do fluxo (endereço salvo por botão/pick)
  > texto DESTE turno (envelope)
  > rascunho atual
```

O envelope vence o rascunho porque é evidência mais nova: se o cliente acabou de digitar outro número de porta ou outra forma de pagamento, a correção entra sem depender da LLM. O rascunho vence quando o turno **não** traz o slot — é o que evita apagar endereço já coletado numa mensagem tipo "pode confirmar". Escolha por botão vence os dois: é decisão explícita, não interpretação de texto.

E a guarda inversa, que generaliza o que `sanitizePreparePaymentAgainstUserText` fazia só para pagamento: **o que a LLM mandou só passa se bater com o envelope ou com o rascunho**. Pagamento e troco sem respaldo são descartados. Endereço estruturado pelo modelo é mantido quando o número da porta coincide com o do texto (a versão do modelo costuma trazer cidade/CEP); se divergir, o texto do cliente vence e a divergência vira `slot_conflict`.

### D4 — Envelope é idempotente por selo de mensagem

O envelope carrega `sourceTextHash` (mesmo hash usado pelo selo da worklist, ADR 0011 D4). Em turno de pick ou de botão, o hash muda e o envelope do texto anterior **não** é reaplicado — evita o endereço da mensagem de ontem reentrar num turno de "1" ou "Confirmar".

### D5 — Perda de slot vira alarme, não print de WhatsApp

Métrica `pro_pipeline.slot_dropped` com tag `slot=address|payment|change|fulfillment`, emitida quando o slot está no envelope e **não** está no rascunho ao fim do turno. Complemento `pro_pipeline.slot_conflict` quando a LLM mandou valor divergente do envelope (hoje isso é sobrescrito em silêncio). Campos `inbound_slots` e `slots_applied` no `pipeline_turn_traces` sob a flag `PRO_PIPELINE_TURN_TRACE`.

Regressão de slot passa a ser detectada no primeiro pedido afetado, não no terceiro print do dono.

### D6 — Guardrail estático contra o nono call site

Teste de auditoria estática no padrão já usado em `tests/workspace/rbacPermissions.test.ts` e `tests/security/createAdminRouteGate.test.ts`: varre `src/pro/**`, encontra toda chamada a `prepareOrderDraftFromTool` / `prepareFromToolInput` e falha se alguma não receber o envelope. O tipo cobre a assinatura; o teste cobre o `as any` e o mock preguiçoso.

### D7 — Placeholder deixa de ser endereço válido

`isAddressStructurallyComplete` e `buildAiAddressFromSavedClienteRow` passam a rejeitar valores de preenchimento (`s/n`, `sn`, `-`, `--`, `(completar)`, `completar`, `x`, `.`) em `numero`, `bairro`, `cidade` e `estado`. Consequência desejada: endereço salvo corrompido **não** é oferecido nem aceito; o fluxo pede rua, número e bairro como se não houvesse salvo.

Limpeza dos registros já gravados em `enderecos_cliente` é item de dado, tratado na Fase 3 com lista revisada pelo dono antes de qualquer `delete`.

### D8 — Custo e latência: o envelope substitui chamada de modelo, não soma

O envelope é CPU pura (regex sobre uma frase, ordem de microssegundos), calculado uma vez e reusado nos oito pontos, em vez de cada ponto reinterpretar texto. Endereço, pagamento, troco e modalidade deixam de depender de round-trip LLM — não sofrem timeout, 429 nem variação de provider. Com o envelope na mão, `extract_order_lines` pode ser **pulado** quando o lexical já cobre a frase (economia de 1 chamada por mensagem multi-item; ganho direto em p95 e em custo por turno).

Determinismo também dá replay estável: mesmo texto ⇒ mesmo envelope ⇒ cassete reproduzível pelo harness existente.

---

## Contrato (tipos)

Canonical em `src/types/contracts.ts`; helpers puros em `src/pro/domain/inboundSlots/`.

```ts
export type InboundSlots = {
    /** Linha de endereço recortada do texto ("rua tangara 850, sao mateus"). */
    addressLine: string | null;
    /** Endereço estruturado quando a linha fecha rua+número(+bairro). */
    address: {
        logradouro: string;
        numero: string;
        bairro: string;
    } | null;
    paymentMethod: PaymentMethod | null;
    changeFor: number | null;
    /** Só menção explícita em texto livre ("vou buscar", "entrega"). */
    fulfillmentType: FulfillmentType | null;
    /** Espelho lexical das linhas (canônico segue sendo a worklist — ADR 0011). */
    orderLines: Array<{ rawTerm: string; quantity: number | null }>;
    /** Selo do texto que gerou este envelope (idempotência — D4). */
    sourceTextHash: string;
};

export const EMPTY_INBOUND_SLOTS: InboundSlots; // turnos de botão/pick
```

### Invariantes

1. `extractInboundSlots` é pura: sem `await`, sem Supabase, sem LLM, sem `Date.now()` no resultado.
2. Todo caminho que chama `prepare` passa um `InboundSlots` — o do turno ou `EMPTY_INBOUND_SLOTS` explícito.
3. Slot vindo da LLM sem respaldo no envelope **ou** no rascunho é descartado (D3).
4. Envelope nunca sobrescreve escolha explícita do cliente por botão/pick (precedência D3).
5. Envelope não grava nada: não é estado de sessão, é derivado do texto do turno.

---

## Estrutura de pastas (alvo)

```text
src/types/contracts.ts                         # InboundSlots + EMPTY_INBOUND_SLOTS

src/pro/domain/inboundSlots/
  extractInboundSlots.ts                       # função pura (D1)
  resolvePrepareInput.ts                       # política de merge + anti-alucinação (D3)
  inboundSlotsInvariants.ts                    # asserts p/ testes

src/pro/tools/prepareOrderDraft.ts             # slots obrigatório (D2)
src/pro/ports/orderDraft.port.ts               # assinatura do port
src/pro/adapters/supabase/orderDraft.supabase.ts

# call sites atualizados (D2)
src/pro/adapters/ai/tools/prepareOrderDraft.tool.ts
src/pro/adapters/ai/tools/resolvePendingPicks.tool.ts
src/pro/adapters/ai/ai.service.ts
src/pro/pipeline/orderWorklist/coalescePrepareUniqueHits.ts
src/pro/pipeline/serverResolvePendingPicks.ts
src/pro/pipeline/serverPrepareAfterPick.ts
src/pro/pipeline/serverPrepareAfterAddressPick.ts
src/pro/pipeline/serverOfferDeliveryAddress.ts

# absorvido
src/pro/pipeline/sanitizePreparePayment.ts     # vira caso particular de resolvePrepareInput

tests/pro/inboundSlots.test.ts                 # tabela de frases → envelope
tests/pro/prepareInputMerge.test.ts            # precedência + anti-alucinação
tests/pro/prepareCallSitesAudit.test.ts        # auditoria estática (D6)
docs/ADR/0012-inbound-slot-envelope.md         # este arquivo
```

---

## Observabilidade

| Sinal | Onde | Dispara quando |
|---|---|---|
| `pro_pipeline.slot_dropped{slot}` | fim do turno, `runProPipeline` | slot no envelope e ausente no rascunho |
| `pro_pipeline.slot_conflict{slot}` | `resolvePrepareInput` | LLM mandou valor divergente do envelope |
| `inbound_slots` / `slots_applied` | `pipeline_turn_traces` (flag `PRO_PIPELINE_TURN_TRACE`) | sempre que a flag está ligada |

`slot_dropped` é o alarme que teria pego o sintoma de 2026-09-21 no primeiro pedido.

---

## Alternativas rejeitadas

| Alternativa | Por que não |
|---|---|
| Corrigir só `coalescePrepareUniqueHits` (passar endereço/pagamento ali) | Fecha o print de hoje e deixa sete call sites abertos; o nono nasce sem slot |
| Deixar a LLM sempre chamar `prepare_order_draft` com tudo | Depende de o modelo lembrar; contraria ADR 0005 D1 e não cobre caminhos server-only (batch, pick, endereço salvo) |
| Slot extraction via LLM dedicada (tool `extract_slots`) | +1 round-trip por turno, custo e p95 piores, não determinístico, sujeito a 429 — endereço e pagamento são regex-friendly |
| Parâmetro `slots` opcional com default | Dual-path silencioso: o call site esquecido volta a compilar e o bug volta a ser invisível (vedado por pré-produção radical) |
| Guardar o envelope na sessão | Vira estado a sincronizar e a invalidar; derivado do texto do turno já basta (D4 cobre idempotência) |

---

## Consequências

**Positivas**

- Perda de endereço/pagamento em mensagem completa deixa de ser possível por caminho esquecido.
- Um lugar para ler "o que o cliente disse neste turno" ao depurar.
- Menos chamada de LLM em multi-item (D8) — custo e p95 caem.
- Anti-alucinação uniforme para endereço e troco, hoje só existente para pagamento.
- Regressão futura vira métrica, não relato de cliente.

**Negativas / custo**

- Mudança de assinatura em função central com oito consumidores + port + adapter (commit único, grande).
- Heurística de endereço em português continua imperfeita: frase muito fora do padrão gera `addressLine: null` e o fluxo pergunta normalmente (degradação segura, igual a hoje).
- D7 pode "esconder" endereços salvos que o cliente reconhecia como seus; mitigado por o fluxo pedir rua/número/bairro e regravar limpo.

---

## Checklist de execução

### Fase 1 — Núcleo (fecha o sintoma) — **feita 2026-09-22**

- [x] `InboundSlots` + `EMPTY_INBOUND_SLOTS` em `contracts.ts`.
- [x] `extractInboundSlots` puro + testes de tabela (frase → envelope), incluindo a frase do sintoma (`tests/pro/inboundSlots.test.ts`).
- [x] `resolvePrepareInput` (precedência D3 + anti-alucinação); `sanitizePreparePayment.ts` **apagado** (absorvido), testes portados.
- [x] `slots` obrigatório em `prepareOrderDraftFromTool` (`PrepareTurnContext`) e no `OrderDraftPort`.
- [x] Nove call sites atualizados; `coalescePrepareUniqueHits` deixa de mandar `address: null`. Envelope calculado 1× em `runProPipeline` e propagado (`TurnState.inboundSlots` para as tools, `AiServiceInput.inboundSlots` para o serviço).
- [x] `recentUserText` (histórico concatenado) removido de `serverPrepareAfterProductPick` — era caminho para endereço/pagamento antigo reentrar num turno de pick.
- [x] `tests/pro/prepareCallSitesAudit.test.ts` (D6) — inventário + sem `as any`.
- [x] `npm test` verde (1823 testes) + `tsc --noEmit` limpo.
- [x] Deploy dos workers (`npm run deploy:workers`) — `renthus-inbound-worker` v76 em `:live`, provisioned concurrency 1 READY, ESM apontando para o alias.
- [ ] Smoke WhatsApp da mensagem completa em produção (depende de mensagem real do dono no número da loja).

### Fase 2 — Guardas

- [ ] `pro_pipeline.slot_dropped` + `slot_conflict`.
- [ ] `inbound_slots` / `slots_applied` no turn trace.
- [ ] Cassete de replay da mensagem completa (itens + endereço + PIX em um turno).

### Fase 3 — Dados

- [ ] D7: placeholder rejeitado em `isAddressStructurallyComplete` e `buildAiAddressFromSavedClienteRow` + testes.
- [ ] Levantamento de `enderecos_cliente` com placeholder (lista ao dono **antes** de qualquer escrita).
- [ ] Limpeza aprovada aplicada via RPC/migration, conforme decisão do dono.

---

## Critérios de aceite (produto)

1. Mensagem com itens + endereço + forma de pagamento num único texto: carrinho monta com endereço, modalidade **entrega** inferida e pagamento retido; o resumo aparece direto, sem card Entrega/Retirar e sem repergunta de pagamento.
2. Mesma mensagem **sem** endereço: fluxo pede rua, número e bairro (cidade/UF da loja), pagamento informado continua retido.
3. Mesma mensagem **sem** pagamento: endereço entra, resumo aparece, botões de pagamento depois do Confirmar.
4. Cliente com endereço salvo contendo placeholder: oferta não aparece; bot pede endereço.
5. Turno de pick (`1`, `caixa`) ou de botão não reaplica endereço/pagamento de mensagem anterior (D4).
6. Modelo que "inventa" PIX ou endereço sem o cliente ter dito: valor descartado, `slot_conflict` emitido.

## Critérios de aceite (engenharia)

7. Nenhuma chamada de prepare em `src/pro/**` sem envelope (auditoria D6 verde).
8. `extractInboundSlots` sem I/O — provado por teste que roda a função sem client Supabase nem rede.
9. Multi-item deixa de gastar `extract_order_lines` quando o lexical cobre a frase, sem regressão nos cassetes do ADR 0011.
