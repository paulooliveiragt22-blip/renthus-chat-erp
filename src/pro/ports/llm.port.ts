/**
 * Porta LLM neutra — o pipeline / AiService não conhecem Anthropic nem OpenAI.
 * Trocar provider = novo adapter + env `LLM_PROVIDER`, sem reescrever tools/checkout.
 */

export type LlmRole = "user" | "assistant";

export type LlmMessage = {
    role: LlmRole;
    /** Conteúdo opaco do provider (texto ou blocos tool_use / tool_result). */
    content: unknown;
};

export type LlmToolDef = Record<string, unknown>;

export type LlmToolChoice =
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
    | undefined;

export type LlmChatRequest = {
    system: string;
    messages: LlmMessage[];
    tools?: LlmToolDef[];
    toolChoice?: LlmToolChoice;
    maxTokens: number;
    /** Override; senão o adapter usa env / default do provider. */
    model?: string;
    timeoutMs: number;
    companyId?: string;
    /** Origem para billing / métricas (ex.: pro_ai_service_full). */
    purpose?: string;
};

export type LlmChatResponse = {
    content: unknown[];
    stopReason: string | null;
    usage?: { inputTokens?: number; outputTokens?: number };
    provider: string;
    model: string;
};

export interface LlmPort {
    chat(req: LlmChatRequest): Promise<LlmChatResponse>;
}

export class LlmTimeoutError extends Error {
    readonly code = "AI_TIMEOUT";
    constructor(message = "AI_TIMEOUT") {
        super(message);
        this.name = "LlmTimeoutError";
    }
}

export class LlmProviderError extends Error {
    readonly code = "AI_PROVIDER_ERROR";
    constructor(message: string) {
        super(message);
        this.name = "LlmProviderError";
    }
}
