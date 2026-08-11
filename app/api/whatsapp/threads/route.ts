import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";
import type { OrderDraft } from "@/src/types/contracts";

export const runtime = "nodejs";

export type ThreadCartSummary = {
    source: "live_session" | "abandoned";
    itemCount: number;
    total: number;
};

/**
 * Resumo leve do carrinho por thread (pro badge 🛒 na lista) — sem N+1: 2 queries no total
 * pra todas as threads da página (sessões vivas + abandonos), não 1 por thread.
 */
async function loadCartSummariesByThread(
    admin: ReturnType<typeof createAdminClient>,
    companyId: string,
    threadIds: string[]
): Promise<Map<string, ThreadCartSummary>> {
    const summaries = new Map<string, ThreadCartSummary>();
    if (threadIds.length === 0) return summaries;

    const { data: sessions } = await admin
        .from("chatbot_sessions")
        .select("thread_id, context")
        .eq("company_id", companyId)
        .in("thread_id", threadIds)
        .gt("expires_at", new Date().toISOString());

    const withLiveCart = new Set<string>();
    for (const row of sessions ?? []) {
        const context = (row.context ?? null) as Record<string, unknown> | null;
        const state = context?.[CHATBOT_SESSION_PRO_V2_STATE_KEY] as { draft?: OrderDraft | null } | undefined;
        const draft = state?.draft ?? null;
        if (draft?.items?.length) {
            withLiveCart.add(String(row.thread_id));
            summaries.set(String(row.thread_id), {
                source: "live_session",
                itemCount: draft.totalItems ?? draft.items.reduce((s, i) => s + i.quantity, 0),
                total: draft.grandTotal ?? 0,
            });
        }
    }

    const remaining = threadIds.filter((id) => !withLiveCart.has(id));
    if (remaining.length > 0) {
        const { data: abandoned } = await admin
            .from("abandoned_carts")
            .select("thread_id, item_count, grand_total")
            .eq("company_id", companyId)
            .in("thread_id", remaining)
            .in("status", ["open", "notified"]);
        for (const row of abandoned ?? []) {
            summaries.set(String(row.thread_id), {
                source: "abandoned",
                itemCount: Number(row.item_count ?? 0),
                total: Number(row.grand_total ?? 0),
            });
        }
    }

    return summaries;
}

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const { searchParams } = new URL(req.url);

    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const q = (searchParams.get("q") ?? "").trim();

    let query = admin
        .from("whatsapp_threads")
        .select(
            "id, phone_e164, profile_name, last_message_at, last_inbound_at, last_message_preview, created_at, bot_active, handover_at, unread_count, channel_id, channel, external_id"
        )
        .eq("company_id", companyId)
        .order("last_message_at", { ascending: false })
        .limit(Number.isFinite(limit) ? limit : 50);

    if (q) {
        // telefone, nome ou external_id (IGSID/PSID)
        query = query.or(
            `phone_e164.ilike.%${q}%,profile_name.ilike.%${q}%,external_id.ilike.%${q}%`
        );
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const threads = data ?? [];
    const cartSummaries = await loadCartSummariesByThread(
        admin,
        companyId,
        threads.map((t) => String(t.id))
    );

    const threadsWithCart = threads.map((t) => ({
        ...t,
        cart_summary: cartSummaries.get(String(t.id)) ?? null,
    }));

    return NextResponse.json({ threads: threadsWithCart });
}
