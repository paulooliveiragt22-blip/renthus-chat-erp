create extension if not exists pg_cron;

-- Retenção de chatbot_queue: apaga jobs terminais antigos mesmo se o worker
-- estiver idle (complementa cleanupOldJobs no process-queue).
-- Default 24h; alinhado a CHATBOT_QUEUE_RETENTION_HOURS no app.

create or replace function public.cleanup_chatbot_queue_old_jobs(p_retention_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hours integer := greatest(1, least(168, coalesce(p_retention_hours, 24)));
  deleted integer;
begin
  delete from public.chatbot_queue
  where status in ('done', 'failed')
    and created_at < now() - make_interval(hours => hours);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.cleanup_chatbot_queue_old_jobs(integer) from public;
grant execute on function public.cleanup_chatbot_queue_old_jobs(integer) to service_role;

do $$
declare
  jid bigint;
begin
  for jid in
    select jobid from cron.job where jobname = 'chatbot-queue-cleanup'
  loop
    perform cron.unschedule(jid);
  end loop;
end $$;

-- Diário 04:15 UTC — independente do wake/worker.
select cron.schedule(
  'chatbot-queue-cleanup',
  '15 4 * * *',
  $cmd$select public.cleanup_chatbot_queue_old_jobs(24);$cmd$
);
