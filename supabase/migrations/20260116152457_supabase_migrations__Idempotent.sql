-- robust_printing_schema_v3.sql
-- Idempotent e compatível com enum job_status atual (pending/processing/done/failed)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


/* ----------- Ensure enum job_status exists ----------- */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE job_status AS ENUM ('pending', 'processing', 'done', 'failed');
  ELSE
    -- Ensure the common values are present; add only if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'job_status'::regtype AND enumlabel = 'pending'
    ) THEN
      ALTER TYPE job_status ADD VALUE 'pending';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'job_status'::regtype AND enumlabel = 'processing'
    ) THEN
      ALTER TYPE job_status ADD VALUE 'processing';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'job_status'::regtype AND enumlabel = 'done'
    ) THEN
      ALTER TYPE job_status ADD VALUE 'done';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'job_status'::regtype AND enumlabel = 'failed'
    ) THEN
      ALTER TYPE job_status ADD VALUE 'failed';
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;


-- ========== printers ==========
CREATE TABLE IF NOT EXISTS printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NULL,
  name text NOT NULL,
  type text NOT NULL,        -- 'network'|'usb'|'bluetooth'|'system'
  format text NOT NULL,      -- 'receipt'|'a4'|'zpl'|'pdf'
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_print boolean DEFAULT false,
  interval_seconds integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE printers ADD COLUMN IF NOT EXISTS company_id uuid;
CREATE INDEX IF NOT EXISTS idx_printers_company_id ON printers(company_id);


-- ========== company_printers ==========
CREATE TABLE IF NOT EXISTS company_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  printer_id uuid NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE company_printers ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE company_printers ADD COLUMN IF NOT EXISTS printer_id uuid;
CREATE INDEX IF NOT EXISTS idx_company_printers_company ON company_printers(company_id);


-- ========== print_agents (ensure expected columns, but DO NOT overwrite existing design) ==========
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'print_agents' AND relkind = 'r'
  ) THEN
    CREATE TABLE public.print_agents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid,
      name text,
      api_key_hash text,
      api_key_prefix text,
      is_active boolean NOT NULL DEFAULT true,
      last_seen timestamptz,
      created_at timestamptz DEFAULT now()
    );
  END IF;
END
$$ LANGUAGE plpgsql;

ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS api_key_hash text;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS api_key_prefix text;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS last_seen timestamptz;
ALTER TABLE public.print_agents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- preserve existing unique index if present; create if not
CREATE UNIQUE INDEX IF NOT EXISTS print_agents_company_name_uq ON public.print_agents (company_id, name);

CREATE INDEX IF NOT EXISTS idx_print_agents_api_key_prefix ON public.print_agents(api_key_prefix);
CREATE INDEX IF NOT EXISTS idx_print_agents_api_key_hash ON public.print_agents(api_key_hash);

-- add FK to companies if possible and not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'print_agents_company_id_fkey'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies' AND relkind = 'r') THEN
      ALTER TABLE public.print_agents
      ADD CONSTRAINT print_agents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;


-- ========== print_jobs ==========
-- Create with status typed as job_status (default pending)
CREATE TABLE IF NOT EXISTS print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  printer_id uuid,
  source text,
  source_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status job_status NOT NULL DEFAULT 'pending'::job_status,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  priority integer DEFAULT 100,
  agent_id uuid NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- add columns if missing (keep status typed as job_status)
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printer_id uuid;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source_id uuid;
-- ensure payload exists
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;

-- For status: if column missing, add it as job_status; if exists, do not try to change type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'print_jobs' AND column_name = 'status'
  ) THEN
    ALTER TABLE print_jobs ADD COLUMN status job_status NOT NULL DEFAULT 'pending'::job_status;
  END IF;
END
$$ LANGUAGE plpgsql;

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 5;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS priority integer DEFAULT 100;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_print_jobs_status_priority ON print_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_company ON print_jobs(company_id);

-- optional FK to print_agents if exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'print_jobs_agent_id_fkey'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'print_agents' AND relkind = 'r') THEN
      ALTER TABLE print_jobs
      ADD CONSTRAINT print_jobs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.print_agents(id) ON DELETE SET NULL;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;


-- ========== print_job_logs ==========
CREATE TABLE IF NOT EXISTS print_job_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  attempt integer,
  message text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE print_job_logs ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE print_job_logs ADD COLUMN IF NOT EXISTS attempt integer;
ALTER TABLE print_job_logs ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE print_job_logs ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE print_job_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_print_job_logs_job ON print_job_logs(job_id);

-- optional FK from logs to jobs if not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'print_job_logs_job_id_fkey'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'print_jobs' AND relkind = 'r') THEN
      ALTER TABLE print_job_logs
      ADD CONSTRAINT print_job_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.print_jobs(id) ON DELETE CASCADE;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;


-- ========== claim_next_print_job function (atomic claim) ==========
CREATE OR REPLACE FUNCTION claim_next_print_job(p_company uuid, p_agent uuid)
RETURNS SETOF print_jobs AS $$
WITH sel AS (
  SELECT id
  FROM print_jobs
  WHERE company_id = p_company AND status = 'pending'::job_status
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
),
upd AS (
  UPDATE print_jobs
  SET status = 'processing'::job_status,
      started_at = now(),
      attempts = COALESCE(attempts,0) + 1,
      agent_id = p_agent
  WHERE id IN (SELECT id FROM sel)
  RETURNING *
)
SELECT * FROM upd;
$$ LANGUAGE sql VOLATILE;
