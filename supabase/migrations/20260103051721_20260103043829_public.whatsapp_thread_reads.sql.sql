-- Migration to introduce whatsapp_thread_reads table for tracking per-user thread reads.
-- This table allows the application to determine which messages are unread for each
-- user within a company, ensuring that one user's actions do not mark a thread
-- as read for all users.

create table if not exists public.whatsapp_thread_reads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.whatsapp_threads(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure that each (company_id, user_id, thread_id) combination is unique.
create unique index if not exists whatsapp_thread_reads_uq
  on public.whatsapp_thread_reads (company_id, user_id, thread_id);

-- Index to accelerate lookups of thread reads by thread and last_read_at.
create index if not exists whatsapp_thread_reads_thread_idx
  on public.whatsapp_thread_reads (thread_id, last_read_at);

-- Function to automatically update the updated_at column on updates.
create or replace function public.set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to invoke the updated_at function before update.
create trigger set_whatsapp_thread_reads_updated_at
before update on public.whatsapp_thread_reads
for each row
execute procedure public.set_updated_at_timestamp();