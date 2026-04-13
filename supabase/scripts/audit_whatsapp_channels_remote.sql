-- ═══════════════════════════════════════════════════════════════════════════
-- Auditoria remota (Supabase SQL Editor) — projeto zwcfuvohxmvlxhdfbgxo
-- Somente SELECT / inspeção. Rode no Dashboard → SQL → New query.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Colunas novas presentes?
SELECT c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'whatsapp_channels'
  AND c.column_name IN ('encrypted_access_token', 'waba_id', 'provider_metadata', 'from_identifier', 'status')
ORDER BY c.column_name;

-- 2) Tabela de auditoria existe?
SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'whatsapp_channel_credential_audit'
) AS audit_table_exists;

-- 3) RLS ativo?
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('whatsapp_channels', 'whatsapp_channel_credential_audit')
ORDER BY c.relname;

-- 4) Policies em whatsapp_channels (esperadas: 4)
SELECT pol.polname AS policy_name,
       pol.polcmd::text AS cmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class cls ON cls.oid = pol.polrelid
JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
WHERE nsp.nspname = 'public'
  AND cls.relname = 'whatsapp_channels'
ORDER BY pol.polname;

-- 5) Helper usado nas policies (deve existir antes da migration 20260413120000)
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'renthus_is_company_admin_for_session';

-- 6) Resumo de dados (sem expor tokens)
SELECT
    count(*)::bigint AS total_channels,
    count(*) FILTER (WHERE encrypted_access_token IS NOT NULL AND trim(encrypted_access_token) <> '')::bigint
        AS rows_with_encrypted_token,
    count(*) FILTER (WHERE provider_metadata ? 'access_token')::bigint AS rows_with_legacy_json_token,
    count(*) FILTER (WHERE waba_id IS NOT NULL AND trim(waba_id) <> '')::bigint AS rows_with_waba_column
FROM public.whatsapp_channels;

-- 7) Últimas linhas de auditoria (se a migration já rodou e houve alterações)
SELECT id, channel_id, company_id, action, actor, created_at
FROM public.whatsapp_channel_credential_audit
ORDER BY created_at DESC
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicar migration pendente (se a auditoria acima mostrar colunas ausentes):
-- Copie o conteúdo completo de:
--   supabase/migrations/20260413120000_whatsapp_channels_rls_encrypted_token_audit.sql
-- e execute na mesma sessão (ou use: supabase db push com CLI linkado).
-- ═══════════════════════════════════════════════════════════════════════════
