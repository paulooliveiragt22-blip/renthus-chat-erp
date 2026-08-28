/**
 * POST /api/billing/signup
 *
 * Cadastro inicial: cria empresa + usuário + billing (trial N dias ou pay-to-start se N=0).
 * Dias de trial: platform_billing_settings.default_trial_days (default 0).
 *
 * Body: {
 *   company_name, cnpj, whatsapp, email, plan: 'essencial' | 'pro' | 'market',
 *   password (mín. 8), password_confirm
 * }
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startBillingAfterSignup } from "@/lib/billing/startBillingAfterSignup";
import { getDefaultTrialDays } from "@/lib/billing/getDefaultTrialDays";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";
import { parseCommercialPlanInput, getPlanLabel } from "@/lib/billing/planCatalog";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_15M_MS,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const RENTHUS_PHONE = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";
const BILLING_SIGNUP_RATE_LIMIT = 10;

export async function POST(req: Request) {
    try {
        const limited = await enforceIpRateLimitAsync(
            req,
            "billing_signup",
            BILLING_SIGNUP_RATE_LIMIT,
            RATE_LIMIT_WINDOW_15M_MS
        );
        if (limited) return limited;

        const body = (await req.json()) as {
            company_name?:     string;
            cnpj?:             string;
            whatsapp?:         string;
            email?:            string;
            plan?:             string;
            password?:         string;
            password_confirm?: string;
        };

        const { company_name, cnpj, whatsapp, email, plan } = body;
        const password = body.password ?? "";
        const passwordConfirm = body.password_confirm ?? "";

        if (!company_name || !cnpj || !whatsapp || !email || !plan) {
            return NextResponse.json(
                { error: "Campos obrigatórios: company_name, cnpj, whatsapp, email, plan" },
                { status: 400 }
            );
        }

        if (password.length < 8) {
            return NextResponse.json(
                { error: "A senha deve ter no mínimo 8 caracteres" },
                { status: 400 }
            );
        }

        if (password !== passwordConfirm) {
            return NextResponse.json({ error: "As senhas não coincidem" }, { status: 400 });
        }

        const planKey = parseCommercialPlanInput(plan);
        if (!planKey) {
            return NextResponse.json(
                { error: "Plano inválido. Use 'essencial', 'pro' ou 'market'" },
                { status: 400 }
            );
        }

        const cnpjDigits = cnpj.replaceAll(/\D/g, "");
        if (cnpjDigits.length !== 14) {
            return NextResponse.json({ error: "CNPJ inválido" }, { status: 400 });
        }

        const emailNorm = email.trim().toLowerCase();
        const whatsappDigits = whatsapp.replaceAll(/\D/g, "");
        if (whatsappDigits.length < 10) {
            return NextResponse.json({ error: "WhatsApp inválido" }, { status: 400 });
        }

        const admin = createAdminClient();

        const { data: dupMeta } = await admin
            .from("companies")
            .select("id")
            .eq("meta->>cnpj", cnpjDigits)
            .maybeSingle();

        const { data: dupCol } = await admin
            .from("companies")
            .select("id")
            .eq("cnpj", cnpjDigits)
            .maybeSingle();

        const existingId = dupMeta?.id ?? dupCol?.id;
        if (existingId) {
            const { data: sub } = await admin
                .from("pagarme_subscriptions")
                .select("status")
                .eq("company_id", existingId)
                .maybeSingle();

            if (sub && sub.status !== "cancelled") {
                return NextResponse.json(
                    { error: "Este CNPJ já possui cadastro. Faça login ou fale com o suporte." },
                    { status: 409 }
                );
            }
        }

        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
            email:         emailNorm,
            password,
            email_confirm: true,
            user_metadata: { company_name: company_name.trim() },
        });

        if (authErr || !authData?.user?.id) {
            const msg = authErr?.message ?? "Não foi possível criar o usuário";
            if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
                return NextResponse.json(
                    { error: "Este e-mail já está cadastrado. Use outro ou faça login." },
                    { status: 409 }
                );
            }
            console.error("[signup] createUser:", msg);
            return NextResponse.json({ error: msg }, { status: 400 });
        }

        const userId = authData.user.id;

        const nowIso = new Date().toISOString();
        const trimmedName = company_name.trim();
        const trialDays = await getDefaultTrialDays(admin);
        const paymentRequired = trialDays === 0;

        const { data: newCompany, error: compErr } = await admin
            .from("companies")
            .insert({
                nome_fantasia:  trimmedName,
                cnpj:           cnpjDigits,
                name:           trimmedName,
                email:          emailNorm,
                whatsapp_phone: whatsappDigits.startsWith("55") ? whatsappDigits : `55${whatsappDigits}`,
                meta:           { cnpj: cnpjDigits },
                is_active:      !paymentRequired,
                senha_definida: true,
                onboarding_completed_at: paymentRequired ? null : nowIso,
            })
            .select("id")
            .single();

        if (compErr || !newCompany) {
            await admin.auth.admin.deleteUser(userId);
            console.error("[signup] Erro ao criar empresa:", compErr?.message);
            return NextResponse.json(
                { error: compErr?.message ?? "Erro ao criar empresa" },
                { status: 500 }
            );
        }

        const companyId = newCompany.id;

        const { error: linkErr } = await admin.from("company_users").insert({
            company_id: companyId,
            user_id:    userId,
            role:       "owner",
        });

        if (linkErr) {
            await admin.from("companies").delete().eq("id", companyId);
            await admin.auth.admin.deleteUser(userId);
            console.error("[signup] company_users:", linkErr.message);
            return NextResponse.json({ error: "Erro ao vincular usuário à empresa" }, { status: 500 });
        }

        const billing = await startBillingAfterSignup(admin, companyId, planKey, trialDays);

        if (!billing.paymentRequired) {
            await syncLogicalSubscription(admin, companyId, planKey);
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.renthus.com.br";
        const cadastroLabel = billing.paymentRequired
            ? "Novo cadastro (aguardando pagamento)"
            : `Novo cadastro (trial ${billing.trialDays}d)`;
        await sendBillingNotification(
            companyId,
            RENTHUS_PHONE,
            `🆕 *${cadastroLabel}*\n\n` +
                `Empresa: ${trimmedName}\n` +
                `Email: ${emailNorm}\n` +
                `Plano: ${getPlanLabel(planKey)}\n` +
                `WhatsApp: ${whatsappDigits}\n\n` +
                `Login: ${appUrl}/login`
        );

        return NextResponse.json({
            ok:                true,
            company_id:        companyId,
            payment_required:  billing.paymentRequired,
            trial_days:        billing.trialDays,
            message:           billing.paymentRequired
                ? "Cadastro criado. Faça login e conclua o pagamento para acessar o sistema."
                : "Cadastro criado. Faça login para acessar o sistema.",
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[signup] ERRO:", err);
        return NextResponse.json(
            {
                error: msg,
                stack:
                    process.env.NODE_ENV !== "production" && err instanceof Error
                        ? err.stack
                        : undefined,
            },
            { status: 500 }
        );
    }
}
