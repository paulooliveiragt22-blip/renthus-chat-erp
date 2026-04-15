import type { IntentDecision, PipelineContext } from "@/src/types/contracts";

export interface IntentServiceInput {
    context: PipelineContext;
    userText: string;
}

export interface IntentService {
    classify(input: IntentServiceInput): Promise<IntentDecision>;
}

