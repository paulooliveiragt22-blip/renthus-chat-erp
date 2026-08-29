/**
 * Platform ops — tenants never-paid (cadastrados sem pagamento).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import { ensureFirstInvoice } from "@/lib/billing/ensureFirstInvoice";

const NEVER_PAID_STATUSES = ["pending_payment", "pending_setup", "blocked"] as const;

export type NeverPaidTenantRow = {
    companyId: string;
    companyName: string;
    email: string | null;
    cnpj: string | null;
    whatsappPhone: string | null;
    isActive: boolean;
    companyCreatedAt: string | null;
    pagarmeSubscriptionId: string;
    plan: string;
    billingStatus: string;
    trialEndsAt: string | null;
    pendingInvoice: {
        id: string;
        amount: number;
        dueAt: string;
        hasPix: boolean;
        pixQrCode: string | null;
        paymentUrl: string | null;
    } | null;
};

export type ListNeverPaidTenantsResult = {
    tenants: NeverPaidTenantRow[];
    total: number;
    page: number;
    limit: number;
};

export async function listNeverPaidTenants(
    admin: SupabaseClient,
    opts: { page: number; limit: number }
): Promise<ListNeverPaidTenantsResult> {
    const page = Math.max(0, opts.page);
    const limit = Math.min(100, Math.max(1, opts.limit));
    const from = page * limit;
    const to = from + limit - 1;

    const { data: rows, error, count } = await admin
        .from("pagarme_subscriptions")
        .select(
            `
            id,
            company_id,
            plan,
            status,
            trial_ends_at,
            companies (
              id,
              name,
              nome_fantasia,
              email,
              cnpj,
              whatsapp_phone,
              is_active,
              created_at
            )
        `,
            { count: "exact" }
        )
        .is("last_paid_at", null)
        .in("status", [...NEVER_PAID_STATUSES])
        .order("created_at", { ascending: false })
        .range(from, to);

    if (error) throw new Error(error.message);

    const companyIds = (rows ?? []).map((r) => r.company_id as string);
    const invoiceByCompany = new Map<string, NeverPaidTenantRow["pendingInvoice"]>();

    if (companyIds.length > 0) {
        const { data: invoices } = await admin
            .from("invoices")
            .select("id, company_id, amount, due_at, pix_qr_code, pagarme_payment_url")
            .in("company_id", companyIds)
            .eq("status", "pending");

        for (const inv of invoices ?? []) {
            const pix = typeof inv.pix_qr_code === "string" ? inv.pix_qr_code : null;
            invoiceByCompany.set(inv.company_id as string, {
                id: inv.id as string,
                amount: Number(inv.amount),
                dueAt: inv.due_at as string,
                hasPix: Boolean(pix?.trim()),
                pixQrCode: pix,
                paymentUrl:
                    typeof inv.pagarme_payment_url === "string" ? inv.pagarme_payment_url : null,
            });
        }
    }

    const tenants: NeverPaidTenantRow[] = (rows ?? []).map((r) => {
        const c = r.companies as {
            name?: string | null;
            nome_fantasia?: string | null;
            email?: string | null;
            cnpj?: string | null;
            whatsapp_phone?: string | null;
            is_active?: boolean | null;
            created_at?: string | null;
        } | null;
        const companyId = r.company_id as string;
        return {
            companyId,
            companyName: (c?.nome_fantasia ?? c?.name ?? "").trim() || "—",
            email: c?.email ?? null,
            cnpj: c?.cnpj ?? null,
            whatsappPhone: c?.whatsapp_phone ?? null,
            isActive: Boolean(c?.is_active),
            companyCreatedAt: c?.created_at ?? null,
            pagarmeSubscriptionId: r.id as string,
            plan: String(r.plan ?? ""),
            billingStatus: String(r.status ?? ""),
            trialEndsAt: (r.trial_ends_at as string | null) ?? null,
            pendingInvoice: invoiceByCompany.get(companyId) ?? null,
        };
    });

    return {
        tenants,
        total: count ?? tenants.length,
        page,
        limit,
    };
}

export type CourtesyPlanKey = "essencial" | "pro" | "market";

const ALLOWED_COURTESY_PLANS: ReadonlySet<CourtesyPlanKey> = new Set([
    "essencial",
    "pro",
    "market",
]);

export async function grantCourtesyTrial(
    admin: SupabaseClient,
    actor: PlatformActor,
    audit: {
        requestId: string;
        ipAddress: string;
        userAgent: string | null;
    },
    params: { companyId: string; days: number; planKey: string; reason?: string }
): Promise<{ trialEndsAt: string; planKey: CourtesyPlanKey }> {
    const days = Math.floor(params.days);
    if (days < 1 || days > 30) {
        throw new Error("courtesy_trial_days_invalid");
    }

    const planKey = String(params.planKey ?? "").trim().toLowerCase() as CourtesyPlanKey;
    if (!ALLOWED_COURTESY_PLANS.has(planKey)) {
        throw new Error("courtesy_trial_plan_invalid");
    }

    const { data: trialEndsAt, error } = await admin.rpc("rpc_platform_grant_courtesy_trial", {
        p_company_id: params.companyId,
        p_days: days,
        p_plan_key: planKey,
        p_actor_id: actor.id,
        p_actor_email: actor.email,
        p_actor_role: actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: params.reason?.trim() ?? "",
    });

    if (error) throw new Error(error.message);
    if (!trialEndsAt) throw new Error("courtesy_trial_failed");

    return { trialEndsAt: String(trialEndsAt), planKey };
}

export async function ensureTenantCheckout(
    admin: SupabaseClient,
    actor: PlatformActor,
    audit: {
        requestId: string;
        ipAddress: string;
        userAgent: string | null;
    },
    companyId: string
): Promise<{ invoiceId: string | null; pixCode: string | null }> {
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select("id, status, last_paid_at")
        .eq("company_id", companyId)
        .maybeSingle();

    if (!sub?.id) throw new Error("pagarme_subscription_not_found");
    if (sub.last_paid_at) throw new Error("company_already_paid");
    if (
        sub.status !== "pending_payment" &&
        sub.status !== "pending_setup" &&
        sub.status !== "blocked"
    ) {
        throw new Error("status_not_eligible_for_checkout");
    }

    const result = await ensureFirstInvoice(admin, companyId);

    await recordPlatformAudit({
        admin,
        actor,
        action: "platform.billing.checkout_ensured",
        resourceType: "company",
        resourceId: companyId,
        companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: {
            invoice_id: result.invoiceId,
            has_pix: Boolean(result.pixCode),
        },
        outcome: "success",
    });

    return result;
}
