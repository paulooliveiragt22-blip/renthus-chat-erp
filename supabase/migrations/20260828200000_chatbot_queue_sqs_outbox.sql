-- ADR-0003: outbox columns for SQS dispatch (inbound + outbound).
-- chatbot_queue / outbound_jobs remain source of truth; SQS carries jobId only.

ALTER TABLE public.chatbot_queue
  ADD COLUMN IF NOT EXISTS sqs_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sqs_message_id text;

ALTER TABLE public.outbound_jobs
  ADD COLUMN IF NOT EXISTS sqs_enqueued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sqs_message_id text;

COMMENT ON COLUMN public.chatbot_queue.sqs_enqueued_at IS
  'Set after successful SQS SendMessage (ADR-0003 outbox). NULL = not yet dispatched.';
COMMENT ON COLUMN public.chatbot_queue.sqs_message_id IS
  'SQS MessageId returned by SendMessage.';
COMMENT ON COLUMN public.outbound_jobs.sqs_enqueued_at IS
  'Set after successful SQS SendMessage (ADR-0003 outbox). NULL = not yet dispatched.';
COMMENT ON COLUMN public.outbound_jobs.sqs_message_id IS
  'SQS MessageId returned by SendMessage.';

CREATE INDEX IF NOT EXISTS chatbot_queue_outbox_pending_idx
  ON public.chatbot_queue (created_at ASC)
  WHERE status = 'pending' AND sqs_enqueued_at IS NULL;

CREATE INDEX IF NOT EXISTS outbound_jobs_outbox_pending_idx
  ON public.outbound_jobs (created_at ASC)
  WHERE status = 'pending' AND sqs_enqueued_at IS NULL;
