// app/api/chatbot/resolve/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const supabaseAdmin = createAdminClient();

type Body = {
    threadId?: string | null;
    phone_e164?: string | null;
    whatsappMessageId?: string | null;
    text: string;
};

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { companyId } = ctx;

    const body = (await req.json()) as Body;
    const text = (body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });

    // 1) bot ativo?
    const { data: bots } = await supabaseAdmin
        .from("chatbots")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);
    const bot = Array.isArray(bots) && bots.length ? bots[0] : null;
    if (!bot) return NextResponse.json({ action: "no_bot_configured" });

    // 2) intents ativos
    const { data: intents } = await supabaseAdmin
        .from("bot_intents")
        .select("*")
        .eq("company_id", companyId)
        .eq("active", true);

    // 3) classificador simples por exemplos (fast path)
    let matched: any = null;
    if (Array.isArray(intents)) {
        for (const it of intents) {
            try {
                const examples: string[] = it.examples ?? [];
                for (const ex of examples) {
                    if (!ex) continue;
                    if (text.toLowerCase().includes(ex.toLowerCase())) {
                        matched = it;
                        break;
                    }
                }
                if (matched) break;
            } catch {
                /* ignore malformed */
            }
        }
    }

    // 4) threshold check (use config.threshold ou 0.75)
    const threshold = (bot?.config?.threshold as number) ?? 0.75;
    const confidence = matched ? 0.9 : 0.0;
    if (!matched || confidence < threshold) {
        await supabaseAdmin.from("bot_logs").insert({
            company_id: companyId,
            thread_id: body.threadId ?? null,
            whatsapp_message_id: body.whatsappMessageId ?? null,
            direction: "decision",
            intent_key: matched?.intent_key ?? null,
            confidence,
            response_text: null,
            created_at: new Date().toISOString(),
        });
        return NextResponse.json({ action: "handover" });
    }

    // 5) construir resposta (usa template se existir)
    let responseText = "";
    if (matched.response_template) {
        // substituições simples; em produção use template engine
        responseText = matched.response_template
            .replace("{{order_id}}", "123")
            .replace("{{status}}", "em preparo");
    } else {
        responseText = "Desculpe, não tenho como responder automaticamente agora.";
    }

    // 6) garantir thread (se não tiver threadId, criar com phone_e164 se fornecido)
    let threadId = body.threadId ?? null;
    if (!threadId) {
        if (!body.phone_e164) {
            // sem thread nem telefone: cria log e retorna erro
            await supabaseAdmin.from("bot_logs").insert({
                company_id: companyId,
                direction: "decision",
                intent_key: matched.intent_key,
                confidence,
                response_text: "no_thread_no_phone",
                created_at: new Date().toISOString(),
            });
            return NextResponse.json({ error: "missing_thread_or_phone" }, { status: 400 });
        }
        // criar thread
        const { data: newThread } = await supabaseAdmin
            .from("whatsapp_threads")
            .insert({
                company_id: companyId,
                phone_e164: body.phone_e164,
                profile_name: null,
                created_at: new Date().toISOString(),
            })
            .select("id")
            .limit(1);
        threadId =
            (Array.isArray(newThread) && newThread.length ? newThread[0].id : (newThread as any)?.id) ?? null;
    }

    // 7) gravar bot_logs
    await supabaseAdmin.from("bot_logs").insert({
        company_id: companyId,
        thread_id: threadId,
        whatsapp_message_id: body.whatsappMessageId ?? null,
        direction: "outbound",
        intent_key: matched.intent_key,
        confidence,
        model_provider: "none",
        model_name: null,
        prompt: { text },
        response_text: responseText,
        llm_tokens_used: 0,
        llm_cost: 0,
        created_at: new Date().toISOString(),
    });

    // 8) gravar whatsapp_messages (outbound)
    await supabaseAdmin.from("whatsapp_messages").insert({
        thread_id: threadId,
        direction: "outbound",
        channel: "whatsapp",
        from_addr: "bot",
        to_addr: body.phone_e164 ?? "unknown",
        body: responseText,
        num_media: 0,
        raw_payload: null,
        created_at: new Date().toISOString(),
    });

    // 9) atualizar preview/last_message na thread
    await supabaseAdmin.from("whatsapp_threads").update({
        last_message_at: new Date().toISOString(),
        last_message_preview: responseText,
    }).eq("id", threadId);

    // 10) incrementar usage_monthly (RPC)
    try {
        await supabaseAdmin.rpc("increment_usage_monthly", { p_company: companyId, p_used: 1 });
    } catch (err) {
        console.error("increment_usage_monthly failed", err);
    }

    return NextResponse.json({ action: "sent", response: responseText });
}
