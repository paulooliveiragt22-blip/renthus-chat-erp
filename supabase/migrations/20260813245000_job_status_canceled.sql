-- M6 prep: adiciona job_status.canceled (precisa txn própria antes de usar o label).
alter type public.job_status add value if not exists 'canceled';
