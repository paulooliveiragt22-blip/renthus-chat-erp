# Diagnóstico: Bot não refletindo as novas mudanças

> 📘 **Documentação completa do chatbot:** `docs/CHATBOT_IMPLEMENTACAO.md`

## Fluxo de mensagens

```
WhatsApp → [webhook/incoming] → processInboundMessage() → Resposta
```

- **Meta Cloud API**: `POST /api/whatsapp/webhook`
- **Twilio**: `POST /api/whatsapp/incoming`

---

## Checklist de diagnóstico

### 1. Webhook aponta para a URL correta?

O webhook do WhatsApp precisa apontar para a **URL de produção**:

- Meta: `https://renthus-chat-erp.vercel.app/api/whatsapp/webhook`
- Twilio: `https://renthus-chat-erp.vercel.app/api/whatsapp/incoming`

Se estiver em staging, ngrok ou outra URL, as mudanças em produção não vão ser usadas.

**Como checar:**
- Meta: Meta for Developers → App → WhatsApp → Configuração → Webhook
- Twilio: Console Twilio → Messaging → WhatsApp Sandbox / Senders

---

### 2. Deploy mais recente está em produção?

O deploy via `npx vercel --prod` usa os arquivos locais. Se o Vercel estiver ligado ao Git e fizer auto-deploy em cada push, o deploy manual pode ter sido sobrescrito.

**Como checar:**
1. Vercel Dashboard → Projeto → Deployments
2. Ver qual é o último deployment de produção
3. Conferir se é posterior às suas alterações

---

### 3. `view_chat_produtos` tem dados?

O interceptor usa `getCachedProducts()` em `view_chat_produtos`. Se a view estiver vazia, `parseIntent` não encontra produtos e sempre retorna `product_not_found`.

**Como checar (SQL no Supabase):**
```sql
SELECT COUNT(*) FROM view_chat_produtos WHERE company_id = 'SEU_COMPANY_ID';
```

Se retornar 0, cadastre produtos/embalagens para essa empresa.

---

### 4. Ordem de prioridade do fluxo

O interceptor global só roda se:

- `input.length >= 3` (ex.: "2 skol" funciona; "oi" ou "1" não)
- O parser **não** retornar `product_not_found` ou `invalid`

Quando o parser retorna `product_not_found`, o fluxo continua para os handlers antigos (`handleFreeTextInput` com `searchVariantsByText`), que usam outra lógica de busca.

Se `searchVariantsByText` acha o produto e `OrderParserService` não, o usuário continua vendo o comportamento antigo.

---

### 5. Logs em produção (Vercel)

**Como checar:**
1. Vercel Dashboard → Projeto → Logs (Runtime Logs)
2. Filtrar por `/api/whatsapp/webhook` ou `/api/whatsapp/incoming`
3. Enviar uma mensagem de teste e verificar:

- `[chatbot] processInboundMessage START`
- `[chatbot] session step: X | cartItems: Y | input: Z`
- Erros ou stack traces

Se `processInboundMessage` não aparecer, o problema está antes (webhook, canal, etc.).

---

### 6. Variáveis de ambiente no Vercel

O bot depende de:

- `GOOGLE_MAPS_API_KEY` – validação de endereço
- `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` – banco

**Como checar:**
Vercel → Projeto → Settings → Environment Variables

---

### 7. Canal ativo e bot ligado

O webhook não chama o chatbot se:

- Nenhum canal Meta ativo para o `phone_number_id`
- `bot_active = false` na thread (handover para humano)

**Como checar (SQL):**
```sql
SELECT id, status, provider_metadata->>'phone_number_id' 
FROM whatsapp_channels 
WHERE provider = 'meta' AND status = 'active';
```

---

## Teste rápido recomendado

1. Enviar pelo WhatsApp: `2 skol` (ou produto cadastrado).
2. Se o interceptor estiver OK, a resposta deve ser:
   > Adicionado 2x Skol 350ml! Seu pedido agora tem 1 itens. Podemos continuar com menu ou quer algo mais?

3. Se a resposta for a antiga (ex.: lista de variantes ou outro fluxo), o fluxo está indo pelos handlers antigos e não pelo interceptor.

---

## Possíveis correções

| Situação | Ação |
|----------|------|
| Webhook em URL errada | Atualizar URL na Meta/Twilio |
| Deploy antigo em produção | Fazer novo deploy: `npx vercel --prod` |
| `view_chat_produtos` vazia | Cadastrar produtos para a empresa |
| Parser muito restritivo | Revisar threshold do Fuse no OrderParserService (0.4) |
| Erros silenciosos | Ver logs do Vercel para stack traces |

---

## Logs adicionais sugeridos

Para entender o fluxo, dá para adicionar logs no interceptor:

```ts
// Em processMessage.ts, logo após o parseIntent:
console.log("[chatbot] interceptor parseIntent result:", parsed.action, 
  parsed.action === "add_to_cart" ? (parsed as any).items?.length : "");
```

Isso permite ver no Vercel se o interceptor está rodando e qual ação está sendo retornada.
