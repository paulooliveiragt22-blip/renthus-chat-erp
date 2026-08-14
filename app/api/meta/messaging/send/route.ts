import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { sendHumanMetaThreadText } from "@/lib/meta/sendHumanMetaThreadText";

export const runtime = "nodejs";

/**
 * Envio humano (inbox) Instagram/Messenger por thread_id.
 * B4: fora da 24h usa Message Tag HUMAN_AGENT.
 */
export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as {
            thread_id?: string;
            text?: string;
        };
        const threadId = typeof body.thread_id === "string" ? body.thread_id.trim() : "";
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!threadId) {
            return NextResponse.json({ error: "thread_id_required" }, { status: 400 });
        }
        if (!text) {
            return NextResponse.json({ error: "text_required" }, { status: 400 });
        }

        const ctx = await requireCapability("whatsapp.operate");
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
        const { admin, companyId } = ctx;

        const feat = await requirePlanFeature(admin, companyId, "omnichannel_ig_messenger");
        if (!feat.ok) return feat.response;

        const result = await sendHumanMetaThreadText({ admin, companyId, threadId, text });
        if (!result.ok) {
            return NextResponse.json(
                { error: result.error },
                { status: result.status ?? 400 }
            );
        }

        return NextResponse.json({
            ok: true,
            provider: "meta",
            provider_message_id: result.providerMessageId ?? null,
            human_agent_tag: result.usedHumanAgentTag,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unexpected error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
