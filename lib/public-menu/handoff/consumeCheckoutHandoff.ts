/**
 * C1b.3 — após pedido no cardápio com token `hc`: marca handoff consumido
 * e zera draft PRO na thread WA (evita segundo finalize / botões Confirmar órfãos).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";
import type { ProSessionState } from "@/src/types/contracts";
import { verifyMenuHandoffToken } from "@/lib/public-menu/sessionToken";

export type ConsumeCheckoutHandoffResult = {
    consumed: boolean;
    draftCleared: boolean;
    threadId: string | null;
    handoffId: string | null;
    reason?: string;
};

function idleProState(customerId: string | null): ProSessionState {
    return {
        step: "pro_idle",
        customerId,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

/** Zera `__pro_v2_state.draft` e step da sessão viva da thread (se existir). */
export async function clearProDraftForWhatsAppThread(
    admin: SupabaseClient,
    params: { companyId: string; threadId: string }
): Promise<boolean> {
    const { companyId, threadId } = params;
    const nowIso = new Date().toISOString();
    const { data: session } = await admin
        .from("chatbot_sessions")
        .select("id, context, customer_id")
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .gt("expires_at", nowIso)
        .maybeSingle();

    if (!session?.id) return false;

    const prevCtx =
        session.context && typeof session.context === "object"
            ? (session.context as Record<string, unknown>)
            : {};
    const prevState = prevCtx[CHATBOT_SESSION_PRO_V2_STATE_KEY] as ProSessionState | undefined;
    const customerId =
        (typeof prevState?.customerId === "string" ? prevState.customerId : null) ??
        (typeof session.customer_id === "string" ? session.customer_id : null);

    const nextCtx = {
        ...prevCtx,
        [CHATBOT_SESSION_PRO_V2_STATE_KEY]: idleProState(customerId),
    };

    const { error } = await admin
        .from("chatbot_sessions")
        .update({
            step: "pro_idle",
            cart: [],
            context: nextCtx,
        })
        .eq("id", session.id)
        .eq("company_id", companyId);

    if (error) {
        console.warn("[public-menu] clearProDraftForWhatsAppThread:", error.message);
        return false;
    }

    await admin
        .from("whatsapp_order_confirmations")
        .update({ status: "cancelled", resolved_at: nowIso })
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .eq("status", "pending");

    return true;
}

/**
 * Consome handoff `hc` (idempotente se já `consumed_at`) e limpa draft WA da thread.
 * Sem token / token inválido → no-op seguro (pedido web orgânico sem bot).
 */
export async function consumeCheckoutHandoffAfterWebOrder(
    admin: SupabaseClient,
    params: {
        companyId: string;
        slug: string;
        handoffToken?: string | null;
    }
): Promise<ConsumeCheckoutHandoffResult> {
    const token = String(params.handoffToken ?? "").trim();
    if (!token) {
        return {
            consumed: false,
            draftCleared: false,
            threadId: null,
            handoffId: null,
            reason: "no_token",
        };
    }

    let payload: ReturnType<typeof verifyMenuHandoffToken>;
    try {
        payload = verifyMenuHandoffToken(token);
    } catch {
        return {
            consumed: false,
            draftCleared: false,
            threadId: null,
            handoffId: null,
            reason: "token_invalid",
        };
    }
    if (!payload || payload.companyId !== params.companyId || payload.slug !== params.slug) {
        return {
            consumed: false,
            draftCleared: false,
            threadId: null,
            handoffId: null,
            reason: "token_mismatch",
        };
    }

    const handoffId = payload.handoffId;
    const nowIso = new Date().toISOString();

    const { data: row } = await admin
        .from("menu_handoffs")
        .select("id, thread_id, consumed_at, expires_at")
        .eq("id", handoffId)
        .eq("company_id", params.companyId)
        .eq("slug", params.slug)
        .maybeSingle();

    if (!row?.id) {
        return {
            consumed: false,
            draftCleared: false,
            threadId: null,
            handoffId,
            reason: "handoff_not_found",
        };
    }

    if (!row.consumed_at) {
        const { error: upErr } = await admin
            .from("menu_handoffs")
            .update({ consumed_at: nowIso })
            .eq("id", row.id)
            .eq("company_id", params.companyId)
            .is("consumed_at", null);
        if (upErr) {
            console.warn("[public-menu] consume handoff:", upErr.message);
        }
    }

    const threadId = typeof row.thread_id === "string" && row.thread_id.trim() ? row.thread_id : null;
    let draftCleared = false;
    if (threadId) {
        draftCleared = await clearProDraftForWhatsAppThread(admin, {
            companyId: params.companyId,
            threadId,
        });
    }

    return {
        consumed: true,
        draftCleared,
        threadId,
        handoffId,
    };
}
