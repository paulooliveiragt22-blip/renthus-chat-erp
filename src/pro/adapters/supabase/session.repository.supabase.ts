import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProSessionState } from "@/src/types/contracts";
import type { SessionRepository } from "../../ports/session.repository";
import { getOrCreateSession, saveSession } from "@/lib/chatbot/session";

/** Chave em `chatbot_sessions.context` onde persiste `ProSessionState` do motor PRO V2. */
export const CHATBOT_SESSION_PRO_V2_STATE_KEY = "__pro_v2_state" as const;

const PRO_V2_STATE_KEY = CHATBOT_SESSION_PRO_V2_STATE_KEY;

function toStateFromLegacy(session: Awaited<ReturnType<typeof getOrCreateSession>>): ProSessionState {
    return {
        step: "pro_idle",
        customerId: session.customer_id ?? null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
    };
}

export class SupabaseSessionRepository implements SessionRepository {
    constructor(private readonly admin: SupabaseClient) {}

    /**
     * Lê `ProSessionState` em `context.__pro_v2_state` ou deriva snapshot mínimo da sessão legada.
     * Erros de rede/Supabase propagam-se; `loadState` encapsula-os em `ProPipelineSessionLoadError`.
     */
    async load(companyId: string, threadId: string): Promise<ProSessionState | null> {
        const session = await getOrCreateSession(this.admin, threadId, companyId);
        const raw = session.context?.[PRO_V2_STATE_KEY];
        const state =
            raw !== null && raw !== undefined && typeof raw === "object"
                ? (raw as ProSessionState)
                : null;
        return state ?? toStateFromLegacy(session);
    }

    async save(companyId: string, threadId: string, state: ProSessionState): Promise<void> {
        const current = await getOrCreateSession(this.admin, threadId, companyId);
        const context = {
            ...(current.context ?? {}),
            [PRO_V2_STATE_KEY]: state,
        };

        await saveSession(this.admin, threadId, companyId, {
            step: state.step,
            customer_id: state.customerId,
            context,
        });
    }
}

