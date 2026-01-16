# Arquitetura — Renthus Chat + ERP

## Princípio de segurança (decisão)
A UI NÃO acessa tabelas sensíveis diretamente.
Fluxo:
UI (Next) -> `app/api/...` -> Supabase (service role)

Motivos:
- reduzir superfície de ataque
- centralizar regras de negócio e cobrança
- evitar dependência de policies RLS no front

## Multi-tenant
Tenant = `companies.id`.
Regra:
- dados de negócio devem ser isolados por company
- `company_users` controla usuários internos do tenant

## WhatsApp: conceito de "canal"
Um canal WhatsApp = (company) + (provedor) + (número).
- 1 canal ativo por company (por enquanto)
- migração: canal antigo vira `migrated/inactive`, canal novo vira `active`

### Componentes (alvo)
- `whatsapp_channels`: define provedor, número, status e janela de validade
- `whatsapp_contacts`: contatos (telefone do usuário)
- `whatsapp_threads`: conversa por contato (e canal)
- `whatsapp_messages`: mensagens inbound/outbound com ids do provedor + payload bruto

### Webhooks
Manter 2 endpoints:
- Twilio inbound: `POST /api/whatsapp/incoming` (form-data, TwiML)
- 360dialog inbound: `POST /api/whatsapp/webhook` (JSON)

Ambos:
- normalizam telefone (E.164)
- upsert de contato/thread
- insert mensagem com `raw_payload`
- deduplicação por (provider, provider_message_id)

### Envio (dispatcher)
`POST /api/whatsapp/send`
- recebe (company_id, to_phone, message payload)
- busca canal ativo do company
- escolhe provedor e envia
- grava mensagem outbound no banco
- retorna status

## Billing/Planos: entitlements (direitos)
Em vez de if/else por plano espalhado:
- `plans`, `features`, `plan_features`
- `subscriptions` (company -> plan)
- `subscription_addons` (company -> addon feature)
- `feature_limits` (mensagens/mês etc)
- `usage_monthly` (uso por mês)

Backend:
- sempre valida se a company tem a feature (ex: impressão automática)
- sempre mede uso para features com limites (ex: WhatsApp messages/month)

## Impressão automática
Deve ser assíncrona.
- tabela `print_jobs`
- worker/cron processa jobs
- re-tentativas, logs, status

Nunca bloquear criação de pedido por falha de impressão.

📘 Renthus Chat + ERP — Estado Atual do Projeto (Documentação Oficial)
Visão Geral

O Renthus Chat + ERP é um SaaS multi-tenant que integra:

WhatsApp (Twilio + 360dialog)

Inbox unificada no painel

Mini-ERP / ERP completo

Arquitetura segura (service role no backend)

Pronto para billing por plano e volume

O projeto já está em produção (Vercel) e funcional.

1️⃣ Arquitetura Base (Decisão Estrutural)
🔐 Segurança (decisão-chave)

Frontend nunca acessa Supabase direto para dados sensíveis

UI → chama app/api/...

Backend → acessa Supabase usando Service Role

RLS no banco deixa de ser crítico para o front

👉 Isso evita vazamento entre empresas (multi-tenant seguro).

🏢 Multi-tenant (Workspace / Company)

Cada cliente = uma company

Usuários pertencem a empresas via company_users

Um usuário pode pertencer a várias companies

Workspace ativo

Armazenado em cookie HttpOnly: renthus_company_id

Definido via:

POST /api/workspace/select


Lido automaticamente por todas as APIs backend

Validação central

Arquivo:

lib/workspace/requireCompanyAccess.ts


Responsável por:

validar autenticação

validar membership

validar role

devolver { admin, companyId, userId }

Todas as APIs sensíveis usam isso.

2️⃣ Supabase — Estrutura Principal
Tabelas-chave

companies

company_users

orders (com company_id)

whatsapp_channels

whatsapp_threads

whatsapp_messages

Ajustes importantes feitos

Backfill de orders.company_id

Garantia de unicidade:

create unique index whatsapp_threads_company_phone_uq
on whatsapp_threads(company_id, phone_e164);

3️⃣ WhatsApp — Estratégia de Provedores
Estratégia de negócio definida

Baixo volume → Twilio (pay per use)

Alto volume → 360dialog (previsível e mais barato)

Um número pertence a um provedor por vez

Migração acontece por análise de constância (não por pico)

4️⃣ Backend WhatsApp (APIs)
Envio de mensagem
POST /api/whatsapp/send


Usa workspace do cookie

Descobre o canal ativo da company

Envia via Twilio ou 360dialog

Salva em whatsapp_messages

Atualiza whatsapp_threads.last_message_*

Webhooks inbound

Twilio inbound

360dialog webhook (Cloud API)

Ambos:

Criam ou reutilizam thread

Salvam mensagem inbound

Atualizam:

last_message_at

last_message_preview

Inbox APIs
Listar conversas
GET /api/whatsapp/threads


Retorna:

phone

profile_name

last_message_at

last_message_preview

Listar mensagens da thread
GET /api/whatsapp/threads/:threadId/messages


📁 Estrutura correta (importante):

app/api/whatsapp/threads/
 ├─ route.ts
 └─ [threadId]/messages/route.ts

5️⃣ UI — Inbox WhatsApp
Página
/whatsapp


Arquivo:

app/whatsapp/page.tsx

Layout

Coluna esquerda → threads

Coluna direita → mensagens

Campo para envio de mensagens

Polling leve (8s)

Funcionalidades confirmadas

Conversar com clientes diretamente pelo UI

Histórico completo

Preview da última mensagem (estilo WhatsApp Web)

Multi-empresa seguro

6️⃣ Preview da Última Mensagem
Coluna adicionada
whatsapp_threads.last_message_preview text

Atualização automática

Outbound (/send)

Inbound (Twilio + 360dialog)

Preview sempre reflete a última mensagem real.

7️⃣ Nova Conversa (Decisão Tomada)
Regra definida

✅ Nova conversa cria a thread mesmo sem mensagem

Motivos:

UX estilo CRM

Permite “pré-criar” contatos

Não obriga envio imediato

Endpoint planejado
POST /api/whatsapp/threads/create


Cria thread se não existir

Retorna existente se já existir

Usa índice único (company_id, phone_e164)

8️⃣ Problemas Resolvidos (importante para histórico)
❌ 404 em rotas

Causa: pasta dinâmica com nome errado ([threads])

Correção: usar [threadId]

VS Code compacta pastas visualmente (não era bug)

❌ Sidebar vazia

Causa: company_id ausente nos pedidos

Correção: backfill SQL

❌ Workspace não selecionado

Causa: membership inexistente

Correção: inserir em company_users

❌ Localhost quebrado

Deploy na Vercel confirmou que arquitetura estava correta

Problema era ambiente local (env/cookies)

9️⃣ Estado Atual do Projeto (Resumo Executivo)

✅ Multi-tenant seguro
✅ Inbox WhatsApp funcional
✅ Conversa operador ↔ cliente
✅ Twilio + 360dialog
✅ Preview de mensagens
✅ Pronto para chatbot híbrido
✅ Pronto para billing
✅ Pronto para escalar

👉 Core do SaaS está pronto

🔜 Próximos Passos Planejados
Curto prazo

Nova conversa (modal)

Mensagens não lidas

Realtime (menos polling)

Médio prazo

Planos e billing

Limite por mensagens

Impressão automática (add-on)

📌 Frase-guia do projeto

UI nunca fala direto com o banco.
Toda ação passa pelo backend validando company, plano e permissão.

📄 Registro oficial – Entitlements, PDV, Fiscal e TEF
Documento

ADR-0003 — Entitlements, PDV Windows, Fiscal (NF) e TEF

Status: Aprovado
Data: 2026-01-03
Contexto: Renthus Chat ERP / ERP Full
Decisores: Produto + Engenharia

1. Contexto

O Renthus evolui de um ERP com WhatsApp para um ERP Full, incluindo:

Emissão fiscal (NFS-e, NF-e, NFC-e)

Operação de loja balcão (varejo)

Pagamentos integrados via TEF

Controle comercial e financeiro com billing por plano/uso

O sistema já possui a base de entitlements (plans, features, limits, usage) e arquitetura onde:

Frontends não acessam dados sensíveis diretamente

Toda regra de negócio passa pela API (app/api/...)

Billing e permissões são validados no backend

2. Decisão: Modelo de Entitlements
2.1 Features (fonte de verdade)

Core

erp_full

Fiscal

fiscal_nfse

fiscal_nfe

fiscal_nfce

PDV / Pagamentos

pdv

tef

Outros

printing_auto (add-on)

2.2 Planos

Mini ERP

Não inclui erp_full

Sem fiscal

Sem PDV

ERP Full

Inclui erp_full

Inclui fiscal_nfse, fiscal_nfe, fiscal_nfce

Inclui pdv

Add-ons

tef

printing_auto

TEF é tratado como add-on por custo operacional, complexidade técnica e variação por cliente.

3. Decisão: Onde rodar o PDV
Cenário do cliente

Loja balcão (varejo)

Emissão de NFC-e

Uso de PC Windows

Necessidade de TEF clássico e periféricos (pinpad, impressora, gaveta)

Decisão

👉 PDV Windows Desktop é a plataforma principal

Justificativa

TEF clássico no Brasil exige integração local (pinpad/SDK/serviço)

Impressoras térmicas USB/rede funcionam melhor em Windows

Operação de balcão tradicional já está nesse ambiente

Web puro não atende bem TEF nem periféricos

4. Arquitetura adotada para o PDV
PDV Windows (UI Desktop)
        |
        v
Backend API (Next / app/api)
        |
        v
Supabase (Service Role)

Componente adicional

Bridge Local (Windows)
Responsável por:

Integração TEF

Impressão térmica

Gaveta de dinheiro

Comunicação local (localhost / named pipes)

O PDV nunca acessa fiscal ou TEF diretamente, tudo passa pelo backend ou pelo bridge controlado.

5. Fiscal (NFS-e, NF-e, NFC-e)
Estratégia

Emissão fiscal ocorre no backend

Certificados e integrações não ficam no PDV

PDV apenas solicita emissão e recebe status

Entitlement enforcement

Endpoints fiscais exigem:

fiscal_nfse ou

fiscal_nfe ou

fiscal_nfce

Uso / Billing

Nota autorizada incrementa:

usage_monthly.feature_key = invoices_per_month

ou nfce_per_month (separável no futuro)

6. TEF
Estratégia

TEF é feature add-on

Implementado via bridge local no Windows

Backend coordena:

criação de payment

criação de tef_transaction

confirmação/estorno

contabilização de uso

Entitlement enforcement

Endpoints TEF exigem tef

Uso / Billing

Transação TEF aprovada → incrementa tef_transactions_per_month

7. Roadmap acordado (continuidade do projeto)
Fase 1 — Entitlements (em andamento)

Seed de plans, features e limits

Helper entitlements.ts

Enforcement no /api/whatsapp/send

Fase 2 — PDV MVP

PDV Windows (checkout, pagamento manual)

Feature gate: pdv

Integração com pedidos existentes

Fase 3 — Fiscal NFC-e

Emissão NFC-e via backend

Feature gate: fiscal_nfce

Fase 4 — TEF

Bridge local Windows

Feature gate: tef

Integração completa com PDV

8. Consequências

Arquitetura permanece consistente (UI → API → Infra)

Billing e permissões centralizados

PDV e fiscal evoluem sem acoplamento

Possível adicionar Android PDV no futuro reutilizando APIs

✅ Conclusão

Este documento define oficialmente:

Modelo de entitlements

Plataforma do PDV

Estratégia fiscal

Estratégia de TEF

Base para continuidade técnica e de produto

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

Middleware já permite tráfego para /api/print/* (roteamento correto). 

middleware

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