/**
 * GET /api/chatbot/reactivate
 *
 * Chamado pelo cron a cada 5 minutos (vercel.json).
 * Reativa o bot em threads que ficaram em handover sem resposta humana
 * por mais de 5 minutos.
 *
 * Critério: bot_active = false
 *           AND handover_at  < NOW() - 5 min
 *           AND last_message_at < NOW() - 5 min
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

export const runtime = "nodejs";

const REACTIVATE_MSG =
    "😔 No momento não há atendentes disponíveis.\n" +
    "Mas não se preocupe — nosso assistente automático está de volta para te ajudar!\n\n" +
    "Digite qualquer mensagem para continuar seu pedido.";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader);
    if (authError) return authError;

    const admin = createAdminClient();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Busca threads elegíveis para reativação
    const { data: threads, error } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, company_id")
        .eq("bot_active", false)
        .lt("handover_at", fiveMinutesAgo)
        .lt("last_message_at", fiveMinutesAgo);

    if (error) {
        console.error("[reactivate] Erro ao buscar threads:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!threads?.length) {
        console.log("[reactivate] Nenhuma thread elegível.");
        return NextResponse.json({ ok: true, reactivated: 0 });
    }

    console.log("[reactivate] Threads elegíveis:", threads.length);

    let reactivated = 0;
    const errors: string[] = [];
    const channelConfigCache = new Map<string, WaConfig>();

    for (const thread of threads) {
        try {
            // Carrega config do canal (com cache por empresa)
            if (!channelConfigCache.has(thread.company_id)) {
                const { data: ch } = await admin
                    .from("whatsapp_channels")
                    .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
                    .eq("company_id", thread.company_id)
                    .eq("provider", "meta")
                    .eq("status", "active")
                    .maybeSingle();
                channelConfigCache.set(thread.company_id, {
                    phoneNumberId: ch?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
                    accessToken:   ch ? resolveChannelAccessToken(ch) : (process.env.WHATSAPP_TOKEN ?? ""),
                });
            }
            const waConfig = channelConfigCache.get(thread.company_id)!;

            // 1. Reativa o bot
            const { error: updateErr } = await admin
                .from("whatsapp_threads")
                .update({
                    bot_active:  true,
                    handover_at: null,
                })
                .eq("id", thread.id);

            if (updateErr) {
                console.error("[reactivate] Erro ao atualizar thread:", thread.id, updateErr.message);
                errors.push(`thread ${thread.id}: ${updateErr.message}`);
                continue;
            }

            // 2. Limpa a sessão do chatbot para reiniciar o fluxo
            await admin
                .from("chatbot_sessions")
                .delete()
                .eq("thread_id", thread.id);

            // 3. Envia mensagem ao cliente
            if (thread.phone_e164) {
                const result = await sendWhatsAppMessage(thread.phone_e164, REACTIVATE_MSG, waConfig);
                if (!result.ok) {
                    console.warn("[reactivate] Falha ao enviar msg para:", thread.phone_e164, result.error);
                }
            }

            console.log("[reactivate] Thread reativada:", thread.id);
            reactivated++;
        } catch (err: any) {
            console.error("[reactivate] Erro inesperado na thread:", thread.id, err?.message ?? err);
            errors.push(`thread ${thread.id}: ${err?.message ?? String(err)}`);
        }
    }

    return NextResponse.json({ ok: true, reactivated, errors: errors.length ? errors : undefined });
}
