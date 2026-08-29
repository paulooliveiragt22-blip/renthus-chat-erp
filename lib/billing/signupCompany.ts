/**
 * SignupCompany — único use case de cadastro SaaS.
 * Auth createUser fica na rota; este módulo: RPC + fatura best-effort.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CommercialPlanKey } from "@/lib/billing/planCatalog";
import { createInitialMonthlyInvoice } from "@/lib/billing/createInitialMonthlyInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type SignupCompanyInput = {
    authUserId: string;
    companyName: string;
    cnpjDigits: string;
    email: string;
    whatsappDigits: string;
    plan: CommercialPlanKey;
    trialDays: number;
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

    const { data: companyId, error } = await admin.rpc("rpc_signup_company_with_billing", {
        p_auth_user_id:   input.authUserId,
        p_company_name:   input.companyName.trim(),
        p_cnpj:           input.cnpjDigits,
        p_email:          input.email.trim().toLowerCase(),
        p_whatsapp_phone: whatsapp,
        p_plan:           input.plan,
        p_trial_days:     input.trialDays,
    });

    if (error || !companyId) {
        throw new Error(error?.message ?? "Erro ao criar empresa (RPC signup)");
    }

    const paymentRequired = input.trialDays === 0;
    const mode = paymentRequired ? "pending_payment" : "trial";
    let invoiceReady = !paymentRequired;

    if (paymentRequired) {
        try {
            const inv = await createInitialMonthlyInvoice(admin, String(companyId));
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
