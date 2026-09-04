/**
 * SignupCompany — único use case de cadastro SaaS.
 * Auth createUser fica na rota; este módulo: RPC + fatura best-effort.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CommercialPlanKey } from "@/lib/billing/planCatalog";
import { createInitialInvoice } from "@/lib/billing/createInitialInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type BillingPeriod = "month" | "year";

export type SignupCompanyInput = {
    authUserId: string;
    companyName: string;
    cnpjDigits: string;
    email: string;
    whatsappDigits: string;
    plan: CommercialPlanKey;
    trialDays: number;
    /** R2-3 anual: ciclo escolhido no signup (default mensal). */
    billingPeriod?: BillingPeriod;
};

export type SignupCompanyResult = {
    companyId: string;
    paymentRequired: boolean;
    trialDays: number;
    mode: "trial" | "pending_payment";
    /** false se pay-to-start e Pagar.me/invoice falhou — UI regenera no /plano/pagar */
    invoiceReady: boolean;
};

export async function signupCompany(
    admin: Admin,
    input: SignupCompanyInput
): Promise<SignupCompanyResult> {
    const whatsapp = input.whatsappDigits.startsWith("55")
        ? input.whatsappDigits
        : `55${input.whatsappDigits}`;

    const billingPeriod: BillingPeriod = input.billingPeriod === "year" ? "year" : "month";

    const { data: companyId, error } = await admin.rpc("rpc_signup_company_with_billing", {
        p_auth_user_id:   input.authUserId,
        p_company_name:   input.companyName.trim(),
        p_cnpj:           input.cnpjDigits,
        p_email:          input.email.trim().toLowerCase(),
        p_whatsapp_phone: whatsapp,
        p_plan:           input.plan,
        p_trial_days:     input.trialDays,
        p_billing_period: billingPeriod,
    });

    if (error || !companyId) {
        throw new Error(error?.message ?? "Erro ao criar empresa (RPC signup)");
    }

    const paymentRequired = input.trialDays === 0;
    const mode = paymentRequired ? "pending_payment" : "trial";
    let invoiceReady = !paymentRequired;

    if (paymentRequired) {
        try {
            const inv = await createInitialInvoice(admin, String(companyId));
            invoiceReady = Boolean(inv.invoiceId);
            if (!invoiceReady) {
                billingLog("signup_billing", "invoice_not_ready", {
                    company_id: companyId,
                    plan: input.plan,
                });
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            billingLog("signup_billing", "invoice_error", {
                company_id: companyId,
                error: msg,
            });
            invoiceReady = false;
        }
    }

    billingLog("signup_billing", mode, {
        company_id: companyId,
        plan: input.plan,
        billing_period: billingPeriod,
        trial_days: input.trialDays,
        invoice_ready: invoiceReady,
    });

    return {
        companyId: String(companyId),
        paymentRequired,
        trialDays: input.trialDays,
        mode,
        invoiceReady,
    };
}

/** @deprecated use signupCompany */
export async function signupCompanyViaRpc(
    admin: Admin,
    input: SignupCompanyInput
): Promise<SignupCompanyResult> {
    return signupCompany(admin, input);
}

export type {
    SignupCompanyInput as SignupCompanyViaRpcInput,
    SignupCompanyResult as SignupCompanyViaRpcResult,
};
