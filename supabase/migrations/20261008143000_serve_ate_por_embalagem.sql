-- serve_ate (e detalhes/informacoes) por embalagem.
-- P/M/G da mesma marmita são UN com o mesmo fator; casar só por sigla+fator
-- gravava o último valor em todas.

CREATE OR REPLACE FUNCTION public.rpc_apply_produto_embalagens_detalhes(
  p_company_id uuid,
  p_product_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_emb_id uuid;
  v_sigla uuid;
  v_descricao text;
  v_detalhes text;
  v_informacoes text;
  v_serve integer;
  v_fator numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    BEGIN
      v_emb_id := NULLIF(trim(v_item->>'id'), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_emb_id := NULL;
    END;
    v_sigla := NULLIF(trim(v_item->>'id_sigla_comercial'), '')::uuid;
    v_descricao := nullif(trim(v_item->>'descricao'), '');
    v_detalhes := nullif(trim(v_item->>'detalhes'), '');
    v_informacoes := nullif(trim(v_item->>'informacoes'), '');
    v_fator := GREATEST(1, COALESCE((v_item->>'fator_conversao')::numeric, 1));
    v_serve := NULLIF(v_item->>'serve_ate', '')::integer;
    IF v_serve IS NOT NULL AND (v_serve < 1 OR v_serve > 99) THEN
      RAISE EXCEPTION 'serve_ate deve ser entre 1 e 99';
    END IF;

    IF v_emb_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM produto_embalagens
      WHERE id = v_emb_id
        AND produto_id = p_product_id
        AND company_id = p_company_id
    ) THEN
      UPDATE produto_embalagens pe
      SET
        detalhes = v_detalhes,
        informacoes = v_informacoes,
        serve_ate = v_serve
      WHERE pe.id = v_emb_id
        AND pe.produto_id = p_product_id
        AND pe.company_id = p_company_id;
    ELSIF v_sigla IS NOT NULL THEN
      UPDATE produto_embalagens pe
      SET
        detalhes = v_detalhes,
        informacoes = v_informacoes,
        serve_ate = v_serve
      WHERE pe.produto_id = p_product_id
        AND pe.company_id = p_company_id
        AND pe.id_sigla_comercial = v_sigla
        AND pe.fator_conversao = v_fator
        AND upper(trim(coalesce(pe.descricao, ''))) = upper(trim(coalesce(v_descricao, '')));
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_apply_produto_embalagens_detalhes(uuid, uuid, jsonb) TO service_role;
