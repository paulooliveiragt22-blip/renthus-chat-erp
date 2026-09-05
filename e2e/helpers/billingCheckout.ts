import { expect, type Page } from "@playwright/test";

export const SANDBOX_CARD = {
    holder: "Sandbox Renthus E2E",
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

export async function fillCardCheckout(page: Page): Promise<void> {
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

export async function payCheckoutWithCard(page: Page): Promise<void> {
    await page.getByRole("button", { name: /Cartão de crédito/i }).click();
    const payBlock = page.getByRole("button", { name: /Pagar com cartão/i });
    await expect(payBlock).toBeVisible({ timeout: 30_000 });
    await fillCardCheckout(page);
    await payBlock.click();

    const paidOk = page
        .getByTestId("billing-checkout-success")
        .or(page.getByText(/Pagamento (aprovado|confirmado)\./i));
    const inReview = page.getByText(/^Pagamento em análise/i);
    const payErr = page
        .getByTestId("billing-checkout-error")
        .or(page.locator("div").filter({ hasText: /não foi possível|recusad|falha ao|erro ao pagar/i }).first());

    // Aprovação pode redirecionar para /ativar antes do banner de sucesso renderizar.
    await expect
        .poll(
            async () => {
                const url = page.url();
                if (/\/ativar(?:\?|$)/.test(url)) return "ativar";
                const r = await page.request.get("/api/billing/status");
                const j = (await r.json()) as {
                    pagarme_subscription?: { status?: string; last_paid_at?: string | null };
                };
                if (j.pagarme_subscription?.status === "active") return "active";
                if ((await paidOk.count()) > 0) return "success";
                if ((await inReview.count()) > 0) return "review";
                if ((await payErr.count()) > 0) return "error";
                return "";
            },
            { timeout: 90_000, message: "checkout cartão sem sucesso/erro/redirect" }
        )
        .not.toBe("");

    if ((await payErr.count()) > 0 && (await paidOk.count()) === 0 && !/\/ativar/.test(page.url())) {
        throw new Error(`Checkout cartão falhou: ${(await payErr.first().innerText()).slice(0, 200)}`);
    }

    await expect
        .poll(
            async () => {
                const r = await page.request.get("/api/billing/status");
                const j = (await r.json()) as {
                    pagarme_subscription?: { status?: string; last_paid_at?: string | null };
                };
                return j.pagarme_subscription?.status ?? "";
            },
            { timeout: 60_000, message: "fulfill não promoveu sub para active" }
        )
        .toBe("active");
}
