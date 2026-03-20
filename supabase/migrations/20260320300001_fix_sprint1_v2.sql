-- ═══════════════════════════════════════════════════════════════════════════════
-- SPRINT 1 v2 — Corrige divergências entre migração Sprint1 e código UI
-- Problemas resolvidos:
--   1. sale_payments.payment_method: debit_card→debit, credit_card→card,
--      credit_card_installment→credit_installment
--   2. sales: adiciona seller_name
--   3. bills: status 'pending'→'open'; adiciona original_amount, saldo_devedor,
--      payment_method, sale_id, order_id
--   4. cash_registers: adiciona initial_amount, operator_name, closing_amount;
--      converte difference de GENERATED→coluna normal
--   5. cash_movements: adiciona operator_name, occurred_at
--   6. v_dre: recria com account_name, account_type, total, period_start, period_end
--   7. Todas as views/triggers que usavam status='pending' para bills → 'open'
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. sale_payments — corrige valores de payment_method ────────────────────

ALTER TABLE sale_payments DROP CONSTRAINT IF EXISTS sale_payments_payment_method_check;

-- Migra valores legados (caso a Sprint1 já tenha sido aplicada com dados)
UPDATE sale_payments SET payment_method = 'debit'              WHERE payment_method = 'debit_card';
UPDATE sale_payments SET payment_method = 'card'               WHERE payment_method = 'credit_card';
UPDATE sale_payments SET payment_method = 'credit_installment' WHERE payment_method = 'credit_card_installment';

ALTER TABLE sale_payments
    ADD CONSTRAINT sale_payments_payment_method_check
    CHECK (payment_method IN (
        'cash','pix','debit','card',
        'credit_installment','boleto','promissoria','cheque'
    ));

-- Atualiza fn_validate_chatbot_payment para novos nomes
CREATE OR REPLACE FUNCTION fn_validate_chatbot_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_origin text;
BEGIN
    SELECT origin INTO v_origin FROM sales WHERE id = NEW.sale_id;

    IF v_origin = 'chatbot' AND NEW.payment_method IN (
        'credit_installment','boleto','promissoria','cheque'
    ) THEN
        RAISE EXCEPTION
            'Pedidos via chatbot/WhatsApp não aceitam pagamento a prazo. '
            'Método informado: %', NEW.payment_method
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atualiza fn_sale_payment_avista_status para novos nomes
CREATE OR REPLACE FUNCTION fn_sale_payment_avista_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method IN ('cash','pix','debit','card') THEN
        NEW.status      := 'received';
        NEW.received_at := now();
        IF NEW.due_date IS NULL THEN
            NEW.due_date := CURRENT_DATE;
        END IF;
    ELSE
        -- A prazo: due_date obrigatório
        IF NEW.due_date IS NULL THEN
            RAISE EXCEPTION
                'Pagamento a prazo requer data de vencimento (due_date)'
                USING ERRCODE = 'not_null_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 2. sales — adiciona seller_name ─────────────────────────────────────────

ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_name text;

-- ─── 3. bills — status 'open' + colunas faltantes ────────────────────────────

-- 3a. Troca status 'pending' → 'open'
ALTER TABLE bills DROP CONSTRAINT IF EXISTS bills_status_check;
UPDATE bills SET status = 'open' WHERE status = 'pending';
ALTER TABLE bills
    ADD CONSTRAINT bills_status_check
    CHECK (status IN ('open','paid','partial','overdue','canceled'));
ALTER TABLE bills ALTER COLUMN status SET DEFAULT 'open';

-- 3b. Colunas faltantes na tabela bills
ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS original_amount numeric     NOT NULL DEFAULT 0 CHECK (original_amount >= 0),
    ADD COLUMN IF NOT EXISTS saldo_devedor   numeric     NOT NULL DEFAULT 0 CHECK (saldo_devedor   >= 0),
    ADD COLUMN IF NOT EXISTS payment_method  text,
    ADD COLUMN IF NOT EXISTS sale_id         uuid        REFERENCES sales(id),
    ADD COLUMN IF NOT EXISTS order_id        uuid        REFERENCES orders(id);

-- 3c. Backfill para linhas já existentes
UPDATE bills
SET original_amount = amount,
    saldo_devedor   = GREATEST(amount - amount_paid, 0)
WHERE original_amount = 0;

-- 3d. Trigger de manutenção do saldo_devedor em INSERT
CREATE OR REPLACE FUNCTION fn_bills_set_original_and_saldo()
RETURNS TRIGGER AS $$
BEGIN
    -- original_amount = amount quando não informado explicitamente
    IF NEW.original_amount = 0 OR NEW.original_amount IS NULL THEN
        NEW.original_amount := NEW.amount;
    END IF;
    -- saldo_devedor calculado
    NEW.saldo_devedor := GREATEST(NEW.original_amount - COALESCE(NEW.amount_paid, 0), 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bills_set_original_and_saldo ON bills;
CREATE TRIGGER trg_bills_set_original_and_saldo
    BEFORE INSERT ON bills
    FOR EACH ROW EXECUTE FUNCTION fn_bills_set_original_and_saldo();

-- 3e. Atualiza saldo_devedor em UPDATE de amount_paid
CREATE OR REPLACE FUNCTION fn_bill_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.amount_paid >= NEW.amount AND NEW.status NOT IN ('paid','canceled') THEN
        NEW.status    := 'paid';
        NEW.paid_at   := COALESCE(NEW.paid_at, now());
    ELSIF NEW.amount_paid > 0 AND NEW.amount_paid < NEW.amount THEN
        NEW.status := 'partial';
    END IF;
    -- Mantém saldo_devedor sincronizado
    NEW.saldo_devedor := GREATEST(NEW.original_amount - NEW.amount_paid, 0);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recria o trigger para disparar em qualquer UPDATE (não só amount_paid)
DROP TRIGGER IF EXISTS trg_bill_payment_status ON bills;
CREATE TRIGGER trg_bill_payment_status
    BEFORE UPDATE ON bills
    FOR EACH ROW EXECUTE FUNCTION fn_bill_payment_status();

-- 3f. Atualiza fn_create_bill_from_sale_payment para incluir novas colunas
CREATE OR REPLACE FUNCTION fn_create_bill_from_sale_payment()
RETURNS TRIGGER AS $$
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
        NEW.amount, NEW.amount, NEW.amount,   -- original_amount = saldo_devedor = amount
        NEW.due_date, v_origin,
        'Parcela ' || NEW.installment_number || '/' || NEW.installment_total,
        NEW.payment_method
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3g. Atualiza fn_recalc_saldo_devedor_from_bills: usa 'open' em vez de 'pending'
CREATE OR REPLACE FUNCTION fn_recalc_saldo_devedor_from_bills()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ─── 4. cash_registers — colunas UI + diferença gravável ─────────────────────

-- 4a. Adiciona colunas esperadas pelo UI
ALTER TABLE cash_registers
    ADD COLUMN IF NOT EXISTS initial_amount  numeric NOT NULL DEFAULT 0 CHECK (initial_amount  >= 0),
    ADD COLUMN IF NOT EXISTS operator_name   text,
    ADD COLUMN IF NOT EXISTS closing_amount  numeric CHECK (closing_amount >= 0);

-- 4b. Backfill a partir das colunas originais (se Sprint1 foi aplicada)
UPDATE cash_registers
SET initial_amount = COALESCE(opening_balance, 0)
WHERE initial_amount = 0 AND opening_balance IS NOT NULL AND opening_balance > 0;

UPDATE cash_registers
SET closing_amount = closing_balance
WHERE closing_amount IS NULL AND closing_balance IS NOT NULL;

-- 4c. Converte difference de GENERATED ALWAYS → coluna normal
--     (GENERATED ALWAYS não pode ser escrita diretamente pelo PDV)
ALTER TABLE cash_registers DROP COLUMN IF EXISTS difference;
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS difference numeric;

-- Backfill difference para registros fechados já existentes
UPDATE cash_registers
SET difference = closing_amount - (
    SELECT COALESCE(SUM(CASE WHEN cm.type = 'sangria'    THEN -cm.amount
                             WHEN cm.type = 'suprimento' THEN  cm.amount
                             ELSE 0 END), 0)
         + cash_registers.initial_amount
         + COALESCE((
             SELECT SUM(sp.amount)
             FROM sale_payments sp
             JOIN sales s ON s.id = sp.sale_id
             WHERE s.cash_register_id = cash_registers.id
               AND sp.payment_method IN ('cash','pix','debit','card')
           ), 0)
    FROM cash_movements cm
    WHERE cm.cash_register_id = cash_registers.id
)
WHERE status = 'closed' AND closing_amount IS NOT NULL;

-- ─── 5. cash_movements — operator_name + occurred_at ─────────────────────────

ALTER TABLE cash_movements
    ADD COLUMN IF NOT EXISTS operator_name text,
    ADD COLUMN IF NOT EXISTS occurred_at   timestamptz NOT NULL DEFAULT now();

-- Backfill: occurred_at = created_at para movimentos existentes
UPDATE cash_movements
SET occurred_at = created_at
WHERE occurred_at IS DISTINCT FROM created_at;

-- ─── 6. v_dre — recria com estrutura esperada pelo UI ────────────────────────
-- UI: .select("account_name, account_type, total")
--     .gte("period_start", from).lte("period_end", to)

DROP VIEW IF EXISTS v_dre CASCADE;

CREATE OR REPLACE VIEW v_dre AS
WITH monthly AS (
    SELECT
        s.company_id,
        date_trunc('month', s.sold_at)::date                                        AS period_start,
        (date_trunc('month', s.sold_at) + interval '1 month' - interval '1 day')::date
                                                                                    AS period_end,
        SUM(s.subtotal)                                                             AS gross_revenue,
        SUM(s.delivery_fee)                                                         AS delivery_revenue,
        COALESCE(SUM(si_cost.total_cost), 0)                                        AS cogs,
        COALESCE(SUM(CASE WHEN sp.payment_method IN ('cash','pix','debit','card')
                          THEN sp.amount ELSE 0 END), 0)                            AS avista_revenue,
        COALESCE(SUM(CASE WHEN sp.payment_method
                          IN ('credit_installment','boleto','promissoria','cheque')
                          THEN sp.amount ELSE 0 END), 0)                            AS prazo_revenue
    FROM sales s
    LEFT JOIN LATERAL (
        SELECT SUM(line_cost) AS total_cost
        FROM sale_items si WHERE si.sale_id = s.id
    ) si_cost ON true
    LEFT JOIN sale_payments sp ON sp.sale_id = s.id AND sp.company_id = s.company_id
    WHERE s.status != 'canceled'
    GROUP BY s.company_id, date_trunc('month', s.sold_at)
)
SELECT company_id, period_start, period_end,
       'Vendas à Vista'       AS account_name,
       'revenue'              AS account_type,
       avista_revenue         AS total
FROM monthly

UNION ALL

SELECT company_id, period_start, period_end,
       'Vendas a Prazo'       AS account_name,
       'revenue'              AS account_type,
       prazo_revenue          AS total
FROM monthly

UNION ALL

SELECT company_id, period_start, period_end,
       'Taxa de Entrega'      AS account_name,
       'revenue'              AS account_type,
       delivery_revenue       AS total
FROM monthly

UNION ALL

SELECT company_id, period_start, period_end,
       'Custo de Mercadorias' AS account_name,
       'cost'                 AS account_type,
       cogs                   AS total
FROM monthly;

-- ─── 7. v_aging_receivables — usa 'open' em vez de 'pending' ─────────────────

DROP VIEW IF EXISTS v_aging_receivables;
CREATE OR REPLACE VIEW v_aging_receivables AS
SELECT
    b.company_id,
    b.customer_id,
    c.name                                                                      AS customer_name,
    COUNT(*)                                                                    AS total_titles,
    SUM(b.amount - b.amount_paid)                                               AS total_open,
    SUM(CASE WHEN b.due_date >= CURRENT_DATE
             THEN b.amount - b.amount_paid ELSE 0 END)                          AS current_amount,
    SUM(CASE WHEN b.due_date < CURRENT_DATE
              AND b.due_date >= CURRENT_DATE - 30
             THEN b.amount - b.amount_paid ELSE 0 END)                          AS overdue_0_30,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 30
              AND b.due_date >= CURRENT_DATE - 60
             THEN b.amount - b.amount_paid ELSE 0 END)                          AS overdue_31_60,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 60
              AND b.due_date >= CURRENT_DATE - 90
             THEN b.amount - b.amount_paid ELSE 0 END)                          AS overdue_61_90,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 90
             THEN b.amount - b.amount_paid ELSE 0 END)                          AS overdue_90plus
FROM bills b
JOIN customers c ON c.id = b.customer_id
WHERE b.type   = 'receivable'
  AND b.status IN ('open','partial','overdue')
GROUP BY b.company_id, b.customer_id, c.name;

-- ─── 8. v_cash_flow_projected — usa 'open' em vez de 'pending' ───────────────

DROP VIEW IF EXISTS v_cash_flow_projected;
CREATE OR REPLACE VIEW v_cash_flow_projected AS
SELECT
    company_id,
    due_date,
    type,
    SUM(amount - amount_paid) AS amount,
    COUNT(*)                  AS titles
FROM bills
WHERE status   IN ('open','partial','overdue')
  AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
GROUP BY company_id, due_date, type
ORDER BY due_date, type;

-- ─── 9. Índices para novas colunas ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bills_sale_id  ON bills(sale_id)  WHERE sale_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_order_id ON bills(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_reg_opened ON cash_registers(opened_at DESC);

-- ─── FIM DA MIGRATION ────────────────────────────────────────────────────────
