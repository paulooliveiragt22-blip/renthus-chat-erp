/**
 * lib/chatbot/session.ts
 *
 * Funções de acesso a sessões do chatbot no Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Session, CartItem, HistoryEntry } from "./types";

const HISTORY_WINDOW = 8; // máx 8 entradas (4 trocas user/bot)

export async function getOrCreateSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string
): Promise<Session> {
    const { data } = await admin
        .from("chatbot_sessions")
        .select("id, step, cart, customer_id, context, history")
        .eq("thread_id", threadId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (data) {
        return {
            id:          data.id,
            step:        data.step ?? "welcome",
            cart:        (data.cart as CartItem[]) ?? [],
            customer_id: data.customer_id ?? null,
            context:     (data.context as Record<string, unknown>) ?? {},
            history:     (data.history as HistoryEntry[]) ?? [],
        };
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const { data: created } = await admin
        .from("chatbot_sessions")
        .upsert(
            {
                thread_id:  threadId,
                company_id: companyId,
                step:       "welcome",
                cart:       [],
                context:    {},
                expires_at: expiresAt,
            },
            { onConflict: "thread_id" }
        )
        .select("id, step, cart, customer_id, context")
        .single();

    return {
        id:          created?.id ?? "",
        step:        created?.step ?? "welcome",
        cart:        [],
        customer_id: null,
        context:     {},
        history:     [],
    };
}

export async function saveSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    patch: Partial<Omit<Session, "id">>
): Promise<void> {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    // Trunca histórico para as últimas HISTORY_WINDOW entradas antes de persistir
    const history = patch.history
        ? patch.history.slice(-HISTORY_WINDOW)
        : undefined;

    await admin.from("chatbot_sessions").upsert(
        {
            thread_id:   threadId,
            company_id:  companyId,
            expires_at:  expiresAt,
            updated_at:  new Date().toISOString(),
            ...(patch.step        !== undefined && { step:        patch.step }),
            ...(patch.cart        !== undefined && { cart:        patch.cart }),
            ...(patch.customer_id !== undefined && { customer_id: patch.customer_id }),
            ...(patch.context     !== undefined && { context:     patch.context }),
            ...(history           !== undefined && { history }),
        },
        { onConflict: "thread_id" }
    );
}

/** Adiciona uma entrada ao histórico da sessão em memória (não persiste sozinho). */
export function appendHistory(session: Session, role: "user" | "bot", text: string): void {
    session.history.push({ role, text, ts: Date.now() });
    if (session.history.length > HISTORY_WINDOW) {
        session.history = session.history.slice(-HISTORY_WINDOW);
    }
}
