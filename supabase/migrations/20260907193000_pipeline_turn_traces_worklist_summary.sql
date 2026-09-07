-- ADR 0011 Fase 4: resumo explícito da OrderWorklist no turn trace (reason codes / debug).
alter table public.pipeline_turn_traces
  add column if not exists worklist_summary jsonb;

comment on column public.pipeline_turn_traces.worklist_summary is
  'ADR 0011: compact OrderWorklist snapshot (byStatus, blocksCheckout, reasons). Null when empty.';
