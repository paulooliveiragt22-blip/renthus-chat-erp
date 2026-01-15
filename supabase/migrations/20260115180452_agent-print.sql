create table public.printers (
  id uuid not null default gen_random_uuid (),
  company_id uuid not null,
  name text not null,
  type text not null,
  format text not null,
  auto_print boolean not null default true,
  interval_seconds integer not null default 0,
  is_active boolean not null default true,
  config jsonb null,
  created_at timestamp with time zone not null default now(),
  constraint printers_pkey primary key (id),
  constraint printers_company_id_fkey foreign KEY (company_id) references companies (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_printers_company_id on public.printers using btree (company_id) TABLESPACE pg_default;

create index IF not exists idx_printers_company_active on public.printers using btree (company_id, is_active) TABLESPACE pg_default;