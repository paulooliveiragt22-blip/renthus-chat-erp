-- F4.2: índices + RPC de leitura agregada do cardápio web.

CREATE INDEX IF NOT EXISTS menu_page_events_company_type_created_idx
    ON public.menu_page_events (company_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS menu_page_events_company_product_idx
    ON public.menu_page_events (company_id, product_id)
    WHERE product_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rpc_get_menu_analytics(
    p_company_id uuid,
    p_from       timestamptz,
    p_to         timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from timestamptz := COALESCE(p_from, now() - interval '30 days');
    v_to   timestamptz := COALESCE(p_to, now());
    v_page_views int;
    v_unique_visitors int;
    v_product_views int;
    v_days jsonb;
    v_top_products jsonb;
    v_utm_sources jsonb;
BEGIN
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
    END IF;
    IF v_to < v_from THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE e.event_type = 'page_view')::int,
        COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'page_view')::int,
        COUNT(*) FILTER (WHERE e.event_type = 'product_view')::int
    INTO v_page_views, v_unique_visitors, v_product_views
    FROM public.menu_page_events e
    WHERE e.company_id = p_company_id
      AND e.created_at >= v_from
      AND e.created_at < v_to;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'date', d.day::text,
                'page_views', d.page_views,
                'unique_visitors', d.unique_visitors
            )
            ORDER BY d.day
        ),
        '[]'::jsonb
    )
    INTO v_days
    FROM (
        SELECT
            (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
            COUNT(*) FILTER (WHERE e.event_type = 'page_view')::int AS page_views,
            COUNT(DISTINCT e.visitor_id) FILTER (WHERE e.event_type = 'page_view')::int AS unique_visitors
        FROM public.menu_page_events e
        WHERE e.company_id = p_company_id
          AND e.created_at >= v_from
          AND e.created_at < v_to
          AND e.event_type = 'page_view'
        GROUP BY 1
    ) d;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'product_id', t.product_id,
                'name', t.name,
                'views', t.views
            )
            ORDER BY t.views DESC
        ),
        '[]'::jsonb
    )
    INTO v_top_products
    FROM (
        SELECT
            e.product_id,
            COALESCE(NULLIF(trim(p.name), ''), 'Produto') AS name,
            COUNT(*)::int AS views
        FROM public.menu_page_events e
        LEFT JOIN public.products p ON p.id = e.product_id
        WHERE e.company_id = p_company_id
          AND e.created_at >= v_from
          AND e.created_at < v_to
          AND e.event_type = 'product_view'
          AND e.product_id IS NOT NULL
        GROUP BY e.product_id, p.name
        ORDER BY COUNT(*) DESC
        LIMIT 10
    ) t;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'utm_source', u.utm_source,
                'page_views', u.page_views,
                'unique_visitors', u.unique_visitors
            )
            ORDER BY u.page_views DESC
        ),
        '[]'::jsonb
    )
    INTO v_utm_sources
    FROM (
        SELECT
            COALESCE(NULLIF(trim(e.utm_source), ''), '(direto)') AS utm_source,
            COUNT(*)::int AS page_views,
            COUNT(DISTINCT e.visitor_id)::int AS unique_visitors
        FROM public.menu_page_events e
        WHERE e.company_id = p_company_id
          AND e.created_at >= v_from
          AND e.created_at < v_to
          AND e.event_type = 'page_view'
        GROUP BY 1
        ORDER BY COUNT(*) DESC
        LIMIT 15
    ) u;

    RETURN jsonb_build_object(
        'from', v_from,
        'to', v_to,
        'page_views', COALESCE(v_page_views, 0),
        'unique_visitors', COALESCE(v_unique_visitors, 0),
        'product_views', COALESCE(v_product_views, 0),
        'days', COALESCE(v_days, '[]'::jsonb),
        'top_products', COALESCE(v_top_products, '[]'::jsonb),
        'utm_sources', COALESCE(v_utm_sources, '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_menu_analytics(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_menu_analytics(uuid, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.rpc_get_menu_analytics(uuid, timestamptz, timestamptz) IS
    'F4.2: agregados do cardápio web (visitas, top produtos, UTM) por empresa.';
