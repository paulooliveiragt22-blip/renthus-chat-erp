import type { AiService, AiServiceResult } from "../../services/ai/ai.types";
import type {
    IntentDecision,
    OutboundMessage,
    PipelineContext,
    ProSessionState,
    SideEffect,
} from "@/src/types/contracts";

export interface AiStageResult {
    state: ProSessionState;
    outbound: OutboundMessage[];
    sideEffects: SideEffect[];
    aiResult: AiServiceResult;
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
            timeoutMs: 15000,
        },
    });

    const aiResult: AiServiceResult = {
        action: raw?.action ?? "error",
        replyText:
            typeof raw?.replyText === "string" && raw.replyText.trim().length > 0
                ? raw.replyText
                : "Tive uma falha ao processar sua mensagem. Pode tentar novamente?",
        updatedDraft: raw?.updatedDraft ?? context.session.draft,
        updatedHistory: raw?.updatedHistory ?? context.session.aiHistory,
        signals: {
            toolRoundsUsed: Number(raw?.signals?.toolRoundsUsed ?? 0),
            intentMarker: raw?.signals?.intentMarker ?? null,
        },
        errorCode: raw?.errorCode,
    };

    const nextState: ProSessionState = {
        ...context.session,
        draft: aiResult.updatedDraft ?? null,
        aiHistory: aiResult.updatedHistory ?? [],
    };

    const outbound: OutboundMessage[] = [{ kind: "text", text: aiResult.replyText }];
    const sideEffects: SideEffect[] = [];

    if (aiResult.action === "request_confirmation") {
        nextState.step = "pro_awaiting_confirmation";
    } else if (aiResult.action === "escalate") {
        nextState.step = "pro_escalation_choice";
    } else if (aiResult.action === "error") {
        nextState.step = "pro_collecting_order";
    } else {
        nextState.step = "pro_collecting_order";
    }

    return { state: nextState, outbound, sideEffects, aiResult };
}

