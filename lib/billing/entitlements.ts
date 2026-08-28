import "server-only";

import { fetchCompanyEntitlements } from "@/lib/billing/fetchCompanyEntitlements";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

export type ActiveSubscription = {
    subscription_id: string;
    plan_id: string;
    plan_key: string;
    plan_name: string | null;
    allow_overage: boolean;
};

export type LimitCheckResult = {
    allowed: boolean; // true se pode prosseguir; false se bloqueado (excesso + não aceitou overage)
    feature_key: string;
    year_month: string;
    used: number;
    limit_per_month: number | null; // null => ilimitado/não definido
    will_overage_by: number; // >0 se passaria do limite com o incremento
    allow_overage: boolean;
};

function formatYearMonth(d: Date) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Usa a função do banco se existir (current_year_month), senão fallback UTC.
 */
export async function getCurrentYearMonth(admin: AdminClient): Promise<string> {
    try {
        const { data, error } = await admin.rpc("current_year_month");
        if (!error && typeof data === "string" && /^\d{4}-\d{2}$/.test(data)) return data;
    } catch {
        // ignore
    }
    return formatYearMonth(new Date());
}

export async function getActiveSubscription(admin: AdminClient, companyId: string): Promise<ActiveSubscription | null> {
    const ent = await fetchCompanyEntitlements(admin, companyId);
    const sub = ent.subscription;
    if (!sub?.plan_id || !sub.plan_key) return null;

    return {
        subscription_id: sub.id,
        plan_id: sub.plan_id,
        plan_key: sub.plan_key,
        plan_name: sub.plan_name,
        allow_overage: sub.allow_overage,
    };
}

export async function getEnabledFeatures(admin: AdminClient, companyId: string): Promise<Set<string>> {
    const ent = await fetchCompanyEntitlements(admin, companyId);
    return new Set(ent.features);
}

export async function hasFeature(admin: AdminClient, companyId: string, featureKey: string) {
    const features = await getEnabledFeatures(admin, companyId);
    return features.has(featureKey);
}

/**
 * Retorna o limite mensal do plano atual (feature_limits).
 * null => sem limite definido
 */
export async function getPlanMonthlyLimit(admin: AdminClient, companyId: string, featureKey: string): Promise<number | null> {
    const sub = await getActiveSubscription(admin, companyId);
    if (!sub) return null;

    const { data, error } = await admin
        .from("feature_limits")
        .select("limit_per_month")
        .eq("plan_id", sub.plan_id)
        .eq("feature_key", featureKey)
        .maybeSingle();

    if (error) throw new Error(error.message);

    const v = data?.limit_per_month;
    return typeof v === "number" ? v : null;
}

export async function getCurrentMonthUsage(
    admin: AdminClient,
    companyId: string,
    featureKey: string
): Promise<{ year_month: string; used: number }> {
    const yearMonth = await getCurrentYearMonth(admin);

    const { data, error } = await admin
        .from("usage_monthly")
        .select("used")
        .eq("company_id", companyId)
        .eq("feature_key", featureKey)
        .eq("year_month", yearMonth)
        .maybeSingle();

    if (error) throw new Error(error.message);

    const used = typeof data?.used === "number" ? data.used : 0;
    return { year_month: yearMonth, used };
}

/**
 * Checa limite antes de executar uma ação que incrementa o uso.
 * Política:
 * - se não tem limite => allowed = true
 * - se está dentro do limite => allowed = true
 * - se passaria do limite => allowed = allow_overage (flag de subscription)
 */
export async function checkLimit(
    admin: AdminClient,
    companyId: string,
    featureKey: string,
    increment = 1
): Promise<LimitCheckResult> {
    const [sub, usage, limit] = await Promise.all([
        getActiveSubscription(admin, companyId),
        getCurrentMonthUsage(admin, companyId, featureKey),
        getPlanMonthlyLimit(admin, companyId, featureKey),
    ]);

    const allowOverage = Boolean(sub?.allow_overage);

    const nextUsed = usage.used + Math.max(0, Math.floor(increment || 0));
    const willOverageBy = limit == null ? 0 : Math.max(0, nextUsed - limit);

    const allowed = limit == null || nextUsed <= limit || allowOverage;

    return {
        allowed,
        feature_key: featureKey,
        year_month: usage.year_month,
        used: usage.used,
        limit_per_month: limit,
        will_overage_by: willOverageBy,
        allow_overage: allowOverage,
    };
}

/**
 * Exige feature e lança erro amigável.
 */
export async function requireFeature(admin: AdminClient, companyId: string, featureKey: string) {
    const ok = await hasFeature(admin, companyId, featureKey);
    if (!ok) throw new Error(`Feature not enabled: ${featureKey}`);
}
