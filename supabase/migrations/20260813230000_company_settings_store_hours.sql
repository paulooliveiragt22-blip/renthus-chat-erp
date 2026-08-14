-- M2: horário de atendimento + descrição do delivery (tipado em company_settings).
-- Não usar companies.settings jsonb para isso.

alter table public.company_settings
  add column if not exists open_time text;

alter table public.company_settings
  add column if not exists close_time text;

alter table public.company_settings
  add column if not exists timezone text not null default 'America/Cuiaba';

alter table public.company_settings
  add column if not exists delivery_description text;

comment on column public.company_settings.open_time is
  'Abertura HH:MM no fuso da loja. Null = quiet hours 08:00.';
comment on column public.company_settings.close_time is
  'Fechamento HH:MM no fuso da loja (pode ser < open_time = overnight). Null = 22:00.';
comment on column public.company_settings.timezone is
  'IANA timezone da loja (default America/Cuiaba).';
comment on column public.company_settings.delivery_description is
  'Texto curto de delivery (ex.: entregamos até 3 km). Máx. 280 no app.';

alter table public.company_settings
  drop constraint if exists company_settings_open_time_hhmm_check;

alter table public.company_settings
  add constraint company_settings_open_time_hhmm_check
  check (open_time is null or open_time ~ '^\d{2}:\d{2}$');

alter table public.company_settings
  drop constraint if exists company_settings_close_time_hhmm_check;

alter table public.company_settings
  add constraint company_settings_close_time_hhmm_check
  check (close_time is null or close_time ~ '^\d{2}:\d{2}$');

alter table public.company_settings
  drop constraint if exists company_settings_delivery_description_len_check;

alter table public.company_settings
  add constraint company_settings_delivery_description_len_check
  check (delivery_description is null or char_length(delivery_description) <= 280);
