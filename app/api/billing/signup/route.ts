/**
 * POST /api/billing/signup
 *
 * Rota pública — cria empresa e pedido no Pagar.me:
 *   PIX → order via API (QR na tela, sem checkout hospedado / reCAPTCHA)
 *   Cartão → checkout hosted
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
 * Retorna: { checkout_url? | pix_qr_url?, pix_qr_code?, company_id, onboarding_token }
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    createCheckoutOrder,
    createPixInvoiceOrder,
    extractCheckoutUrl,
    extractPixCode,
    extractPixUrl,
    getSetupPriceCents,
    getYearlyPriceCents,
    centsToBRL,
} from "@/lib/billing/pagarme";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        console.log("[signup] variáveis de ambiente:", {
            hasPagarmeKey:   !!process.env.PAGARME_API_KEY,
            hasSupabaseUrl:  !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            hasServiceRole:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            nodeEnv:         process.env.NODE_ENV,
        });

        const body = (await req.json()) as {
            company_name?:   string;
            cnpj?:           string;
            whatsapp?:       string;
            email?:          string;
            plan?:           string;
            interval?:       string;
            payment_method?: string;
            installments?:   number;
            address_street?:  string;
            address_number?:  string;
            address_city?:    string;
            address_state?:   string;
            address_zip?:     string;
        };

        console.log("[signup] body recebido:", JSON.stringify(body));

        const { company_name, cnpj, whatsapp, email, plan } = body;
        const { address_street, address_number, address_city, address_state, address_zip } = body;
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

        if (!address_street || !address_number || !address_city || !address_state || !address_zip) {
            return NextResponse.json(
                { error: "Campos de endereço obrigatórios: address_street, address_number, address_city, address_state, address_zip" },
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

        console.log("[signup] validações ok — criando admin client...");
        const admin = createAdminClient();
        console.log("[signup] admin client criado");

        // 1. Verifica se já existe empresa com esse CNPJ
        const { data: existing } = await admin
            .from("companies")
            .select("id, onboarding_token")
            .eq("meta->cnpj", cnpjDigits)
            .maybeSingle();

        let companyId: string;
        let onboardingToken: string;

        console.log("[signup] busca CNPJ result:", JSON.stringify(existing));

        if (existing) {
            companyId       = existing.id;
            onboardingToken = existing.onboarding_token;
            console.log("[signup] empresa existente:", companyId);
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
                console.error("[signup] Erro ao criar empresa:", compErr?.message, compErr?.code, compErr?.details);
                return NextResponse.json(
                    { error: `Erro ao criar empresa: ${compErr?.message ?? "desconhecido"}` },
                    { status: 500 }
                );
            }

            companyId       = newCompany.id;
            onboardingToken = newCompany.onboarding_token;
            console.log("[signup] empresa criada:", companyId, "| token:", onboardingToken);
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

        console.log("[signup] subscription existente:", JSON.stringify(existingSub));

        // Token confirmado no banco ANTES de criar o checkout
        console.log("[signup] onboarding_token:", onboardingToken);

        // URLs de retorno — montadas após ter o onboardingToken
        const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? "https://renthus-chat-erp.vercel.app";
        const successUrl = `${appUrl}/signup/complete?token=${onboardingToken}`;
        const cancelUrl  = `${appUrl}/signup`;
        console.log("[signup] successUrl:", successUrl);
        console.log("[signup] cancelUrl:", cancelUrl);

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

        console.log("[signup] chamando Pagar.me — amountCents:", amountCents, "| interval:", interval, "| method:", paymentMethod);

        const customerPayload = {
            name:     company_name.trim(),
            email:    email.trim().toLowerCase(),
            document: cnpjDigits,
            phone:    whatsapp.replace(/\D/g, ""),
            address: {
                street:  address_street.trim(),
                number:  address_number.trim(),
                zipCode: address_zip.trim(),
                city:    address_city.trim(),
                state:   address_state.trim().toUpperCase(),
            },
        };

        let orderId: string;
        let checkoutUrl: string | null = null;
        let pixQrUrl: string | null     = null;
        let pixQrCode: string | null    = null;

        if (paymentMethod === "pix") {
            // PIX via API: sem página hospedada do Pagar.me → sem reCAPTCHA no fluxo
            const order = await createPixInvoiceOrder({
                amountCents,
                description: orderDescription,
                itemCode:      orderCode,
                customer:      customerPayload,
                metadata: {
                    type:       "setup",
                    company_id: companyId,
                    plan,
                },
            });
            orderId    = order.id;
            pixQrUrl   = extractPixUrl(order);
            pixQrCode  = extractPixCode(order);
            console.log("[signup] Pagar.me order PIX:", orderId, "| qr:", !!pixQrUrl, "| code:", !!pixQrCode);
            if (!pixQrCode && !pixQrUrl) {
                console.error("[signup] PIX sem QR/código. Order:", orderId);
                return NextResponse.json(
                    { error: "Erro ao gerar PIX. Tente cartão ou contate o suporte." },
                    { status: 500 }
                );
            }
        } else {
            const order = await createCheckoutOrder({
                amountCents,
                description:     orderDescription,
                code:            orderCode,
                maxInstallments: installments,
                acceptPix:       false,
                acceptCard:      true,
                customer:        customerPayload,
                successUrl,
                cancelUrl,
                metadata: {
                    type:       "setup",
                    company_id: companyId,
                    plan,
                },
            });
            orderId     = order.id;
            checkoutUrl = extractCheckoutUrl(order);
            console.log("[signup] Pagar.me checkout:", orderId, "| url:", !!checkoutUrl);
            if (!checkoutUrl) {
                console.error("[signup] Pagar.me não retornou checkout_url. Order:", order.id);
                return NextResponse.json(
                    { error: "Erro ao gerar link de pagamento" },
                    { status: 500 }
                );
            }
        }

        // 5. Registra setup_payment como pending
        await admin.from("setup_payments").insert({
            company_id:          companyId,
            plan,
            amount:              centsToBRL(amountCents),
            installments,
            status:              "pending",
            pagarme_order_id:    orderId,
            pagarme_payment_url: checkoutUrl ?? pixQrUrl ?? "",
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
            payment_method:   paymentMethod,
            checkout_url:     checkoutUrl,
            pix_qr_url:       pixQrUrl,
            pix_qr_code:      pixQrCode,
            company_id:       companyId,
            onboarding_token: onboardingToken,
        });

    } catch (err: any) {
        console.error("[signup] ERRO COMPLETO:", err);
        return NextResponse.json(
            {
                error: err instanceof Error ? err.message : String(err),
                stack: process.env.NODE_ENV !== "production"
                    ? (err instanceof Error ? err.stack : undefined)
                    : undefined,
            },
            { status: 500 }
        );
    }
}
