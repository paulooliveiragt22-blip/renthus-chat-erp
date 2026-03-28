-- Adiciona coluna last_error em print_jobs (necessária para o agente registrar falhas)
ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS last_error text;
