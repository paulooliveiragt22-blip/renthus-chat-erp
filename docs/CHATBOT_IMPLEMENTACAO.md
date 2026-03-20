# Chatbot WhatsApp — Documentação Completa

Documentação do chatbot de pedidos via WhatsApp do Renthus Chat + ERP. Motor de processamento em `lib/chatbot/processMessage.ts`, parser de intenções em `lib/chatbot/OrderParserService.ts`.

---

## 1. Visão Geral

O chatbot permite que clientes façam pedidos de bebidas via WhatsApp com fluxo guiado (catálogo) ou **texto livre** (ex.: "manda 2 heineken na rua passo fundo 1627").

### Fluxo principal

```
welcome → main_menu → catalog_categories → catalog_products
   → cart → checkout_address → awaiting_address_number
   → checkout_payment → checkout_confirm → main_menu (pedido concluído)
                                                      ↘ handover (atendente humano)
```

### Entrada de mensagens

| Provedor | Endpoint |
|----------|----------|
| Meta Cloud API | `POST /api/whatsapp/webhook` |
| Twilio | `POST /api/whatsapp/incoming` |

Ambos chamam `processInboundMessage()` após salvar a mensagem e verificar se o bot está ativo.

---

## 2. Interceptor Global de Intenções (OrderParserService)

**Toda mensagem** com `input.length >= 3` passa primeiro pelo `OrderParserService.parseIntent()` antes do roteamento por step.

### Ordem de processamento

1. **Extração de endereço** — Identifica padrões (rua, av, avenida, travessa, etc.) + número.
2. **Remoção do endereço** — O trecho de endereço é removido antes da busca de produtos, evitando que "rua" seja enviado ao Fuse.js.
3. **Extração de produtos** — O texto restante é enviado ao Fuse.js para busca fuzzy.
4. **Validação de endereço** — Se configurado, chama Google Geocoding API.

### Ações retornadas

| Ação | Descrição |
|------|-----------|
| `add_to_cart` (com itens) | Produtos encontrados → merge no carrinho, confirmação |
| `add_to_cart` (só endereço) | Apenas endereço → atualiza contexto, mantém carrinho |
| `confirm_order` | Produto + endereço na mesma frase → vai para checkout |
| `low_confidence` | Confiança < 0,3 → fallback inteligente (em steps não livres) |
| `product_not_found` | Nenhum produto identificado |
| `invalid` | Mensagem muito curta ou inválida |

### Resposta ao adicionar produtos

> ✅ Adicionado 2x Heineken 350ml!
>
> Seu pedido agora tem **1** itens.
>
> Podemos continuar com **menu** ou quer algo mais?

---

## 3. Extração de Quantidade

O parser reconhece:

- **Números:** "2 skol", "10 brahma"
- **Palavras:** um/uma → 1, dois/duas → 2, três → 3, etc.
- **Com verbos:** "manda duas heineken" → qty = 2, produto = heineken

Verbos removidos antes da extração: quero, manda, traga, por favor, etc.

---

## 4. Endereço

### Detecção

- Padrão: `(rua|av|avenida|travessa|...)\s+nome\s+número`
- Bairro opcional após o número
- Fallback: texto após "na rua", "no bairro", etc.

### Validação (Google)

- `GOOGLE_MAPS_API_KEY` necessária
- Geocoding API precisa estar habilitada no Google Cloud Console
- Se faltar número: step `awaiting_address_number`, pergunta o número

### Logs

- `[OrderParserService] Endereço identificado:` — quando o endereço é detectado
- `[OrderParserService] Texto para busca de produtos:` — texto enviado ao Fuse.js
- `[OrderParserService] Chamando API do Google Geocoding para:` — antes da chamada à API

---

## 5. Comandos Globais

Funcionam em qualquer step:

| Comando | Ação |
|---------|------|
| cancelar, limpar, esvaziar, menu, oi, olá | Zera sessão e carrinho, volta ao menu |
| atendente, humano, ajuda | Handover para atendente humano |
| fechar, pagar, finalizar, acabou | Atalho para checkout (se carrinho não vazio) |

---

## 6. Resumo do Pedido (`sendOrderSummary`)

Função que envia o resumo estruturado no WhatsApp:

- **Itens do carrinho** com preços do ERP
- **Endereço validado**
- **Total com frete**
- **3 botões interativos:**
  - ✅ Confirmar pedido
  - 🔄 Alterar itens
  - 📍 Mudar endereço

### Validação de endereço completo

Se faltar **número da casa**, o botão "Confirmar" não aparece. O bot pergunta o número e mostra apenas "Alterar itens" e "Mudar endereço".

---

## 7. Fallback Inteligente (`low_confidence`)

Quando o parser retorna confiança < 0,3 e o usuário **não** está em step de texto livre (ex.: `checkout_confirm`, `catalog_categories`):

- **1ª vez:** pergunta se quer adicionar produto ou falar com atendente + botões (Ver cardápio, Status, Atendente)
- **2ª vez:** envia **List Message** com categorias de produtos do ERP

Steps considerados "texto livre": `main_menu`, `welcome`, `catalog_products`, `cart`.

---

## 8. Persistência e Checkout

- Após adicionar produtos ou erros, o fluxo retorna ao último ponto de verificação (checkout).
- Ao confirmar o pedido (insert no Supabase retorna sucesso):
  - **Cart zerado**
  - **Step = main_menu**
  - `last_order_id` no contexto

---

## 9. Tabelas e Dados

| Tabela/View | Uso |
|-------------|-----|
| `chatbot_sessions` | Sessão por thread: step, cart, context, expires_at |
| `view_chat_produtos` | Produtos/embalagens para busca (Fuse.js e getCachedProducts) |
| `delivery_zones` | Zonas de entrega e taxas por bairro |
| `chatbots` | Config por company (is_active) |

---

## 10. Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `GOOGLE_MAPS_API_KEY` | Geocoding API para validação de endereços |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role para backend |

---

## 11. Arquivos Principais

| Arquivo | Função |
|---------|--------|
| `lib/chatbot/processMessage.ts` | Motor principal, fluxo por step, handlers |
| `lib/chatbot/OrderParserService.ts` | Parser de intenções, Fuse.js, validação de endereço |
| `lib/chatbot/TextParserService.ts` | getCachedProducts, validateAddressViaGoogle |
| `app/api/whatsapp/webhook/route.ts` | Webhook Meta Cloud API |
| `app/api/whatsapp/incoming/route.ts` | Webhook Twilio |

---

## 12. Diagnóstico

Para troubleshooting, ver `docs/DIAGNOSTICO_CHATBOT.md`.

**Teste rápido:** enviar `2 skol` ou `manda duas heineken na rua X 123`. Resposta esperada: "Adicionado 2x Skol...!" em vez de lista de variantes ou menu.

---

## 13. Changelog (Resumo)

- **Interceptor global** com OrderParserService em toda mensagem
- **Prioridade de extração:** endereço primeiro, depois produtos (evita buscar "rua" como produto)
- **Quantidade por extenso:** um/uma, dois/duas etc., inclusive após verbos
- **Comandos cancelar/limpar** zeram sessão e carrinho
- **sendOrderSummary(session)** com 3 botões e validação de número do endereço
- **Fallback inteligente** para low_confidence (pergunta → List Message de categorias)
- **Limpeza de sessão** após pedido criado (step = main_menu, cart = [])
- **Logs** de endereço e chamada à API do Google
