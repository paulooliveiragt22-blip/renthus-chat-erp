import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { normalizeFinanceOrigin } from "../../src/financeiro/domain/origin";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("F4 UI Financeiro", () => {
    it("shell + 6 tabs + período + opex", () => {
        const page = read("app/(admin)/financeiro/page.tsx");
        assert.match(page, /PlanFeatureGate/);
        assert.match(page, /useFinancePeriod/);
        assert.match(page, /DashboardTab/);
        assert.match(page, /ExtratoTab/);
        assert.match(page, /ReceberTab/);
        assert.match(page, /PagarTab/);
        assert.match(page, /CaixaTab/);
        assert.match(page, /DreTab/);
        for (const f of [
            "DashboardTab.tsx",
            "ExtratoTab.tsx",
            "ReceberTab.tsx",
            "PagarTab.tsx",
            "CaixaTab.tsx",
            "DreTab.tsx",
        ]) {
            assert.ok(existsSync(join(root, "app/(admin)/financeiro/components", f)), f);
        }
        assert.match(read("app/api/admin/financeiro/opex/route.ts"), /rpc_post_opex|postOpex/);
        assert.match(read("app/api/admin/financeiro/opex/route.ts"), /financeiro\.write/);
    });

    it("KPIs: resultado gerencial; CMV=0 avisado; sem lucro real", () => {
        const dash = read("app/(admin)/financeiro/components/DashboardTab.tsx");
        assert.match(dash, /Resultado gerencial/);
        assert.match(dash, /CMV do período está zerado|resultado gerencial/);
        assert.equal(/Lucro [Rr]eal/.test(dash), false);
        assert.match(read("app/(admin)/financeiro/components/DreTab.tsx"), /Resultado gerencial/);
    });

    it("A Pagar POST /opex; A Receber aging; Caixa esperado; extrato cursor", () => {
        assert.match(read("app/(admin)/financeiro/components/PagarTab.tsx"), /\/api\/admin\/financeiro\/opex/);
        assert.match(read("app/(admin)/financeiro/components/ReceberTab.tsx"), /aging/);
        assert.match(read("app/api/admin/financeiro/bills/route.ts"), /queryAging|v_aging_receivables/);
        assert.match(read("app/(admin)/financeiro/components/CaixaTab.tsx"), /expected_balance|Total esperado/);
        assert.match(read("app/api/admin/financeiro/extrato/route.ts"), /cursor/);
        assert.match(read("app/(admin)/financeiro/components/ExtratoTab.tsx"), /cursor/);
        assert.match(read("app/(admin)/financeiro/components/ExtratoTab.tsx"), /\/pedidos\?id=/);
    });

    it("ai_chat não mapeia para PDV", () => {
        assert.equal(normalizeFinanceOrigin("ai_chat"), "ai_chat");
        assert.equal(normalizeFinanceOrigin("ia"), "ai_chat");
        assert.notEqual(normalizeFinanceOrigin("ai_chat"), "pdv");
        const dash = read("app/(admin)/financeiro/components/DashboardTab.tsx");
        assert.match(dash, /ORIGIN_LABELS/);
        assert.match(dash, /FINANCE_ORIGINS/);
        assert.match(read("src/financeiro/application/queryDashboard.ts"), /normalizeFinanceOrigin/);
    });
});
