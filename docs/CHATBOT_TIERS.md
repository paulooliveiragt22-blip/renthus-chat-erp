# Chatbot Starter vs Chatbot PRO

O motor de mensagens inbound (`lib/chatbot/processMessage.ts`) escolhe o pipeline com base no **plano ativo** da empresa (`subscriptions` → `plans.key`).

| Plano (`plans.key`) | Motor | Arquivos principais |
|---------------------|--------|------------------------|
| **`starter`** (ou sem subscrição ativa) | **Chatbot Starter** — comportamento **flow-first** existente: `order_intent` abre o WhatsApp Flow de catálogo. | `lib/chatbot/inboundPipeline.ts` (`starterOrderFlow`) |
| **`pro`** | **Chatbot PRO** — IA (Haiku) com tools `search_produtos`, `get_order_hints`, `prepare_order_draft`; endereço “de sempre”; estoque/preço no servidor; confirmação PT-BR; RPC `create_order_with_items` (`ai_chat_pro`); após **4** `INTENT_UNKNOWN`, Flow de catálogo. | `lib/chatbot/pro/*.ts` (ver `CHATBOT_AI_FIRST_ORDER_SPEC.md` §9) |

Resolução do plano: `lib/chatbot/tier.ts` → `getChatbotProductTier()`.

Mapeamento comercial Pagar.me / checkout (`bot` / `complete`) para linhas lógicas `starter` / `pro` já existe em `lib/billing/pagarmeSetupPaid.ts`.

---

## Próximas fases (Chatbot PRO)

Ver `docs/CHATBOT_AI_FIRST_ORDER_SPEC.md`: confirmação de pedido, endereço obrigatório, estoque, RPC `create_order_with_items`, “endereço de sempre”, gírias de confirmação sem regex, etc.

---

*Última atualização: introdução dos dois motores ligados ao plano.*
