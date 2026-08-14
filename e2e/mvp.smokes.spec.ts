import { test as base, expect } from "@playwright/test";
import { e2eCredentials, loginAsAdmin, openConfigTab } from "./helpers/auth";

const creds = e2eCredentials();

const test = base.extend({});
test.describe.configure({ mode: "serial" });

test.describe("MVP smokes (Playwright)", () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!creds, "Defina E2E_EMAIL e E2E_PASSWORD (+ app em E2E_BASE_URL, default :3000)");
        await loginAsAdmin(page);
    });

    test("M1+M2 — Configurações Delivery: flags e horário", async ({ page }) => {
        await openConfigTab(page, /^Delivery$/i);
        await expect(page.getByText(/Configurações de Delivery/i)).toBeVisible();
        await expect(page.getByText(/Abre às/i)).toBeVisible();
        await expect(page.getByText(/Fecha às/i)).toBeVisible();
        await expect(page.getByText(/Descrição do delivery/i)).toBeVisible();
        // liga/desliga (texto ou toggle presente na aba)
        await expect(page.getByText(/entrega|retirada|aceitar/i).first()).toBeVisible();
    });

    test("M3 — Configurações Geral: equipe e perfis", async ({ page }) => {
        await openConfigTab(page, /^Geral$/i);
        await expect(page.getByText(/Equipe e permissões/i)).toBeVisible();
        await expect(page.getByText(/Perfis de acesso/i)).toBeVisible();
        await expect(page.getByText(/^Equipe$/)).toBeVisible();
    });

    test("M5 — Pedidos: filtro Em preparo", async ({ page }) => {
        await page.goto("/pedidos");
        await expect(page.getByText(/Em preparo/i).first()).toBeVisible();
        await page.getByRole("button", { name: /Em preparo/i }).first().click();
        // lista/cards carregam sem erro de rota
        await expect(page).toHaveURL(/pedidos/);
    });

    test("M4+M6 — Impressoras: vias e Limpar fila", async ({ page }) => {
        await page.goto("/impressoras");
        await expect(page.getByRole("button", { name: /Limpar fila/i })).toBeVisible();
        // vias / auto print (rótulos PT-BR)
        await expect(
            page.getByText(/Cozinha|Caixa|Entregador|via|impress/i).first()
        ).toBeVisible();
    });

    test("M7 — Dashboard carrega (receita do dia)", async ({ page }) => {
        await page.goto("/");
        // dashboard home ou redirect autenticado
        await expect(page).not.toHaveURL(/\/login/);
        // algum indicador financeiro/operacional
        await expect(
            page.getByText(/hoje|faturamento|pedidos|dashboard|vendas/i).first()
        ).toBeVisible({ timeout: 30_000 });
    });
});

test.describe("MVP smoke — login page (sem credencial)", () => {
    test("tela de login renderiza", async ({ page }) => {
        try {
            await page.goto("/login", { timeout: 30_000 });
        } catch {
            test.skip(true, "App offline — rode npm run dev ou defina E2E_BASE_URL");
        }
        await expect(page.getByPlaceholder("seu@exemplo.com")).toBeVisible();
        await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible();
    });
});
