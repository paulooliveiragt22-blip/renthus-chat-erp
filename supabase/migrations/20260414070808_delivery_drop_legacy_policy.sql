-- Remove policy legada de delivery_zones para evitar acesso não intencional se grants mudarem no futuro.

drop policy if exists "company members can manage delivery zones" on public.delivery_zones;
