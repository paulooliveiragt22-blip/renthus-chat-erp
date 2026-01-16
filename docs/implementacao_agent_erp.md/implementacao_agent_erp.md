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