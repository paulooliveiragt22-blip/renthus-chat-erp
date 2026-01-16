-- Migration: cria agent_download_tokens para download one-time de agentes
CREATE TABLE IF NOT EXISTS public.agent_download_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.print_agents(id) ON DELETE CASCADE,
  token_hash text NOT NULL,             -- bcrypt hash do token para validar
  token_prefix text NOT NULL,           -- prefixo (primeiros 8 chars) para busca rápido
  encrypted_api_key text NOT NULL,      -- api_key criptografado temporariamente (AES-GCM), será apagado após uso
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_by uuid,                      -- opcional: id do usuário que gerou
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_download_tokens_agent ON public.agent_download_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_download_tokens_prefix ON public.agent_download_tokens(token_prefix);
CREATE INDEX IF NOT EXISTS idx_agent_download_tokens_expire ON public.agent_download_tokens(expires_at);
