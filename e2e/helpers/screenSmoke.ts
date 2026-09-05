import { expect, type Page } from "@playwright/test";
import type { ScreenRoute } from "./routes";

const ERROR_PATTERNS = [
    /Application error: a client-side exception/i,
    /Internal Server Error/i,
    /Unhandled Runtime Error/i,
    /This page could not be found/i,
];

function pathMatches(url: string, routePath: string): boolean {
    const u = new URL(url);
    const [pathname, query = ""] = routePath.split("?");
    if (query) {
        return u.pathname === pathname && u.search === `?${query}`;
    }
    return u.pathname === pathname || u.pathname.startsWith(`${pathname}/`);
}

function urlAllowed(url: string, route: ScreenRoute): boolean {
    if (pathMatches(url, route.path.replace(/__PRODUCT_ID__/g, "").replace(/__SLUG__/g, ""))) {
        return true;
    }
    const allowed = route.allowedRedirects ?? [];
    return allowed.some((re) => re.test(url));
}

export async function visitScreen(page: Page, route: ScreenRoute, path: string): Promise<void> {
    const res = await page.goto(path, { waitUntil: "commit", timeout: 90_000 });
    expect(res, `goto ${path} sem response`).toBeTruthy();
    expect(res!.status(), `${route.name}: HTTP ${res!.status()}`).toBeLessThan(500);

    await expect(page.getByText(/Carregando sua empresa/i)).toHaveCount(0, { timeout: 90_000 }).catch(
        () => undefined
    );
    await expect(page.getByRole("banner").getByText("Carregando...")).toBeHidden({
        timeout: 90_000,
    }).catch(() => undefined);

    const finalUrl = page.url();
    const finalPath = new URL(finalUrl).pathname;
    const isPublicLogin = route.path === "/login" || route.path === "/signup";

    if (!isPublicLogin && route.group !== "public") {
        const ok =
            pathMatches(finalUrl, path) ||
            pathMatches(finalUrl, route.path) ||
            urlAllowed(finalUrl, route);
        expect(ok, `${route.name}: URL inesperada ${finalUrl} (path ${path})`).toBeTruthy();
    }

    if (
        route.group !== "public" &&
        route.path !== "/logout" &&
        route.path !== "/platform/login" &&
        finalPath === "/login"
    ) {
        throw new Error(`${route.name}: redirecionou para login — sessão E2E inválida`);
    }

    const bodyText = await page.locator("body").innerText();
    for (const pat of ERROR_PATTERNS) {
        expect(bodyText, `${route.name}: erro na página (${pat})`).not.toMatch(pat);
    }

    if (route.expectText) {
        await expect(page.locator("body")).toContainText(route.expectText, { timeout: 30_000 });
    } else if (route.group === "admin") {
        await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
    }
}

export function resolveRoutePath(
    route: ScreenRoute,
    resolved?: { productPath?: string | null; catalogPath?: string | null }
): string | null {
    if (route.dynamic === "product-images") {
        const p = resolved?.productPath;
        return p ?? null;
    }
    if (route.dynamic === "catalog-slug") {
        return resolved?.catalogPath ?? null;
    }
    if (route.path.includes("__PRODUCT_ID__") || route.path.includes("__SLUG__")) {
        return null;
    }
    return route.path;
}

export function shouldSkipRoute(route: ScreenRoute): string | false {
    if (route.requiresEnv && !process.env[route.requiresEnv]?.trim()) {
        return `Defina ${route.requiresEnv}`;
    }
    return false;
}
