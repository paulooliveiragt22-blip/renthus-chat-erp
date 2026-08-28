-- P1.4: onboarding_step persistido no wizard /ativar

alter table public.companies
  add column if not exists onboarding_step smallint not null default 0;

comment on column public.companies.onboarding_step is
  'Step atual do wizard /ativar (0=welcome … 5=done). onboarding_completed_at setado no fim.';
