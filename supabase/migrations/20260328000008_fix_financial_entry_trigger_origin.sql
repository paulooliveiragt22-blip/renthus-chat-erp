-- Fix fn_create_financial_entry_on_finalize: map orders.source → correct origin
-- instead of defaulting everything to 'chatbot'

CREATE OR REPLACE FUNCTION fn_create_financial_entry_on_finalize()
RETURNS TRIGGER AS $$
BEGIN
    -- Só cria financial_entry se o pedido NÃO foi fechado via PDV (sem sale_id)
    IF (TG_OP = 'UPDATE')
       AND (NEW.status = 'finalized')
       AND (OLD.status IS DISTINCT FROM 'finalized')
       AND (NEW.sale_id IS NULL) -- evita duplicata quando PDV já criou a entrada
    THEN
        IF NOT EXISTS (
            SELECT 1 FROM financial_entries WHERE order_id = NEW.id
        ) THEN
            INSERT INTO financial_entries (
                company_id, order_id, type, amount, delivery_fee,
                payment_method, description, occurred_at, origin, status, received_at
            ) VALUES (
                NEW.company_id,
                NEW.id,
                'income',
                COALESCE(NEW.total_amount, 0),
                COALESCE(NEW.delivery_fee, 0),
                NEW.payment_method,
                'Pedido finalizado (legado)',
                now(),
                CASE
                    WHEN NEW.source IN ('chatbot') OR NEW.source LIKE 'flow_%' THEN 'chatbot'
                    WHEN NEW.source = 'ui' THEN 'ui_order'
                    ELSE 'balcao'
                END,
                'received',
                now()
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
