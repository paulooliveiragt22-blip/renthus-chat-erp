# Banco — Estado Atual (Supabase / public)

## Tabelas em public
- brands
- categories
- companies
- company_users
- customers
- order_items
- orders
- product_variants
- products
- v_daily_sales (view)
- whatsapp_messages
- whatsapp_threads

## WhatsApp (estado atual)
### whatsapp_threads
- id (uuid)
- phone_e164 (text)
- wa_from (text, nullable)
- wa_to (text, nullable)
- profile_name (text, nullable)
- last_message_at (timestamptz, nullable)
- created_at (timestamptz)

### whatsapp_messages
- id (uuid)
- thread_id (uuid fk -> whatsapp_threads.id)
- direction (text)
- channel (text, default 'whatsapp')
- twilio_message_sid (text, nullable)
- twilio_account_sid (text, nullable)
- from_addr (text)
- to_addr (text)
- body (text, nullable)
- num_media (int, default 0)
- raw_payload (jsonb, nullable)
- created_at (timestamptz)

## RLS
- whatsapp_threads: RLS enabled
- whatsapp_messages: RLS enabled
- policies: atualmente não há policies para whatsapp_*

Conclusão:
- acesso deve ser feito via backend com service role (decisão já tomada)

⚠️ Um detalhe importante pra você anotar (não precisa mexer agora)

Hoje o polling está a cada 10s. Está ótimo para agora, mas no futuro:

empresas com alto volume → polling vira custo

aí a gente evolui para:

SSE (Server-Sent Events)

ou Realtime só no backend

ou fila (BullMQ / Supabase Functions)


proximos passos
💳 Opção B — Planos e Billing (estratégia de negócio)

Começar a travar recursos por plano:

mini-ERP

ERP completo

chatbot

limites de mensagens

add-on impressão

👉 Isso te permite vender e cobrar.

🧾 Opção C — Impressão automática

tabela printers

vínculo company_printers

job de impressão por pedido

integração futura com WhatsApp (“imprimir pedido recebido”)

👉 Forte para restaurantes/lojas físicas.