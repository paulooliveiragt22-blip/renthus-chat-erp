-- ============================================================
-- Ajustes em cascata em todos os produtos (exceto product_id especificado)
-- Preenche todos os campos do formulário de cadastro
-- ============================================================

-- Produto a ser excluído dos ajustes
-- 412f1f00-5ca0-4854-8983-41e6830ea185

-- 1. Garantir colunas unit_type e details em products (se não existirem)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_type text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS details text;

-- 2. Garantir product_volumes para produtos que não têm (exceto o excluído)
INSERT INTO public.product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo, preco_custo)
SELECT DISTINCT ON (p.id, COALESCE(un.volume_quantidade::text, ''), COALESCE(un.id_unit_type::text, ''))
  p.company_id, p.id, un.volume_quantidade, un.id_unit_type,
  COALESCE(p.estoque_atual, 0), COALESCE(p.estoque_minimo, 0), p.preco_custo_unitario
FROM public.products p
JOIN public.produto_embalagens un ON un.produto_id = p.id
JOIN public.siglas_comerciais sc ON sc.id = un.id_sigla_comercial
WHERE p.id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND NOT EXISTS (
    SELECT 1 FROM public.product_volumes pv
    WHERE pv.product_id = p.id
      AND pv.volume_quantidade IS NOT DISTINCT FROM un.volume_quantidade
      AND pv.id_unit_type IS NOT DISTINCT FROM un.id_unit_type
  );

-- Produtos sem UN: criar product_volume default
INSERT INTO public.product_volumes (company_id, product_id, volume_quantidade, id_unit_type, estoque_atual, estoque_minimo, preco_custo)
SELECT p.company_id, p.id, NULL, NULL, COALESCE(p.estoque_atual, 0), COALESCE(p.estoque_minimo, 0), p.preco_custo_unitario
FROM public.products p
WHERE p.id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND NOT EXISTS (SELECT 1 FROM public.product_volumes pv WHERE pv.product_id = p.id);

-- 3. Atualizar product_volume_id em produto_embalagens (UN) — exceto produto excluído
UPDATE public.produto_embalagens pe
SET product_volume_id = pv.id
FROM public.product_volumes pv,
     public.siglas_comerciais sc
WHERE pe.produto_id = pv.product_id
  AND pe.produto_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND pe.id_sigla_comercial = sc.id
  AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND (
    (pe.volume_quantidade IS NOT DISTINCT FROM pv.volume_quantidade AND pe.id_unit_type IS NOT DISTINCT FROM pv.id_unit_type)
    OR (pv.volume_quantidade IS NULL AND pv.id_unit_type IS NULL AND pe.volume_quantidade IS NULL AND pe.id_unit_type IS NULL)
  )
  AND pe.product_volume_id IS NULL;

-- 4. Atualizar product_volume_id em produto_embalagens (CX/FARD/PAC) — exceto produto excluído
UPDATE public.produto_embalagens pe
SET product_volume_id = (
  SELECT pv.id FROM public.product_volumes pv
  WHERE pv.product_id = pe.produto_id
  ORDER BY pv.volume_quantidade NULLS LAST, pv.id_unit_type NULLS LAST
  LIMIT 1
)
FROM public.siglas_comerciais sc
WHERE pe.id_sigla_comercial = sc.id
  AND pe.produto_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND upper(sc.sigla) NOT IN ('UN', 'UNIDADE')
  AND pe.product_volume_id IS NULL;

-- 5. Sincronizar produto_embalagens: id_unit_type e volume_quantidade do product_volume
UPDATE public.produto_embalagens pe
SET
  id_unit_type = pv.id_unit_type,
  volume_quantidade = pv.volume_quantidade
FROM public.product_volumes pv
WHERE pe.product_volume_id = pv.id
  AND pe.produto_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND (pe.id_unit_type IS DISTINCT FROM pv.id_unit_type OR pe.volume_quantidade IS DISTINCT FROM pv.volume_quantidade);

-- 6. Sincronizar products.unit_type e products.details a partir da embalagem UN
UPDATE public.products p
SET
  unit_type = COALESCE(ut.sigla, p.unit_type),
  details = COALESCE(un.descricao, p.details)
FROM public.produto_embalagens un
JOIN public.siglas_comerciais sc ON sc.id = un.id_sigla_comercial
LEFT JOIN public.unit_types ut ON ut.id = un.id_unit_type
WHERE un.produto_id = p.id
  AND p.id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND upper(sc.sigla) IN ('UN', 'UNIDADE')
  AND (p.unit_type IS DISTINCT FROM COALESCE(ut.sigla, p.unit_type) OR p.details IS DISTINCT FROM COALESCE(un.descricao, p.details));

-- 7. Sincronizar product_volumes.preco_custo a partir da embalagem UN ou products
UPDATE public.product_volumes pv
SET preco_custo = COALESCE(
  (SELECT pe.preco_custo FROM public.produto_embalagens pe
   JOIN public.siglas_comerciais sc ON sc.id = pe.id_sigla_comercial
   WHERE pe.product_volume_id = pv.id AND upper(sc.sigla) IN ('UN', 'UNIDADE') LIMIT 1),
  p.preco_custo_unitario
)
FROM public.products p
WHERE pv.product_id = p.id
  AND pv.product_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND (pv.preco_custo IS NULL OR pv.preco_custo = 0);

-- 8. Backfill product_volumes.estoque quando vazio e products tem valor
UPDATE public.product_volumes pv
SET
  estoque_atual = COALESCE(p.estoque_atual, 0),
  estoque_minimo = COALESCE(p.estoque_minimo, 0)
FROM public.products p
WHERE pv.product_id = p.id
  AND pv.product_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND pv.estoque_atual = 0 AND pv.estoque_minimo = 0
  AND (COALESCE(p.estoque_atual, 0) > 0 OR COALESCE(p.estoque_minimo, 0) > 0);

-- 9. Garantir fator_conversao mínimo 1 em produto_embalagens
UPDATE public.produto_embalagens pe
SET fator_conversao = GREATEST(1, COALESCE(pe.fator_conversao, 1))
WHERE pe.produto_id <> '412f1f00-5ca0-4854-8983-41e6830ea185'::uuid
  AND (pe.fator_conversao IS NULL OR pe.fator_conversao < 1);

COMMENT ON COLUMN public.products.unit_type IS 'Sigla da unidade (ml, L, kg) herdada da embalagem UN.';
COMMENT ON COLUMN public.products.details IS 'Descrição herdada da embalagem UN (ex: 350ml, long neck).';
