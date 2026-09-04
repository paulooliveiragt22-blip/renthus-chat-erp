/**
 * Smoke billing sandbox — cartão + PIX no deploy (Vercel / main).
 *
 * Não precisa de PAGARME_* no .env.local: o app usa as env vars do deploy.
 *
 * .env.local (formato dotenv, sem `$env:`):
 *   E2E_SKIP_WEBSERVER=1
 *   E2E_BASE_URL=https://renthus-chat-erp.vercel.app
 *   E2E_EMAIL=...
 *   E2E_PASSWORD=...
 *   E2E_COMPANY_ID=...   # opcional — força workspace never-paid / pending
 *
 * Conta ideal: empresa com pending_setup / pending_payment / overdue
 * (ou trial com invoice pending). Cartão sandbox: 4000000000000010 · 12/30 · CVV 123
 */

import { test as base, expect } from "@playwright/test";
import { e2eCredentials, ensureE2eEnv, gotoApp, loginAsAdmin } from "./helpers/auth";

const creds = e2eCredentials();
const test = base.extend({});
test.describe.configure({ mode: "serial" });

/** Smoke: sorrisogeladinha (pending_payment) — reset 2026-09-04. */
const DEFAULT_E2E_COMPANY_ID = "ca485517-6e64-4249-a566-6875976c3e41";

function needsPaymentCheckout(st: {
    pagarme_subscription?: { status?: string } | null;
    pending_invoice?: unknown;
}): boolean {
    const status = st.pagarme_subscription?.status ?? "";
    return (
        status === "pending_setup" ||
        status === "pending_payment" ||
        status === "overdue" ||
        // trial/active com invoice pending ainda mostra checkout (não redireciona /ativar)
        Boolean(st.pending_invoice)
    );
}

const SANDBOX_CARD = {
    holder: "Sandbox Renthus",
    number: "4000000000000010",
    exp: "12/30",
    cvv: "123",
    cep: "01310100",
    endereco: "Avenida Paulista",
    numero: "1000",
    bairro: "Bela Vista",
    cidade: "São Paulo",
    uf: "SP",
};

async function selectBillingWorkspace(page: import("@playwright/test").Page): Promise<void> {
    ensureE2eEnv();
    const forced =
        process.env.E2E_COMPANY_ID?.trim() || DEFAULT_E2E_COMPANY_ID;

    const res = await page.request.post("/api/workspace/select", {
        data: { company_id: forced },
        failOnStatusCode: false,
    });
    expect(
        res.ok(),
        `workspace/select ${forced} falhou HTTP ${res.status()} — o E2E_EMAIL precisa ser member dessa company`
    ).toBeTruthy();
    const stRes = await page.request.get("/api/billing/status");
    expect(stRes.ok(), "billing/status após company select").toBeTruthy();
    const stJson = (await stRes.json()) as {
        pagarme_subscription?: { status?: string };
        pending_invoice?: unknown;
    };
    const status = stJson.pagarme_subscription?.status ?? "";
    if (!needsPaymentCheckout(stJson)) {
        throw new Error(
            `company ${forced} status=${status || "(sem sub)"} pending_invoice=${Boolean(stJson.pending_invoice)} — precisa pending_*/overdue ou invoice pending`
        );
    }
    console.log(`[e2e-billing] workspace ${forced} status=${status}`);
}

async function fillCardCheckout(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: /Cartão de crédito/i }).click();
    await page.getByLabel("Nome no cartão").fill(SANDBOX_CARD.holder);
    await page.getByPlaceholder("0000 0000 0000 0000").fill(SANDBOX_CARD.number);
    await page.getByLabel("Validade (MM/AA)").fill(SANDBOX_CARD.exp);
    await page.getByLabel("CVV").fill(SANDBOX_CARD.cvv);
    await page.locator("#renthus-card-cep").fill(SANDBOX_CARD.cep);
    await page.getByLabel("Endereço (logradouro)").fill(SANDBOX_CARD.endereco);
    await page.getByLabel("Número").nth(1).fill(SANDBOX_CARD.numero);
    await page.getByLabel("Bairro").fill(SANDBOX_CARD.bairro);
    await page.getByLabel("Cidade").fill(SANDBOX_CARD.cidade);
    await page.getByLabel("UF").fill(SANDBOX_CARD.uf);
}

test.describe("Billing sandbox (deploy prod)", () => {
    test.beforeEach(async ({ page }) => {
        if (!creds) {
            throw new Error(
                "Defina E2E_EMAIL e E2E_PASSWORD no shell (ou .env.local). Skip silencioso escondia a causa."
            );
        }
        await loginAsAdmin(page);
        await selectBillingWorkspace(page);
        await gotoApp(page, "/plano/pagar");
        // Conta active/trial sem pending redireciona para /ativar — falha cedo e clara
        await expect(page).toHaveURL(/\/plano\/pagar/, { timeout: 30_000 });
        await expect(
            page.getByRole("heading", { name: /Concluir pagamento/i })
        ).toBeVisible({ timeout: 30_000 });
    });

    test("plano/pagar carrega e Pagar.me está configurado", async ({ page }) => {
        await expect(page.getByRole("button", { name: /^PIX$/i })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByRole("button", { name: /Cartão de crédito/i })).toBeVisible();
        await expect(
            page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)
        ).toHaveCount(0);
    });

    // PIX antes do cartão: cartão aprova → active e /plano/pagar some (redirect /ativar)
    test("PIX sandbox — gera QR/código", async ({ page }) => {
        await page.getByRole("button", { name: /^PIX$/i }).click();
        const pixBtn = page.getByRole("button", { name: /Gerar código PIX|Gerar novo/i });
        await expect(pixBtn).toBeVisible({ timeout: 15_000 });

        const checkoutWait = page.waitForResponse(
            (r) =>
                r.url().includes("/api/billing/create-invoice-checkout") &&
                r.request().method() === "POST",
            { timeout: 90_000 }
        );
        await pixBtn.click();
        const checkoutRes = await checkoutWait;
        const checkoutJson = (await checkoutRes.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
            pix_qr_code?: string;
            pix_qr_url?: string;
        };
        if (
            checkoutRes.status() === 502 &&
            (checkoutJson.error === "pix_gateway_stub" ||
                checkoutJson.error === "pix_emv_unavailable")
        ) {
            console.warn("[e2e-billing] PIX 502 detail:", {
                error: checkoutJson.error,
                message: checkoutJson.message,
                order_id: (checkoutJson as { order_id?: string }).order_id,
                pix_qr_url: checkoutJson.pix_qr_url,
            });
            test.skip(
                true,
                `PIX sem EMV no PSP (${checkoutJson.error}): painel Pagar.me → Meios de pagamento → PIX no gateway Pagar.me/Stone (não Mundipagg). Cartão segue no próximo teste. Ver docs/SMOKE_BILLING_PAGARME_SANDBOX.md`
            );
        }
        expect(
            checkoutRes.ok(),
            `create-invoice-checkout PIX HTTP ${checkoutRes.status()}: ${checkoutJson.error ?? checkoutJson.message ?? JSON.stringify(checkoutJson).slice(0, 200)}`
        ).toBeTruthy();

        await expect(
            page
                .getByRole("button", { name: /Copiar PIX|Copiado/i })
                .or(page.getByText(/pix_emv_unavailable/i))
                .or(page.getByRole("img", { name: /QR PIX/i }))
        ).toBeVisible({ timeout: 30_000 });

        const statusRes = await page.request.get("/api/billing/status");
        expect(statusRes.ok()).toBeTruthy();
        const json = (await statusRes.json()) as {
            pagarme_subscription?: { status?: string };
            amount_mismatch?: boolean;
        };
        const st = json.pagarme_subscription?.status ?? "";
        expect(["active", "trial", "pending_setup", "pending_payment", "overdue"]).toContain(st);
        expect(json.amount_mismatch).not.toBe(true);
    });

    test("cartão sandbox — pagamento aprovado", async ({ page }) => {
        await page.getByRole("button", { name: /Cartão de crédito/i }).click();
        const payBlock = page.getByRole("button", { name: /Pagar com cartão/i });
        const noPayment = page.getByText(/nenhuma cobrança|plano ativo|sem pendência/i);

        if (await noPayment.count()) {
            test.skip(true, "Conta sem cobrança pendente — use loja pending_setup/pending_payment");
        }
        if ((await payBlock.count()) === 0) {
            test.skip(true, "Bloco de pagamento não visível para esta empresa");
        }

        await fillCardCheckout(page);
        await payBlock.click();

        // NÃO usar /plano liberado|em análise/ solto — colide com o texto de ajuda estático
        // ("Aprovado na hora = plano liberado… Em análise = …")
        const paidOk = page
            .getByTestId("billing-checkout-success")
            .or(page.getByText(/Pagamento (aprovado|confirmado)\./i));
        const inReview = page.getByText(/^Pagamento em análise/i);
        const payErr = page.getByTestId("billing-checkout-error").or(
            page.locator("div").filter({ hasText: /não foi possível|recusad|falha ao|erro ao pagar/i }).first()
        );

        await expect(paidOk.or(inReview).or(payErr)).toBeVisible({ timeout: 90_000 });
        await expect(page.getByRole("button", { name: /Processando/i })).toHaveCount(0, {
            timeout: 15_000,
        });

        const errVisible = (await payErr.count()) > 0 && (await paidOk.count()) === 0;
        if (errVisible) {
            throw new Error(
                `Checkout cartão falhou na UI: ${(await payErr.first().innerText()).slice(0, 200)}`
            );
        }

        if ((await paidOk.count()) > 0) {
            await expect
                .poll(
                    async () => {
                        const r = await page.request.get("/api/billing/status");
                        const j = (await r.json()) as {
                            pagarme_subscription?: { status?: string };
                        };
                        return j.pagarme_subscription?.status ?? "";
                    },
                    { timeout: 60_000, message: "fulfill não promoveu sub para active" }
                )
                .toBe("active");
            const after = (await (await page.request.get("/api/billing/status")).json()) as {
                pagarme_subscription?: { last_paid_at?: string | null };
            };
            expect(after.pagarme_subscription?.last_paid_at).toBeTruthy();
        } else {
            // Em análise: webhook libera depois — status local pode continuar pending_*
            const statusRes = await page.request.get("/api/billing/status");
            expect(statusRes.ok()).toBeTruthy();
            const json = (await statusRes.json()) as {
                pagarme_subscription?: { status?: string };
            };
            const st = json.pagarme_subscription?.status ?? "";
            expect(["active", "trial", "pending_payment", "pending_setup", "overdue"]).toContain(st);
        }
    });
});
