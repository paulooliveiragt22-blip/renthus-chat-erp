/**
 * POST /api/onboarding
 *
 * Actions:
 *   action = "save_whatsapp"   → salva whatsapp_phone e notifica Renthus
 *   action = "request_activation" → marca activation_requested_at e notifica Renthus
 */

import { NextResponse }            from "next/server";
import { createAdminClient }       from "@/lib/supabase/admin";
import { sendBillingNotification } from "@/lib/billing/sendBillingNotification";
import { createClient }            from "@/lib/supabase/server";

export const runtime = "nodejs";

const RENTHUS_PHONE = process.env.RENTHUS_SUPPORT_PHONE ?? "5566992071285";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as {
            action:    "save_whatsapp" | "request_activation";
            whatsapp?: string;
        };

        // Autenticação via session
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
        }

        const admin = createAdminClient();

        // Descobre company_id pelo user_id
        const { data: cu } = await admin
            .from("company_users")
            .select("company_id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (!cu?.company_id) {
            return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
        }

        const companyId = cu.company_id;

        const { data: company } = await admin
            .from("companies")
            .select("name, email, whatsapp_phone")
            .eq("id", companyId)
            .single();

        // Busca plano
        const { data: sub } = await admin
            .from("pagarme_subscriptions")
            .select("plan")
            .eq("company_id", companyId)
            .maybeSingle();

        if (body.action === "save_whatsapp") {
            const digits = (body.whatsapp ?? "").replaceAll(/\D/g, "");
            if (digits.length < 10) {
                return NextResponse.json({ error: "Número inválido" }, { status: 400 });
            }

            const phoneWithCountry = digits.startsWith("55") ? digits : `55${digits}`;

            await admin
                .from("companies")
                .update({ whatsapp_phone: phoneWithCountry })
                .eq("id", companyId);

            await sendBillingNotification(
                companyId,
                RENTHUS_PHONE,
                `🔔 *Novo cliente aguarda ativação:*\n\n` +
                `Empresa: ${company?.name}\n` +
                `Número: ${phoneWithCountry}\n` +
                `Plano: ${sub?.plan ?? "-"}\n\n` +
                `Entre em contato para auxiliar na verificação do Meta.`
            );

            return NextResponse.json({ ok: true });
        }

        if (body.action === "request_activation") {
            await admin
                .from("companies")
                .update({ activation_requested_at: new Date().toISOString() })
                .eq("id", companyId);

            const { data: updated } = await admin
                .from("companies")
                .select("whatsapp_phone")
                .eq("id", companyId)
                .single();

            await sendBillingNotification(
                companyId,
                RENTHUS_PHONE,
                `🚀 *SOLICITAÇÃO DE ATIVAÇÃO:*\n\n` +
                `Empresa: ${company?.name}\n` +
                `Plano: ${sub?.plan ?? "-"}\n` +
                `Número: ${updated?.whatsapp_phone ?? "-"}\n` +
                `Email: ${company?.email}\n` +
                `Cadastro completo: SIM`
            );

            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ error: "Ação inválida" }, { status: 400 });

    } catch (err: any) {
        console.error("[onboarding]", err?.message ?? err);
        return NextResponse.json({ error: err?.message ?? "Erro interno" }, { status: 500 });
    }
}
