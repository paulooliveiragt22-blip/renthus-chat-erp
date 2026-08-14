-- Drenagem da chatbot_queue em batimento fixo (Fase 4 de
-- docs/PLANO_ESCALA_PICOS_PEDIDOS.md). Complementa o wake HTTP pós-enqueue; não substitui.
--
-- Pré-requisito FORA deste arquivo (nunca versionar o valor):
--   select vault.create_secret('<CRON_SECRET>', 'chatbot_queue_cron_secret');
-- A migration só referencia o *nome* do secret.
--
-- URL: domínio de produção estável (mesma origem de NEXT_PUBLIC_APP_URL).
-- Timeout do pg_net 50s — o worker tem maxDuration 60s; pg_net é async mas o timeout
-- evita cancelar cedo demais se o runtime abortar no disconnect do client.

create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'chatbot_queue_cron_secret'
  ) then
    raise exception
      'vault secret chatbot_queue_cron_secret ausente — rode vault.create_secret(CRON_SECRET, nome) antes desta migration';
  end if;
end $$;

do $$
declare
  jid bigint;
begin
  for jid in
    select jobid from cron.job where jobname = 'chatbot-queue-drain'
  loop
    perform cron.unschedule(jid);
  end loop;
end $$;

select cron.schedule(
  'chatbot-queue-drain',
  '10 seconds',
  $cmd$
  select net.http_get(
    url := 'https://app.renthus.com.br/api/chatbot/process-queue',
    headers := jsonb_build_object(
      'authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'chatbot_queue_cron_secret'
      )
    ),
    timeout_milliseconds := 50000
  );
  $cmd$
);
