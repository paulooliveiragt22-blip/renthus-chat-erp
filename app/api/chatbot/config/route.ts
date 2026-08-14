import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import {
    DEFAULT_CHATBOT_MESSAGE_TEMPLATES,
    mergeMessageTemplatesIntoBotConfig,
    resolveChatbotMessageTemplates,
    type ChatbotMessageTemplates,
} from "@/lib/chatbot/messageTemplates";
import { parseAiOrderModePolicy } from "@/lib/chatbot/aiOrderModePolicy";

export const runtime = "nodejs";

export async function GET() {
    // staff precisa ler templates (avisos WhatsApp em Pedidos)
    const ctx = await requireCapability("settings.company");
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
    const aiOrderModePolicy = parseAiOrderModePolicy(cfg);
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
        aiOrderMode: aiOrderModePolicy.mode,
        sessionIdleMinutes: aiOrderModePolicy.sessionIdleMinutes,
        aiSessionWindowMinutes: aiOrderModePolicy.aiSessionWindowMinutes,
        aiMaxTurnsPerSession: aiOrderModePolicy.aiMaxTurnsPerSession,
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
    // Merge: preserva chaves antigas (threshold etc.) se o PATCH não as enviar
    let nextConfig = { ...prevCfg, ...body.config };
    if (body.messageTemplates) {
        nextConfig = mergeMessageTemplatesIntoBotConfig(nextConfig, body.messageTemplates);
    }

    // Normaliza chaves de modo/limites da IA (defaults seguros).
    const normalized = parseAiOrderModePolicy(nextConfig);
    nextConfig = {
        ...nextConfig,
        ai_order_mode: normalized.mode,
        session_idle_minutes: normalized.sessionIdleMinutes,
        ai_session_window_minutes: normalized.aiSessionWindowMinutes,
        ai_max_turns_per_session:
            normalized.mode === "info_only" ? normalized.aiMaxTurnsPerSession : 0,
    };

    const { error } = await admin
        .from("chatbots")
        .update({ config: nextConfig })
        .eq("id", body.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        ok: true,
        messageTemplates: resolveChatbotMessageTemplates(nextConfig),
        aiOrderMode: normalized.mode,
        sessionIdleMinutes: normalized.sessionIdleMinutes,
        aiSessionWindowMinutes: normalized.aiSessionWindowMinutes,
        aiMaxTurnsPerSession: normalized.aiMaxTurnsPerSession,
    });
}
