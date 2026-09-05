import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

describe("billing UI contract — seleção ≠ fatura", () => {
    it("change-plan upgrade usa prepare (quote/intent), não ensurePlanUpgradeCheckout", () => {
        const src = read("app/api/billing/change-plan/route.ts");
        assert.match(src, /preparePlanUpgradeSelection/);
        assert.doesNotMatch(src, /ensurePlanUpgradeCheckout/);
        assert.doesNotMatch(src, /createPixInvoiceOrder/);
        assert.doesNotMatch(src, /from\("invoices"\)\s*\n\s*\.insert/);
    });

    it("switch-period usa prepare (quote/intent), não cria invoice no clique", () => {
        const src = read("app/api/billing/switch-period/route.ts");
        assert.match(src, /preparePeriodSwitchSelection/);
        assert.doesNotMatch(src, /ensurePeriodSwitchCheckout/);
        assert.doesNotMatch(src, /createPixInvoiceOrder/);
    });

    it("rebillPendingObligation não cria invoice se não existir pending subscription/year", () => {
        const src = read("lib/billing/rebillPendingObligation.ts");
        assert.match(src, /if \(!inv\) return \{ ok: true, action: "noop" \}/);
        assert.doesNotMatch(src, /needsObligation/);
    });

    it("create-invoice-checkout materializa intent antes do PSP", () => {
        const src = read("app/api/billing/create-invoice-checkout/route.ts");
        assert.match(src, /materializeCheckoutIntent/);
        const postBody = src.slice(src.indexOf("export async function POST"));
        const matIdx = postBody.indexOf("materializeCheckoutIntent");
        const loadIdx = postBody.indexOf("loadCheckoutContext");
        assert.ok(matIdx >= 0 && loadIdx > matIdx, "materialize antes de loadCheckoutContext");
    });

    it("materializeCheckoutIntent trata upgrade_to_annual via period_switch+target", () => {
        const src = read("lib/billing/materializeCheckoutIntent.ts");
        assert.match(src, /upgrade_to_annual/);
        assert.match(src, /targetPlan:\s*upgradeTarget/);
    });

    it("change-plan aceita to_annual no upgrade ativo", () => {
        const src = read("app/api/billing/change-plan/route.ts");
        assert.match(src, /prepareUpgradeToAnnualSelection/);
        assert.match(src, /to_annual/);
    });

    it("PlanChangeCatalog envia to_annual no view anual", () => {
        const src = read("components/billing/PlanChangeCatalog.tsx");
        assert.match(src, /to_annual:\s*toAnnual/);
        assert.match(src, /Upgrade para anual/);
        assert.match(src, /to_annual:\s*toAnnualImmediate/);
        assert.match(src, /Migrar para anual/);
    });

    it("prepareUpgradeToAnnualSelection aceita plano inferior (keep)", () => {
        const src = read("lib/billing/prepareUpgradeToAnnualSelection.ts");
        assert.match(src, /rpc_resolve_keep_user_ids/);
        assert.doesNotMatch(src, /planRank\(toPlan\) <= planRank\(fromPlan\)/);
    });

    it("preparePlanUpgradeSelection não insere invoice", () => {
        const src = read("lib/billing/preparePlanUpgradeSelection.ts");
        assert.doesNotMatch(src, /\.insert\(\{/);
        assert.match(src, /pending_upgrade_plan_key/);
    });

    it("preparePeriodSwitchSelection não insere invoice", () => {
        const src = read("lib/billing/preparePeriodSwitchSelection.ts");
        assert.doesNotMatch(src, /\.insert\(\{/);
        assert.match(src, /pending_checkout_intent/);
    });
});

describe("billing gate matrix (P0.9) — import smoke", () => {
    it("suite billingGateMatrix existe e cobre change-plan overdue", async () => {
        await import("./billingGateMatrix.test.js");
        assert.ok(true);
    });
});
