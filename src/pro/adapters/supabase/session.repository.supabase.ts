import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProSessionState } from "@/src/types/contracts";
import type { SessionRepository } from "../../ports/session.repository";
import { getOrCreateSession, saveSession } from "@/lib/chatbot/session";

const PRO_V2_STATE_KEY = "__pro_v2_state";

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

    async load(companyId: string, threadId: string): Promise<ProSessionState | null> {
        const session = await getOrCreateSession(this.admin, threadId, companyId);
        const state = (session.context?.[PRO_V2_STATE_KEY] as ProSessionState | undefined) ?? null;
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

