/**
 * Smoke billing sandbox — cartão + PIX no deploy (Vercel / main).
 *
 * Não precisa de PAGARME_* no .env.local: o app usa as env vars do deploy.
 *
 * PowerShell:
 *   $env:E2E_SKIP_WEBSERVER="1"
 *   $env:E2E_BASE_URL="https://renthus-chat-erp.vercel.app"
 *   $env:E2E_EMAIL="owner@loja.com"
 *   $env:E2E_PASSWORD="..."
 *   npm run test:e2e -- e2e/billing.sandbox.spec.ts
 *
 * Conta ideal: empresa com pagarme_subscriptions em pending_setup, pending_payment ou overdue.
 * Cartão sandbox: 4000000000000010 · 12/30 · CVV 123
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
        await gotoApp(page, "/plano/pagar");
    });

    test("plano/pagar carrega e Pagar.me está configurado", async ({ page }) => {
        await expect(page.getByRole("button", { name: /^PIX$/i })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole("button", { name: /Cartão de crédito/i })).toBeVisible();
        await expect(
            page.getByText(/Configure NEXT_PUBLIC_PAGARME_PUBLIC_KEY/i)
        ).toHaveCount(0);
    });

    test("cartão sandbox — pagamento aprovado", async ({ page }) => {
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
    });

    test("PIX sandbox — gera QR/código", async ({ page }) => {
        const pixBtn = page.getByRole("button", { name: /Gerar código PIX|Gerar novo/i });
        if ((await pixBtn.count()) === 0) {
            test.skip(true, "Sem botão PIX — conta pode já estar paga ou sem pendência");
        }

        await page.getByRole("button", { name: /^PIX$/i }).click();
        await pixBtn.click();

        await expect(
            page.getByText(/PIX gerado|copiar|QR PIX/i).first()
        ).toBeVisible({ timeout: 90_000 });

        // Simulador Pagar.me confirma PIX em segundos; webhook no deploy libera o plano.
        await page.waitForTimeout(35_000);
        await page.reload({ waitUntil: "domcontentloaded" });

        const statusRes = await page.request.get("/api/billing/status");
        expect(statusRes.ok()).toBeTruthy();
        const json = (await statusRes.json()) as {
            pagarme_subscription?: { status?: string };
        };
        const st = json.pagarme_subscription?.status ?? "";
        expect(["active", "trial", "pending_setup", "pending_payment", "overdue"]).toContain(st);
    });
});
