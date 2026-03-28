-- ============================================================
-- Fix: fn_create_bill_from_sale_payment e fn_recalc_saldo_devedor_from_bills
--
-- Problema: as duas funções de trigger NÃO eram SECURITY DEFINER.
-- Quando o trigger dispara a partir de um INSERT em sale_payments feito
-- pelo cliente browser (anon key + JWT do usuário), o INSERT interno em
-- bills precisa passar pelo RLS (bills_all: company_id = current_company_id()).
-- Em contextos de trigger, auth.uid() pode retornar NULL, fazendo
-- current_company_id() retornar NULL → RLS bloqueia o INSERT → trigger
-- levanta exceção → toda a instrução INSERT em sale_payments é revertida.
--
-- Correção: marcar ambas as funções como SECURITY DEFINER com
-- SET search_path = public para bypassar RLS de forma segura.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_create_bill_from_sale_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_origin      text;
    v_customer_id uuid;
    v_order_id    uuid;
    v_account_id  uuid;
BEGIN
    -- Apenas para pagamentos a prazo
    IF NEW.payment_method NOT IN ('credit_installment','boleto','promissoria','cheque') THEN
        RETURN NEW;
    END IF;

    SELECT origin, customer_id, order_id
    INTO v_origin, v_customer_id, v_order_id
    FROM sales WHERE id = NEW.sale_id;

    v_account_id := '00000000-0001-0000-0000-000000000002'; -- 1.1 Vendas

    INSERT INTO bills (
        company_id, type, sale_payment_id, sale_id, order_id,
        customer_id, chart_account_id, document_type, document_ref,
        installment_number, installment_total,
        amount, original_amount, saldo_devedor,
        due_date, origin, description,
        payment_method
    ) VALUES (
        NEW.company_id, 'receivable', NEW.id, NEW.sale_id, v_order_id,
        COALESCE(NEW.customer_id, v_customer_id),
        v_account_id,
        CASE NEW.payment_method
            WHEN 'credit_installment' THEN 'credit_card'
            ELSE NEW.payment_method
        END,
        NEW.document_ref,
        NEW.installment_number, NEW.installment_total,
        NEW.amount, NEW.amount, NEW.amount,
        NEW.due_date, v_origin,
        'Parcela ' || NEW.installment_number || '/' || NEW.installment_total,
        NEW.payment_method
    );

    RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_recalc_saldo_devedor_from_bills()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _customer_id uuid;
BEGIN
    _customer_id := COALESCE(NEW.customer_id, OLD.customer_id);
    IF _customer_id IS NULL THEN RETURN NEW; END IF;

    UPDATE customers
    SET saldo_devedor = (
        SELECT COALESCE(SUM(amount - amount_paid), 0)
        FROM bills
        WHERE customer_id = _customer_id
          AND type        = 'receivable'
          AND status      IN ('open','partial','overdue')
    )
    WHERE id = _customer_id;

    RETURN NEW;
END;
$$;
