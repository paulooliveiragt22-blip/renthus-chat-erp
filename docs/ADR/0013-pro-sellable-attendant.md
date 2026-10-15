# ADR 0013 — Agente PRO: atendente vendável (boca do servidor, endereço entregável, status, prontidão)

**Status:** aceito (2026-10-14) — fatias 1 a 4 no código. A view da fatia 4 está no banco remoto. O worker do chatbot não muda com esta fatia.
**Data:** 2026-10-14
**Aprovação do dono:** 2026-10-14 (estrutura das quatro fatias aprovada; esta ADR registra antes do código)
**Escopo técnico:** o que ainda impede vender o chatbot PRO como atendimento de delivery — uma boca por turno de pedido, endereço salvo oferecido só se for entregável, status do pedido em uma frase, prontidão da loja como leitura.
**Escopo comercial:** **não** muda preço, taxa, mínimo, formas de pagamento, confirmação por botão, cupom, adicional de cozinha, pedido agendado nem cobrança PIX antecipada. `S/N` com bairro e cidade reais continua endereço válido.
**Predecessor:** [`ADR/0005`](./0005-pro-agent-calibration-pillars.md) (D1: *LLM interpreta; servidor decide*), [`ADR/0012`](./0012-inbound-slot-envelope.md) (envelope de slots; D7 de placeholder **afinado** aqui)
**Relacionados:** [`CHATBOT_PROD.md`](../CHATBOT_PROD.md), [`PRO_ORDER_SLOT_MACHINE.md`](../PRO_ORDER_SLOT_MACHINE.md), [`PLANO_CALIBRACAO_AGENTE_PRO.md`](../PLANO_CALIBRACAO_AGENTE_PRO.md) (C2.1 vira a fatia 4)
**Governança:** `projeto-pre-producao-radical.mdc` (sem dual-path), `agente-pro-hexagonal.mdc`, `decisoes-negocio-antes-codigo.mdc` (sem preço, cupom ou modificador novos)

---

## Contexto

O ciclo de pedido do PRO já cobre o que um piloto de bebida ou conveniência cobra na entrega: catálogo com preço e embalagem, carrinho no servidor, entrega ou retirada, taxa, mínimo e previsão no rascunho, cartão canônico de endereço (`serverOfferDeliveryAddress`), PIX/cartão/dinheiro com troco, confirmação só por botão, repasse para atendente, cardápio web se a IA cair, e recuperação de carrinho na janela de 24 h.

O que falta para vender não é outra feature de marketplace. São quatro furos, nesta ordem:

1. **A bolha ainda pode ser do modelo.** `checkoutPostProcess` repassa o texto da IA. Só o “um momento” sem item novo é trocado (`replaceHoldingOnlyReply`). No turno de duas marmitas o carrinho e o cartão de endereço estavam certos e a IA descreveu o produto por conta própria.
2. **Placeholder ainda é oferecido.** `buildAiAddressFromSavedClienteRow` e `isAddressStructurallyComplete` aceitam qualquer string não vazia. O pedido que propôs «Rua turmalina 34, S/N, bairro `-`, cidade `(completar)`» passou porque o cadastro era `is_principal`. O cliente confirmou.
3. **«Cadê meu pedido?» não fecha numa frase.** `orderStatusFaq.ts` já lista até três pedidos com rótulo, antes do modelo, quando o regex casa e há `customerId`. Não traz a previsão. Se essa resposta vier vazia, `routeStage` manda o CTA do cardápio ou «consulta não configurada».
4. **A loja não liga o canal sozinha.** C2.1 (sigla, preço, estoque, zona) segue checklist de operação. Não há leitura que diga «pronto» ou «falta isto».

### O que esta ADR não reabre

Cartão canônico de endereço (um proposto + os demais, Confirmar / Novo). Apelido digitado pelo cliente **não** escolhe o endereço; o cliente sempre confirma. Sem card paralelo «mais usado vs último pedido». Sem casar «casa» / «trabalho» com apelido.

---

## Decisão

Quatro fatias, nesta ordem. Cada uma entra sozinha. A seguinte não começa antes da anterior estar no ar com teste. Não há modo degradado da conversa enquanto a loja está incompleta.

### D1 — Uma boca no turno de pedido

Função pura `composeServerOwnedOutbound` em `src/pro/pipeline/composeServerOwnedOutbound.ts`.

Quando o outbound do turno já tem botão ou resumo de carrinho do servidor, bolha de texto livre do modelo é descartada. Fica o texto que o servidor montou (resumo, clarificação de embalagem, cartão de endereço, pagamento, estoque).

Quando o turno **não** tem cartão do servidor (saudação, «tem marmita?», pergunta sem rascunho), o texto do modelo permanece.

Chamada única em `checkoutPostProcess`, no lugar do `replaceHoldingOnlyReply` solto. O modelo continua classificando e chamando ferramenta. Quem fala com o cliente no turno de pedido é o apresentador.

`replaceHoldingOnlyReply` deixa de ser um segundo apresentador: ou entra dentro do compositor, ou o compositor cobre o caso «um momento» sem item novo.

### D2 — Endereço oferecido só se for entregável

Afina o D7 do [`ADR/0012`](./0012-inbound-slot-envelope.md). O cartão canônico não muda. Muda quem entra na lista.

Predicado único, usado por `buildAiAddressFromSavedClienteRow` (e portanto por `listCompleteSavedAddresses` / `pickProposedDeliveryAddress`):

| Valor em `numero`, `bairro` ou `cidade` | Resultado |
|---|---|
| vazio | não entregável (já vale hoje) |
| `-`, `--`, `(completar)`, `completar` (sem distinção de maiúsculas) | não entregável |
| só pontuação | não entregável |
| `S/N` ou `SN` **em `numero`**, com bairro e cidade que passam nas linhas acima | **entregável** |

`S/N` com bairro `-` ou cidade `(completar)` não é oferecido — foi o cadastro «Chatbot» do turno real.

Se nenhum salvo restar, o fluxo pede endereço novo, como já faz com lista vazia.

Sem migration e sem `DELETE` em `enderecos_cliente`. O cadastro incompleto continua para a loja corrigir. A Fase 3 do ADR 0012 que previa lista ao dono e limpeza por escrita **não** faz parte desta fatia.

### D3 — Status em uma frase

Estender `tryBuildOrderStatusReply` (`src/pro/pipeline/orderStatusFaq.ts`). Não criar um segundo FAQ.

- Pergunta de um pedido («cadê meu pedido», «status»): uma frase do pedido aberto mais recente — código, rótulo atual (`publicMenuOrderStatusLabel`) e previsão quando o pedido tiver `deliveryEtaMin` (ou o equivalente já gravado no pedido).
- «Meus pedidos»: até três linhas, como hoje, com a previsão na linha do pedido aberto.
- O cardápio de pedidos, se `ordersMenuUrl` existir, sai num botão `cta_url` (**Acompanhar**). A URL não entra no texto.

`routeStage` deixa de emitir o CTA de `status_intent` / `btn_status` quando essa resposta existir. O CTA ou o texto «consulta não configurada» permanece só sem `customerId` ou sem pedido.

### D4 — Prontidão da loja (depois das três primeiras)

Não muda o pipeline e não degrada a conversa. Leitura para o admin, o checklist C2.1 virando tela.

- View `v_sec_bot_readiness` filtrada por `company_id` (SELECT de domínio; a tabela base não abre no browser — `governanca-seguranca-negocio.mdc`).
- Campos que a leitura cobre: preço de venda na embalagem, estoque, sigla comercial, zona de entrega com taxa, horário, e um endereço de referência da loja.
- Configurações → Canais mostra o que falta. O canal WhatsApp só marca «pronto» quando a leitura passar.

Fora desta view: volume, fator e EAN continuam dados de catálogo (C2.1 ops). Não entram como gate desta fatia.

---

## Fora de escopo

Não implementar nesta ADR, nem como “já que estamos no arquivo”:

- Grupo de adicional, meio a meio, observação de cozinha, combo.
- Cupom, fidelidade, pedido agendado.
- PIX cobrado dentro do WhatsApp (link de cobrança). Para quem recebe na entrega, o botão PIX basta.
- Casar apelido digitado com `enderecos_cliente`.
- Reabrir o card de dois endereços («mais usado» vs «último pedido»).

---

## Estrutura de pastas (alvo)

```text
src/pro/pipeline/composeServerOwnedOutbound.ts          # D1, função pura
src/pro/pipeline/stages/checkoutPostProcess.ts          # única chamada do compositor
src/pro/tools/resolveSavedAddress.ts                    # D2, predicado no builder
src/pro/pipeline/orderDraftGate.ts                      # D2, mesma regra em isAddressStructurallyComplete
src/pro/pipeline/orderStatusFaq.ts                      # D3
src/pro/pipeline/stages/routeStage.ts                   # D3, CTA só no vazio

# D4, só depois de D1–D3 no ar
supabase/migrations/<ts>_v_sec_bot_readiness.sql        # view + revoke da base se nascer tabela
app/(admin)/... Canais                                  # lista do que falta

tests/pro/composeServerOwnedOutbound.test.ts
tests/pro/resolveSavedAddress.test.ts                   # S/N válido; "-" e "(completar)" fora
tests/pro/orderStatusFaq.test.ts

docs/ADR/0013-pro-sellable-attendant.md                 # este arquivo
```

O predicado de endereço entregável mora num lugar. `isAddressStructurallyComplete` e `buildAiAddressFromSavedClienteRow` chamam o mesmo predicado — dois critérios divergentes foi o que deixou o placeholder passar.

---

## Alternativas rejeitadas

| Alternativa | Por que não |
|---|---|
| Pedir ao modelo, no prompt, para não narrar o carrinho | O turno das marmitas já tinha o cartão certo e a prosa saiu mesmo assim |
| Rejeitar todo `S/N` (D7 literal do ADR 0012) | `S/N` com bairro e cidade reais é endereço entregável; o dono manteve isso em 2026-10-14 |
| Apagar ou reescrever `enderecos_cliente` com placeholder nesta entrega | A fatia 2 só tira o cadastro da oferta; limpeza é decisão de dado à parte |
| Novo classificador de status | `orderStatusFaq` já responde antes do modelo; falta a frase e a previsão |
| Bloquear o webhook enquanto a loja está incompleta | A conversa não ganha modo degradado; a prontidão é tela de admin (D4) |
| Modificador / cupom / PIX antecipado antes do piloto | Outro segmento ou outra cobrança; não fecha os quatro furos |

---

## Consequências

**Positivas**

- Turno com carrinho ou cartão deixa de competir com uma frase do modelo.
- Principal incompleto deixa de ser o endereço proposto.
- «Cadê meu pedido?» responde o pedido aberto, com previsão quando existir.
- A loja vê o que falta antes de o canal ser marcado pronto.

**Negativas / custo**

- Saudação e pergunta sem cartão continuam em texto de modelo — de propósito.
- Endereço com `S/N` e bairro real continua sendo oferecido e confirmado pelo cliente.
- D4 é tela e view; não muda o hot path e não entra no mesmo deploy das fatias 1–3.

---

## Checklist de execução

Implementar **nesta ordem**. Não marcar item sem teste e, nas fatias 1–3, sem `npm test`.

### Fatia 1 — Boca do servidor — feita

- [x] `composeServerOwnedOutbound` + teste: item novo + frase da IA devolve só o resumo; turno sem cartão mantém o texto do modelo; «um momento» com preço e sem item novo vira a pergunta de produto.
- [x] `checkoutPostProcess` chama o compositor. A oferta de endereço entra depois, então `runProPipeline` chama a mesma função de novo com as bolhas do modelo.

### Fatia 2 — Endereço entregável — feita

- [x] Predicado único (`isDeliverableAddressFields`); `S/N` + bairro e cidade reais passa; `-` e `(completar)` não passam.
- [x] Oferta canônica não propõe o cadastro incompleto; lista vazia pede endereço novo (caminho já existente quando `pickProposed` é nulo).
- [x] Nenhuma escrita em `enderecos_cliente`.

### Fatia 3 — Status — feita

- [x] Uma frase do pedido aberto + previsão da loja (`companies.settings.delivery_est_minutes`) quando houver; «meus pedidos» / `btn_status` mantém até três linhas. Retirada não leva previsão de entrega. O pedido não grava ETA próprio.
- [x] O cardápio de pedidos vai no botão **Acompanhar**, no mesmo formato do cardápio. `routeStage` só manda o CTA sozinho quando o FAQ não respondeu (sem cliente ou sem pedido).

### Fatia 4 — Prontidão — feita

- [x] `v_sec_bot_readiness` aplicada no remoto. Sem tabela nova. `anon` e `authenticated` sem grant; `select` só para `service_role`. A API `GET /api/admin/bot-readiness` valida a empresa antes de ler.
- [x] Canais lista preço, estoque, sigla, zona com taxa, horário e endereço da loja. O selo Pronto só aparece com o canal conectado e `ready`. A conversa não lê esta view.

---

## Critérios de aceite (produto)

1. Turno que monta carrinho ou manda cartão de endereço, pagamento ou embalagem: o cliente vê só o texto e os botões do servidor.
2. «Tem marmita?» sem rascunho continua podendo ser texto do modelo.
3. Cadastro principal com bairro `-` ou cidade `(completar)` não é proposto; o cliente cai no pedido de endereço novo se não houver outro salvo entregável.
4. `S/N` com bairro e cidade reais ainda pode ser proposto, e o cliente confirma no cartão canônico.
5. «Cadê meu pedido?» devolve uma frase do pedido aberto (código, situação e previsão quando existir), sem o modelo narrar.
6. Canal não é marcado pronto enquanto preço, estoque, sigla, zona com taxa, horário ou endereço da loja faltarem. A conversa em si não muda por causa disso.
