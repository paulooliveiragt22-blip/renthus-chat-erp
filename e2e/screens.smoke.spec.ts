/**
 * Smoke de todas as telas — visita cada rota e valida render sem crash/500.
 *
 * Admin/billing autenticado: E2E_EMAIL + E2E_PASSWORD (+ Supabase anon no .env.local)
 * Cardápio público (opcional): E2E_CATALOG_SLUG
 * Imagens produto: 1º produto da API ou E2E_PRODUCT_ID
 *
 * .env.local / shell:
 *   E2E_SKIP_WEBSERVER=1
 *   E2E_BASE_URL=https://app.renthus.com.br
 */

import { test as base } from "@playwright/test";
import { e2eCredentials } from "./helpers/auth";
import {
    ADMIN_SCREENS,
    BILLING_SCREENS,
    CATALOG_SCREEN,
    PLATFORM_SCREENS,
    PUBLIC_SCREENS,
    type ScreenRoute,
} from "./helpers/routes";
import {
    ensureAdminSession,
    resolveCatalogPath,
    resolveProductImagesPath,
} from "./helpers/session";
import { resolveRoutePath, shouldSkipRoute, visitScreen } from "./helpers/screenSmoke";

const test = base;
test.describe.configure({ mode: "serial" });

function screenTest(route: ScreenRoute, path: string): void {
    test(`[${route.group}] ${route.name} — ${path}`, async ({ page }) => {
        const skipReason = shouldSkipRoute(route);
        if (skipReason) test.skip(true, skipReason);
        await visitScreen(page, route, path);
    });
}

test.describe("Smoke — telas públicas", () => {
    for (const route of PUBLIC_SCREENS) {
        const path = resolveRoutePath(route);
        if (path) screenTest(route, path);
    }
});

test.describe("Smoke — telas admin", () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!e2eCredentials(), "E2E_EMAIL/E2E_PASSWORD");
        await ensureAdminSession(page);
    });

    for (const route of ADMIN_SCREENS) {
        const path = resolveRoutePath(route);
        if (path) screenTest(route, path);
    }
});

test.describe("Smoke — telas billing / paywall", () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!e2eCredentials(), "E2E_EMAIL/E2E_PASSWORD");
        await ensureAdminSession(page);
    });

    for (const route of BILLING_SCREENS) {
        screenTest(route, route.path);
    }
});

test.describe("Smoke — admin rotas dinâmicas", () => {
    test.beforeEach(async ({ page }) => {
        test.skip(!e2eCredentials(), "E2E_EMAIL/E2E_PASSWORD");
        await ensureAdminSession(page);
    });

    test("[admin] Imagens produto", async ({ page }) => {
        const path = await resolveProductImagesPath(page);
        if (!path) {
            test.skip(true, "Empresa sem produtos — cadastre um ou defina E2E_PRODUCT_ID");
        }
        await visitScreen(
            page,
            {
                path: path!,
                name: "Imagens produto",
                group: "admin",
                expectText: /imagem|produto|galeria|foto/i,
                allowedRedirects: [/\/produtos\/lista/, /\/login/],
            },
            path!
        );
    });
});

test.describe("Smoke — cardápio público (opcional)", () => {
    test("[public] Cardápio web", async ({ page }) => {
        const skipReason = shouldSkipRoute(CATALOG_SCREEN);
        if (skipReason) test.skip(true, skipReason);
        const path = resolveCatalogPath();
        if (!path) test.skip(true, "E2E_CATALOG_SLUG vazio");
        await visitScreen(page, CATALOG_SCREEN, path!);
    });
});

test.describe("Smoke — platform", () => {
    test("[platform] Login", async ({ page }) => {
        const route = PLATFORM_SCREENS.find((r) => r.path === "/platform/login")!;
        await visitScreen(page, route, route.path);
    });

    for (const route of PLATFORM_SCREENS.filter((r) => r.path !== "/platform/login")) {
        test(`[platform] ${route.name} — ${route.path}`, async () => {
            test.skip(true, "Defina E2E_PLATFORM_EMAIL + helper de login platform (futuro)");
        });
    }
});
