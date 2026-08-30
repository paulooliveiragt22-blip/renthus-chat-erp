/**
 * Gate inbound WA/Meta/chatbot: companies.is_active + TenantAccess (paywall).
 * Fail-closed em erro de leitura.
 * Exceção 1: quando a empresa já escolheu um plano (plan_intent) e o status é pending_payment,
 * o inbound é liberado — mensagens de clientes reais devem fluir mesmo antes do pagamento,
 * para não perder vendas e atender o cliente enquanto o dono regulariza a assinatura.
 * Exceção 2: status=abandoned também libera inbound, mas com flag autoReply="reactivation"
 * para que o handler envie o template WA de reativação e NÃO processe com LLM.
 *   (substitui o comportamento antigo em que inbound era bloqueado — agora aproveitamos
 *    o tráfego de clientes para reativar a empresa via template pré-aprovado pela Meta.)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTenantAccess } from "@/lib/billing/tenantAccess";
import type { PagarmeSubSnapshot } from "@/lib/billing/resolveBillingAccess";

export type InboundChannelGateResult =
    | { allowed: true }
    | { allowed: true; autoReply: "reactivation" }
    | { allowed: false; reason: string };

/** Puro — testável sem I/O. */
export function resolveInboundFromSnapshots(
    companyActive: boolean | null | undefined,
    sub: PagarmeSubSnapshot | null,
    now: Date = new Date()
): InboundChannelGateResult {
    // Exceção: abandoned — libera inbound para receber template de reativação.
    // O inbound flui mesmo com is_active=false (abandoned não tem mais is_active=true).
    const raw = sub?.status != null ? String(sub.status).toLowerCase() : "";
    if (raw === "abandoned") {
        return { allowed: true, autoReply: "reactivation" };
    }

    if (companyActive !== true) {
        return { allowed: false, reason: "company_inactive" };
    }
    // Se a empresa já escolheu um plano (plan_intent) mas ainda não pagou,
    // permitimos o inbound para que mensagens de clientes reais possam chegar.
    const hasPlan = sub?.plan != null && String(sub.plan).trim() !== "";
    if (hasPlan && (raw === "pending_payment" || raw === "pending_setup")) {
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
