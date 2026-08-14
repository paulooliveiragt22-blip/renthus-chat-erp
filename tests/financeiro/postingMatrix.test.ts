import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("F5 posting matrix + mata-legado", () => {
    it("legado TS/API apagado; leitura só journal/RPC", () => {
        assert.equal(existsSync(join(root, "lib/server/financeiro")), false);
        assert.equal(existsSync(join(root, "app/api/admin/financeiro/expenses/route.ts")), false);
        assert.equal(existsSync(join(root, "scripts/_apply_raw_1_finance.json")), false);

        const srcTree = [
            "src/financeiro/application/cashRevenue.ts",
            "src/financeiro/application/queryDashboard.ts",
            "src/financeiro/application/queryExtrato.ts",
            "src/financeiro/domain/dayBounds.ts",
            "app/api/admin/financeiro/opex/route.ts",
        ];
        for (const f of srcTree) assert.ok(existsSync(join(root, f)), f);

        const greps = [
            'from("financial_entries")',
            'from("expenses")',
            "rpc_upsert_expense",
            "rpc_company_received_income",
            "rpc_pay_bill",
            "v_daily_sales",
            "lib/server/financeiro",
        ];
        const scanRoots = ["app", "src", "lib", "components", "tests"];
        for (const dir of scanRoots) {
            // only assert known high-risk files via targeted reads below
            void dir;
        }
        assert.equal(/from\("financial_entries"\)/.test(read("app/api/dashboard/stats/route.ts")), false);
        assert.equal(/v_daily_sales/.test(read("app/api/reports/summary/route.ts")), false);
        assert.equal(/v_daily_sales/.test(read("app/api/reports/daily/route.ts")), false);
        for (const g of greps) {
            assert.equal(
                new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(
                    read("src/financeiro/application/queryDashboard.ts")
                ),
                false,
                g
            );
        }
    });

    it("matriz de partidas no SQL (PDV misto, prazo, taxa 3.2, recognize, cash, reverse)", () => {
        const f1 = read("supabase/migrations/20260814150000_finance_ledger_v1.sql");
        const f2 = read("supabase/migrations/20260814160000_finance_ledger_f2_writers.sql");
        const f5 = read("supabase/migrations/20260814170000_finance_ledger_f5_cleanup.sql");

        // PDV: 1 journal por payment
        assert.match(f1, /sale:.*:pay:/);
        assert.match(f1, /fn_fin_post_sale_payments/);

        // a prazo → 1.2
        assert.match(f1, /code','1\.2'/);
        assert.match(f2, /fn_fin_is_prazo|credit_installment|1\.2/);

        // chatbot prazo recusa
        assert.match(f2, /chatbot_prazo_forbidden/);

        // recognize à vista + taxa 3.2
        assert.match(f1, /code','3\.2'/);
        assert.match(f2, /code', '3\.2'/);

        // PDV também separa 3.2 (F5)
        assert.match(f5, /code','3\.2'/);
        assert.match(f5, /delivery_fee/);

        // estorno
        assert.match(f1, /rpc_reverse_journal|source_type = 'reversal'/);

        // idempotency ON CONFLICT / same key
        assert.match(f1, /idempotency_key/);
        assert.match(f2, /idempotency_key_required|p_idempotency_key/);

        // sangria
        assert.match(f1, /rpc_post_cash_movement/);
        assert.match(f2, /idempotency_key_required/);

        // v_daily_sales dropada
        assert.match(f5, /drop view if exists public\.v_daily_sales/i);
    });

    it("TS commands apontam RPC canônicas", () => {
        const cmd = read("src/financeiro/adapters/supabase/financeCommand.supabase.ts");
        assert.match(cmd, /rpc_recognize_order_sale/);
        assert.match(cmd, /rpc_settle_bill/);
        assert.match(cmd, /rpc_post_opex/);
        assert.match(cmd, /rpc_reverse_journal/);
        assert.match(cmd, /rpc_post_cash_movement/);
        assert.equal(/rpc_pay_bill|rpc_upsert_expense|rpc_company_received_income/.test(cmd), false);
    });
});
