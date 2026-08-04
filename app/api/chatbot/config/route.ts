import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    DEFAULT_CHATBOT_MESSAGE_TEMPLATES,
    mergeMessageTemplatesIntoBotConfig,
    resolveChatbotMessageTemplates,
    type ChatbotMessageTemplates,
} from "@/lib/chatbot/messageTemplates";

export const runtime = "nodejs";

export async function GET() {
    // staff precisa ler templates (avisos WhatsApp em Pedidos)
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("chatbots")
        .select("id, name, is_active, config")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ chatbot: null });

    const cfg = (data.config as Record<string, unknown> | null) ?? {};
    const aiEnabled = cfg.ai_enabled === undefined || cfg.ai_enabled === null ? true : Boolean(cfg.ai_enabled);
    return NextResponse.json({
        chatbot: data,
        messageTemplates: resolveChatbotMessageTemplates(cfg),
        messageDefaults: DEFAULT_CHATBOT_MESSAGE_TEMPLATES,
        aiEnabled,
        highValueConfirmEnabled: Boolean(cfg.high_value_confirm_enabled),
        highValueConfirmAmountBrl:
            typeof cfg.high_value_confirm_amount_brl === "number"
                ? cfg.high_value_confirm_amount_brl
                : Number(cfg.high_value_confirm_amount_brl) || 0,
    });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    let body: {
        id?: string;
        config?: Record<string, unknown>;
        messageTemplates?: Partial<ChatbotMessageTemplates>;
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (!body.id || !body.config) {
        return NextResponse.json({ error: "id and config required" }, { status: 400 });
    }

    const { data: existing } = await admin
        .from("chatbots")
        .select("id, config")
        .eq("id", body.id)
        .eq("company_id", companyId)
        .maybeSingle();

    if (!existing) return NextResponse.json({ error: "chatbot not found" }, { status: 404 });

    const prevCfg = (existing.config as Record<string, unknown> | null) ?? {};
    // Preserva mensagens já salvas se o PATCH só alterar modelo/threshold
    let nextConfig = { ...prevCfg, ...body.config };
    if (body.messageTemplates) {
        nextConfig = mergeMessageTemplatesIntoBotConfig(nextConfig, body.messageTemplates);
    }

    const { error } = await admin
        .from("chatbots")
        .update({ config: nextConfig })
        .eq("id", body.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        ok: true,
        messageTemplates: resolveChatbotMessageTemplates(nextConfig),
    });
}
