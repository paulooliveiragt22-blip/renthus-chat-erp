-- 2026_01_09_fix_usage_monthly_insert.sql
-- Insere um registro mensal para cada company para a feature 'chatbot' com used = 0
-- (só insere se ainda não existir para o company / year_month)

INSERT INTO public.usage_monthly (id, company_id, feature_key, year_month, used, created_at)
SELECT gen_random_uuid(), c.id, 'chatbot', to_char(CURRENT_DATE, 'YYYY-MM'), 0, now()
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.usage_monthly um
  WHERE um.company_id = c.id
    AND um.feature_key = 'chatbot'
    AND um.year_month = to_char(CURRENT_DATE, 'YYYY-MM')
);
