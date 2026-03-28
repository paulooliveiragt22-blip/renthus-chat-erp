# Contexto do Projeto — Renthus Chat ERP

> Leia este arquivo no início de toda nova sessão para ter contexto completo do projeto.

---

## O que é este projeto

Sistema SaaS multi-tenant de delivery via WhatsApp. Empresas usam o painel para gerenciar pedidos, produtos, clientes e atendimento. O chatbot processa mensagens recebidas pelo WhatsApp Cloud API (Meta).

**Stack**: Next.js 14 App Router + Supabase + Vercel + Meta WhatsApp Cloud API + Claude Haiku

---

## Arquitetura atual (2026-03-27)

### Fluxo de mensagem
```
Meta Webhook POST
  → app/api/whatsapp/incoming/route.ts
  → lib/chatbot/processMessage.ts (orquestrador)
  → intentDetector → parserChain → stepRouter
  → handlers (handleMainMenu, handleCatalog, handleCheckout...)
  → lib/whatsapp/send.ts (Meta API)
```

### WhatsApp Flows (Meta)
- `app/api/whatsapp/flows/route.ts` — endpoint criptografado (RSA-OAEP + AES-128-GCM)
- Flow Catálogo: `WHATSAPP_CATALOG_FLOW_ID` — CATEGORIES→PRODUCTS→QUANTITIES→ADDRESS→PAYMENT→SUCCESS
- Flow Checkout: `WHATSAPP_FLOW_ID` — CEP_SEARCH→ADDRESS→PAYMENT→SUCCESS
- `flow_token` format: `threadId|companyId|flowType`
- **NÃO modificar flows/route.ts sem manter criptografia**

### Multi-tenant
- Cada empresa tem um canal em `whatsapp_channels`
- `from_identifier` = Meta `phone_number_id`
- `provider_metadata` = `{ access_token, catalog_flow_id }` por empresa
- `WaConfig { phoneNumberId, accessToken }` em `lib/whatsapp/send.ts`

---

## Arquitetura atual: Flow-First ✅ IMPLEMENTADA (2026-03-27)

**Decisão**: pedidos somente via WhatsApp Flows. IA = assistente FAQ + redirecionador.

### Comportamento novo da IA
- "quanto custa a skol?" → responde info + "Para pedir, acesse o catálogo:" + botão Flow
- "quero pedir" → "Use nosso catálogo:" + botão Flow catálogo
- "onde meu pedido?" → botão Flow status
- "quero atendente" → handover para humano
- Dúvidas gerais → Claude responde + oferece opção de atendente

### Implementação concluída
- `lib/chatbot/`: 29 → 11 arquivos, build TS limpo (zero erros)
- Steps ativos: welcome | main_menu | awaiting_flow | handover
- Bugs multi-tenant corrigidos: waConfig propagado, Maps sem hardcode MT, phone normalizado

---

## Bugs críticos a resolver na refatoração

1. **waConfig nunca propagado** — todos os `sendInteractiveButtons/sendListMessage/sendFlowMessage` nos handlers usam env vars globais em vez de credencial por empresa
2. **Google Maps hardcoded Sorriso/MT** — `OrderParserService.ts` ~linha 430 tem `locality:Sorriso|administrative_area:MT`
3. **sendMessage.ts linha 111** — `toPhone.replace("+", "")` sem normalização do dígito 9
4. **ParseResult em types.ts** — tipo morto, ninguém importa
5. **normalize() duplicada em 4 arquivos** — utils.ts, TextParserService, PackagingExtractor, OrderParserService
6. **normalizeBrazilianNumber em 3 lugares** — send.ts, billing/sendBillingNotification.ts, phone.ts (este é o canônico)

Ver lista completa: `memory/project_stack_bugs_2026_03_27.md`

---

## Banco de dados (tabelas principais)

| Tabela | Uso |
|--------|-----|
| `whatsapp_channels` | Config por empresa: `from_identifier` (phoneNumberId), `provider_metadata` (token, catalog_flow_id) |
| `whatsapp_threads` | Conversa por telefone: `phone_e164`, `bot_active`, `handover_at` |
| `whatsapp_messages` | Histórico: `direction`, `sender_type` (human/bot), `provider_message_id` |
| `chatbot_sessions` | Sessão do chatbot: `step`, `cart`, `context`, `customer_id` |
| `chatbots` | Config do bot por empresa: `is_active`, `config` (model, threshold) |
| `chatbot_queue` | Fila de processamento assíncrono (futuro) |
| `orders` | Pedidos criados |
| `order_items` | Itens dos pedidos |
| `support_tickets` | Tickets de suporte criados no handover |
| `produto_embalagens` | Catálogo de produtos com embalagens |
| `product_images` | Imagens dos produtos |

---

## Variáveis de ambiente críticas

| Var | Uso |
|-----|-----|
| `WHATSAPP_TOKEN` | Token padrão (fallback quando não configurado por empresa) |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone ID padrão (fallback) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Verificação do webhook Meta |
| `WHATSAPP_FLOWS_PRIVATE_KEY` | Chave RSA para flows criptografados |
| `WHATSAPP_CATALOG_FLOW_ID` | ID do Flow catálogo no Meta |
| `WHATSAPP_FLOW_ID` | ID do Flow checkout no Meta |
| `GOOGLE_MAPS_API_KEY` | Validação de endereço (será removido na refatoração) |
| `CRON_SECRET` | Auth para rotas de cron |

---

## Regras importantes (não violar)

1. **Nunca fire-and-forget em Vercel** — sempre `await` em route handlers (Lambda congela após response)
2. **Nunca timeout < 15s no Supabase admin** — cold starts levam 6-11s
3. **flows/route.ts mantém criptografia RSA-OAEP + AES-128-GCM** — obrigatório pelo Meta
4. **Máx 3 botões por sendInteractiveButtons** — limite da Meta API
5. **Sistema em teste** — sem usuários reais, permite breaking changes agressivos
6. **Confirmar no Vercel logs qual URL o Meta chama** — projeto tem /webhook e /incoming

---

## Arquivos principais por área

**Chatbot**: `lib/chatbot/processMessage.ts` (orquestrador)
**WhatsApp send**: `lib/whatsapp/send.ts` (funções de envio)
**Webhook entry**: `app/api/whatsapp/incoming/route.ts`
**Flows**: `app/api/whatsapp/flows/route.ts`
**Inbox UI**: `components/whatsapp/WhatsAppInbox.tsx`
**Dashboard**: `app/(admin)/`
**Tipos compartilhados**: `lib/chatbot/types.ts`, `lib/whatsapp/types.ts`
