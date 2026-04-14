import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

type RuleInput = {
    neighborhood: string;
    is_served: boolean;
    fee_override?: number | null;
    min_order_override?: number | null;
    eta_override_min?: number | null;
    is_active?: boolean;
};

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const admin = createAdminClient();
    const companyId = ctx.companyId;

    const { data: company } = await admin
        .from("companies")
        .select("id, cidade, uf, delivery_fee_enabled, default_delivery_fee, settings")
        .eq("id", companyId)
        .maybeSingle();

    const { data: policy } = await admin
        .from("company_delivery_policy")
        .select("service_city, service_state, service_by_zone, default_mode")
        .eq("company_id", companyId)
        .maybeSingle();

    const serviceCity = (policy?.service_city as string | null) ?? (company?.cidade as string | null) ?? "";
    const serviceState = (policy?.service_state as string | null) ?? (company?.uf as string | null) ?? "";
    const { data: rules } = await admin
        .from("company_delivery_neighborhood_rules")
        .select("id, neighborhood, is_served, fee_override, min_order_override, eta_override_min, is_active")
        .eq("company_id", companyId)
        .eq("city", serviceCity || "")
        .order("neighborhood");

    const { data: catalog } = await admin
        .from("city_neighborhoods")
        .select("neighborhood")
        .eq("city", serviceCity || "")
        .eq("state", serviceState || "")
        .order("neighborhood");

    return NextResponse.json({
        company: company ?? null,
        policy: {
            service_city: serviceCity,
            service_state: serviceState,
            service_by_zone: Boolean(policy?.service_by_zone),
            default_mode: (policy?.default_mode as string | null) ?? "all_city",
        },
        rules: rules ?? [],
        city_neighborhoods: (catalog ?? []).map((n) => String(n.neighborhood ?? "")).filter(Boolean),
    });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const admin = createAdminClient();
    const companyId = ctx.companyId;

    const serviceCity = String(body.service_city ?? "").trim();
    const serviceState = String(body.service_state ?? "").trim().toUpperCase();
    const serviceByZone = Boolean(body.service_by_zone);
    const defaultModeRaw = String(body.default_mode ?? "all_city").trim();
    const defaultMode = (defaultModeRaw === "allow_list" || defaultModeRaw === "deny_list")
        ? defaultModeRaw
        : "all_city";
    const rulesInput = (Array.isArray(body.rules) ? body.rules : []) as RuleInput[];

    const defaultDeliveryFee = body.default_delivery_fee != null ? Number(body.default_delivery_fee) : null;
    const deliveryEnabled = body.delivery_fee_enabled != null ? Boolean(body.delivery_fee_enabled) : null;
    const deliveryMinOrder = body.delivery_min_order != null ? Number(body.delivery_min_order) : null;
    const deliveryEstMinutes = body.delivery_est_minutes != null ? Number(body.delivery_est_minutes) : null;
    const deliveryRadiusKm = body.delivery_radius_km != null ? Number(body.delivery_radius_km) : null;
    const deliveryFreeAbove = body.delivery_free_above != null ? Number(body.delivery_free_above) : null;

    const { data: currentCompany } = await admin
        .from("companies")
        .select("settings")
        .eq("id", companyId)
        .maybeSingle();
    const mergedSettings = {
        ...((currentCompany?.settings ?? {}) as Record<string, unknown>),
        delivery_min_order: Number.isFinite(deliveryMinOrder) ? deliveryMinOrder : null,
        delivery_est_minutes: Number.isFinite(deliveryEstMinutes) ? deliveryEstMinutes : null,
        delivery_radius_km: Number.isFinite(deliveryRadiusKm) ? deliveryRadiusKm : null,
        delivery_free_above: Number.isFinite(deliveryFreeAbove) ? deliveryFreeAbove : null,
    };

    const companyPatch: Record<string, unknown> = {
        settings: mergedSettings,
    };
    if (serviceCity) companyPatch.cidade = serviceCity;
    if (serviceState) companyPatch.uf = serviceState;
    if (Number.isFinite(defaultDeliveryFee)) companyPatch.default_delivery_fee = defaultDeliveryFee;
    if (deliveryEnabled != null) companyPatch.delivery_fee_enabled = deliveryEnabled;

    const { error: companyErr } = await admin
        .from("companies")
        .update(companyPatch)
        .eq("id", companyId);
    if (companyErr) return NextResponse.json({ error: companyErr.message }, { status: 500 });

    const { error: policyErr } = await admin
        .from("company_delivery_policy")
        .upsert({
            company_id: companyId,
            service_city: serviceCity || null,
            service_state: serviceState || null,
            service_by_zone: serviceByZone,
            default_mode: defaultMode,
            updated_at: new Date().toISOString(),
        });
    if (policyErr) return NextResponse.json({ error: policyErr.message }, { status: 500 });

    const { error: delErr } = await admin
        .from("company_delivery_neighborhood_rules")
        .delete()
        .eq("company_id", companyId)
        .eq("city", serviceCity || "");
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    const cleaned = rulesInput
        .map((r) => ({
            company_id: companyId,
            city: serviceCity || "",
            neighborhood: String(r.neighborhood ?? "").trim(),
            is_served: Boolean(r.is_served),
            fee_override: r.fee_override != null && Number.isFinite(Number(r.fee_override)) ? Number(r.fee_override) : null,
            min_order_override: r.min_order_override != null && Number.isFinite(Number(r.min_order_override)) ? Number(r.min_order_override) : null,
            eta_override_min: r.eta_override_min != null && Number.isFinite(Number(r.eta_override_min)) ? Math.floor(Number(r.eta_override_min)) : null,
            is_active: r.is_active !== false,
        }))
        .filter((r) => r.neighborhood.length > 0);

    if (cleaned.length) {
        const { error: insErr } = await admin.from("company_delivery_neighborhood_rules").insert(cleaned);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
