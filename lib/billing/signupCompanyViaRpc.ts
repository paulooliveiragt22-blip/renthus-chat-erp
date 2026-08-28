/**
 * Signup transacional (P0.7): company + owner + pagarme_sub + subscriptions.
 * Auth createUser permanece fora do SQL; invoice Pagar.me após RPC se pay-to-start.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CommercialPlanKey } from "@/lib/billing/planCatalog";
import { createInitialMonthlyInvoice } from "@/lib/billing/createInitialMonthlyInvoice";
import { billingLog } from "@/lib/billing/billingLog";

type Admin = ReturnType<typeof createAdminClient>;

export type SignupCompanyViaRpcInput = {
    authUserId: string;
    companyName: string;
    cnpjDigits: string;
    email: string;
    whatsappDigits: string;
    plan: CommercialPlanKey;
    trialDays: number;
};

export type SignupCompanyViaRpcResult = {
    companyId: string;
    paymentRequired: boolean;
    trialDays: number;
    mode: "trial" | "pending_payment";
};

export async function signupCompanyViaRpc(
    admin: Admin,
    input: SignupCompanyViaRpcInput
): Promise<SignupCompanyViaRpcResult> {
    const whatsapp = input.whatsappDigits.startsWith("55")
        ? input.whatsappDigits
        : `55${input.whatsappDigits}`;

    const { data: companyId, error } = await admin.rpc("rpc_signup_company_with_billing", {
        p_auth_user_id:    input.authUserId,
        p_company_name:    input.companyName.trim(),
        p_cnpj:            input.cnpjDigits,
        p_email:           input.email.trim().toLowerCase(),
        p_whatsapp_phone:  whatsapp,
        p_plan:            input.plan,
        p_trial_days:      input.trialDays,
    });

    if (error || !companyId) {
        throw new Error(error?.message ?? "Erro ao criar empresa (RPC signup)");
    }

    const paymentRequired = input.trialDays === 0;
    const mode = paymentRequired ? "pending_payment" : "trial";

    if (paymentRequired) {
        await createInitialMonthlyInvoice(admin, String(companyId));
    }

    billingLog("signup_billing", mode, {
        company_id: companyId,
        plan:       input.plan,
        trial_days: input.trialDays,
    });

    return {
        companyId: String(companyId),
        paymentRequired,
        trialDays: input.trialDays,
        mode,
    };
}
