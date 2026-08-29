-- Fase 5 ADR-0003: claim/reclaim HTTP poll removido — SQS + reconciler Lambda.

DROP FUNCTION IF EXISTS public.claim_chatbot_queue_jobs(integer, integer);
DROP FUNCTION IF EXISTS public.claim_chatbot_queue_jobs(integer, integer, integer);
DROP FUNCTION IF EXISTS public.reclaim_stuck_chatbot_queue_jobs(integer);
DROP FUNCTION IF EXISTS public.claim_outbound_jobs(integer, integer, integer);
DROP FUNCTION IF EXISTS public.reclaim_stuck_outbound_jobs(integer);
