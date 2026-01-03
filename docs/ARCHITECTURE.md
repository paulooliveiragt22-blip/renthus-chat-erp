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