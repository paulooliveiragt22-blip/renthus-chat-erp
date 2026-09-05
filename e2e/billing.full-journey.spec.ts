/**
 * Massa de teste automatizada — jornada completa billing:
 * signup (API) → login → checkout cartão → /plano (contrato intent vs cobrança).
 *
 * Não depende de conta fixa: cria empresa nova a cada execução (CNPJ/e-mail únicos).
 *
 * .env.local:
 *   E2E_SKIP_WEBSERVER=1
 *   E2E_BASE_URL=https://app.renthus.com.br
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import { test as base, expect, type Browser } from "@playwright/test";
import { payCheckoutWithCard } from "./helpers/billingCheckout";
import {
    buildUniqueSignupAccount,
    loginWithAccount,
    signupViaApi,
    skipOnboardingWizard,
    type BillingFixtureAccount,
} from "./helpers/billingFixture";
import { ensureE2eEnv, gotoApp } from "./helpers/auth";

const test = base;
test.describe.configure({ mode: "serial" });

type BillingStatus = {
    pagarme_subscription?: {
        status?: string;
        plan?: string;
        last_paid_at?: string | null;
        pending_upgrade_plan_key?: string | null;
        pending_checkout_intent?: string | null;
    } | null;
    pending_invoice?: {
        kind?: string;
        amount?: number;
        target_plan_key?: string | null;
    } | null;
    checkout_amount_brl?: number | null;
};

let journeyAccount: BillingFixtureAccount;

async function fetchBillingStatus(page: import("@playwright/test").Page): Promise<BillingStatus> {
    const res = await page.request.get("/api/billing/status");
    const raw = (await res.json().catch(() => ({}))) as BillingStatus & { error?: string };
    expect(res.ok(), `billing/status HTTP ${res.status()}: ${raw.error ?? ""}`).toBeTruthy();
    expect(raw.pagarme_subscription, "pagarme_subscription null — migration/deploy?").toBeTruthy();
    return raw;
}

async function provisionJourneyAccount(browser: Browser): Promise<void> {
    ensureE2eEnv();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    journeyAccount = buildUniqueSignupAccount();
    await signupViaApi(page, journeyAccount, { plan: "pro" });
    await ctx.close();
}

test.describe("Billing — jornada signup → checkout → /plano", () => {
    test.beforeAll(async ({ browser }) => {
        await provisionJourneyAccount(browser);
        console.log(
            `[e2e-journey] provisioned ${journeyAccount.email} company=${journeyAccount.companyId}`
        );
    });

    test.beforeEach(async ({ page }) => {
        await loginWithAccount(page, journeyAccount);
    });

    test("signup cria empresa pending e /plano/pagar carrega checkout", async ({ page }) => {
        const beforePay = await fetchBillingStatus(page);
        const st = beforePay.pagarme_subscription?.status ?? "";
        expect(["pending_setup", "pending_payment", "overdue", "trial"]).toContain(st);

        await gotoApp(page, "/plano/pagar");
        await expect(page).toHaveURL(/\/plano\/pagar/, { timeout: 45_000 });
        await expect(page.getByRole("heading", { name: /Concluir pagamento/i })).toBeVisible({
            timeout: 60_000,
        });
        await expect(page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)).toHaveCount(0);
    });

    test("checkout cartão sandbox promove assinatura para active", async ({ page }) => {
        await gotoApp(page, "/plano/pagar");
        await expect(page.getByRole("heading", { name: /Concluir pagamento/i })).toBeVisible({
            timeout: 60_000,
        });
        await payCheckoutWithCard(page);

        const after = await fetchBillingStatus(page);
        expect(after.pagarme_subscription?.status).toBe("active");
        expect(after.pagarme_subscription?.last_paid_at).toBeTruthy();
        console.log(`[e2e-journey] paid active plan=${after.pagarme_subscription?.plan}`);

        await skipOnboardingWizard(page);
        await gotoApp(page, "/plano");
    });

    test("em /plano, selecionar upgrade não dispara create-invoice-checkout", async ({ page }) => {
        await skipOnboardingWizard(page);
        await gotoApp(page, "/plano");
        await expect(page).toHaveURL(/\/plano(?:\?|$)/, { timeout: 45_000 });
        await expect(page.getByText(/Carregando sua empresa/i)).toHaveCount(0, { timeout: 90_000 });
        await expect(
            page.getByRole("heading", { level: 1, name: /Plano e pagamentos/i })
        ).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText(/Planos disponíveis/i)).toBeVisible({ timeout: 90_000 });

        const before = await fetchBillingStatus(page);
        const upgradeBtn = page.getByRole("button", { name: /^Fazer upgrade$/i }).first();
        const migrateBtn = page.getByRole("button", { name: /^Migrar para anual$/i }).first();

        let targetBtn = upgradeBtn;
        if ((await upgradeBtn.count()) === 0 && (await migrateBtn.count()) > 0) {
            targetBtn = migrateBtn;
        } else if ((await upgradeBtn.count()) === 0) {
            test.skip(true, `Plano ${before.pagarme_subscription?.plan} sem upgrade clicável`);
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

        const apiWait = page.waitForResponse(
            (r) => {
                const url = r.url();
                return (
                    r.request().method() === "POST" &&
                    (url.includes("/api/billing/change-plan") ||
                        url.includes("/api/billing/switch-period"))
                );
            },
            { timeout: 60_000 }
        );

        await targetBtn.click();
        const apiRes = await apiWait;
        const apiJson = (await apiRes.json().catch(() => ({}))) as {
            error?: string;
            action?: string;
            invoice_id?: string;
        };

        expect(
            apiRes.ok(),
            `API plano HTTP ${apiRes.status()}: ${apiJson.error ?? JSON.stringify(apiJson).slice(0, 200)}`
        ).toBeTruthy();

        const okActions = [
            "upgrade_quoted",
            "period_switch_quoted",
            "upgraded",
            "upgrade_pending",
            "period_switch_pending",
            "downgrade_scheduled",
            "changed",
        ];
        expect(okActions.includes(String(apiJson.action)), `action=${apiJson.action}`).toBeTruthy();

        if (
            (apiJson.action === "upgrade_pending" || apiJson.action === "period_switch_pending") &&
            apiJson.invoice_id
        ) {
            throw new Error(
                `Contrato quebrado: invoice ${apiJson.invoice_id} criada no clique (${apiJson.action})`
            );
        }

        await page.waitForTimeout(1500);
        expect(checkoutCalls, "create-invoice-checkout no clique de plano").toBe(0);

        const after = await fetchBillingStatus(page);
        if (apiJson.action === "upgrade_quoted") {
            expect(after.pending_invoice).toBeFalsy();
            expect(after.pagarme_subscription?.pending_upgrade_plan_key).toBeTruthy();
            expect(after.checkout_amount_brl).toBeGreaterThan(0);
        }
        if (apiJson.action === "period_switch_quoted") {
            expect(after.pending_invoice).toBeFalsy();
            expect(after.pagarme_subscription?.pending_checkout_intent).toBe("period_switch");
        }
    });
});
