-- P0g: Market R$ 397, remove mobile_app do catálogo pago.
-- P0g2: schema + RPCs de atendimento de mesa (table_service).

-- ─── Comercial ───────────────────────────────────────────────────────────────
UPDATE public.plans
SET
    price_cents = 39700,
    description = 'Pro + iFood/Aiqfome + Instagram/Messenger + mesa · R$ 397/mês',
    name = 'Market'
WHERE key = 'market';

UPDATE public.features
SET description = 'Atendimento de mesa / salão'
WHERE key = 'table_service';

UPDATE public.features
SET description = 'Chatbot Instagram + Messenger'
WHERE key = 'omnichannel_ig_messenger';

UPDATE public.features
SET description = 'Integração iFood'
WHERE key = 'marketplace_ifood';

UPDATE public.features
SET description = 'Integração Aiqfome'
WHERE key = 'marketplace_aiqfome';

DELETE FROM public.plan_features
WHERE feature_key = 'mobile_app';

-- ─── Pedidos: source/channel mesa ────────────────────────────────────────────
ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_source_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_source_check
    CHECK (source = ANY (ARRAY[
        'chatbot'::text,
        'ui'::text,
        'pdv_direct'::text,
        'flow_catalog'::text,
        'flow_checkout'::text,
        'ai_chat_pro_v2'::text,
        'web_menu'::text,
        'marketplace_ifood'::text,
        'marketplace_aiqfome'::text,
        'table_service'::text
    ]));

ALTER TABLE public.orders
    DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_channel_check
    CHECK (channel = ANY (ARRAY[
        'whatsapp'::text,
        'admin'::text,
        'balcao'::text,
        'web'::text,
        'marketplace'::text,
        'mesa'::text,
        'instagram'::text,
        'messenger'::text
    ]));

-- ─── Mesas / sessões / itens ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dining_tables (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    code        text NOT NULL,
    label       text,
    capacity    integer,
    sort_order  integer NOT NULL DEFAULT 0,
    status      text NOT NULL DEFAULT 'free'
        CHECK (status = ANY (ARRAY['free'::text, 'occupied'::text, 'disabled'::text])),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dining_tables_company_code_uq UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS public.table_sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    dining_table_id  uuid NOT NULL REFERENCES public.dining_tables (id) ON DELETE RESTRICT,
    status           text NOT NULL DEFAULT 'open'
        CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text])),
    customer_id      uuid REFERENCES public.customers (id) ON DELETE SET NULL,
    notes            text,
    opened_at        timestamptz NOT NULL DEFAULT now(),
    closed_at        timestamptz,
    order_id         uuid REFERENCES public.orders (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open_per_table_uq
    ON public.table_sessions (dining_table_id)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS table_sessions_company_open_idx
    ON public.table_sessions (company_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.table_session_items (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id           uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    session_id           uuid NOT NULL REFERENCES public.table_sessions (id) ON DELETE CASCADE,
    produto_embalagem_id uuid NOT NULL REFERENCES public.produto_embalagens (id) ON DELETE RESTRICT,
    product_id           uuid REFERENCES public.products (id) ON DELETE SET NULL,
    product_name         text NOT NULL,
    qty                  numeric NOT NULL CHECK (qty > 0),
    unit_price           numeric NOT NULL CHECK (unit_price >= 0),
    sigla_comercial      text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS table_session_items_session_idx
    ON public.table_session_items (session_id);

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS table_session_id uuid REFERENCES public.table_sessions (id) ON DELETE SET NULL;

-- RLS select company
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_session_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dining_tables_select_company ON public.dining_tables;
CREATE POLICY dining_tables_select_company ON public.dining_tables
    FOR SELECT TO authenticated
    USING (
        company_id IN (
            SELECT cu.company_id FROM public.company_users cu WHERE cu.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS table_sessions_select_company ON public.table_sessions;
CREATE POLICY table_sessions_select_company ON public.table_sessions
    FOR SELECT TO authenticated
    USING (
        company_id IN (
            SELECT cu.company_id FROM public.company_users cu WHERE cu.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS table_session_items_select_company ON public.table_session_items;
CREATE POLICY table_session_items_select_company ON public.table_session_items
    FOR SELECT TO authenticated
    USING (
        company_id IN (
            SELECT cu.company_id FROM public.company_users cu WHERE cu.user_id = auth.uid()
        )
    );

GRANT SELECT ON public.dining_tables, public.table_sessions, public.table_session_items TO authenticated;
GRANT ALL ON public.dining_tables, public.table_sessions, public.table_session_items TO service_role;

-- ─── RPCs ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mesa_list_floor(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sort_order, t.code), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT
            dt.id,
            dt.code,
            dt.label,
            dt.capacity,
            dt.sort_order,
            dt.status AS table_status,
            s.id AS session_id,
            s.opened_at,
            s.notes,
            s.customer_id,
            COALESCE((
                SELECT SUM(i.qty * i.unit_price)
                FROM public.table_session_items i
                WHERE i.session_id = s.id
            ), 0) AS session_total,
            COALESCE((
                SELECT COUNT(*)::int
                FROM public.table_session_items i
                WHERE i.session_id = s.id
            ), 0) AS items_count
        FROM public.dining_tables dt
        LEFT JOIN public.table_sessions s
            ON s.dining_table_id = dt.id AND s.status = 'open'
        WHERE dt.company_id = p_company_id
    ) t;

    RETURN jsonb_build_object('ok', true, 'tables', v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_upsert_table(
    p_company_id uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid := NULLIF(trim(COALESCE(p_payload ->> 'id', '')), '')::uuid;
    v_code text := nullif(trim(COALESCE(p_payload ->> 'code', '')), '');
    v_label text := nullif(trim(COALESCE(p_payload ->> 'label', '')), '');
    v_capacity integer := NULLIF(trim(COALESCE(p_payload ->> 'capacity', '')), '')::integer;
    v_sort integer := COALESCE(NULLIF(trim(COALESCE(p_payload ->> 'sort_order', '')), '')::integer, 0);
    v_status text := COALESCE(nullif(trim(COALESCE(p_payload ->> 'status', '')), ''), 'free');
    v_row public.dining_tables%ROWTYPE;
BEGIN
    IF v_code IS NULL THEN
        RAISE EXCEPTION 'code_required' USING ERRCODE = '23502';
    END IF;
    IF v_status NOT IN ('free', 'occupied', 'disabled') THEN
        v_status := 'free';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.dining_tables (company_id, code, label, capacity, sort_order, status)
        VALUES (p_company_id, v_code, v_label, v_capacity, v_sort, CASE WHEN v_status = 'occupied' THEN 'free' ELSE v_status END)
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.dining_tables
        SET
            code = v_code,
            label = v_label,
            capacity = v_capacity,
            sort_order = v_sort,
            status = CASE
                WHEN status = 'occupied' THEN status
                WHEN v_status = 'occupied' THEN status
                ELSE v_status
            END,
            updated_at = now()
        WHERE id = v_id AND company_id = p_company_id
        RETURNING * INTO v_row;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'table', jsonb_build_object(
            'id', v_row.id,
            'code', v_row.code,
            'label', v_row.label,
            'capacity', v_row.capacity,
            'sort_order', v_row.sort_order,
            'status', v_row.status
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_open_session(
    p_company_id uuid,
    p_table_id uuid,
    p_notes text DEFAULT NULL,
    p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table public.dining_tables%ROWTYPE;
    v_session public.table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_table
    FROM public.dining_tables
    WHERE id = p_table_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_table.status = 'disabled' THEN
        RAISE EXCEPTION 'table_disabled' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.table_sessions
        WHERE dining_table_id = p_table_id AND status = 'open'
    ) THEN
        RAISE EXCEPTION 'table_already_open' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.table_sessions (company_id, dining_table_id, notes, customer_id)
    VALUES (p_company_id, p_table_id, nullif(trim(COALESCE(p_notes, '')), ''), p_customer_id)
    RETURNING * INTO v_session;

    UPDATE public.dining_tables
    SET status = 'occupied', updated_at = now()
    WHERE id = p_table_id;

    RETURN jsonb_build_object(
        'ok', true,
        'session', jsonb_build_object(
            'id', v_session.id,
            'dining_table_id', v_session.dining_table_id,
            'opened_at', v_session.opened_at,
            'notes', v_session.notes
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_add_item(
    p_company_id uuid,
    p_session_id uuid,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.table_sessions%ROWTYPE;
    v_emb uuid := NULLIF(trim(COALESCE(p_payload ->> 'produto_embalagem_id', '')), '')::uuid;
    v_product uuid := NULLIF(trim(COALESCE(p_payload ->> 'product_id', '')), '')::uuid;
    v_name text := nullif(trim(COALESCE(p_payload ->> 'product_name', '')), '');
    v_qty numeric := COALESCE((p_payload ->> 'qty')::numeric, 0);
    v_price numeric := COALESCE((p_payload ->> 'unit_price')::numeric, 0);
    v_sigla text := nullif(trim(COALESCE(p_payload ->> 'sigla_comercial', '')), '');
    v_item public.table_session_items%ROWTYPE;
BEGIN
    SELECT * INTO v_session
    FROM public.table_sessions
    WHERE id = p_session_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'session_not_open' USING ERRCODE = '23514';
    END IF;
    IF v_emb IS NULL OR v_name IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'item_invalid' USING ERRCODE = '23502';
    END IF;

    INSERT INTO public.table_session_items (
        company_id, session_id, produto_embalagem_id, product_id, product_name, qty, unit_price, sigla_comercial
    )
    VALUES (p_company_id, p_session_id, v_emb, v_product, v_name, v_qty, GREATEST(v_price, 0), v_sigla)
    RETURNING * INTO v_item;

    RETURN jsonb_build_object(
        'ok', true,
        'item', jsonb_build_object(
            'id', v_item.id,
            'produto_embalagem_id', v_item.produto_embalagem_id,
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'qty', v_item.qty,
            'unit_price', v_item.unit_price,
            'sigla_comercial', v_item.sigla_comercial
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_remove_item(
    p_company_id uuid,
    p_session_id uuid,
    p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_session
    FROM public.table_sessions
    WHERE id = p_session_id AND company_id = p_company_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'session_not_open' USING ERRCODE = '23514';
    END IF;

    DELETE FROM public.table_session_items
    WHERE id = p_item_id AND session_id = p_session_id AND company_id = p_company_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_get_session(
    p_company_id uuid,
    p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.table_sessions%ROWTYPE;
    v_table public.dining_tables%ROWTYPE;
    v_items jsonb;
BEGIN
    SELECT * INTO v_session
    FROM public.table_sessions
    WHERE id = p_session_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_table FROM public.dining_tables WHERE id = v_session.dining_table_id;

    SELECT COALESCE(jsonb_agg(row_to_json(i)::jsonb ORDER BY i.created_at), '[]'::jsonb)
    INTO v_items
    FROM public.table_session_items i
    WHERE i.session_id = p_session_id;

    RETURN jsonb_build_object(
        'ok', true,
        'session', jsonb_build_object(
            'id', v_session.id,
            'status', v_session.status,
            'opened_at', v_session.opened_at,
            'closed_at', v_session.closed_at,
            'notes', v_session.notes,
            'customer_id', v_session.customer_id,
            'order_id', v_session.order_id,
            'table', jsonb_build_object(
                'id', v_table.id,
                'code', v_table.code,
                'label', v_table.label
            ),
            'items', v_items,
            'total', COALESCE((
                SELECT SUM(x.qty * x.unit_price) FROM public.table_session_items x WHERE x.session_id = p_session_id
            ), 0)
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_mark_session_closed(
    p_company_id uuid,
    p_session_id uuid,
    p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_session
    FROM public.table_sessions
    WHERE id = p_session_id AND company_id = p_company_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'session_not_open' USING ERRCODE = '23514';
    END IF;

    UPDATE public.table_sessions
    SET status = 'closed', closed_at = now(), order_id = p_order_id, updated_at = now()
    WHERE id = p_session_id;

    UPDATE public.dining_tables
    SET status = 'free', updated_at = now()
    WHERE id = v_session.dining_table_id AND company_id = p_company_id;

    UPDATE public.orders
    SET
        source = 'table_service',
        channel = 'mesa',
        table_session_id = p_session_id,
        customer_name = COALESCE(
            customer_name,
            'Mesa ' || COALESCE((
                SELECT code FROM public.dining_tables WHERE id = v_session.dining_table_id
            ), '')
        )
    WHERE id = p_order_id AND company_id = p_company_id;

    RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'session_id', p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_mesa_seed_default_tables(
    p_company_id uuid,
    p_count integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_n integer := GREATEST(1, LEAST(COALESCE(p_count, 8), 40));
    v_i integer;
    v_existing integer;
BEGIN
    SELECT COUNT(*)::int INTO v_existing
    FROM public.dining_tables WHERE company_id = p_company_id;
    IF v_existing > 0 THEN
        RETURN jsonb_build_object('ok', true, 'seeded', 0, 'existing', v_existing);
    END IF;

    FOR v_i IN 1..v_n LOOP
        INSERT INTO public.dining_tables (company_id, code, label, sort_order, status)
        VALUES (p_company_id, v_i::text, 'Mesa ' || v_i::text, v_i, 'free');
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'seeded', v_n, 'existing', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_mesa_list_floor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_upsert_table(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_open_session(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_add_item(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_remove_item(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_get_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_mark_session_closed(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_mesa_seed_default_tables(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_mesa_list_floor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_upsert_table(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_open_session(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_add_item(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_remove_item(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_get_session(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_mark_session_closed(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_mesa_seed_default_tables(uuid, integer) TO service_role;
