/**
 * Agenda downgrade para fim do ciclo (BN-12 / R3-4).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    normalizePlanKey,
    parseCommercialPlanInput,
    planRank,
    PLAN_CATALOG,
    type CommercialPlanKey,
} from "@/lib/billing/planCatalog";
import { validateKeepUserSelection } from "@/lib/billing/validateKeepUserSelection";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";

export type ScheduleDowngradeResult =
    | {
          ok: true;
          action: "scheduled";
          pending_plan_key: CommercialPlanKey;
          pending_plan_change_at: string;
          keep_user_ids: string[];
      }
    | { ok: false; error: string; status: number };

export async function scheduleDowngrade(
    admin: SupabaseClient,
    companyId: string,
    input: { plan: string; keep_user_ids?: string[] }
): Promise<ScheduleDowngradeResult> {
    const target = parseCommercialPlanInput(input.plan);
    if (!target) {
        return { ok: false, error: "Plano inválido.", status: 400 };
    }

    const { data: sub, error } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, next_billing_at, pending_plan_key, pending_plan_change_at, pending_keep_user_ids"
        )
        .eq("company_id", companyId)
        .maybeSingle();
    if (error) return { ok: false, error: error.message, status: 500 };
    if (!sub?.id) return { ok: false, error: "Assinatura não encontrada.", status: 404 };

    const st = String(sub.status ?? "");
    if (st !== "active") {
        return {
            ok: false,
            error: "Downgrade agendado só para assinatura ativa.",
            status: 400,
        };
    }

    const current = normalizePlanKey(String(sub.plan ?? ""));
    if (!current) {
        return { ok: false, error: "Plano atual inválido.", status: 400 };
    }
    if (planRank(target) >= planRank(current)) {
        return {
            ok: false,
            error: "Use o fluxo de upgrade para subir de plano.",
            status: 400,
        };
    }

    const nextAt = sub.next_billing_at ? String(sub.next_billing_at) : null;
    if (!nextAt) {
        return {
            ok: false,
            error: "Sem data de próximo vencimento — não é possível agendar.",
            status: 400,
        };
    }

    const pricing = await loadPlanPricing(admin, target);
    const targetIncluded = pricing.includedSeats || PLAN_CATALOG[target].includedSeats;

    const { data: members, error: memErr } = await admin
        .from("company_users")
        .select("user_id, role, is_active")
        .eq("company_id", companyId);
    if (memErr) return { ok: false, error: memErr.message, status: 500 };

    const activeMembers = (members ?? []).map((m) => ({
        user_id: String(m.user_id),
        role: String(m.role ?? "member"),
        is_active: m.is_active !== false,
    }));

    const validated = validateKeepUserSelection({
        activeMembers,
        targetIncludedSeats: targetIncluded,
        keepUserIds: input.keep_user_ids,
    });
    if (!validated.ok) {
        return { ok: false, error: validated.error, status: 400 };
    }

    const { error: upErr } = await admin
        .from("pagarme_subscriptions")
        .update({
            pending_plan_key: target,
            pending_plan_change_at: nextAt,
            pending_keep_user_ids: validated.keep_user_ids,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
    if (upErr) return { ok: false, error: upErr.message, status: 500 };

    return {
        ok: true,
        action: "scheduled",
        pending_plan_key: target,
        pending_plan_change_at: nextAt,
        keep_user_ids: validated.keep_user_ids,
    };
}

export async function cancelPendingPlanChange(
    admin: SupabaseClient,
    companyId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    const { data: sub, error } = await admin
        .from("pagarme_subscriptions")
        .select("id, pending_plan_key")
        .eq("company_id", companyId)
        .maybeSingle();
    if (error) return { ok: false, error: error.message, status: 500 };
    if (!sub?.id) return { ok: false, error: "Assinatura não encontrada.", status: 404 };
    if (!sub.pending_plan_key) {
        return { ok: false, error: "Não há downgrade agendado.", status: 400 };
    }

    const { error: upErr } = await admin
        .from("pagarme_subscriptions")
        .update({
            pending_plan_key: null,
            pending_plan_change_at: null,
            pending_keep_user_ids: null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
    if (upErr) return { ok: false, error: upErr.message, status: 500 };
    return { ok: true };
}

// re-export puro
export { effectiveChargePlanKey } from "@/lib/billing/validateKeepUserSelection";
