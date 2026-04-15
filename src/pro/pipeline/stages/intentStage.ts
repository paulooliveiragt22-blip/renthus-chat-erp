import type { IntentDecision, PipelineContext } from "@/src/types/contracts";
import type { IntentService } from "../../services/intent/intent.types";

export async function intentStage(params: {
    intentService: IntentService;
    context: PipelineContext;
    userText: string;
}): Promise<IntentDecision> {
    const { intentService, context, userText } = params;
    return intentService.classify({ context, userText });
}

