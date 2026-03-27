-- Garante que nenhum pedido fique sem itens após uma transação.
-- Usa CONSTRAINT TRIGGER DEFERRABLE: dispara no COMMIT, não linha a linha.
-- Cobre: DELETE do último item (ex: painel admin) e DELETE em cascata.

CREATE OR REPLACE FUNCTION public.enforce_order_has_items()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Verifica se o pedido ainda tem ao menos 1 item após a operação
    IF NOT EXISTS (
        SELECT 1 FROM public.order_items WHERE order_id = OLD.order_id
    ) THEN
        RAISE EXCEPTION 'pedido % não pode ficar sem itens', OLD.order_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NULL;
END;
$$;

-- Só dispara quando o último item é removido (DELETE)
-- DEFERRABLE INITIALLY DEFERRED: avaliado no COMMIT da transação,
-- permitindo que deleções intermediárias ocorram dentro da mesma tx.
DROP TRIGGER IF EXISTS trg_order_must_have_items ON public.order_items;
CREATE CONSTRAINT TRIGGER trg_order_must_have_items
    AFTER DELETE ON public.order_items
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.enforce_order_has_items();
