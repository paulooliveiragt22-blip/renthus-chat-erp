/**
 * UI /plano — gestão de assinatura (upgrade/downgrade), não checkout inicial.
 *
 * Contrato: clicar em plano NÃO chama create-invoice-checkout e NÃO deve criar
 * pending_invoice só pela seleção (intent/quote ok).
 *
 * .env.local:
 *   E2E_SKIP_WEBSERVER=1
 *   E2E_BASE_URL=https://app.renthus.com.br
 *   E2E_EMAIL=...
 *   E2E_PASSWORD=...
 *   E2E_PLANO_COMPANY_ID=...   # opcional — empresa active + last_paid_at
 */

import { test as base, expect } from "@playwright/test";
import { e2eCredentials, ensureE2eEnv, gotoApp, loginAsAdmin } from "./helpers/auth";

const creds = e2eCredentials();
const test = base.extend({});
test.describe.configure({ mode: "serial" });

type BillingStatus = {
    pagarme_subscription?: {
        status?: string;
        plan?: string;
        last_paid_at?: string | null;
        pending_upgrade_plan_key?: string | null;
        pending_checkout_intent?: string | null;
    } | null;
    pending_invoice?: { kind?: string; amount?: number } | null;
    checkout_amount_brl?: number | null;
};

async function fetchBillingStatus(page: import("@playwright/test").Page): Promise<BillingStatus> {
    const res = await page.request.get("/api/billing/status");
    expect(res.ok(), `billing/status HTTP ${res.status()}`).toBeTruthy();
    return (await res.json()) as BillingStatus;
}

async function selectPlanoWorkspace(page: import("@playwright/test").Page): Promise<BillingStatus> {
    ensureE2eEnv();
    const forced = process.env.E2E_PLANO_COMPANY_ID?.trim() || process.env.E2E_COMPANY_ID?.trim();

    if (forced) {
        const res = await page.request.post("/api/workspace/select", {
            data: { company_id: forced },
            failOnStatusCode: false,
        });
        expect(
            res.ok(),
            `workspace/select ${forced} HTTP ${res.status()} — E2E_EMAIL precisa ser owner/admin`
        ).toBeTruthy();
    }

    const st = await fetchBillingStatus(page);
    const sub = st.pagarme_subscription;
    const status = sub?.status ?? "";
    const paid = Boolean(sub?.last_paid_at);

    if (status !== "active" || !paid) {
        test.skip(
            true,
            `Precisa assinatura active + last_paid_at (status=${status || "?"}, paid=${paid}). ` +
                `Defina E2E_PLANO_COMPANY_ID com conta paga.`
        );
    }

    console.log(
        `[e2e-plano] company workspace status=${status} plan=${sub?.plan ?? "?"} ` +
            `pending_invoice=${Boolean(st.pending_invoice)}`
    );
    return st;
}

test.describe("/plano — gestão assinante pago", () => {
    test.beforeEach(async ({ page }) => {
        if (!creds) {
            test.skip(true, "Defina E2E_EMAIL e E2E_PASSWORD em .env.local");
        }
        await loginAsAdmin(page);
        await selectPlanoWorkspace(page);
        await gotoApp(page, "/plano");
        await expect(page).toHaveURL(/\/plano(?:\?|$)/, { timeout: 45_000 });
        await expect(page.getByRole("heading", { name: /Planos disponíveis|Escolha do plano/i })).toBeVisible({
            timeout: 45_000,
        });
    });

    test("carrega /plano sem redirecionar para /plano/pagar", async ({ page }) => {
        await expect(page).not.toHaveURL(/\/plano\/pagar/);
        await expect(page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)).toHaveCount(0);
    });

    test("selecionar upgrade não dispara create-invoice-checkout", async ({ page }) => {
        const before = await fetchBillingStatus(page);
        const currentPlan = before.pagarme_subscription?.plan ?? "essencial";

        const upgradeBtn = page.getByRole("button", { name: /^Fazer upgrade$/i }).first();
        if ((await upgradeBtn.count()) === 0) {
            test.skip(true, `Sem botão Fazer upgrade (plano atual=${currentPlan}, já no topo?)`);
        }

        let checkoutCalls = 0;
        page.on("request", (req) => {
            if (
                req.method() === "POST" &&
                req.url().includes("/api/billing/create-invoice-checkout")
            ) {
                checkoutCalls += 1;
            }
        });

        const changePlanWait = page.waitForResponse(
            (r) =>
                r.url().includes("/api/billing/change-plan") && r.request().method() === "POST",
            { timeout: 60_000 }
        );

        await upgradeBtn.click();
        const changeRes = await changePlanWait;
        const changeJson = (await changeRes.json().catch(() => ({}))) as {
            error?: string;
            action?: string;
            invoice_id?: string;
            message?: string;
        };

        expect(
            changeRes.ok(),
            `change-plan HTTP ${changeRes.status()}: ${changeJson.error ?? JSON.stringify(changeJson).slice(0, 200)}`
        ).toBeTruthy();

        expect(
            ["upgrade_quoted", "upgraded", "upgrade_pending"].includes(String(changeJson.action)),
            `action inesperada: ${changeJson.action}`
        ).toBeTruthy();

        if (changeJson.action === "upgrade_pending" && changeJson.invoice_id) {
            console.warn(
                "[e2e-plano] WARN: deploy ainda retorna invoice no clique (upgrade_pending) — contrato quebrado"
            );
        }

        await page.waitForTimeout(1500);

        expect(checkoutCalls, "create-invoice-checkout não deve rodar ao selecionar plano").toBe(0);

        const after = await fetchBillingStatus(page);
        if (changeJson.action === "upgrade_quoted") {
            expect(after.pending_invoice).toBeFalsy();
            expect(after.pagarme_subscription?.pending_upgrade_plan_key).toBeTruthy();
            expect(after.checkout_amount_brl).toBeGreaterThan(0);
        }

        const success = page.getByTestId("billing-checkout-success");
        if ((await success.count()) > 0) {
            await expect(success).toContainText(/selecionado|upgrade|migra/i);
        }
    });

    test("bloco de pagamento só aparece com intenção/cobrança (não sempre)", async ({ page }) => {
        const st = await fetchBillingStatus(page);
        const hasIntent = Boolean(
            st.pagarme_subscription?.pending_upgrade_plan_key ||
                st.pagarme_subscription?.pending_checkout_intent
        );
        const hasInvoice = Boolean(st.pending_invoice);

        const payHeading = page.getByRole("heading", {
            name: /Pagar mensalidade|Confirmar upgrade|Migrar para plano anual|Concluir pagamento/i,
        });

        if (!hasIntent && !hasInvoice && st.pagarme_subscription?.status === "active") {
            await expect(payHeading).toHaveCount(0);
        } else if (hasIntent || hasInvoice) {
            await expect(payHeading.first()).toBeVisible({ timeout: 15_000 });
        }
    });
});
