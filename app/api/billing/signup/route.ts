/**
 * POST /api/billing/signup
 *
 * Rota pública — cria empresa, order de setup no Pagar.me (checkout hosted)
 * e retorna a URL do checkout para abrir no modal.
 *
 * Body: {
 *   company_name:   string
 *   cnpj:           string  (somente dígitos)
 *   whatsapp:       string  (somente dígitos, ex: 5566992071285)
 *   email:          string
 *   plan:           'bot' | 'complete'
 *   payment_method: 'pix' | 'credit_card'  (padrão: 'pix')
 *   installments:   number  (1–10, padrão 1; ignorado para PIX)
 * }
 *
 * Desconto PIX: 5% sobre o valor do setup (SETUP_PIX_DISCOUNT_PCT env var, padrão 5)
 *
 * Retorna: { checkout_url, company_id }
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createCheckoutOrder,
    extractCheckoutUrl,
    getSetupPriceCents,
    getYearlyPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";

export const runtime = "nodejs";

const SUCCESS_URL =
    process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/billing/checkout-success`
        : "https://app.renthus.com.br/billing/checkout-success";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            company_name?:   string;
            cnpj?:           string;
            whatsapp?:       string;
            email?:          string;
            plan?:           string;
            interval?:       string;
            payment_method?: string;
            installments?:   number;
        };

        const { company_name, cnpj, whatsapp, email, plan } = body;
        const interval      = body.interval === "yearly" ? "yearly" : "monthly";
        const paymentMethod = body.payment_method === "credit_card" ? "credit_card" : "pix";
        // Plano anual: sempre à vista (sem parcelamento), sem desconto PIX
        const installments  = interval === "monthly" && paymentMethod === "credit_card"
            ? Math.min(10, Math.max(1, body.installments ?? 1))
            : 1;

        if (!company_name || !cnpj || !whatsapp || !email || !plan) {
            return NextResponse.json(
                { error: "Campos obrigatórios: company_name, cnpj, whatsapp, email, plan" },
                { status: 400 }
            );
        }

        if (!["bot", "complete"].includes(plan)) {
            return NextResponse.json(
                { error: "Plano inválido. Use 'bot' ou 'complete'" },
                { status: 400 }
            );
        }

        const cnpjDigits = cnpj.replace(/\D/g, "");
        if (cnpjDigits.length !== 14) {
            return NextResponse.json({ error: "CNPJ inválido" }, { status: 400 });
        }

        const admin = createAdminClient();

        // 1. Verifica se já existe empresa com esse CNPJ
        const { data: existing } = await admin
            .from("companies")
            .select("id, onboarding_token")
            .eq("meta->cnpj", cnpjDigits)
            .maybeSingle();

        let companyId: string;
        let onboardingToken: string;

        if (existing) {
            companyId       = existing.id;
            onboardingToken = existing.onboarding_token;
        } else {
            // 2. Cria empresa (sem usuário vinculado — será vinculado no onboarding pós-pagamento)
            const { data: newCompany, error: compErr } = await admin
                .from("companies")
                .insert({
                    name:           company_name.trim(),
                    email:          email.trim().toLowerCase(),
                    whatsapp_phone: whatsapp.replace(/\D/g, ""),
                    meta:           { cnpj: cnpjDigits },
                    is_active:      false, // ativa somente após pagamento
                })
                .select("id, onboarding_token")
                .single();

            if (compErr || !newCompany) {
                console.error("[signup] Erro ao criar empresa:", compErr?.message);
                return NextResponse.json(
                    { error: "Erro ao criar empresa" },
                    { status: 500 }
                );
            }

            companyId       = newCompany.id;
            onboardingToken = newCompany.onboarding_token;
        }

        // 3. Verifica se já tem subscription ativa
        const { data: existingSub } = await admin
            .from("pagarme_subscriptions")
            .select("id, status, pagarme_customer_id")
            .eq("company_id", companyId)
            .maybeSingle();

        if (existingSub && ["trial", "active", "overdue"].includes(existingSub.status)) {
            return NextResponse.json(
                { error: "Empresa já possui assinatura ativa" },
                { status: 409 }
            );
        }

        // 4. Calcula valor do checkout
        let amountCents: number;
        let orderDescription: string;
        let orderCode: string;

        if (interval === "yearly") {
            // Plano anual: cobra o valor total do ano (setup incluído, sem desconto PIX)
            amountCents      = getYearlyPriceCents(plan as "bot" | "complete");
            orderDescription = `Plano Anual ${plan === "bot" ? "Bot" : "Completo"} — Renthus`;
            orderCode        = `annual_${plan}`;
        } else {
            // Plano mensal: cobra somente o setup fee (com desconto PIX opcional)
            const baseSetup   = getSetupPriceCents(plan as "bot" | "complete");
            const pixDiscount = parseFloat(process.env.SETUP_PIX_DISCOUNT_PCT ?? "5") / 100;
            amountCents       = paymentMethod === "pix"
                ? Math.round(baseSetup * (1 - pixDiscount))
                : baseSetup;
            orderDescription  = `Setup Plano ${plan === "bot" ? "Bot" : "Completo"} — Renthus`;
            orderCode         = `setup_${plan}`;
        }

        const order = await createCheckoutOrder({
            amountCents,
            description:     orderDescription,
            code:            orderCode,
            maxInstallments: installments,
            acceptPix:       true,
            acceptCard:      paymentMethod === "credit_card",
            customer: {
                name:     company_name.trim(),
                email:    email.trim().toLowerCase(),
                document: cnpjDigits,
                phone:    whatsapp.replace(/\D/g, ""),
            },
            successUrl: SUCCESS_URL,
            metadata: {
                type:       "setup",
                company_id: companyId,
                plan,
            },
        });

        const checkoutUrl = extractCheckoutUrl(order);

        if (!checkoutUrl) {
            console.error("[signup] Pagar.me não retornou checkout_url. Order:", order.id);
            return NextResponse.json(
                { error: "Erro ao gerar link de pagamento" },
                { status: 500 }
            );
        }

        // 5. Registra setup_payment como pending
        await admin.from("setup_payments").insert({
            company_id:          companyId,
            plan,
            amount:              centsToBRL(amountCents),
            installments,
            status:              "pending",
            pagarme_order_id:    order.id,
            pagarme_payment_url: checkoutUrl,
            // guarda interval para o webhook saber se é anual ou mensal
            ...(interval === "yearly" ? { interval: "yearly" } : {}),
        });

        // 6. Cria/atualiza subscription com status pending_setup
        await admin.from("pagarme_subscriptions").upsert(
            {
                company_id:    companyId,
                plan,
                status:        "pending_setup",
                trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
            { onConflict: "company_id" }
        );

        return NextResponse.json({
            ok:               true,
            checkout_url:     checkoutUrl,
            company_id:       companyId,
            onboarding_token: onboardingToken,
        });

    } catch (err: any) {
        console.error("[signup] Erro:", err?.message ?? err);
        return NextResponse.json(
            { error: err?.message ?? "Erro interno" },
            { status: 500 }
        );
    }
}
