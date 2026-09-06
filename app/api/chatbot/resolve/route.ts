// app/api/chatbot/resolve/route.ts
//
// Endpoint manual para acionar o chatbot via painel admin.
// Para chamadas automáticas (webhooks), processInboundMessage() é chamado diretamente.
//
// Autenticação:
//   - Cookie de sessão (admin logado) → requireCapability
//   - Header X-Service-Key = INTERNAL_CHATBOT_SECRET (server-to-server; nunca service_role)

import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundMessage } from "@/lib/chatbot/processMessage";
import { validateInternalChatbotSecret } from "@/lib/security/internalChatbotAuth";

export const runtime = "nodejs";

type Body = {
    threadId?: string | null;
    phone_e164?: string | null;
    whatsappMessageId?: string | null;
    text: string;
    /** Para chamadas internas (sem cookie de sessão), passa companyId diretamente */
    _companyId?: string | null;
};

export async function POST(req: Request) {
    const body = (await req.json()) as Body;
    const text = (body.text ?? "").trim();

    if (!text) {
        return NextResponse.json({ error: "empty_text" }, { status: 400 });
    }

    // ── Autenticação ──────────────────────────────────────────────────────────
    const serviceKeyHeader = req.headers.get("x-service-key");
    const wantsInternal = Boolean(serviceKeyHeader) || Boolean(body._companyId);

    let companyId: string;
    const admin = createAdminClient();

    if (wantsInternal) {
        const auth = validateInternalChatbotSecret(serviceKeyHeader);
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const internalCompanyId = String(body._companyId ?? "").trim();
        if (!internalCompanyId) {
            return NextResponse.json({ error: "company_id_required" }, { status: 400 });
        }
        companyId = internalCompanyId;
    } else {
        const ctx = await requireCapability("settings.company");
        if (!ctx.ok) {
            return NextResponse.json({ error: ctx.error }, { status: ctx.status });
        }
        companyId = ctx.companyId;
    }

    // ── Resolve threadId ──────────────────────────────────────────────────────
    let threadId = body.threadId ?? null;

    if (!threadId && body.phone_e164) {
        const { data: th } = await admin
            .from("whatsapp_threads")
            .select("id")
            .eq("company_id", companyId)
            .eq("phone_e164", body.phone_e164)
            .maybeSingle();
        threadId = th?.id ?? null;
    }

    if (!threadId) {
        return NextResponse.json({ error: "missing_thread_or_phone" }, { status: 400 });
    }

    // Defesa contra IDOR: thread informada deve pertencer à empresa resolvida.
    const { data: threadOwned } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (!threadOwned) {
        return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }

    // ── Verifica se há bot ativo ──────────────────────────────────────────────
    const { data: bots } = await admin
        .from("chatbots")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    if (!bots?.length) {
        return NextResponse.json({ action: "no_bot_configured" });
    }

    // ── Processa via engine do chatbot ────────────────────────────────────────
    try {
        await processInboundMessage({
            admin,
            companyId,
            threadId,
            messageId: body.whatsappMessageId ?? "",
            phoneE164: body.phone_e164 ?? "",
            text,
        });

        return NextResponse.json({ action: "processed" });
    } catch (err: any) {
        console.error("[resolve] processInboundMessage error:", err);
        return NextResponse.json(
            { error: "processing_failed", details: String(err?.message ?? err) },
            { status: 500 }
        );
    }
}
