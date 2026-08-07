import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProSessionState } from "@/src/types/contracts";
import type { SessionRepository } from "../../ports/session.repository";
import { getOrCreateSession, saveSession } from "@/lib/chatbot/session";
import { stripLegacyProSessionFields } from "@/src/pro/pipeline/sessionLegacyStrip";

/** Chave em `chatbot_sessions.context` onde persiste `ProSessionState` do motor PRO V2. */
export const CHATBOT_SESSION_PRO_V2_STATE_KEY = "__pro_v2_state" as const;

const PRO_V2_STATE_KEY = CHATBOT_SESSION_PRO_V2_STATE_KEY;

/** Chaves do motor PRO legado — não ler; strip no save para não acumular lixo no JSON. */
const LEGACY_PRO_CONTEXT_KEYS = [
    "ai_order_canonical",
    "pro_anthropic_messages",
    "pro_misunderstanding_streak",
    "pro_escalation_tier",
] as const;

/** @internal exported for unit tests */
export function stripLegacyProContextKeys(
    context: Record<string, unknown>
): Record<string, unknown> {
    const next = { ...context };
    for (const key of LEGACY_PRO_CONTEXT_KEYS) {
        delete next[key];
    }
    return next;
}

function emptyProState(
    session: Awaited<ReturnType<typeof getOrCreateSession>>
): ProSessionState {
    return {
        step: "pro_idle",
        customerId: session.customer_id ?? null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

function normalizeProV2State(raw: ProSessionState): ProSessionState {
    const base: ProSessionState = {
        ...raw,
        searchProdutoEmbalagemIds: raw.searchProdutoEmbalagemIds ?? [],
        lastSearchPicks: raw.lastSearchPicks ?? [],
        emptySearchStreak: raw.emptySearchStreak ?? 0,
        checkoutEditHold: raw.checkoutEditHold === true,
        pendingSwapRemoveName: raw.pendingSwapRemoveName ?? null,
        inferredPaymentMethod: raw.inferredPaymentMethod ?? null,
        bootstrapResolvedEmbalagemIds: raw.bootstrapResolvedEmbalagemIds ?? [],
        bootstrapPendingClarifications: raw.bootstrapPendingClarifications ?? [],
        pendingAskRepeatTerms: raw.pendingAskRepeatTerms ?? [],
        pendingClarifyQuantity: raw.pendingClarifyQuantity ?? null,
        pendingClarifySegment: raw.pendingClarifySegment ?? null,
        aiHistorySummary: raw.aiHistorySummary ?? null,
        aiTurnCount: raw.aiTurnCount,
        aiWindowStartedAt: raw.aiWindowStartedAt ?? null,
    };
    return stripLegacyProSessionFields(base);
}

export class SupabaseSessionRepository implements SessionRepository {
    constructor(
        private readonly admin: SupabaseClient,
        private readonly options?: { idleMinutes?: number }
    ) {}

    /**
     * Lê `ProSessionState` em `context.__pro_v2_state`.
     * Sem estado V2: snapshot mínimo (customerId); não reidrata draft legado.
     */
    async load(companyId: string, threadId: string): Promise<ProSessionState | null> {
        const session = await getOrCreateSession(this.admin, threadId, companyId, {
            idleMinutes: this.options?.idleMinutes,
        });
        const raw = session.context?.[PRO_V2_STATE_KEY];
        const state =
            raw !== null && raw !== undefined && typeof raw === "object"
                ? normalizeProV2State(raw as ProSessionState)
                : null;
        return state ?? emptyProState(session);
    }

    async save(companyId: string, threadId: string, state: ProSessionState): Promise<void> {
        const current = await getOrCreateSession(this.admin, threadId, companyId, {
            idleMinutes: this.options?.idleMinutes,
        });
        const drained = stripLegacyProSessionFields(state);
        const context = stripLegacyProContextKeys({
            ...(current.context ?? {}),
            [PRO_V2_STATE_KEY]: drained,
        });

        await saveSession(
            this.admin,
            threadId,
            companyId,
            {
                step: state.step,
                customer_id: state.customerId,
                context,
            },
            { idleMinutes: this.options?.idleMinutes }
        );
    }
}
