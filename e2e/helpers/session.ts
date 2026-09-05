import { expect, type Page } from "@playwright/test";
import { skipOnboardingWizard } from "./billingFixture";
import { e2eCredentials, loginAsAdmin } from "./auth";

/** Login + workspace + libera wizard /ativar para smokes admin. */
export async function ensureAdminSession(page: Page): Promise<void> {
    const creds = e2eCredentials();
    if (!creds) throw new Error("E2E_EMAIL/E2E_PASSWORD não definidos");

    await loginAsAdmin(page);

    const forced = process.env.E2E_COMPANY_ID?.trim();
    if (forced) {
        const sel = await page.request.post("/api/workspace/select", {
            data: { company_id: forced },
            failOnStatusCode: false,
        });
        expect(sel.ok(), `workspace/select ${forced} HTTP ${sel.status()}`).toBeTruthy();
    }

    const ativar = await page.request.get("/api/ativar", { failOnStatusCode: false });
    if (ativar.ok()) {
        const json = (await ativar.json()) as { completed?: boolean };
        if (!json.completed) {
            await skipOnboardingWizard(page);
        }
    }
}

export async function resolveProductImagesPath(page: Page): Promise<string | null> {
    const forced = process.env.E2E_PRODUCT_ID?.trim();
    if (forced) return `/produtos/${forced}/imagens`;

    const res = await page.request.get("/api/admin/products", { failOnStatusCode: false });
    if (!res.ok()) return null;
    const json = (await res.json()) as { rows?: Array<{ id?: string; product_id?: string }> };
    const row = json.rows?.[0];
    const id = row?.id ?? row?.product_id;
    return id ? `/produtos/${id}/imagens` : null;
}

export function resolveCatalogPath(): string | null {
    const slug = process.env.E2E_CATALOG_SLUG?.trim();
    return slug ? `/c/${slug}` : null;
}
