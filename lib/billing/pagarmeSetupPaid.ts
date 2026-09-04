/**
 * Efeitos colaterais quando o pedido de setup (taxa de ativação) é pago.
 * Usado pelo webhook e pelo signup com cartão tokenizado (aprovação imediata).
 */

import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";
import { normalizePlanKey } from "@/lib/billing/planCatalog";

const TEMP_PW_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Senha temporária com entropia criptográfica + rejection sampling (sem bias de módulo). */
function generateTempPassword(): string {
    const out: string[] = [];
    while (out.length < 12) {
        const bytes = randomBytes(32);
        for (const b of bytes) {
            if (b >= 256 - (256 % TEMP_PW_ALPHABET.length)) continue;
            out.push(TEMP_PW_ALPHABET.charAt(b % TEMP_PW_ALPHABET.length));
            if (out.length >= 12) break;
        }
    }
    const s = out.join("");
    return s.slice(0, 8) + s.slice(8, 12).toUpperCase() + "1!";
}

export async function syncLogicalSubscription(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    planKey: string
) {
    if (!companyId || !planKey) return;

    const mappedKey = normalizePlanKey(planKey);
    if (!mappedKey) return;

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

    await admin.from("pagarme_subscriptions").upsert(
        {
            company_id: companyId,
            plan_id:    planRow.id,
            plan:       mappedKey as never,
            plan_key:   mappedKey,
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
        .select("email, name, whatsapp_phone")
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
            companyId,
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

    const tempPassword = generateTempPassword();

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
    const loginUrl   = `${appUrl}/login`;

    const renthusNumber = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";
    await sendBillingNotification(
        companyId,
        renthusNumber,
        `🎉 *Novo cliente!*\n\n` +
            `Empresa: ${company.name}\n` +
            `Email: ${company.email}\n` +
            `Plano: ${plan}\n` +
            `WhatsApp: ${company.whatsapp_phone ?? "-"}\n\n` +
            `Login: ${loginUrl}\n` +
            `Onboarding: ${appUrl}/ativar`
    );
}

/**
 * Ativa a assinatura após pagamento do setup:
 * - Se já existe sub → atualiza para active + define next_billing_at
 * - Se não existe sub → cria nova como active
 */
export async function provisionUserAfterPaymentIfNeeded(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: string
): Promise<void> {
    await provisionUserAfterPayment(admin, companyId, plan);
}

/**
 * Ativa a assinatura após pagamento do setup:
 * - Se já existe sub → atualiza para active + define next_billing_at
 * - Se não existe sub → cria nova como active
 */
export async function activateAfterSetupPayment(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    plan: string,
    pagarmeCustomerId?: string
): Promise<void> {
    const paidAt = new Date();

    const { data: existingSub } = await admin
        .from("pagarme_subscriptions")
        .select("id, billing_period")
        .eq("company_id", companyId)
        .maybeSingle();

    // next_billing_at period-aware pelo banco (ADR-0006 D10 / governanca Regra 2)
    const period = String(existingSub?.billing_period ?? "month");
    const { data: nextDue, error: nextErr } = await admin.rpc("fn_billing_next_due", {
        p_paid_at: paidAt.toISOString(),
        p_period: period,
    });
    if (nextErr) throw new Error(nextErr.message);
    const nextBillingAt = new Date(String(nextDue));

    const patch: Record<string, unknown> = {
        plan,
        status:          "active",
        last_paid_at:    paidAt.toISOString(),
        next_billing_at: nextBillingAt.toISOString(),
        activated_at:    paidAt.toISOString(),
    };
    if (pagarmeCustomerId) patch.pagarme_customer_id = pagarmeCustomerId;

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
 * Se existir invoice de setup para este order.id, marca pago e ativa subscription.
 * @returns true se tratou como setup pago
 */
export async function processSetupOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    order: { id?: string; customer?: { id?: string }; metadata?: Record<string, string> }
): Promise<boolean> {
    const orderId = order?.id;
    if (!orderId) return false;

    const { data: setupInvoice } = await admin
        .from("invoices")
        .select("id")
        .eq("pagarme_order_id", orderId)
        .eq("kind", "setup")
        .limit(1)
        .maybeSingle();
    if (!setupInvoice) return false;

    const { fulfillPayment } = await import("@/lib/billing/fulfillPayment");
    const r = await fulfillPayment(admin, {
        id: orderId,
        metadata: { ...(order.metadata ?? {}), type: "setup" },
        customer: order.customer,
    });
    return r.kind === "setup";
}
