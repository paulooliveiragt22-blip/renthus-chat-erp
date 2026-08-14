import { expect, type Page } from "@playwright/test";

export function e2eCredentials(): { email: string; password: string } | null {
    const email = process.env.E2E_EMAIL?.trim() ?? "";
    const password = process.env.E2E_PASSWORD ?? "";
    if (!email || !password) return null;
    return { email, password };
}

/** Login Supabase via UI + sync de sessão/workspace. */
export async function loginAsAdmin(page: Page): Promise<void> {
    const creds = e2eCredentials();
    if (!creds) throw new Error("E2E_EMAIL/E2E_PASSWORD não definidos");

    await page.goto("/login");
    await page.getByPlaceholder("seu@exemplo.com").fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.getByRole("button", { name: /entrar/i }).click();

    // pós-login: pedidos ou outra rota admin (não deve permanecer em /login)
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 45_000 });
}

export async function openConfigTab(page: Page, tabLabel: string | RegExp): Promise<void> {
    await page.goto("/configuracoes");
    await page.getByRole("button", { name: tabLabel }).first().click();
}
