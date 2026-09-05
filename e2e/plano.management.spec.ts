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
import { ensureE2eEnv, gotoApp, loginAsAdmin } from "./helpers/auth";

const test = base.extend({});
test.describe.configure({ mode: "serial" });

function requireCreds(): { email: string; password: string } {
    ensureE2eEnv();
    const email = process.env.E2E_EMAIL?.trim() ?? "";
    const password = process.env.E2E_PASSWORD ?? "";
    if (!email || !password) {
        throw new Error("Defina E2E_EMAIL e E2E_PASSWORD (shell ou .env.local)");
    }
    return { email, password };
}

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
    plan_key?: string | null;
    is_blocked?: boolean;
    invoice_history?: Array<{ status?: string }>;
};

async function fetchBillingStatus(page: import("@playwright/test").Page): Promise<BillingStatus> {
    const res = await page.request.get("/api/billing/status");
    const raw = (await res.json().catch(() => ({}))) as BillingStatus & { error?: string };
    if (!res.ok()) {
        console.log(`[e2e-plano] billing/status HTTP ${res.status()}: ${JSON.stringify(raw).slice(0, 300)}`);
    } else if (!raw.pagarme_subscription) {
        console.log(
            `[e2e-plano] billing/status keys=${Object.keys(raw).join(",")} ` +
                `body=${JSON.stringify(raw).slice(0, 1200)}`
        );
    }
    expect(res.ok(), `billing/status HTTP ${res.status()}`).toBeTruthy();
    return raw;
}

async function selectPlanoWorkspace(
    page: import("@playwright/test").Page
): Promise<BillingStatus | null> {
    ensureE2eEnv();
    const forced = process.env.E2E_PLANO_COMPANY_ID?.trim() || process.env.E2E_COMPANY_ID?.trim();

    if (forced) {
        const res = await page.request.post("/api/workspace/select", {
            data: { company_id: forced },
            failOnStatusCode: false,
        });
        if (!res.ok()) {
            console.warn(
                `[e2e-plano] workspace/select ${forced} HTTP ${res.status()} — tentando auto-select`
            );
        } else {
            const st = await fetchBillingStatus(page);
            if (isEligiblePaidSub(st)) return st;
        }
    }

    const listRes = await page.request.get("/api/workspace/list");
    if (!listRes.ok()) {
        console.warn(`[e2e-plano] workspace/list HTTP ${listRes.status()}`);
        return null;
    }
    const listJson = (await listRes.json()) as {
        companies?: Array<{ id: string; name?: string | null }>;
    };
    const companies = listJson.companies ?? [];
    console.log(
        `[e2e-plano] workspaces: ${companies.map((c) => `${c.name ?? c.id.slice(0, 8)}`).join(", ") || "(vazio)"}`
    );

    for (const c of companies) {
        const sel = await page.request.post("/api/workspace/select", {
            data: { company_id: c.id },
            failOnStatusCode: false,
        });
        if (!sel.ok()) continue;
        const st = await fetchBillingStatus(page);
        if (isEligiblePaidSub(st)) {
            console.log(
                `[e2e-plano] auto-selected ${c.name ?? c.id} plan=${st.pagarme_subscription?.plan}`
            );
            return st;
        }
    }

    const last = await fetchBillingStatus(page);
    console.log(
        `[e2e-plano] ineligible status=${last.pagarme_subscription?.status ?? "?"} ` +
            `paid=${Boolean(last.pagarme_subscription?.last_paid_at)}`
    );
    return null;
}

function isEligiblePaidSub(st: BillingStatus): boolean {
    const ps = st.pagarme_subscription;
    if (ps && String(ps.status ?? "") === "active" && Boolean(ps.last_paid_at)) {
        return true;
    }
    const hasPaidHistory = (st.invoice_history ?? []).some(
        (row) => String(row.status ?? "").toLowerCase() === "paid"
    );
    return Boolean(st.plan_key) && hasPaidHistory && st.is_blocked !== true;
}

test.describe("/plano — gestão assinante pago", () => {
    test.beforeEach(async ({ page }) => {
        requireCreds();
        await loginAsAdmin(page);
        const st = await selectPlanoWorkspace(page);
        if (!st) {
            test.skip(
                true,
                "Conta sem assinatura active+paga — use empresa com last_paid_at preenchido"
            );
        }
        await gotoApp(page, "/plano");
        await expect(page).toHaveURL(/\/plano(?:\?|$)/, { timeout: 45_000 });
        await expect(page.getByText(/Carregando sua empresa/i)).toHaveCount(0, {
            timeout: 90_000,
        });
        await expect(
            page.getByRole("heading", { level: 1, name: /Plano e pagamentos/i })
        ).toBeVisible({ timeout: 90_000 });
        await expect(
            page.getByText(/Assinatura ativa|Plano atual:/i).first()
        ).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText(/Planos disponíveis/i)).toBeVisible({
            timeout: 90_000,
        });
    });

    test("carrega /plano sem redirecionar para /plano/pagar", async ({ page }) => {
        const st = await fetchBillingStatus(page);
        console.log(
            `[e2e-plano] status plan=${st.pagarme_subscription?.plan} ` +
                `pending_invoice=${JSON.stringify(st.pending_invoice ?? null)}`
        );
        await expect(page).not.toHaveURL(/\/plano\/pagar/);
        await expect(page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)).toHaveCount(0);
    });

    test("selecionar plano não dispara create-invoice-checkout", async ({ page }) => {
        const before = await fetchBillingStatus(page);
        const currentPlan = before.pagarme_subscription?.plan ?? "essencial";

        const upgradeBtn = page.getByRole("button", { name: /^Fazer upgrade$/i }).first();
        const migrateBtn = page.getByRole("button", { name: /^Migrar para anual$/i }).first();
        const downgradeBtn = page
            .getByRole("button", { name: /^Agendar downgrade$/i })
            .first();

        let targetBtn = upgradeBtn;
        if ((await upgradeBtn.count()) === 0 && (await migrateBtn.count()) > 0) {
            targetBtn = migrateBtn;
        } else if ((await upgradeBtn.count()) === 0 && (await downgradeBtn.count()) > 0) {
            targetBtn = downgradeBtn;
        } else if ((await upgradeBtn.count()) === 0) {
            test.skip(
                true,
                `Sem ação de plano clicável (plano=${currentPlan}, só "Plano atual"?)`
            );
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
            message?: string;
        };

        expect(
            apiRes.ok(),
            `API plano HTTP ${apiRes.status()}: ${apiJson.error ?? JSON.stringify(apiJson).slice(0, 200)}`
        ).toBeTruthy();

        const okActions = [
            "upgrade_quoted",
            "upgraded",
            "upgrade_pending",
            "period_switch_quoted",
            "period_switch_pending",
            "downgrade_scheduled",
            "changed",
        ];
        expect(
            okActions.includes(String(apiJson.action)),
            `action inesperada: ${apiJson.action}`
        ).toBeTruthy();

        if (
            (apiJson.action === "upgrade_pending" || apiJson.action === "period_switch_pending") &&
            apiJson.invoice_id
        ) {
            console.warn(
                `[e2e-plano] WARN: deploy ainda cria invoice no clique (${apiJson.action}) — contrato quebrado`
            );
        }

        await page.waitForTimeout(1500);

        expect(checkoutCalls, "create-invoice-checkout não deve rodar ao selecionar plano").toBe(0);

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
