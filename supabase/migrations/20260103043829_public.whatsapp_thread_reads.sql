-- Cria a tabela whatsapp_thread_reads se ainda não existir
create table if not exists public.whatsapp_thread_reads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.whatsapp_threads(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garante que cada usuário tenha apenas um registro de leitura por thread (idempotência)
create unique index if not exists whatsapp_thread_reads_uq
  on public.whatsapp_thread_reads (company_id, user_id, thread_id);

-- Índice para consultas por thread (ajuda a listar quem leu e ordenar por last_read_at)
create index if not exists whatsapp_thread_reads_thread_idx
  on public.whatsapp_thread_reads (thread_id, last_read_at);

-- Função para atualizar automaticamente updated_at
create or replace function public.set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Gatilho para disparar a função antes de atualizar registros
create trigger set_whatsapp_thread_reads_updated_at
before update on public.whatsapp_thread_reads
for each row
execute procedure public.set_updated_at_timestamp();
