import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

let envLoaded = false;

/** Carrega `.env.local` no processo do Playwright (Next não injeta isso no runner). */
function loadEnvLocal(): void {
    if (envLoaded) return;
    envLoaded = true;
    const file = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

export function e2eCredentials(): { email: string; password: string } | null {
    loadEnvLocal();
    const email = process.env.E2E_EMAIL?.trim() ?? "";
    const password = process.env.E2E_PASSWORD ?? "";
    if (!email || !password) return null;
    return { email, password };
}

async function requestJson(
    page: Page,
    label: string,
    method: "GET" | "POST",
    url: string,
    data?: Record<string, unknown>
): Promise<unknown> {
    const res = await page.request.fetch(url, {
        method,
        data,
        timeout: 45_000,
        failOnStatusCode: false,
    });
    const body = await res.text();
    const trimmed = body.trim();
    if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
        throw new Error(`${label}: HTML status ${res.status()} (proxy mandou p/ login — sem cookie)`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new Error(`${label}: não-JSON status ${res.status()}: ${trimmed.slice(0, 200)}`);
    }
    if (!res.ok()) {
        throw new Error(`${label}: HTTP ${res.status()} ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    return parsed;
}

async function setReactInput(page: Page, selector: string, value: string): Promise<void> {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: "visible" });
    await loc.click();
    await loc.evaluate((el, v) => {
        const input = el as HTMLInputElement;
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        desc?.set?.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}

/** Login pela tela (como o Chrome). Usado quando o deploy ainda não libera POST /api/auth/sync-session. */
async function loginViaUi(page: Page, creds: { email: string; password: string }): Promise<void> {
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await setReactInput(page, 'input[type="email"]', creds.email.trim().toLowerCase());
    await setReactInput(page, 'input[type="password"]', creds.password);
    await page.getByRole("button", { name: /^entrar$/i }).click();
    try {
        await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 45_000 });
    } catch {
        const alert = page.getByRole("alert");
        const errText = (await alert.textContent().catch(() => null))?.trim();
        throw new Error(
            `Login UI ficou em ${page.url()}. ${errText ? `Tela: "${errText}"` : "Sem alerta — senha/e-mail ou sessão."}`
        );
    }
}

/**
 * Login E2E: tenta cookies via API; se o deploy antigo devolver 405/HTML, cai no formulário.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
    loadEnvLocal();
    const creds = e2eCredentials();
    if (!creds) throw new Error("E2E_EMAIL/E2E_PASSWORD não definidos");

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
        throw new Error(
            "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes (coloque em .env.local)."
        );
    }

    const supabase = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
        email: creds.email.trim().toLowerCase(),
        password: creds.password,
    });
    if (error || !data.session) {
        throw new Error(`Supabase signIn falhou: ${error?.message ?? "sem session"}`);
    }

    try {
        await requestJson(page, "sync-session", "POST", "/api/auth/sync-session", {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/405|HTML|não-JSON|Unregistered|401|500/i.test(msg)) throw err;
        await loginViaUi(page, creds);
        return;
    }

    try {
        const list = (await requestJson(page, "workspace/list", "GET", "/api/workspace/list")) as {
            companies?: Array<{ id: string }>;
        };
        const companies = Array.isArray(list.companies) ? list.companies : [];
        if (companies.length >= 1) {
            await requestJson(page, "workspace/select", "POST", "/api/workspace/select", {
                company_id: companies[0].id,
            });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Deploy com service_role inválida / drift de keys → UI login ainda funciona.
        if (!/Unregistered|401|500|HTML/i.test(msg)) throw err;
        await loginViaUi(page, creds);
        return;
    }

    const cookies = await page.context().cookies();
    const hasAuth = cookies.some(
        (c) => c.name.includes("auth-token") || c.name.startsWith("sb-")
    );
    if (!hasAuth) {
        await loginViaUi(page, creds);
    }
}

/** Next em `dev` aborta o 1º goto enquanto compila a rota — retry + commit. */
export async function gotoApp(page: Page, path: string): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto(path, { waitUntil: "commit", timeout: 90_000 });
            lastErr = undefined;
            break;
        } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!/ERR_ABORTED|frame was detached|Timeout/i.test(msg) || attempt === 3) {
                throw err;
            }
        }
    }
    if (lastErr) throw lastErr;
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 45_000 });
}

export async function openConfigTab(page: Page, tab: "geral" | "delivery"): Promise<void> {
    await gotoApp(page, `/configuracoes?tab=${tab}`);
    await expect(page.getByRole("heading", { name: /^Configurações$/ })).toBeVisible({
        timeout: 90_000,
    });
    // Header "Carregando..." = workspace ainda sem company_id; o painel fica no spinner.
    await expect(page.getByRole("banner").getByText("Carregando...")).toBeHidden({
        timeout: 90_000,
    });
}
