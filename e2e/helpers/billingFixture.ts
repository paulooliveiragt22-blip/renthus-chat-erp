import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { ensureE2eEnv } from "./auth";
import { generateValidCnpj } from "./cnpj";

export type BillingFixtureAccount = {
    email: string;
    password: string;
    companyId: string;
    companyName: string;
};

export function buildUniqueSignupAccount(): BillingFixtureAccount {
    const stamp = Date.now();
    return {
        email: `e2e.billing.${stamp}@renthus-e2e.local`,
        password: "Minhaloja01!",
        companyId: "",
        companyName: `E2E Billing ${stamp}`,
    };
}

export async function signupViaApi(
    page: Page,
    account: BillingFixtureAccount,
    opts?: { plan?: "essencial" | "pro" | "market"; billingPeriod?: "month" | "year" }
): Promise<string> {
    const plan = opts?.plan ?? "pro";
    const billingPeriod = opts?.billingPeriod ?? "month";
    const cnpj = generateValidCnpj();
    const res = await page.request.post("/api/billing/signup", {
        data: {
            company_name: account.companyName,
            cnpj,
            whatsapp: "66999887766",
            email: account.email,
            plan,
            billing_period: billingPeriod,
            password: account.password,
            password_confirm: account.password,
        },
        failOnStatusCode: false,
    });
    const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        company_id?: string;
        ok?: boolean;
    };
    expect(
        res.ok(),
        `signup HTTP ${res.status()}: ${json.error ?? JSON.stringify(json).slice(0, 200)}`
    ).toBeTruthy();
    expect(json.company_id, "signup sem company_id").toBeTruthy();
    account.companyId = String(json.company_id);
    console.log(`[e2e-fixture] signup ok company=${account.companyId} email=${account.email}`);
    return account.companyId;
}

export async function loginWithAccount(page: Page, account: BillingFixtureAccount): Promise<void> {
    ensureE2eEnv();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes");
    }

    const supabase = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({
        email: account.email.trim().toLowerCase(),
        password: account.password,
    });
    if (error || !data.session) {
        throw new Error(`signIn falhou: ${error?.message ?? "sem session"}`);
    }

    const sync = await page.request.post("/api/auth/sync-session", {
        data: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
        },
        failOnStatusCode: false,
    });
    expect(sync.ok(), `sync-session HTTP ${sync.status()}`).toBeTruthy();

    const sel = await page.request.post("/api/workspace/select", {
        data: { company_id: account.companyId },
        failOnStatusCode: false,
    });
    expect(sel.ok(), `workspace/select HTTP ${sel.status()}`).toBeTruthy();
}

export async function createPaidSubscriber(
    page: Page,
    opts?: { plan?: "essencial" | "pro" | "market" }
): Promise<BillingFixtureAccount> {
    const account = buildUniqueSignupAccount();
    await signupViaApi(page, account, opts);
    await loginWithAccount(page, account);
    return account;
}

/** Libera rotas admin bloqueadas pelo wizard /ativar (contas novas pós-pagamento). */
export async function skipOnboardingWizard(page: Page): Promise<void> {
    const res = await page.request.post("/api/ativar", {
        data: { action: "skip" },
        failOnStatusCode: false,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; completed?: boolean };
    expect(res.ok(), `ativar/skip HTTP ${res.status()}: ${json.error ?? ""}`).toBeTruthy();
}
