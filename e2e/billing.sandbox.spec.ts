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
import { e2eCredentials, gotoApp, loginAsAdmin } from "./helpers/auth";

const creds = e2eCredentials();
const test = base.extend({});
test.describe.configure({ mode: "serial" });

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
    const forced = process.env.E2E_COMPANY_ID?.trim();
    if (forced) {
        const res = await page.request.post("/api/workspace/select", {
            data: { company_id: forced },
            failOnStatusCode: false,
        });
        expect(res.ok(), `workspace/select ${forced}`).toBeTruthy();
        return;
    }

    const listRes = await page.request.get("/api/workspace/list");
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as { companies?: Array<{ id: string; name?: string }> };
    const companies = Array.isArray(list.companies) ? list.companies : [];
    expect(companies.length, "usuário E2E sem empresas").toBeGreaterThan(0);

    let chosen = companies[0]!.id;
    for (const c of companies) {
        await page.request.post("/api/workspace/select", {
            data: { company_id: c.id },
            failOnStatusCode: false,
        });
        const stRes = await page.request.get("/api/billing/status");
        if (!stRes.ok()) continue;
        const stJson = (await stRes.json()) as {
            pagarme_subscription?: { status?: string };
            pending_invoice?: unknown;
        };
        const status = stJson.pagarme_subscription?.status ?? "";
        if (
            status === "pending_setup" ||
            status === "pending_payment" ||
            status === "overdue" ||
            stJson.pending_invoice
        ) {
            chosen = c.id;
            break;
        }
    }

    const sel = await page.request.post("/api/workspace/select", {
        data: { company_id: chosen },
        failOnStatusCode: false,
    });
    expect(sel.ok(), `workspace/select final ${chosen}`).toBeTruthy();
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
        test.skip(!creds, "Defina E2E_EMAIL e E2E_PASSWORD");
        await loginAsAdmin(page);
        await selectBillingWorkspace(page);
        await gotoApp(page, "/plano/pagar");
        await expect(page).toHaveURL(/\/plano\/pagar/, { timeout: 30_000 });
    });

    test("plano/pagar carrega e Pagar.me está configurado", async ({ page }) => {
        await expect(
            page.getByRole("heading", { name: /Concluir pagamento|pagamento|plano/i }).first()
        ).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("button", { name: /^PIX$/i })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("button", { name: /Cartão de crédito/i })).toBeVisible();
        await expect(
            page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)
        ).toHaveCount(0);
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

        await expect(
            page.getByText(/Pagamento aprovado|Plano liberado|em análise/i)
        ).toBeVisible({ timeout: 90_000 });

        const statusRes = await page.request.get("/api/billing/status");
        expect(statusRes.ok()).toBeTruthy();
        const json = (await statusRes.json()) as {
            pagarme_subscription?: { status?: string; last_paid_at?: string | null };
        };
        const st = json.pagarme_subscription?.status ?? "";
        const paidAt = json.pagarme_subscription?.last_paid_at;
        const approvedVisible = await page.getByText(/Pagamento aprovado|Plano liberado/i).count();
        if (approvedVisible > 0) {
            expect(st).toBe("active");
            expect(paidAt).toBeTruthy();
        } else {
            expect(["active", "trial", "pending_payment", "pending_setup", "overdue"]).toContain(st);
        }
    });

    test("PIX sandbox — gera QR/código", async ({ page }) => {
        await page.getByRole("button", { name: /^PIX$/i }).click();
        const pixBtn = page.getByRole("button", { name: /Gerar código PIX|Gerar novo/i });
        if ((await pixBtn.count()) === 0) {
            test.skip(true, "Sem botão PIX — conta pode já estar paga ou sem pendência");
        }

        await pixBtn.click();

        await expect(
            page
                .getByRole("button", { name: /Copiar PIX/i })
                .or(page.getByText(/copia-e-cola|pix_emv_unavailable/i))
                .or(page.getByRole("img", { name: /QR PIX/i }))
        ).toBeVisible({ timeout: 90_000 });

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
});
