-- ═══════════════════════════════════════════════════════════════════════════════
-- SPRINT 1 — Financial Foundation
-- Cria: chart_of_accounts, cost_centers, cash_registers, cash_movements,
--        sales, sale_items, sale_payments, bills
-- Altera: orders (source, sale_id, confirmed_at)
-- Depreca: vendas_a_prazo (migra dados → bills), expenses (mantém por ora)
-- Regra de negócio: chatbot nunca aceita pagamento a prazo
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. CHART OF ACCOUNTS (plano de contas) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        REFERENCES companies(id) ON DELETE CASCADE,
    -- null = conta do sistema (global, compartilhada entre todas as empresas)
    parent_id   uuid        REFERENCES chart_of_accounts(id),
    code        text        NOT NULL,
    name        text        NOT NULL,
    type        text        NOT NULL CHECK (type IN ('revenue','expense','asset','liability')),
    is_system   boolean     NOT NULL DEFAULT false,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (company_id, code)
);

-- Seed: contas do sistema (company_id = null → disponível para todas as empresas)
INSERT INTO chart_of_accounts (id, company_id, code, name, type, is_system) VALUES
-- RECEITAS
('00000000-0001-0000-0000-000000000001', null, '1',     'Receitas',                         'revenue', true),
('00000000-0001-0000-0000-000000000002', null, '1.1',   'Vendas de Produtos',               'revenue', true),
('00000000-0001-0000-0000-000000000003', null, '1.1.1', 'Vendas Balcão / PDV',              'revenue', true),
('00000000-0001-0000-0000-000000000004', null, '1.1.2', 'Vendas Delivery WhatsApp',         'revenue', true),
('00000000-0001-0000-0000-000000000005', null, '1.1.3', 'Vendas UI / App',                  'revenue', true),
('00000000-0001-0000-0000-000000000006', null, '1.2',   'Taxa de Entrega',                  'revenue', true),
('00000000-0001-0000-0000-000000000007', null, '1.3',   'Outras Receitas',                  'revenue', true),
-- DESPESAS
('00000000-0001-0000-0000-000000000010', null, '2',     'Despesas',                         'expense', true),
('00000000-0001-0000-0000-000000000011', null, '2.1',   'Custo de Mercadoria (CMV)',         'expense', true),
('00000000-0001-0000-0000-000000000012', null, '2.1.1', 'Bebidas e Produtos',               'expense', true),
('00000000-0001-0000-0000-000000000013', null, '2.1.2', 'Acompanhamentos',                  'expense', true),
('00000000-0001-0000-0000-000000000014', null, '2.2',   'Despesas Operacionais',            'expense', true),
('00000000-0001-0000-0000-000000000015', null, '2.2.1', 'Aluguel',                          'expense', true),
('00000000-0001-0000-0000-000000000016', null, '2.2.2', 'Energia / Água',                   'expense', true),
('00000000-0001-0000-0000-000000000017', null, '2.2.3', 'Salários e Pró-labore',            'expense', true),
('00000000-0001-0000-0000-000000000018', null, '2.2.4', 'Combustível / Entregadores',       'expense', true),
('00000000-0001-0000-0000-000000000019', null, '2.2.5', 'Embalagens e Material',            'expense', true),
('00000000-0001-0000-0000-000000000020', null, '2.2.6', 'Marketing e Publicidade',          'expense', true),
('00000000-0001-0000-0000-000000000021', null, '2.2.7', 'Manutenção',                       'expense', true),
('00000000-0001-0000-0000-000000000022', null, '2.3',   'Despesas Administrativas',         'expense', true),
('00000000-0001-0000-0000-000000000023', null, '2.3.1', 'Contabilidade',                    'expense', true),
('00000000-0001-0000-0000-000000000024', null, '2.3.2', 'Sistema / Software',               'expense', true),
('00000000-0001-0000-0000-000000000025', null, '2.3.3', 'Tarifas Bancárias',                'expense', true),
('00000000-0001-0000-0000-000000000026', null, '2.4',   'Impostos e Taxas',                 'expense', true)
ON CONFLICT DO NOTHING;

-- parent_id backfill para hierarquia
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000001' WHERE code IN ('1.1','1.2','1.3') AND company_id IS NULL;
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000002' WHERE code IN ('1.1.1','1.1.2','1.1.3') AND company_id IS NULL;
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000010' WHERE code IN ('2.1','2.2','2.3','2.4') AND company_id IS NULL;
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000011' WHERE code IN ('2.1.1','2.1.2') AND company_id IS NULL;
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000014' WHERE code IN ('2.2.1','2.2.2','2.2.3','2.2.4','2.2.5','2.2.6','2.2.7') AND company_id IS NULL;
UPDATE chart_of_accounts SET parent_id = '00000000-0001-0000-0000-000000000022' WHERE code IN ('2.3.1','2.3.2','2.3.3') AND company_id IS NULL;

-- ─── 2. COST CENTERS (centros de custo) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS cost_centers (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    code        text,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. CASH REGISTERS (caixas PDV) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_registers (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    operator_id       uuid        REFERENCES company_users(id),
    opening_balance   numeric     NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    closing_balance   numeric     CHECK (closing_balance >= 0),
    expected_balance  numeric,    -- calculado pelo sistema no fechamento
    difference        numeric     GENERATED ALWAYS AS (
                          CASE WHEN closing_balance IS NOT NULL AND expected_balance IS NOT NULL
                               THEN closing_balance - expected_balance
                               ELSE NULL
                          END
                      ) STORED,
    status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    opened_at         timestamptz NOT NULL DEFAULT now(),
    closed_at         timestamptz,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- Só pode ter 1 caixa aberto por empresa ao mesmo tempo
    CONSTRAINT one_open_register_per_company
        EXCLUDE USING btree (company_id WITH =)
        WHERE (status = 'open')
);

-- ─── 4. CASH MOVEMENTS (sangria / suprimento) ────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_movements (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    cash_register_id  uuid        NOT NULL REFERENCES cash_registers(id),
    operator_id       uuid        REFERENCES company_users(id),
    type              text        NOT NULL CHECK (type IN ('sangria','suprimento')),
    amount            numeric     NOT NULL CHECK (amount > 0),
    reason            text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── 5. SALES (venda fechada — ato de fechar o caixa) ────────────────────────

CREATE TABLE IF NOT EXISTS sales (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id          uuid        REFERENCES orders(id),          -- null = venda direta PDV
    customer_id       uuid        REFERENCES customers(id),
    cash_register_id  uuid        REFERENCES cash_registers(id),
    cost_center_id    uuid        REFERENCES cost_centers(id),
    chart_account_id  uuid        REFERENCES chart_of_accounts(id)
                                  DEFAULT '00000000-0001-0000-0000-000000000002', -- 1.1 Vendas
    created_by        uuid        REFERENCES company_users(id),
    origin            text        NOT NULL DEFAULT 'pdv'
                                  CHECK (origin IN ('pdv','ui_order','chatbot')),
    subtotal          numeric     NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    delivery_fee      numeric     NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    discount          numeric     NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total             numeric     NOT NULL DEFAULT 0 CHECK (total >= 0),
    status            text        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','paid','partial','canceled')),
    notes             text,
    sold_at           timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── 6. SALE ITEMS (itens da venda com snapshot de custo) ────────────────────

CREATE TABLE IF NOT EXISTS sale_items (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sale_id               uuid        NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    produto_embalagem_id  uuid        REFERENCES produto_embalagens(id),
    product_name          text        NOT NULL DEFAULT '',
    qty                   numeric     NOT NULL CHECK (qty > 0),
    unit_price            numeric     NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    unit_cost             numeric     NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),  -- snapshot preco_custo
    discount              numeric     NOT NULL DEFAULT 0 CHECK (discount >= 0),
    line_total            numeric     NOT NULL DEFAULT 0, -- qty * unit_price - discount
    line_cost             numeric     NOT NULL DEFAULT 0, -- qty * unit_cost
    created_at            timestamptz NOT NULL DEFAULT now()
);

-- Trigger: calcula line_total e line_cost automaticamente
CREATE OR REPLACE FUNCTION fn_calc_sale_item_totals()
RETURNS TRIGGER AS $$
BEGIN
    NEW.line_total := (NEW.qty * NEW.unit_price) - COALESCE(NEW.discount, 0);
    NEW.line_cost  := NEW.qty * NEW.unit_cost;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_items_calc_totals
    BEFORE INSERT OR UPDATE ON sale_items
    FOR EACH ROW EXECUTE FUNCTION fn_calc_sale_item_totals();

-- Trigger: recalcula sales.subtotal/total quando sale_items mudam
CREATE OR REPLACE FUNCTION fn_recalc_sale_total()
RETURNS TRIGGER AS $$
DECLARE
    v_sale_id uuid;
BEGIN
    v_sale_id := COALESCE(NEW.sale_id, OLD.sale_id);
    UPDATE sales
    SET subtotal = (
            SELECT COALESCE(SUM(line_total), 0) FROM sale_items WHERE sale_id = v_sale_id
        ),
        total = (
            SELECT COALESCE(SUM(line_total), 0) FROM sale_items WHERE sale_id = v_sale_id
        ) + delivery_fee - discount
    WHERE id = v_sale_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_items_recalc_total
    AFTER INSERT OR UPDATE OR DELETE ON sale_items
    FOR EACH ROW EXECUTE FUNCTION fn_recalc_sale_total();

-- ─── 7. SALE PAYMENTS (como foi pago — 1 linha por forma/parcela) ────────────

CREATE TABLE IF NOT EXISTS sale_payments (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sale_id             uuid        NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    customer_id         uuid        REFERENCES customers(id),
    payment_method      text        NOT NULL CHECK (payment_method IN (
                            'cash','pix','debit_card','credit_card',
                            'credit_card_installment','boleto','promissoria','cheque'
                        )),
    amount              numeric     NOT NULL CHECK (amount > 0),
    -- Parcelamento (apenas para métodos a prazo)
    installment_total   int         NOT NULL DEFAULT 1 CHECK (installment_total >= 1),
    installment_number  int         NOT NULL DEFAULT 1 CHECK (installment_number >= 1),
    due_date            date,       -- vencimento desta parcela
    -- Controle de recebimento
    status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','received','overdue','canceled')),
    received_at         timestamptz,
    document_ref        text,       -- nº cheque, código boleto, etc.
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- Parcela não pode exceder total de parcelas
    CONSTRAINT installment_order CHECK (installment_number <= installment_total)
);

-- ─── REGRA DE NEGÓCIO: chatbot nunca aceita pagamento a prazo ────────────────

CREATE OR REPLACE FUNCTION fn_validate_chatbot_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_origin text;
BEGIN
    SELECT origin INTO v_origin FROM sales WHERE id = NEW.sale_id;

    IF v_origin = 'chatbot' AND NEW.payment_method IN (
        'credit_card_installment','boleto','promissoria','cheque'
    ) THEN
        RAISE EXCEPTION
            'Pedidos via chatbot/WhatsApp não aceitam pagamento a prazo. '
            'Método informado: %', NEW.payment_method
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_chatbot_payment
    BEFORE INSERT OR UPDATE ON sale_payments
    FOR EACH ROW EXECUTE FUNCTION fn_validate_chatbot_payment();

-- Trigger: à vista → status já nasce como 'received'
CREATE OR REPLACE FUNCTION fn_sale_payment_avista_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method IN ('cash','pix','debit_card','credit_card') THEN
        NEW.status      := 'received';
        NEW.received_at := now();
        -- À vista: vence hoje
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

CREATE TRIGGER trg_sale_payment_avista_status
    BEFORE INSERT ON sale_payments
    FOR EACH ROW EXECUTE FUNCTION fn_sale_payment_avista_status();

-- ─── 8. BILLS (contas a receber e a pagar) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type                text        NOT NULL CHECK (type IN ('receivable','payable')),
    -- Origem
    sale_payment_id     uuid        REFERENCES sale_payments(id),  -- receivable de venda
    -- Contraparte
    customer_id         uuid        REFERENCES customers(id),      -- receivable
    supplier_name       text,                                       -- payable (texto livre por ora)
    -- Plano de contas e centro de custo
    chart_account_id    uuid        REFERENCES chart_of_accounts(id),
    cost_center_id      uuid        REFERENCES cost_centers(id),
    -- Documento
    document_type       text        CHECK (document_type IN (
                            'boleto','cheque','promissoria',
                            'credit_card','nota_fiscal','manual'
                        )),
    document_ref        text,       -- nº cheque, código boleto, etc.
    -- Parcelamento
    installment_number  int         NOT NULL DEFAULT 1,
    installment_total   int         NOT NULL DEFAULT 1,
    -- Valores
    amount              numeric     NOT NULL CHECK (amount > 0),
    amount_paid         numeric     NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
    -- Datas e status
    due_date            date        NOT NULL,
    paid_at             timestamptz,
    status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','paid','partial','overdue','canceled')),
    -- Origem da operação (receivable de chatbot nunca deve existir com a prazo)
    origin              text        CHECK (origin IN ('pdv','ui_order','chatbot','manual')),
    description         text,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT installment_order CHECK (installment_number <= installment_total),
    CONSTRAINT amount_paid_not_exceed CHECK (amount_paid <= amount),
    -- Receivable de chatbot nunca pode ser a prazo (due_date > hoje significa a prazo)
    CONSTRAINT no_chatbot_receivable_prazo CHECK (
        NOT (origin = 'chatbot' AND type = 'receivable' AND due_date > CURRENT_DATE)
    )
);

-- Trigger: cria bill automaticamente quando sale_payment a prazo é inserido
CREATE OR REPLACE FUNCTION fn_create_bill_from_sale_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_origin      text;
    v_customer_id uuid;
    v_account_id  uuid;
BEGIN
    -- Apenas para pagamentos a prazo
    IF NEW.payment_method NOT IN ('credit_card_installment','boleto','promissoria','cheque') THEN
        RETURN NEW;
    END IF;

    SELECT origin, customer_id INTO v_origin, v_customer_id
    FROM sales WHERE id = NEW.sale_id;

    -- Resolve conta contábil pelo método de pagamento
    v_account_id := '00000000-0001-0000-0000-000000000002'; -- 1.1 Vendas (default)

    INSERT INTO bills (
        company_id, type, sale_payment_id, customer_id,
        chart_account_id, document_type, document_ref,
        installment_number, installment_total,
        amount, due_date, origin, description
    ) VALUES (
        NEW.company_id, 'receivable', NEW.id, COALESCE(NEW.customer_id, v_customer_id),
        v_account_id,
        CASE NEW.payment_method
            WHEN 'credit_card_installment' THEN 'credit_card'
            ELSE NEW.payment_method
        END,
        NEW.document_ref,
        NEW.installment_number, NEW.installment_total,
        NEW.amount, NEW.due_date, v_origin,
        'Parcela ' || NEW.installment_number || '/' || NEW.installment_total
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_bill_from_sale_payment
    AFTER INSERT ON sale_payments
    FOR EACH ROW EXECUTE FUNCTION fn_create_bill_from_sale_payment();

-- Trigger: quando bill é pago → atualiza amount_paid e status
CREATE OR REPLACE FUNCTION fn_bill_payment_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.amount_paid >= NEW.amount AND NEW.status NOT IN ('paid','canceled') THEN
        NEW.status  := 'paid';
        NEW.paid_at := COALESCE(NEW.paid_at, now());
    ELSIF NEW.amount_paid > 0 AND NEW.amount_paid < NEW.amount THEN
        NEW.status := 'partial';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bill_payment_status
    BEFORE UPDATE OF amount_paid ON bills
    FOR EACH ROW EXECUTE FUNCTION fn_bill_payment_status();

-- Trigger: quando bill receivable é pago → cria financial_entry (receita realizada)
CREATE OR REPLACE FUNCTION fn_bill_paid_to_financial_entry()
RETURNS TRIGGER AS $$
BEGIN
    -- Só dispara quando transiciona para 'paid'
    IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.type = 'receivable' THEN
        INSERT INTO financial_entries (
            company_id, type, amount, payment_method,
            description, occurred_at, origin, order_id
        )
        SELECT
            NEW.company_id,
            'income',
            NEW.amount,
            COALESCE(sp.payment_method, 'manual'),
            COALESCE(NEW.description, 'Recebimento de título'),
            now(),
            COALESCE(NEW.origin, 'manual'),
            s.order_id
        FROM bills b
        LEFT JOIN sale_payments sp ON sp.id = b.sale_payment_id
        LEFT JOIN sales          s  ON s.id  = sp.sale_id
        WHERE b.id = NEW.id
        LIMIT 1;
    END IF;

    -- Quando payable pago → cria financial_entry (despesa realizada)
    IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.type = 'payable' THEN
        INSERT INTO financial_entries (
            company_id, type, amount, payment_method,
            description, occurred_at, origin
        ) VALUES (
            NEW.company_id,
            'expense',
            NEW.amount,
            'manual',
            COALESCE(NEW.description, NEW.supplier_name, 'Pagamento de conta'),
            now(),
            'manual'
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bill_paid_to_financial_entry
    AFTER UPDATE OF status ON bills
    FOR EACH ROW EXECUTE FUNCTION fn_bill_paid_to_financial_entry();

-- Trigger: recalcula customers.saldo_devedor com base em bills (substitui fn_recalc_saldo_devedor)
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
        WHERE customer_id   = _customer_id
          AND type          = 'receivable'
          AND status        IN ('pending','partial','overdue')
    )
    WHERE id = _customer_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bills_recalc_saldo
    AFTER INSERT OR UPDATE OR DELETE ON bills
    FOR EACH ROW EXECUTE FUNCTION fn_recalc_saldo_devedor_from_bills();

-- ─── 9. ALTER TABLE orders ────────────────────────────────────────────────────
-- Adiciona rastreabilidade de origem e link com a venda gerada

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS sale_id      uuid REFERENCES sales(id),
    ADD COLUMN IF NOT EXISTS source       text NOT NULL DEFAULT 'chatbot'
                                          CHECK (source IN ('chatbot','ui','pdv_direct')),
    ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Backfill source a partir do channel existente
UPDATE orders
SET source = CASE
    WHEN channel = 'whatsapp' THEN 'chatbot'
    WHEN channel = 'pdv'      THEN 'pdv_direct'
    ELSE 'ui'
END
WHERE source = 'chatbot'; -- só atualiza os que ainda têm o default

-- ─── 10. MIGRAR vendas_a_prazo → bills ───────────────────────────────────────

INSERT INTO bills (
    company_id, type, customer_id,
    document_type, amount, amount_paid,
    due_date, paid_at, status, origin, description, notes, created_at
)
SELECT
    vp.company_id,
    'receivable',
    vp.customer_id,
    'manual',
    vp.valor,
    CASE WHEN vp.status = 'pago' THEN vp.valor ELSE 0 END,
    vp.data_vencimento::date,
    vp.pago_em,
    CASE vp.status
        WHEN 'pago'     THEN 'paid'
        WHEN 'atrasado' THEN 'overdue'
        ELSE 'pending'
    END,
    'manual',
    COALESCE(vp.notas, 'Migrado de vendas_a_prazo'),
    vp.notas,
    vp.created_at
FROM vendas_a_prazo vp
ON CONFLICT DO NOTHING;

-- ─── 11. ATUALIZAR financial_entries: adicionar sale_id e status ──────────────

ALTER TABLE financial_entries
    ADD COLUMN IF NOT EXISTS sale_id      uuid REFERENCES sales(id),
    ADD COLUMN IF NOT EXISTS due_date     date,
    ADD COLUMN IF NOT EXISTS received_at  timestamptz,
    ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'received'
                                          CHECK (status IN ('pending','received','overdue'));

-- Entradas existentes: todas já realizadas
UPDATE financial_entries SET status = 'received', received_at = occurred_at
WHERE status = 'received' AND received_at IS NULL;

-- ─── 12. DEPRECAR fn_create_financial_entry_on_finalize ──────────────────────
-- O lançamento financeiro agora passa pelo PDV (sales → sale_payments → bills/financial_entries)
-- Desabilitar o trigger antigo para evitar duplicatas quando o PDV fechar a venda
-- O trigger ainda funciona para pedidos finalizados SEM passar pelo PDV (legado)

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
                COALESCE(NEW.source, 'chatbot'),
                'received',
                now()
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 13. ÍNDICES ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sales_company        ON sales(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_order          ON sales(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer       ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_origin         ON sales(origin);
CREATE INDEX IF NOT EXISTS idx_sales_sold_at        ON sales(sold_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale      ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_company   ON sale_items(company_id);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale   ON sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_method ON sale_payments(payment_method);
CREATE INDEX IF NOT EXISTS idx_sale_payments_status ON sale_payments(status);
CREATE INDEX IF NOT EXISTS idx_sale_payments_due    ON sale_payments(due_date);

CREATE INDEX IF NOT EXISTS idx_bills_company        ON bills(company_id);
CREATE INDEX IF NOT EXISTS idx_bills_type           ON bills(type);
CREATE INDEX IF NOT EXISTS idx_bills_customer       ON bills(customer_id);
CREATE INDEX IF NOT EXISTS idx_bills_status         ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_due_date       ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_sale_payment   ON bills(sale_payment_id);

CREATE INDEX IF NOT EXISTS idx_cash_registers_co    ON cash_registers(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_registers_st    ON cash_registers(status);
CREATE INDEX IF NOT EXISTS idx_cash_movements_reg   ON cash_movements(cash_register_id);

CREATE INDEX IF NOT EXISTS idx_chart_accounts_co    ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_co      ON cost_centers(company_id);

CREATE INDEX IF NOT EXISTS idx_fin_entries_sale     ON financial_entries(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_sale          ON orders(sale_id) WHERE sale_id IS NOT NULL;

-- ─── 14. ROW LEVEL SECURITY ──────────────────────────────────────────────────

ALTER TABLE chart_of_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills               ENABLE ROW LEVEL SECURITY;

-- chart_of_accounts: empresa vê as próprias + as do sistema (company_id IS NULL)
CREATE POLICY coa_select ON chart_of_accounts FOR SELECT
    USING (company_id IS NULL OR company_id = current_company_id());
CREATE POLICY coa_insert ON chart_of_accounts FOR INSERT
    WITH CHECK (company_id = current_company_id());
CREATE POLICY coa_update ON chart_of_accounts FOR UPDATE
    USING (company_id = current_company_id() AND is_system = false);
CREATE POLICY coa_delete ON chart_of_accounts FOR DELETE
    USING (company_id = current_company_id() AND is_system = false);

-- Demais tabelas: isolamento completo por empresa
CREATE POLICY cost_centers_all   ON cost_centers   FOR ALL USING (company_id = current_company_id());
CREATE POLICY cash_registers_all ON cash_registers FOR ALL USING (company_id = current_company_id());
CREATE POLICY cash_movements_all ON cash_movements FOR ALL USING (company_id = current_company_id());
CREATE POLICY sales_all          ON sales          FOR ALL USING (company_id = current_company_id());
CREATE POLICY sale_items_all     ON sale_items     FOR ALL USING (company_id = current_company_id());
CREATE POLICY sale_payments_all  ON sale_payments  FOR ALL USING (company_id = current_company_id());
CREATE POLICY bills_all          ON bills          FOR ALL USING (company_id = current_company_id());

-- ─── 15. VIEWS AUXILIARES ────────────────────────────────────────────────────

-- View: aging de contas a receber por cliente
CREATE OR REPLACE VIEW v_aging_receivables AS
SELECT
    b.company_id,
    b.customer_id,
    c.name                                          AS customer_name,
    COUNT(*)                                        AS total_titles,
    SUM(b.amount - b.amount_paid)                  AS total_open,
    SUM(CASE WHEN b.due_date >= CURRENT_DATE                              THEN b.amount - b.amount_paid ELSE 0 END) AS current_amount,
    SUM(CASE WHEN b.due_date < CURRENT_DATE AND b.due_date >= CURRENT_DATE - 30  THEN b.amount - b.amount_paid ELSE 0 END) AS overdue_0_30,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 30  AND b.due_date >= CURRENT_DATE - 60  THEN b.amount - b.amount_paid ELSE 0 END) AS overdue_31_60,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 60  AND b.due_date >= CURRENT_DATE - 90  THEN b.amount - b.amount_paid ELSE 0 END) AS overdue_61_90,
    SUM(CASE WHEN b.due_date < CURRENT_DATE - 90  THEN b.amount - b.amount_paid ELSE 0 END) AS overdue_90plus
FROM bills b
JOIN customers c ON c.id = b.customer_id
WHERE b.type = 'receivable'
  AND b.status IN ('pending','partial','overdue')
GROUP BY b.company_id, b.customer_id, c.name;

-- View: DRE simplificado por período
CREATE OR REPLACE VIEW v_dre AS
SELECT
    s.company_id,
    date_trunc('month', s.sold_at)                  AS month,
    SUM(s.subtotal)                                 AS gross_revenue,
    SUM(s.delivery_fee)                             AS delivery_revenue,
    SUM(si_cost.total_cost)                         AS cogs,
    SUM(s.subtotal) + SUM(s.delivery_fee)
        - COALESCE(SUM(si_cost.total_cost), 0)      AS gross_profit,
    COUNT(DISTINCT s.id)                            AS total_sales,
    AVG(s.total)                                    AS avg_ticket
FROM sales s
LEFT JOIN LATERAL (
    SELECT SUM(line_cost) AS total_cost
    FROM sale_items si WHERE si.sale_id = s.id
) si_cost ON true
WHERE s.status != 'canceled'
GROUP BY s.company_id, date_trunc('month', s.sold_at);

-- View: fluxo de caixa projetado (próximos 30 dias)
CREATE OR REPLACE VIEW v_cash_flow_projected AS
SELECT
    company_id,
    due_date,
    type,
    SUM(amount - amount_paid) AS amount,
    COUNT(*)                  AS titles
FROM bills
WHERE status IN ('pending','partial','overdue')
  AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
GROUP BY company_id, due_date, type
ORDER BY due_date, type;

-- ─── FIM DA MIGRATION ────────────────────────────────────────────────────────
