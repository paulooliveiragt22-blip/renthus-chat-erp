-- Fase 1: traces por turno do motor PRO (replay / diagnóstico).

CREATE TABLE IF NOT EXISTS public.pipeline_turn_traces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    v smallint NOT NULL DEFAULT 1,
    company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    thread_id uuid NOT NULL,
    channel text NOT NULL DEFAULT 'whatsapp',
    inbound_message_id text NOT NULL,
    state_before jsonb,
    state_after jsonb,
    outbound jsonb NOT NULL DEFAULT '[]'::jsonb,
    draft_snapshot jsonb,
    telemetry_reason text,
    ai_profile text
);

CREATE INDEX IF NOT EXISTS pipeline_turn_traces_company_thread_created_idx
    ON public.pipeline_turn_traces (company_id, thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS pipeline_turn_traces_created_at_idx
    ON public.pipeline_turn_traces (created_at DESC);

-- Idempotência por inbound (reprocess / wake duplicado)
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_turn_traces_company_inbound_uq
    ON public.pipeline_turn_traces (company_id, inbound_message_id);

ALTER TABLE public.pipeline_turn_traces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pipeline_turn_traces FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE public.pipeline_turn_traces TO service_role;
