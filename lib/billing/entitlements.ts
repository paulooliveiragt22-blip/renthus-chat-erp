import "server-only";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

export type ActiveSubscription = {
    subscription_id: string;
    plan_id: string;
    plan_key: string;
    plan_name: string | null;
};

export type LimitCheckResult = {
    allowed: boolean;               // por enquanto sempre true; você pode mudar pra bloquear
    feature_key: string;
    year_month: string;
    used: number;                   // uso atual
    limit_per_month: number | null; // null = ilimitado/não definido
    will_overage_by: number;        // >0 se passar do limite com o incremento
};

function formatYearMonth(d: Date) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Usa a função do banco se existir (current_year_month), senão fallback UTC.
 * A função foi criada na migration de helpers.
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

export async function getActiveSubscription(
    admin: AdminClient,
    companyId: string
): Promise<ActiveSubscription | null> {
    // subscriptions.status = 'active'
    // join com plans para pegar plan.key
    const { data, error } = await admin
        .from("subscriptions")
        .select("id, plan_id, plans:plans ( key, name )")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.plan_id) return null;

    const planKey = (data as any)?.plans?.key as string | undefined;
    const planName = (data as any)?.plans?.name as string | null | undefined;

    if (!planKey) {
        // plano inválido / sem FK resolvida
        return null;
    }

    return {
        subscription_id: data.id,
        plan_id: data.plan_id,
        plan_key: planKey,
        plan_name: planName ?? null,
    };
}

export async function getEnabledFeatures(admin: AdminClient, companyId: string): Promise<Set<string>> {
    const sub = await getActiveSubscription(admin, companyId);
    if (!sub) return new Set();

    // 1) features do plano
    const { data: pf, error: pfErr } = await admin
        .from("plan_features")
        .select("feature_key")
        .eq("plan_id", sub.plan_id);

    if (pfErr) throw new Error(pfErr.message);

    // 2) addons da company
    const { data: addons, error: addErr } = await admin
        .from("subscription_addons")
        .select("feature_key")
        .eq("company_id", companyId);

    if (addErr) throw new Error(addErr.message);

    const s = new Set<string>();
    for (const row of pf ?? []) if (row?.feature_key) s.add(String(row.feature_key));
    for (const row of addons ?? []) if (row?.feature_key) s.add(String(row.feature_key));

    return s;
}

export async function hasFeature(admin: AdminClient, companyId: string, featureKey: string) {
    const features = await getEnabledFeatures(admin, companyId);
    return features.has(featureKey);
}

/**
 * Retorna o limite mensal do plano atual (feature_limits).
 * null => sem limite definido
 */
export async function getPlanMonthlyLimit(
    admin: AdminClient,
    companyId: string,
    featureKey: string
): Promise<number | null> {
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
 * Política atual: NÃO bloqueia (allowed = true), só calcula overage.
 */
export async function checkLimit(
    admin: AdminClient,
    companyId: string,
    featureKey: string,
    increment = 1
): Promise<LimitCheckResult> {
    const [{ year_month, used }, limit] = await Promise.all([
        getCurrentMonthUsage(admin, companyId, featureKey),
        getPlanMonthlyLimit(admin, companyId, featureKey),
    ]);

    const nextUsed = used + Math.max(0, Math.floor(increment || 0));
    const willOverageBy = limit == null ? 0 : Math.max(0, nextUsed - limit);

    return {
        allowed: true, // por enquanto: não bloqueia (overage é auditável)
        feature_key: featureKey,
        year_month,
        used,
        limit_per_month: limit,
        will_overage_by: willOverageBy,
    };
}

/**
 * Helper opcional pra usar em endpoints: exige feature e lança erro amigável.
 */
export async function requireFeature(
    admin: AdminClient,
    companyId: string,
    featureKey: string
) {
    const ok = await hasFeature(admin, companyId, featureKey);
    if (!ok) {
        throw new Error(`Feature not enabled: ${featureKey}`);
    }
}
