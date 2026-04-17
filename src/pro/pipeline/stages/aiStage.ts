import type { AiService, AiServiceResult } from "../../services/ai/ai.types";
import type {
    IntentDecision,
    OutboundMessage,
    PipelineContext,
    ProSessionState,
    SideEffect,
} from "@/src/types/contracts";
import { stripHallucinatedOrderPersistenceClaims } from "@/src/pro/adapters/ai/sanitizeAiVisibleOrderClaims";
import { applyAiStateTransition } from "../proStepTransitions";

export interface AiStageResult {
    state: ProSessionState;
    outbound: OutboundMessage[];
    sideEffects: SideEffect[];
    aiResult: AiServiceResult;
    /** `true` quando `replyText` veio vazio/ausente e o estágio aplicou a mensagem de fallback segura. */
    invalidAiSanitized: boolean;
}

export async function aiStage(params: {
    aiService: AiService;
    context: PipelineContext;
    decision: IntentDecision;
    userText: string;
}): Promise<AiStageResult> {
    const { aiService, context, decision, userText } = params;

    const raw = await aiService.run({
        context,
        userText,
        intentDecision: decision,
        draft: context.session.draft,
        history: context.session.aiHistory,
        limits: {
            maxToolRounds: context.policies.maxToolRounds,
            maxHistoryTurns: context.policies.maxHistoryTurns,
            timeoutMs: context.policies.aiTimeoutMs,
        },
    });

    const hadValidReplyText =
        typeof raw?.replyText === "string" && raw.replyText.trim().length > 0;
    const baseReplyText = hadValidReplyText
        ? raw.replyText.trim()
        : "Tive uma falha ao processar sua mensagem. Pode tentar novamente?";
    const replyText = stripHallucinatedOrderPersistenceClaims(baseReplyText);
    const invalidAiSanitized =
        !hadValidReplyText || (hadValidReplyText && replyText !== baseReplyText);

    const aiResult: AiServiceResult = {
        action: raw?.action ?? "error",
        replyText,
        updatedDraft: raw?.updatedDraft ?? context.session.draft,
        updatedHistory: raw?.updatedHistory ?? context.session.aiHistory,
        signals: {
            toolRoundsUsed: Number(raw?.signals?.toolRoundsUsed ?? 0),
            intentMarker: raw?.signals?.intentMarker ?? null,
        },
        errorCode: raw?.errorCode,
    };

    const nextStateBase = {
        ...context.session,
        draft: aiResult.updatedDraft ?? null,
        aiHistory: aiResult.updatedHistory ?? [],
    };

    const outbound: OutboundMessage[] = [{ kind: "text", text: aiResult.replyText }];
    const sideEffects: SideEffect[] = [];

    const nextState = applyAiStateTransition({
        state: nextStateBase,
        action: aiResult.action,
        intentMarker: aiResult.signals.intentMarker ?? null,
    });

    return { state: nextState, outbound, sideEffects, aiResult, invalidAiSanitized };
}

