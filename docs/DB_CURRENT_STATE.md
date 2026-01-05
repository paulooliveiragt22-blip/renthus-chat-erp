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

# Mini-ERP — estado atual (resumo técnico)

## O que já implementamos
- Login / seleção de workspace
  - Fluxo: login → `/api/workspace/list` → `/api/workspace/select` → cookie HttpOnly `renthus_company_id`
  - Auto-select: quando o usuário tem apenas 1 company, o app seleciona automaticamente.

- Proteção de rotas server-side
  - `requireCompanyAccess()` valida workspace via cookie `renthus_company_id`.
  - Fallback discutido para usar `createServerClient()` quando service role faltar (opcional para dev).

- AdminSidebar
  - `loadOrders()` usa `credentials: 'include'`.
  - Auto-select antes de carregar pedidos.
  - Botão **Estatísticas** que abre modal com dados agregados.

- Endpoints de orders
  - `GET /api/orders/list` — lista de pedidos (protegido).
  - `GET /api/orders/stats` — agregados (counts, receita total, série diária, últimos 30 dias).
  - `GET /api/orders/status` — resumo por status (count + revenue).

- WhatsApp
  - `GET /api/whatsapp/threads` — lista de conversas.
  - `POST /api/whatsapp/send` — envia mensagem (integração Twilio / provider).

- Correções
  - `lib/supabase/admin.ts` limpo (service role apenas no servidor).
  - Várias `fetch` ajustadas para `credentials: 'include'`.
  - Removidos `console.log` de debug.

## Principais arquivos alterados / criados
- Modificados:
  - `components/AdminSidebar.tsx`
  - `lib/supabase/admin.ts`
- Criados:
  - `components/OrdersStatsModal.tsx`
  - `app/api/orders/stats/route.ts`
  - `app/api/orders/status/route.ts`

## Como testar rapidamente (smoke test no browser console)
```js
// 1) Sessão e memberships
fetch('/api/debug/whoami', { credentials: 'include' }).then(r=>r.json()).then(console.log);

// 2) Listar companies
fetch('/api/workspace/list', { credentials: 'include' }).then(r=>r.json()).then(console.log);

// 3) Selecionar workspace (substitua COMPANY_ID)
fetch('/api/workspace/select',{
  method:'POST',
  credentials:'include',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ company_id: 'e5865f09-7dce-4fce-afad-d9ab20031790' })
}).then(r => r.text()).then(console.log);

// 4) Orders, threads, stats
fetch('/api/orders/list?limit=10', { credentials:'include' }).then(r=>r.json()).then(console.log);
fetch('/api/whatsapp/threads?limit=10', { credentials:'include' }).then(r=>r.json()).then(console.log);
fetch('/api/orders/stats', { credentials:'include' }).then(r=>r.json()).then(console.log);
fetch('/api/orders/status', { credentials:'include' }).then(r=>r.json()).then(console.log);

-- Verificar company_user
SELECT id, company_id, user_id, role, is_active
FROM company_users
WHERE company_id = '<COMPANY_ID>' AND user_id = '<USER_ID>';

-- Ativar company_user se necessário
UPDATE company_users
SET is_active = true
WHERE company_id = '<COMPANY_ID>' AND user_id = '<USER_ID>';


---

## O que falta (lista curta, priorizada) — **para finalizar o Mini-ERP**

### Crítico (necessário antes de entrega aos clientes)
1. **Entitlements / Billing**
   - Implementar `feature_limits` checks no backend (ex.: limites de mensagens/whatsapp, usuários).
   - Rotina `usage_monthly` e cobrança (ou integração com Stripe).
   - Acceptance: endpoints rejeitam ação quando limite excedido e `usage_monthly` atualiza.

2. **RLS & Service role + Segurança**
   - Garantir `SUPABASE_SERVICE_ROLE_KEY` correta em Production (Vercel — já checado).
   - Review de RLS policies nas tabelas sensíveis (`orders`, `company_users`, `whatsapp_messages`).
   - Acceptance: admin client consegue operações protegidas; client nunca usa secret.

3. **Finalizar `requireCompanyAccess()`**
   - Aplicar fallback definitivo (usar `createServerClient()` para ver membership quando necessário) ou garantir a service role em todos os runtimes.
   - Acceptance: rotas protegidas não retornam 403 indevidos.

4. **Relatórios mínimos**
   - Sales report: vendas por período, por produto (top N).
   - Export CSV/PDF.
   - Acceptance: botão relatórios gera CSV com filtros (periodo, produto).

5. **Usuários por company (mini rules)**
   - Para Mini-ERP o requisito era 1 usuário por company — garantir isso / documentar.
   - Para ERP Full: permitir multi-usuário com roles; planejar para fase 2.

6. **Testes / Smoke**
   - Criar script de smoke (login → select → orders/stats/whatsapp) e integrar em CI.
   - Acceptance: CI smoke passa.

### Importante (priorizar após crítico)
1. **Pagamentos / Invoices**
   - Gerar nota/fatura simplificada, marcar pedidos como pagos.
2. **Performance**
   - Reimplementar agregações pesadas via SQL `GROUP BY` / views / RPC.
3. **UX**
   - Melhorar modal de estatísticas (gráfico), paginação, filtros avançados.
4. **Logs / observability**
   - Cloud logs (Vercel), alertas em erros 500, métricas.

### Opcional / Nice-to-have
1. Multi-company admin console, CSV imports, roles erweit.
2. Audit log (who changed order/status).
3. SSO / OAuth.
4. Mobile UI refinements.

---

## Pequena checklist técnica (passos finais para entregar)
- [ ] Garantir `SUPABASE_SERVICE_ROLE_KEY` em Production (Vercel) — confirmar prefixo nos logs.  
- [ ] Aplicar `requireCompanyAccess()` fallback **ou** confirmar service role em todos os ambientes.  
- [ ] Implementar Entitlements/Billing (usage, limits, alerts).  
- [ ] Implementar Reports (sales, top products, evolution export).  
- [ ] Remover arquivos de debug e `.diff` do repo; adicionar changelog da release.  
- [ ] Criar smoke test + adicionar ao CI.  
- [ ] Teste de aceitação com cliente (fluxo completo + dados reais).

---

Estado do Mini-ERP + Chatbot — Resumo rápido
Finalizado (implementado e testado)

Tabelas do chatbot

chatbots — configurações por company (id, company_id, name, config, is_active, timestamps).

bot_intents — intents/templates por company (intent_key, examples, response_template, response_json, priority, active, timestamps).

bot_logs — auditoria / decisões do bot (intent, confidence, provider, prompt, response_text/json, llm tokens/cost, timestamps).

Function / Usage

increment_usage_monthly(p_company uuid, p_used integer) — RPC atômico para incrementar usage_monthly para o feature chatbot.

usage_monthly já usada/atualizada no fluxo do bot e testada (upsert funciona; valor do mês incrementado).

Route handler

POST /api/chatbot/resolve (Next.js server route) — implementado e deployado em versão no-LLM:

verifica chatbots.is_active, Pesquisa bot_intents, classifica por exemplos (fast path), aplica threshold,

usa response_template (fallback padrão se não houver template),

grava bot_logs, insere whatsapp_messages (outbound) e atualiza whatsapp_threads (preview/last_message_at),

chama increment_usage_monthly para contabilizar uso.

Handler robusto para ambiente sem OpenAI / sem Twilio — permite test dev sem provedores.

Smoke / testes manuais

Teste via browser console: fetch('/api/chatbot/resolve', ...) → respondeu com template e gerou registros.

bot_logs, whatsapp_messages, whatsapp_threads e usage_monthly confirmados com dados de teste.

Correções de conteúdo

Corrigido typo no template (0 pedido → O pedido) e atualizadas ocorrências em bot_logs, whatsapp_messages e whatsapp_threads.

Índices e unicidade

Índices/unique para bot_intents(company_id,intent_key) e chatbots(company_id,name) criados.

Deploy / ambiente

Ajuste feito: variáveis SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY configuradas no Vercel; build aprovada.