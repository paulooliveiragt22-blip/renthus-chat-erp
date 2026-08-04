-- Parte 1/2: só enum (precisa commit antes de usar os novos valores)

DO $$ BEGIN
    ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'essencial';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'pro';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'market';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
