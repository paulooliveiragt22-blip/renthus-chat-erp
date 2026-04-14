# Especificação — Pedido com IA primeiro, Flow após falhas (estrutura)

Documento de desenho e **fases de implementação**. A **Fase 1** já está no código: plano `pro` usa `handleProOrderIntent` (tool `search_produtos` + contador `pro_misunderstanding_streak` + Flow após 4× `INTENT_UNKNOWN`); plano `starter` mantém o flow-first. As secções abaixo descrevem o produto alvo completo.

---

## 1. Objetivo do produto

1. O cliente fala em **linguagem natural** (ex.: pedido + morada na mesma frase).
2. A **IA (Claude Haiku / Anthropic)** tenta **montar e fechar o pedido** com dados da base (produto/embalagem, stock, endereço).
3. Só **depois de esgotar tentativas válidas** é enviado o **WhatsApp Flow** de catálogo, com mensagem amigável.
4. **Primeiro contacto** pode ser **já com IA** (não é obrigatório forçar Flow na primeira vez).

---

## 2. Contador de tentativas — **4 tentativas**

### 2.1 O que **incrementa** o contador

Conta **+1** apenas quando a mensagem/texto representa uma situação em que a **IA não entendeu a intenção** ou **não conseguiu avançar** no sentido de clarificar o pedido de forma útil (ex.: texto ambíguo demais, fora de contexto, contraditório sem resolução, pedido impossível de mapear a produtos após uso das ferramentas).

### 2.2 O que **não incrementa** (não conta como “erro” / tentativa falhada)

- Pedido explícito de **dado em falta**: número da casa, bairro, forma de pagamento, complemento, CEP, etc.
- Perguntas de **esclarecimento** da IA e resposta normal do cliente com esse dado.
- **Confirmação final** (“sim”, “ok”, “manda ver”, “isso aí”, etc.) — faz parte do fecho, não de falha.

Resumo: o contador mede **falhas de interpretação / impasse**, não **turnos de formulário** para completar morada ou pagamento.

---

## 3. Obrigatório para criar `order`

| Requisito | Detalhe |
|-----------|---------|
| **Itens** | Pedido **nunca** é criado sem linhas de item (validação server-side obrigatória). |
| **Endereço** | **Rua**, **número** e **bairro** obrigatórios (normalizados / validados no servidor). |
| **Embalagem** | Sempre associada a **`produto_embalagens`** (nunca “produto genérico” sem embalagem escolhida). |
| **Confirmação explícita** | Após resumo (produtos, quantidades, pagamento, endereço), só criar pedido após **“ok”** do cliente no sentido de aceite (incluir **gírias**: *sim*, *ok*, *isso aí*, *manda ver*, *pode mandar*, *fechou*, *é isso*, etc. — lista extensível e/ou classificador leve). |

### 3.1 “Endereço de sempre” / último / mais pedido

- Deve existir opção de o cliente dizer: **“endereço de sempre”**, **“o de sempre”**, **“igual ao último”**, **“o do último pedido”**, etc.
- Comportamento: resolver contra **último endereço usado** em pedido entregue / **endereço principal** em `enderecos_cliente` / **endereço mais frequente** — regra de prioridade a definir na implementação (documentar qual vence empate).
- **Sempre** apresentar ao cliente o endereço resolvido (rua, número, bairro) e pedir **confirmação** antes de gravar pedido (salvo política explícita futura).

### 3.2 Quantidade

- **Sempre confirmar quantidade** explicitamente (mesmo que o modelo já tenha inferido “1”).

---

## 4. Produto e embalagens (UX da IA)

### 4.1 Cliente refere produto genérico (“heineken”, “cerveja”)

- Se houver **várias embalagens** para o mesmo `products.name` (ou mesmo produto lógico), a IA **não** assume; pergunta: *“Qual Heineken você quer?”* listando opções com texto construído a partir de:
  - `produto_embalagens.descricao`
  - `produto_embalagens.volume_quantidade`
  - `produto_embalagens.id_unit_type` (resolver para nome legível da unidade, ex. ml, L, un)
- Apresentação **agrupada por `products.name`**, com lista de embalagens sob esse produto.

### 4.2 “A de sempre” / último pedido / mais pedida

- **“A de sempre”** / **“a que mais peço”** / **“igual ao último”**: resolver via histórico de pedidos do cliente (telefone/`customer_id`) — **sempre** confirmar produto **e** quantidade antes de fechar.

### 4.3 Fator de conversão / múltiplas unidades (ex.: un vs caixa c/15)

- Se a embalagem tiver **mais de um** `fator_conversao` (ou equivalente no modelo de dados), mostrar opções claras (ex.: **un** vs **cx c/15**).
- O item da `order` deve gravar a **embalagem** e a **quantidade na unidade comercial** escolhida (coerente com o resto do ERP).

### 4.4 Pergunta exploratória: “Quais cervejas vocês têm?”

- IA **consulta** a base (categoria / tipo produto) e responde com **até 5** produtos/embalagens (definir critério: mais vendidos, ordem alfabética, destaque — a fixar).
- Se existirem **mais de 5** resultados: dizer que há essas **e outras**, perguntar se quer **algo específico** ou ver **cardápio/catálogo** — **sem mostrar preços** nessa fase (opcional mostrar preço só após escolha de embalagem ou no resumo final).

---

## 5. Fluxo após 4 tentativas válidas falhadas

- Enviar `sendFlowMessage` (mesmo `flowId` / `flowToken` de catálogo já usados hoje).
- Mensagem **amigável** (ex.: não conseguimos fechar pelo chat automático; usar o formulário garante stock e opções certas).
- Resetar contador / estado `ai_order_*` para não loop infinito; opcionalmente marcar `flow_offered` para não spammar.

---

## 6. Arquitetura técnica (referência, sem código)

| Peça | Função |
|------|--------|
| **Sessão** (`chatbot_sessions.context`) | `ai_order_attempts`, `ai_order_draft`, `flow_offered`, etc. |
| **Handler novo** | Ex.: `handleAiFirstOrder` chamado a partir de `order_intent` (e eventualmente heurísticas em texto livre). |
| **Ferramentas / passos servidor** | Busca produto/embalagem, stock, último endereço, top pedidos; **create order** só após validação + confirmação OK. |
| **RPC / serviço único** | Reutilizar lógica alinhada a `create_order_with_items` (paridade com Flow). |
| **Transição Flow** | Após limite de tentativas **válidas** (secção 2). |

---

## 7. Melhorias de produto (ajustadas à tua decisão)

| Melhoria | Nota |
|----------|------|
| Primeiro contacto | **Pode ser IA** desde o início (revogado o “só Flow no primeiro contacto”). |
| Telemetria | Taxa IA vs Flow, motivos de falha, tentativas até sucesso. |
| A/B ou config por empresa | `N=4` e listas de gírias em `chatbots.config`. |
| Handover | Oferecer humano se frustração explícita, independentemente do contador. |
| Limites de valor | Confirmação extra ou só Flow acima de X reais (futuro). |

---

## 8. Checklist de implementação (para quando for codar)

- [ ] Definir na BD/queries: agrupamento por `products.name`, joins `produto_embalagens`, `fator_conversao`, unidade.
- [ ] Serviço “resolver endereço de sempre / último / mais frequente”.
- [ ] Detector de confirmação (gírias PT-BR) + resumo obrigatório pré-`create_order`.
- [ ] Contador conforme secção 2 (só incrementa nos casos certos).
- [ ] Integração Anthropic com tool use; **nunca** confiar em preço/stock vindo só do modelo.
- [ ] Testes: frases reais, multi-embalagem, >5 produtos na categoria, “endereço de sempre”, recusa/confirmação.

---

## 9. Implementação no repositório (Fase 1)

- `lib/chatbot/tier.ts` — `getChatbotProductTier` (Starter vs PRO pelo `plans.key`).
- `lib/chatbot/processMessage.ts` — router para `runInboundChatbotPipeline`.
- `lib/chatbot/inboundPipeline.ts` — lógica comum; `order_intent` ramifica Starter vs PRO.
- `lib/chatbot/pro/handleProOrderIntent.ts` — Haiku + tool `search_produtos`; marcadores `INTENT_OK` / `INTENT_UNKNOWN`; contexto `pro_misunderstanding_streak`.

Ver também `docs/CHATBOT_TIERS.md`.

---

## 10. Relação com documentação antiga

- `docs/CHATBOT_IMPLEMENTACAO.md` referencia fluxos/`OrderParserService` que **não** batem com o motor atual **flow-first** em `lib/chatbot/processMessage.ts`.  
- Esta especificação é a **fonte de verdade** para o comportamento **IA primeiro → Flow após 4 falhas interpretativas** até a doc antiga ser revisada ou arquivada.

---

*Documento: estrutura de produto + referência à implementação por fases.*
