/**
 * Gate inbound WA/Meta/chatbot: companies.is_active + TenantAccess (paywall).
 * Fail-closed em erro de leitura.
 * Exceção: quando a empresa já escolheu um plano (plan_intent) e o status é pending_payment,
 * o inbound é liberado — mensagens de clientes reais devem fluir mesmo antes do pagamento,
 * para não perder vendas e atender o cliente enquanto o dono regulariza a assinatura.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTenantAccess } from "@/lib/billing/tenantAccess";
import type { PagarmeSubSnapshot } from "@/lib/billing/resolveBillingAccess";

export type InboundChannelGateResult =
    | { allowed: true }
    | { allowed: false; reason: string };

/** Puro — testável sem I/O. */
export function resolveInboundFromSnapshots(
    companyActive: boolean | null | undefined,
    sub: PagarmeSubSnapshot | null,
    now: Date = new Date()
): InboundChannelGateResult {
    if (companyActive !== true) {
        return { allowed: false, reason: "company_inactive" };
    }
    // Se a empresa já escolheu um plano (plan_intent) mas ainda não pagou,
    // permitimos o inbound para que mensagens de clientes reais possam chegar.
    const hasPlan = sub?.plan != null && String(sub.plan).trim() !== "";
    if (hasPlan && sub?.status === "pending_payment") {
        return { allowed: true };
    }
    const access = resolveTenantAccess(sub, now);
    if (access.access !== "allow") {
        return { allowed: false, reason: access.reason };
    }
    return { allowed: true };
}

export async function canProcessInboundChannel(
    admin: SupabaseClient,
    companyId: string,
    now: Date = new Date()
): Promise<InboundChannelGateResult> {
    const [{ data: company, error: cErr }, { data: sub, error: sErr }] = await Promise.all([
        admin.from("companies").select("is_active").eq("id", companyId).maybeSingle(),
        admin
            .from("pagarme_subscriptions")
            .select("status, trial_ends_at, last_paid_at, plan")
            .eq("company_id", companyId)
            .maybeSingle(),
    ]);

    if (cErr || sErr) {
        return { allowed: false, reason: "gate_read_error" };
    }

    return resolveInboundFromSnapshots(
        company?.is_active as boolean | null | undefined,
        (sub as PagarmeSubSnapshot | null) ?? null,
        now
    );
}
