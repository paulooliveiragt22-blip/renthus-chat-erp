import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("F3 dashboard M7 — fontes alinhadas", () => {
    it("home stats usa rpc_fin_dashboard + v_fin_extrato; não soma orders.total_amount", () => {
        assert.ok(existsSync(join(root, "src/financeiro/application/queryHomeStats.ts")));
        const home = read("src/financeiro/application/queryHomeStats.ts");
        assert.match(home, /financeQuerySupabase\.dashboard|rpc_fin_dashboard/);
        assert.match(home, /v_fin_extrato/);
        assert.match(home, /sale_items/);
        assert.equal(/orders\.total_amount|sum\(orders/.test(home), false);

        const stats = read("app/api/dashboard/stats/route.ts");
        assert.match(stats, /queryHomeStats/);
        assert.match(stats, /arOpen|settledSalesToday|revenueSource/);
        assert.match(stats, /finance_journals_1_1/);
    });

    it("DashboardClient: Recebido / A receber / ticket liquidadas / fuso / drill Pro", () => {
        const ui = read("components/DashboardClient.tsx");
        assert.match(ui, /Recebido hoje/);
        assert.match(ui, /A receber/);
        assert.match(ui, /settledSalesToday/);
        assert.match(ui, /timeZone/);
        assert.match(ui, /financeiro_full/);
        assert.match(ui, /\/financeiro\?from=/);
        assert.match(ui, /Caixa recebido/);
        assert.match(ui, /não é faturamento/);
    });

    it("Financeiro respeita ?from&to da home; reports usam caixa RPC", () => {
        const fin = read("app/(admin)/financeiro/page.tsx");
        assert.match(fin, /useSearchParams/);
        assert.match(fin, /searchParams\.get\("from"\)/);

        assert.match(read("app/api/reports/summary/route.ts"), /fetchReceivedIncome|rpc_fin_cash_revenue|rpcCashRevenue/);
        assert.match(read("app/api/reports/daily/route.ts"), /fetchReceivedIncome|rpc_fin_cash_revenue|rpcCashRevenue/);
        assert.match(
            read("lib/server/financeiro/dashboardPayload.ts"),
            /rpc_fin_dashboard|financeQuerySupabase/
        );
    });
});
