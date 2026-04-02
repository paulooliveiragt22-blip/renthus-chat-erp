/**
 * Efeitos colaterais quando o pedido de setup (taxa de ativação) é pago.
 * Usado pelo webhook e pelo signup com cartão tokenizado (aprovação imediata).
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateTrial } from "@/lib/billing/activateTrial";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";

export async function syncLogicalSubscription(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    planKey: string
) {
    if (!companyId || !planKey) return;

    if (planKey !== "bot" && planKey !== "complete") return;

    const { data: planRow, error: planErr } = await admin
        .from("plans")
        .select("id")
        .eq("key", planKey)
        .maybeSingle();

    if (planErr || !planRow?.id) {
        console.warn(
            "[pagarmeSetupPaid] syncLogicalSubscription: plano não encontrado para key=",
            planKey,
            "| err=",
            planErr?.message
        );
        return;
    }

    await admin.from("subscriptions").upsert(
        {
            company_id: companyId,
            plan_id:    planRow.id,
            status:     "active",
            started_at: new Date().toISOString(),
        },
        { onConflict: "company_id" }
    );
}

async function provisionUserAfterPayment(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: string
) {
    const { data: company } = await admin
        .from("companies")
        .select("email, name, onboarding_token, whatsapp_phone")
        .eq("id", companyId)
        .maybeSingle();

    if (!company?.email) {
        console.warn("[pagarmeSetupPaid] Empresa sem email, pulando provisionamento:", companyId);
        return;
    }

    const tempPassword =
        Math.random().toString(36).slice(-8) +
        Math.random().toString(36).slice(-4).toUpperCase() +
        "1!";

    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email:         company.email,
        password:      tempPassword,
        email_confirm: false,
        user_metadata: { company_id: companyId, company_name: company.name },
    });

    if (authErr) {
        console.warn("[pagarmeSetupPaid] createUser:", authErr.message);
    } else if (authData?.user?.id) {
        await admin
            .from("company_users")
            .upsert(
                { company_id: companyId, user_id: authData.user.id, role: "owner" },
                { onConflict: "company_id,user_id" }
            );
        console.log(`[pagarmeSetupPaid] Auth user criado para ${company.email}`);
    }

    const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.renthus.com.br";
    const onboardUrl = `${appUrl}/signup/complete?token=${company.onboarding_token}`;

    const renthusNumber = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";
    await sendBillingNotification(
        renthusNumber,
        `🎉 *Novo cliente!*\n\n` +
            `Empresa: ${company.name}\n` +
            `Email: ${company.email}\n` +
            `Plano: ${plan}\n` +
            `WhatsApp: ${company.whatsapp_phone ?? "-"}\n\n` +
            `Link onboarding: ${onboardUrl}`
    );
}

/**
 * Se existir setup_payment pendente para este order.id, marca pago e ativa trial.
 * @returns true se tratou como setup pago
 */
export async function processSetupOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    order: { id?: string; customer?: { id?: string } }
): Promise<boolean> {
    const orderId = order?.id as string;
    if (!orderId) return false;

    const { data: sp } = await admin
        .from("setup_payments")
        .select("id, plan, company_id")
        .eq("pagarme_order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!sp?.company_id) return false;

    const companyId = sp.company_id as string;

    await admin
        .from("setup_payments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", sp.id);

    const { data: existingSub } = await admin
        .from("pagarme_subscriptions")
        .select("id, status")
        .eq("company_id", companyId)
        .maybeSingle();

        const st = existingSub?.status as string | undefined;
        if (!existingSub || st === "cancelled" || st === "pending_setup") {
            const pagarmeCustomerId: string = order?.customer?.id ?? "";
            await activateTrial(
                admin,
                companyId,
                sp.plan as "bot" | "complete",
                pagarmeCustomerId
            );
            console.log(`[pagarmeSetupPaid] Trial ativado para empresa ${companyId} (plano ${sp.plan})`);
        }

    await syncLogicalSubscription(admin, companyId, sp.plan as string);
    await provisionUserAfterPayment(admin, companyId, sp.plan as string);
    return true;
}
