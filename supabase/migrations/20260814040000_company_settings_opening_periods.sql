-- Horário de atendimento: até 2 turnos/dia (almoço + jantar).
-- opening_periods é canônico; open_time/close_time = 1º turno (compat).

alter table public.company_settings
  add column if not exists opening_periods jsonb not null default '[]'::jsonb;

comment on column public.company_settings.opening_periods is
  'Turnos [{open,close} HH:MM], máx. 2. Vazio = sem horário cadastrado (loja tratada como aberta).';

update public.company_settings
set opening_periods = jsonb_build_array(
  jsonb_build_object('open', open_time, 'close', close_time)
)
where coalesce(jsonb_typeof(opening_periods), 'null') in ('null', 'array')
  and jsonb_array_length(coalesce(opening_periods, '[]'::jsonb)) = 0
  and open_time is not null
  and close_time is not null;
