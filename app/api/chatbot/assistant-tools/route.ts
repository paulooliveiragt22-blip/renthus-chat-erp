/**
 * POST /api/chatbot/assistant-tools
 *
 * Anthropic SDK + tools: catálogo (view_chat_produtos via runSearchProdutos) e pedidos por telefone.
 * Autenticação: cookie (admin/staff da empresa) ou X-Service-Key + _companyId (interno).
 *
 * Body JSON:
 *   - text (obrigatório): mensagem do usuário / atendente de teste
 *   - phone_e164 (opcional): telefone do cliente para a tool de pedidos quando o modelo não passar
 *   - model (opcional): id do modelo Anthropic (padrão: CHATBOT_ANTHROPIC_MODEL ou Haiku 4.5 do projeto)
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { runDistributorAssistantWithTools } from "@/lib/server/anthropicDistributorAssistant";

export const runtime = "nodejs";

const RL_LIMIT     = 30;
const RL_WINDOW_MS = 60_000;

function clientIp(req: NextRequest): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    return req.headers.get("x-real-ip")?.trim() || "unknown";
}

type Body = {
    text?:         string;
    phone_e164?:   string | null;
    model?:        string | null;
    _companyId?:   string | null;
};

export async function POST(req: NextRequest) {
    const rl = checkRateLimit(`assistant_tools:${clientIp(req)}`, RL_LIMIT, RL_WINDOW_MS);
    if (!rl.allowed) {
        return NextResponse.json(
            { error: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
        );
    }

    let body: Body;
    try {
        body = (await req.json()) as Body;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const text = String(body.text ?? "").trim();
    if (!text) {
        return NextResponse.json({ error: "text_required" }, { status: 400 });
    }

    const serviceKey = req.headers.get("x-service-key");
    const isInternal =
        serviceKey &&
        serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY &&
        !!body._companyId;

    let companyId: string;
    if (isInternal) {
        companyId = body._companyId!;
    } else {
        const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
        if (!ctx.ok) {
            return NextResponse.json({ error: ctx.error }, { status: ctx.status });
        }
        companyId = ctx.companyId;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: "anthropic_api_key_missing" }, { status: 503 });
    }

    const admin = createAdminClient();

    try {
        const out = await runDistributorAssistantWithTools({
            admin,
            companyId,
            userMessage:       text,
            customerPhoneE164: body.phone_e164 ?? null,
            model:             body.model?.trim() || undefined,
        });
        return NextResponse.json({
            reply:       out.reply,
            model:       out.model,
            tool_rounds: out.tool_rounds,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[assistant-tools]", msg);
        return NextResponse.json({ error: "assistant_failed", details: msg }, { status: 500 });
    }
}
