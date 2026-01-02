create table whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  provider whatsapp_provider not null,
  status whatsapp_channel_status not null default 'active',

  -- Número / identificador do provedor
  from_identifier text not null,

  -- Metadados (ex: phone_number_id, waba_id, etc)
  provider_metadata jsonb,

  started_at timestamptz not null default now(),
  ended_at timestamptz,

  created_at timestamptz not null default now(),

  constraint one_active_channel_per_company
    unique (company_id)
    deferrable initially deferred
);

alter table whatsapp_threads
  add column company_id uuid references companies(id),
  add column channel_id uuid references whatsapp_channels(id);

alter table whatsapp_messages
  add column provider whatsapp_provider,
  add column provider_message_id text,
  add column status text,
  add column error text;

create unique index if not exists whatsapp_dedup_idx
on whatsapp_messages (provider, provider_message_id)
where provider_message_id is not null;

create table whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  phone_e164 text not null,
  display_name text,

  created_at timestamptz not null default now(),

  unique (company_id, phone_e164)
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, -- ex: mini_erp, full_erp
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table features (
  key text primary key, -- ex: whatsapp, erp_full, printing_auto
  description text
);

create table plan_features (
  plan_id uuid references plans(id) on delete cascade,
  feature_key text references features(key) on delete cascade,
  primary key (plan_id, feature_key)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plan_id uuid not null references plans(id),

  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table subscription_addons (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  feature_key text not null references features(key),
  quantity int not null default 1,

  created_at timestamptz not null default now(),

  unique (company_id, feature_key)
);

create table feature_limits (
  plan_id uuid references plans(id) on delete cascade,
  feature_key text references features(key),
  limit_per_month int not null,

  primary key (plan_id, feature_key)
);

create table usage_monthly (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  feature_key text not null,
  year_month text not null, -- ex: 2026-01

  used int not null default 0,

  created_at timestamptz not null default now(),

  unique (company_id, feature_key, year_month)
);

create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid references orders(id),

  status job_status not null default 'pending',
  payload jsonb,
  error text,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);
