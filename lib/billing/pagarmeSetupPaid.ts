/**
 * Efeitos colaterais quando o pedido de setup (taxa de ativação) é pago.
 * Usado pelo webhook e pelo signup com cartão tokenizado (aprovação imediata).
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateTrial } from "@/lib/billing/activateTrial";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";
import { computeNextBillingAt } from "@/lib/billing/computeNextBillingAt";

export async function syncLogicalSubscription(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    planKey: string
) {
    if (!companyId || !planKey) return;

    // pagarme_subscriptions usa 'bot'/'complete'; plans table usa 'starter'/'pro'
    const mappedKey =
        planKey === "bot"      ? "starter" :
        planKey === "complete" ? "pro"     :
        planKey;

    if (mappedKey !== "starter" && mappedKey !== "pro") return;

    const { data: planRow, error: planErr } = await admin
        .from("plans")
        .select("id")
        .eq("key", mappedKey)
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

    const { count: linkedUsers, error: cuCountErr } = await admin
        .from("company_users")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId);

    if (!cuCountErr && (linkedUsers ?? 0) > 0) {
        const renthusNumber = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";
        await sendBillingNotification(
            renthusNumber,
            `✅ *Pagamento de ativação confirmado*\n\n` +
                `Empresa: ${company.name}\n` +
                `Email: ${company.email}\n` +
                `Plano: ${plan}\n` +
                `WhatsApp: ${company.whatsapp_phone ?? "-"}\n\n` +
                `Conta já existente (trial/cadastro direto) — sem link de senha/onboarding.`
        );
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
 * Ativa a assinatura após pagamento do setup:
 * - Se já existe sub → atualiza para active + define next_billing_at
 * - Se não existe sub → cria nova como active
 */
export async function activateAfterSetupPayment(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: "bot" | "complete",
    pagarmeCustomerId?: string
): Promise<void> {
    const paidAt        = new Date();
    const nextBillingAt = computeNextBillingAt(paidAt);

    const patch: Record<string, unknown> = {
        plan,
        status:          "active",
        last_paid_at:    paidAt.toISOString(),
        next_billing_at: nextBillingAt.toISOString(),
        activated_at:    paidAt.toISOString(),
    };
    if (pagarmeCustomerId) patch.pagarme_customer_id = pagarmeCustomerId;

    const { data: existingSub } = await admin
        .from("pagarme_subscriptions")
        .select("id")
        .eq("company_id", companyId)
        .maybeSingle();

    if (existingSub) {
        await admin
            .from("pagarme_subscriptions")
            .update(patch)
            .eq("id", existingSub.id);
    } else {
        await admin.from("pagarme_subscriptions").insert({
            company_id:    companyId,
            trial_ends_at: paidAt.toISOString(), // sem trial residual
            ...patch,
        });
    }

    await admin.from("companies").update({ is_active: true }).eq("id", companyId);
    console.log(`[pagarmeSetupPaid] Subscription ativada para empresa ${companyId} | plano=${plan} | next=${nextBillingAt.toISOString()}`);
}

/**
 * Se existir setup_payment pendente para este order.id, marca pago e ativa subscription.
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

    const companyId         = sp.company_id as string;
    const pagarmeCustomerId = (order?.customer?.id as string | undefined) ?? undefined;

    await admin
        .from("setup_payments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", sp.id);

    await activateAfterSetupPayment(admin, companyId, sp.plan as "bot" | "complete", pagarmeCustomerId);
    await syncLogicalSubscription(admin, companyId, sp.plan as string);
    await provisionUserAfterPayment(admin, companyId, sp.plan as string);
    return true;
}
