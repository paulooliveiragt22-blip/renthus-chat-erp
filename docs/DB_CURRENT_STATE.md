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

Faltante (para finalizar o Mini-ERP + Chatbot)

Organizado por prioridade (Crítico → Importante → Opcional).

Crítico (necessário antes de entrega a clientes)

Entitlements / Billing

Implementar validação feature_limits no backend (bloqueio/rejeição e overage).

Integrar usage_monthly com cobrança (Stripe ou fluxo de cobrança).

Acceptance: endpoints rejeitam ação quando limite excedido; overage tratado conforme subscriptions.allow_overage.

Segurança & RLS

Definir e aplicar RLS policies para tabelas sensíveis (orders, company_users, whatsapp_threads, whatsapp_messages, bot_logs, chatbots, bot_intents).

Garantir que apenas backend/service-role pode fazer operações sensíveis; ou políticas que permitam leitura segura quando apropriado.

requireCompanyAccess()

Finalizar fallback/strategia (server client / service role) para evitar 403 indevidos em rotas protegidas.

Env & deploy hardening

Validar e tratar ausências de env vars no server (já adicionada checagem sugerida).

Adicionar OPTIONS() handler para evitar 405 em preflight (melhoria aplicada via PR recomendada).

Acceptance tests / Smoke in CI

Criar scripts de smoke (login → select workspace → create thread → resolve bot) e adicionar ao CI.

Importante (prioridade média)

Integração de envio real

Integrar dispatcher com Twilio e 360dialog (quando contas aprovadas). Substituir gravação simulada de whatsapp_messages pelo envio real + logging do provider ids.

LLM / custo e contabilidade

Implementar integração LLM (OpenAI ou outro) com leitura de tokens e custo; gravar llm_tokens_used e llm_cost em bot_logs.

Template engine & NLU

Substituir replace simples por template engine (ex.: mustache) para evitar typos/injection.

Melhorar classificação (classifier/embedding) para intents (em vez de matching por includes).

Unicidade whatsapp_threads

Migrar UNIQUE(phone_e164) → UNIQUE(company_id, phone_e164) (migração segura: detectar duplicatas, criar índice CONCURRENTLY via psql, remover constraint antiga).

RLS policies específicas para chatbot

Políticas que permitam leitura de bot_logs por admins only, impedir clientes de alterar logs/intents.

Opcional / Nice-to-have

UI / Admin

Painel CRUD para chatbots e bot_intents (templates, examples, thresholds).

Bot activation toggle e history viewer (bot_logs).

Observability & Billing exports

Dashboard métricas: chamadas LLM, latência, custos, overage alerts.

Export CSV de uso por company.

Impressão / PDV / TEF

Worker/queue para print_jobs e integrações PDV (fase ERP full).

Handover workflow

Fila/Notificações para atendimento humano quando confidence < threshold, com UI para operadores.

Critérios de aceitação (resumido)

Bot configurável por company; bot_intents CRUD em backend.

Mensagens automatizadas gravadas em bot_logs e whatsapp_messages; preview na thread atualizado.

Uso contabilizado em usage_monthly e respeitado por feature_limits antes de chamar LLM.

RLS/policies aprovadas e testadas para impedir vazamento entre companies.

Envio real via Twilio/360dialog integrado e testado (quando contas estiverem prontas).

atualizando 08/01/2025
Arquivos / objetos criados ou ajustados
Migrations (principais)

2026_01_08_000000_create_companies_and_related_fixed.sql
Migração idempotente que:

cria/garante tabela public.companies com campos opcionais e flexíveis (meta/settings);

cria public.company_users, public.company_integrations (se não existirem) e public.daily_company_metrics;

adiciona/garante triggers de updated_at (set_updated_at_column) e usa DROP TRIGGER IF EXISTS / CREATE OR REPLACE FUNCTION para evitar erros;

gera slug de forma idempotente (normaliza nome_fantasia/razao_social e resolve duplicatas com sufixo -N);

cria índices idempotentes (companies_slug_idx, companies_name_idx, companies_cnpj_unique);

habilita RLS e cria policies idempotentes (usa DROP POLICY IF EXISTS e recria): companies_select_for_members, companies_no_client_*, company_users_select, company_integrations_select_for_members, daily_company_metrics_select_for_members.

Observação: policies usam jwt.claims.sub (padrão Supabase).

20260109_add_companies_cadastro_columns.sql
Migração idempotente para garantir as colunas explícitas de cadastro que o LoginClient.tsx e a RPC esperam:

cnpj, razao_social, nome_fantasia, name, slug, email, phone, whatsapp_phone, cep, endereco, numero, bairro, cidade, uf, owner_id, plan_id, is_active, meta, settings

cria triggers/índices idempotentes e company_users caso não exista.

Observação: todas as migrations foram escritas para serem idempotentes (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION, etc.), para evitar falhas ao reaplicar supabase db push.

Funções / Triggers

public.set_updated_at_column() — função trigger CREATE OR REPLACE FUNCTION para manter updated_at automático. Usada por várias triggers (trg_companies_set_updated_at, trg_company_integrations_set_updated_at, etc.).

Triggers adicionados para companies, company_integrations, daily_company_metrics (usando DROP TRIGGER IF EXISTS antes de criar).

RPC (stored procedure)

public.create_company_and_owner(creator_uuid uuid, payload jsonb) — RPC atômica e SECURITY DEFINER.
Características principais:

insere a company e em seguida cria company_users registrando o creator_uuid como owner, tudo em uma única operação atômica;

é robusta: detecta dinamicamente se colunas explícitas (cnpj, razao_social, nome_fantasia, meta, etc.) existem no schema e faz EXECUTE dinâmico quando necessário — assim funciona em bancos com/sem colunas explícitas;

normaliza CNPJ e verifica duplicidade (verificação segura que suporta cnpj explícito ou meta->>'cnpj');

retorna company_id e a linha company em JSON (RETURNS TABLE (company_id uuid, company jsonb)).

Nota de segurança: SECURITY DEFINER — não exponha a RPC diretamente ao cliente; chame-a via backend com a service role.

Endpoint backend

app/api/companies/create/route.ts (Next.js / app router)

valida token do usuário (lê Authorization: Bearer <token> e chama /auth/v1/user para obter sub);

chama a RPC create_company_and_owner usando o Supabase admin client (service role key);

espera no body company (payload JSON com campos como razao_social, nome_fantasia, cnpj, email, phone, address);

retorna { company, company_id } com status 201 em caso de sucesso.

Requisito de env: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.

2) Principais colunas/tabelas garantidas

public.companies — id, timestamps, cadastro explícito:

cnpj, razao_social, nome_fantasia, name, slug, email, phone, whatsapp_phone, cep, endereco, numero, bairro, cidade, uf, owner_id, plan_id, is_active, meta (jsonb), settings (jsonb).

public.company_users — vínculo empresa↔usuário (company_id, user_id, role, is_active).

public.company_integrations — integrações por company (provider, config jsonb).

public.daily_company_metrics — agregados diários (orders_count, orders_delivered, revenue, messages_in, messages_out).

3) Índices e unicidade

companies_slug_idx — índice único em lower(slug) (idempotente).

companies_cnpj_unique — índice único em regexp_replace(cnpj, '\D','','g') (CNPJ normalizado).

companies_name_idx, companies_cidade_idx, company_users_company_user_unique (unique company_id,user_id) e índices em company_integrations.

4) RLS / Policies (resumido)

Policies criadas/ajustadas (idempotentes, usando DROP POLICY IF EXISTS antes de criar):

companies_select_for_members — permite SELECT na companies apenas se o user_id estiver em company_users e is_active = true. Usa current_setting('jwt.claims.sub', true)::uuid.

companies_no_client_insert/update/delete — bloqueia inserts/updates/deletes vindos do cliente (somente backend pode escrever). Policies separadas por operação.

company_users_select — permite SELECT na company_users para o próprio user ou admins/owners da mesma company.

company_integrations_select_for_members e daily_company_metrics_select_for_members — leitura restrita para membros.

Claim JWT: todas as policies foram padronizadas para usar jwt.claims.sub (padrão do Supabase). Se o projeto usar outro claim, é necessário adaptar.

O que já foi implementado / validado
Arquitetura & DB

print_jobs design e filas já existiam na base/doc — confirmação no schema/arquitetura do ERP. 

schema

Nova migration proposta criada (SQL entregue) que adiciona:

print_agents (registro de agentes com api_key_hash, prefix, last_seen),

company_printers (vínculo company ⇄ printer),

ajustes em print_jobs (processed_by, attempts, reserved_at, processed_at) e índice print_jobs_pending_company_idx.

RPC atômica reserve_print_job(p_company, p_agent) implementada (PL/pgSQL com FOR UPDATE SKIP LOCKED) para reservar jobs sem race. (migration/RPC entregue).

Backend (renthus-chat-erp)

O proxy (`proxy.ts`) já permite tráfego para /api/print/* (roteamento correto).

proxy.ts

Helpers: lib/supabase/admin.ts (service-role client) e lib/workspace/requireCompanyAccess.ts existem e são usados nas rotas. 

PROJECT_SPEC +1

Novos endpoints implementados (arquivos prontos / exemplos entregues):

POST /api/print/agents — criar/registrar agente (gera api_key e retorna a chave apenas uma vez).

GET /api/print/jobs/poll — agente autentica com Authorization: Bearer <AGENT_KEY> e reserva job via reserve_print_job RPC.

POST /api/print/jobs/:id/status — agente reporta done/failed.

GET /api/print/companies/:companyId/printers e GET /api/print/printers/:id — para o agente obter config de impressora.

Lib de verificação de agente: lib/print/agents.ts com verifyAgentByApiKey e updateAgentLastSeen (usa service role + bcrypt para hash check). (Código entregue).

Diretrizes de RLS/policies: recomendado manter backend como gatekeeper (service role); não expor escrita direta ao agente via RLS. (Documentação de políticas fornecida).

Agent (renthus-print-agent)

printAgent.advanced.js — versão atualizada e entregue:

Não usa SUPABASE_SERVICE_ROLE_KEY (correção de segurança). Em vez disso usa AGENT_KEY e chama endpoints do ERP (/jobs/poll, /jobs/:id/status) para operar. 

printAgent.advanced

Suporta impressão: ESC/POS receipt builder, PDF A4 (PDFKit + pdf-to-printer), ZPL, e envios a impressoras via TCP (raw 9100), USB (escpos/escpos-usb) e Bluetooth SPP. Fallback para leitura de printers.json local se DB não responder.

Loop de polling com backoff, queue/processing por company, reportJobStatus, logs e health endpoint (/health).

tools/print-agent/package.json entregue e corrigido; dependências instaladas (incluindo escpos/escpos-usb opcional). 

package

Testes / validação já feitos

Agent executa e reporta mensagens de inicialização; instalamos dependências e fizemos validações iniciais (logs, warnings sobre libs Bluetooth/USB se ausentes).

Foi validado que o agent exige AGENT_KEY para operar (mensagem informativa quando não setado).

O que ainda falta (checklist detalhado — prioridade alta → baixa)

Prioridade alta (produção / segurança)

Gerar / entregar instaladores / pacotes para cliente

Build do agente em executáveis por plataforma (Windows .exe, Linux ELF, macOS) — recomendação: pkg para criar binários standalone.

Criar ZIPs pré-configurados por agente (binário + config.json com API_BASE e AGENT_KEY + install scripts).

Endpoint seguro GET /api/print/agents/:id/download?platform=... para gerar/entregar ZIP (one-time token or ephemeral key). Risco: não armazenar AGENT_KEY em texto puro; usar token/one-time download approach. (Not implemented).

Gerenciar api_key com segurança

Mostrar o api_key apenas uma vez no momento de criação (já definido) e não persistir plain.

Implementar armazenamento com hash (bcrypt) — já na migration. Implementar processo para download one-time: gravar token temporário que permite a rota de download retornar o plain AGENT_KEY apenas naquele download e depois removê-lo. (Implementar.)

Instalador / Serviço (Windows/ Linux)

Criar install.ps1 (com NSSM fallback) e install.sh (systemd unit que roda como usuário dedicado).

Publicar instruções e testar instalação automática como serviço. (Aguardando).

Revogação / lifecycle

Endpoint UI/Backend para revogar agentes (is_active=false).

Agent deve checar periodicamente se is_active (ou backend notificá-lo) para parar se revogado. (Agent currently updates last_seen but doesn’t poll for active flag).

Auto-update / code signing

Implementar versãoing & auto-update (agent check endpoint) and code signing for Windows binaries. (Important for trust).

End-to-end tests & CI

E2E tests: create agent → download → install (virtual) → create print_job → agent prints → update db status = done.

CI pipeline to build dist binaries and run unit tests.

Prioridade medium (robustness & ops)

Driver / OS instructions (drivers/udev/Zadig)

Provide documented steps for Windows (Zadig / driver), Linux (udev rule example), macOS notes.

Provide udev rules snippets and sample printers.json example. (Docs partially provided.)

Observability / logging / metrics

Add structured logging to agent, push metrics (job processed, attempts, errors) to central logs (or expose endpoint).

Admin UI showing agents list, last_seen, queued jobs, recent errors.

Retries / dead-letter Handling

Backend worker/cron to handle failed → retry policy (based on attempts column) and to mark permanently failed after N attempts, alert admin.

Rate limiting / abuse protection

Rate-limit GET /jobs/poll per agent to avoid over-polling. Also throttle backend endpoints.

Prioridade low (enhancements & billing)

Billing / entitlements enforcement

Ensure printing feature printing_auto is enforced (backend check when enqueueing print_jobs or when creating jobs). Docs already mention entitlements; ensure enforcement for paid plans. 

20260103000100_seed_entitlement…

Admin console improvements

Download buttons, agent revoke/regenerate key, agent logs view, usage/billing by prints.

Secure distribution / audit trail

Log agent download events (who downloaded, when) and ensure auditability.

Operacional / Segurança — pontos críticos a tratar agora

Never ship SUPABASE_SERVICE_ROLE_KEY in any agent package. Backend must be sole holder of service_role. (Already handled.) 

admin

API Key handling: store only hashed key; plain key transient and delivered once (or via one-time download token). If key is leaked, admin must be able to revoke and create new agent.

Service user: install agent as non-root service user (Linux) and ensure minimal privileges; document required permissions for USB access (udev rules) and driver installation on Windows.

Code signing: for Windows executables sign to avoid security prompts.

Network constraints: document API_BASE host/ports (HTTPS mandatory), firewall rules for PDV to reach ERP.

Artefatos / arquivos já entregues (para documentação/revisão)

supabase/migrations/20260115_..._create_print_agents_...sql — migration + RPC reserve_print_job (text delivered).

lib/print/agents.ts — verifyAgentByApiKey, updateAgentLastSeen.

app/api/print/* routes (POST agents, GET jobs/poll, POST jobs/:id/status, GET companies/:companyId/printers, GET printers/:id) — arquivos e exemplos entregues.

printAgent.advanced.js — agent updated (no service role, uses AGENT_KEY, supports ESC/POS/PDF/TCP/USB/BT, health endpoint). 

printAgent.advanced

tools/print-agent/package.json — validated and fixed. 

package

(Use estes para anexar à documentação como “implementado” e referenciar o código.)

Recomendações de próximos passos (ordem sugerida — ação imediata)

Implementar rota / processo de download one-time (secure generator of ZIP with agent + config) — alta prioridade. (Backend change + small storage for ephemeral token)

Build de binários com pkg para cada plataforma e colocar em print-agent-dist/ no servidor.

Escrever/commitar install.ps1 e install.sh (com NSSM/systemd patterns) e testar fluxo de instalação como serviço.

Implementar revogação e agent-check for is_active (agent polls endpoint or backend pushes) e a UI para admins.

Testes E2E (pipeline): criar agent → download → install → create job → agent prints → status done. Automatizar com VM/container.

Documentação final: instruções PDV (Windows/ Linux), driver/Zadig, udev rules, troubleshooting.
Integração Print-Agent ↔ Renthus Chat ERP — Resumo do trabalho
1 — Objetivo

Permitir que um agente local (renthus-print-agent), instalado no PDV do cliente, registre-se automaticamente, associe-se a uma impressora local e consuma jobs do ERP de forma segura e idempotente (claim atômico), atualizando status e logs.

2 — O que foi criado / preparado
Scripts / arquivos gerados (principais)

robust_printing_schema_v3.sql
SQL idempotente para criação/ajuste do schema de impressão (tabelas, enum, índices e RPC claim_next_print_job).
Executa/garante: printers, company_printers, print_agents (sem sobrescrever schema existente), print_jobs, print_job_logs, enum job_status e função claim_next_print_job. (fornecido e aprovado para execução)

create_print_agent.js
Script Node para gerar prefix.secret, criar bcrypt do secret e inserir um registro em print_agents usando SUPABASE_SERVICE_ROLE_KEY. Retorna token completo para o agent.

lib/agents/requireAgent.ts (implementação proposta)
Middleware server-side (Next.js) que valida Authorization: Bearer <prefix.secret> com fallback para agent_download_tokens (validação de token temporário). Suporta bcrypt e sha256 como algoritmos de verificação.

Server routes (esquemas/trechos entregues):

GET /api/print/jobs/poll

POST /api/print/jobs/:id/status

GET /api/print/companies/:companyId/printers

GET /api/print/printers/:printerId

POST /api/print/agents/register (admin — cria agente permanente)

(propostas adicionais) POST /api/print/agents/generate_download_token, GET /api/print/agents/activate, POST /api/print/companies/:companyId/printers/:printerId/assign

Design do fluxo de ativação: download token → GET /api/print/agents/activate?token=... → ERP devolve AGENT_KEY permanente ao agente/instalador.

Documentação de testes: passos SQL para inserir jobs de teste (ZPL/PDF/ESC-POS) + comandos curl para testar poll/status.

3 — Tabelas e colunas (definições oficiais usadas)

Observação: abaixo constam as colunas definidas no SQL idempotente e o DDL já existente (quando aplicável). Use isto como fonte para migrations/documentação.

printers

id uuid PRIMARY KEY DEFAULT gen_random_uuid()

company_id uuid (nullable)

name text NOT NULL

type text NOT NULL — valores esperados: 'network'|'usb'|'bluetooth'|'system'

format text NOT NULL — 'receipt'|'a4'|'zpl'|'pdf'

config jsonb NOT NULL DEFAULT '{}'::jsonb — ex.: { "host":"192.168.1.100","port":9100 } ou { "printerName":"EPSON TM-T20" }

auto_print boolean DEFAULT false

interval_seconds integer DEFAULT 0

is_active boolean DEFAULT true

created_at timestamptz DEFAULT now()

updated_at timestamptz DEFAULT now()

Índice: idx_printers_company_id (company_id).

company_printers (opcional)

id uuid PRIMARY KEY

company_id uuid NOT NULL

printer_id uuid NOT NULL

config jsonb DEFAULT '{}'::jsonb — override por company

is_active boolean DEFAULT true

created_at timestamptz DEFAULT now()

Índice: idx_company_printers_company.

print_agents (registry)

DDL existente (já presente no banco)

create table public.print_agents (
  id uuid not null default gen_random_uuid (),
  company_id uuid not null,
  name text not null,
  api_key_hash text not null,
  api_key_prefix text not null,
  is_active boolean not null default true,
  last_seen timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint print_agents_pkey primary key (id),
  constraint print_agents_company_id_fkey foreign KEY (company_id) references companies (id) on delete CASCADE
);
create unique INDEX IF not exists print_agents_company_name_uq on public.print_agents (company_id, name);


api_key_hash e api_key_prefix já existem (no nosso design não criamos api_key em texto).

Índices recomendados criados: idx_print_agents_api_key_prefix, idx_print_agents_api_key_hash.

agent_download_tokens (já existente — DDL fornecido)
create table public.agent_download_tokens (
  id uuid not null default gen_random_uuid (),
  agent_id uuid not null,
  token_hash text not null,
  token_prefix text not null,
  encrypted_api_key text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  used_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint agent_download_tokens_pkey primary key (id),
  constraint agent_download_tokens_agent_id_fkey foreign KEY (agent_id) references print_agents (id) on delete CASCADE
);
create index IF not exists idx_agent_download_tokens_agent on public.agent_download_tokens (agent_id);
create index IF not exists idx_agent_download_tokens_prefix on public.agent_download_tokens (token_prefix);
create index IF not exists idx_agent_download_tokens_expire on public.agent_download_tokens (expires_at);


Usada para tokens temporários (one-time ou expiráveis) e contém encrypted_api_key e hash/prefix do token.

print_jobs

id uuid PRIMARY KEY DEFAULT gen_random_uuid()

company_id uuid

printer_id uuid

source text — ex: 'order'|'whatsapp'|'manual'

source_id uuid

payload jsonb NOT NULL — ex.: { type: 'zpl'|'pdf'|'receipt', zplText, pdf_url, raw_base64, copies, options }

status job_status NOT NULL DEFAULT 'pending'::job_status

attempts integer DEFAULT 0

max_attempts integer DEFAULT 5

last_error text

priority integer DEFAULT 100

agent_id uuid NULL — referenciando print_agents.id

meta jsonb DEFAULT '{}'::jsonb

created_at, started_at, finished_at timestamptz

Índices:

idx_print_jobs_status_priority ON (status, priority, created_at)

idx_print_jobs_company ON (company_id)

Note: status usa enum job_status (labels utilizados no sistema: pending, processing, done, failed — adaptamos a função para usar pending em vez de queued).

print_job_logs

id uuid PRIMARY KEY DEFAULT gen_random_uuid()

job_id uuid NOT NULL (FK para print_jobs.id)

attempt integer

message text

raw jsonb

created_at timestamptz DEFAULT now()

Índice: idx_print_job_logs_job ON (job_id)

Enum job_status

Os rótulos garantidos no DB:

pending

processing

done

failed

(Implementamos script seguro para garantir que estes valores existam, sem remover ou alterar enums existentes.)

4 — Função RPC atômica

claim_next_print_job(p_company uuid, p_agent uuid)

Implementada como CREATE OR REPLACE FUNCTION ... com FOR UPDATE SKIP LOCKED e UPDATE ... RETURNING *.

Comportamento: seleciona um único job status = 'pending' ordenado por priority, created_at, marca como processing, incrementa attempts, seta started_at e agent_id, e devolve o registro.

Usada para evitar race conditions entre múltiplos agents.

(Fornecemos a versão completa da função no SQL robust_printing_schema_v3.sql.)

5 — Indices/constraints criados

idx_printers_company_id

idx_company_printers_company

print_agents_company_name_uq (existente)

idx_print_agents_api_key_prefix

idx_print_agents_api_key_hash

idx_print_jobs_status_priority

idx_print_jobs_company

idx_print_job_logs_job

índices para agent_download_tokens já existiam (prefix, agent, expires_at)

6 — Endpoints HTTP criados/propostos (contrato)
Autenticação do Agent

Token: AGENT_KEY = "<prefix>.<secret>"

Header: Authorization: Bearer <AGENT_KEY>

requireAgent() valida api_key_prefix + api_key_hash (bcrypt/sha256) na print_agents. Se falhar, tenta agent_download_tokens (verifica token_prefix, token_hash, expires_at, used).

Endpoints essenciais (ERP)

GET /api/print/jobs/poll?company_id=<id>&limit=N

Protegido (Agent auth).

Comportamento: chama RPC claim_next_print_job até limit e retorna { jobs: [...] } já com status = processing.

POST /api/print/jobs/:id/status

Protegido (Agent auth). Body: { status: "processing|done|failed", attempt?: number, message?: string, printed_at?: timestamp, raw?: any }

Atualiza print_jobs e insere print_job_logs.

GET /api/print/companies/:companyId/printers

Retorna printers configuradas por company.

GET /api/print/printers/:printerId

Retorna printer detail.

POST /api/print/agents/register (admin)

Cria print_agent permanent (gera token prefix.secret e insere hash). Uso admin.

Propostas UX:

POST /api/print/agents/generate_download_token (admin) — gera token de download + encripta api_key.

GET /api/print/agents/activate?token=... — ativador do installer que valida token e retorna AGENT_KEY permanente.

POST /api/print/companies/:companyId/printers/:printerId/assign — associa printer local selecionada pelo cliente (local_printer_name, timer_seconds, auto_print).

O agent implementa GET /jobs/poll e POST /jobs/:id/status por padrão (ver código do agent). 

printAgent.advanced

7 — Middleware requireAgent (comportamento resumido)

Extraímos token de Authorization (espera Bearer ).

Separa prefix e secret (formato prefix.secret ou fallback prefix=first8chars).

Procura print_agents.api_key_prefix = prefix:

Se encontrado, valida secret contra api_key_hash (bcrypt se $2a$|$2b$|$2y$ ou sha256 hex fallback).

Se válido, atualiza last_seen e retorna { ok:true, agent }.

Se não, tenta agent_download_tokens.token_prefix:

Verifica token_hash, expires_at, used.

Se válido, pode marcar used=true (se one-time) e devolver print_agents associado.

Retorna status apropriado (401/403/500).

(Middleware entregue em TypeScript como proposta; o comportamento cobre o schema já existente.)

8 — Scripts / utilitários úteis
create_print_agent.js

Gera prefix (hex), secret (hex), token completo prefix.secret.

Calcula bcrypt(secret) e insere em print_agents via supabaseAdmin (usa SUPABASE_SERVICE_ROLE_KEY).

Imprime token para ser usado em AGENT_KEY.

Uso: node create_print_agent.js <COMPANY_ID> "agent-name"

Instalador / ativador proposto

Fluxo recomendado para UX: gerar agent_download_token (one-time), gerar instalador que chama GET /api/print/agents/activate?token=... e devolve AGENT_KEY permanente.

O agent então mostra UI para detecção de impressoras locais, escolha de impressora e configuração do temporizador (intervalSeconds), e envia POST /companies/:companyId/printers/:printerId/assign para finalizar a associação.

9 — SQL executado / rodado (lista)

robust_printing_schema_v3.sql — cria/ajusta tabelas: printers, company_printers, print_agents (montagem segura sem sobrescrever), print_jobs, print_job_logs; inclui enum job_status e claim_next_print_job RPC. (versão final usada: v3)

Queries de verificação executadas durante a integração (recomendações):

SELECT ... FROM information_schema.columns WHERE table_name='print_agents'; — validou api_key_hash/api_key_prefix.

SELECT ... FROM pg_enum WHERE enumtypid = 'job_status'::regtype — validou labels do enum.

SELECT * FROM agent_download_tokens LIMIT 5; — validou existência da tabela e índices.

Scripts Node: create_print_agent.js executado para criar tokens de teste.

(Se precisar, incluo um CHANGELOG com timestamp dos scripts aplicados e os comandos usados no ambiente de staging/prod.)

10 — Testes realizados / instruções de verificação

Criar job de teste (SQL inserts para zpl, pdf e receipt), verificar que:

GET /jobs/poll devolve job(s) já marcados como processing (claim atômico).

Agent executa driver e chama POST /jobs/:id/status com status = done ou failed.

print_job_logs armazena mensagens e print_jobs.started_at/finished_at são setados.

Comandos de verificação sugeridos/ documentados no robust_printing_schema_v3.sql e na seção de testes.

11 — Pontos de segurança e operacionais (resumo)

Não expor SUPABASE_SERVICE_ROLE_KEY no agent. Service role usado apenas no backend.

Tokens temporários (agent_download_tokens): expires_at + used=true para ativação one-time.

Armazenamento de keys: print_agents.api_key_hash (bcrypt) e encrypted_api_key em agent_download_tokens (AES-GCM recomendada / KMS).

Agent como serviço: empacotar agent como Windows service / systemd para iniciar automaticamente.

Monitoramento: last_seen em print_agents + print_job_logs + dashboard de agentes.

12 — Referências / arquivos no repositório

Agent client code (ex.: tools/print-agent/printAgent.advanced.js, printers.json, package.json) — o agent já implementa polling e drivers (TCP, USB, Bluetooth, PDF). 

printAgent.advanced +2

ERP docs: docs/DB_CURRENT_STATE.md — referência do schema e observações (WhatsApp, mini-ERP etc.).

WhatsApp / Chatbot routes (exemplos de desenho de rotas e uso service-role) — rota POST /api/whatsapp/send e GET /api/whatsapp/threads para referência de padrões de rota/insert no ERP.

13 — Próximos passos recomendados (para finalizar documentação / produção)

Commitar robust_printing_schema_v3.sql como migration (supabase/migrations/<timestamp>_printing_schema.sql).

Commitar lib/agents/requireAgent.ts e as server routes app/api/print/... no ERP.

Commitar create_print_agent.js (ou colocá-lo em tools/admin-scripts).

Implementar POST /api/print/agents/generate_download_token e GET /api/print/agents/activate + UI “Baixar Agent”/QR no painel Impressoras.

Empacotar instalador do agent (Windows exe / ZIP com Node + script) e documentar procedimento de instalação (1-click / seleciona impressora / confirmar).

Testes de aceitação fim-a-fim em staging (criar job → agent claim → impressão real → status/logs).