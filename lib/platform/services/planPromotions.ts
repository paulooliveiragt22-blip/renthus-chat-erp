import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformOpsAuditCtx } from "@/lib/platform/services/platformOps";

export type UpsertPlanPromotionInput = {
    plan_id: string;
    name?: string;
    starts_at: string;
    ends_at: string;
    duration_months: number;
    adjustment_kind: "discount" | "surcharge";
    adjustment_mode: "fixed_brl" | "percent";
    adjustment_value: number;
    active?: boolean;
};

export async function listPlanPromotions(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("plan_promotions")
        .select(
            "id, plan_id, name, starts_at, ends_at, duration_months, adjustment_kind, adjustment_mode, adjustment_value, active, created_at, plans(key, name)"
        )
        .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function upsertPlanPromotion(
    admin: SupabaseClient,
    input: UpsertPlanPromotionInput,
    audit: PlatformOpsAuditCtx,
    id?: string
) {
    if (!input.plan_id?.trim()) throw new Error("plan_id_required");
    if (!input.starts_at || !input.ends_at) throw new Error("window_required");
    if (new Date(input.ends_at) <= new Date(input.starts_at)) throw new Error("window_invalid");
    if (!Number.isInteger(input.duration_months) || input.duration_months < 1) {
        throw new Error("duration_months_invalid");
    }
    if (input.adjustment_kind !== "discount" && input.adjustment_kind !== "surcharge") {
        throw new Error("adjustment_kind_invalid");
    }
    if (input.adjustment_mode !== "fixed_brl" && input.adjustment_mode !== "percent") {
        throw new Error("adjustment_mode_invalid");
    }
    if (!Number.isInteger(input.adjustment_value) || input.adjustment_value < 0) {
        throw new Error("adjustment_value_invalid");
    }

    const row = {
        plan_id: input.plan_id.trim(),
        name: (input.name ?? "").trim(),
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        duration_months: input.duration_months,
        adjustment_kind: input.adjustment_kind,
        adjustment_mode: input.adjustment_mode,
        adjustment_value: input.adjustment_value,
        active: input.active !== false,
        updated_at: new Date().toISOString(),
    };

    const q = id
        ? admin.from("plan_promotions").update(row).eq("id", id)
        : admin.from("plan_promotions").insert(row);

    const { data, error } = await q
        .select(
            "id, plan_id, name, starts_at, ends_at, duration_months, adjustment_kind, adjustment_mode, adjustment_value, active"
        )
        .single();
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.billing.plan_promotion_upserted",
        resourceType: "plan_promotion",
        resourceId: data.id,
        companyId: null,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: { id: data.id, plan_id: data.plan_id, active: data.active },
    });

    return data;
}

/** Kill-switch: desliga/liga promo mesmo antes de ends_at (só bloqueia novas adesões). */
export async function setPlanPromotionActive(
    admin: SupabaseClient,
    promoId: string,
    active: boolean,
    audit: PlatformOpsAuditCtx
) {
    const id = promoId?.trim();
    if (!id) throw new Error("promo_id_required");

    const { data, error } = await admin
        .from("plan_promotions")
        .update({ active: Boolean(active), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(
            "id, plan_id, name, starts_at, ends_at, duration_months, adjustment_kind, adjustment_mode, adjustment_value, active"
        )
        .single();
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.billing.plan_promotion_toggled",
        resourceType: "plan_promotion",
        resourceId: data.id,
        companyId: null,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: { active: data.active, plan_id: data.plan_id },
    });

    return data;
}
