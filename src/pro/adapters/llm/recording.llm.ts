import type { LlmChatRequest, LlmChatResponse, LlmPort } from "@/src/pro/ports/llm.port";

export type LlmCassetteEntry = {
    requestFingerprint: string;
    response: LlmChatResponse;
};

/** Fingerprint estável o bastante para ordenar/casar turns (não é crypto). */
export function fingerprintLlmRequest(req: LlmChatRequest): string {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const content =
        typeof lastUser?.content === "string"
            ? lastUser.content
            : JSON.stringify(lastUser?.content ?? null);
    return [
        req.purpose ?? "",
        req.model ?? "",
        String(req.maxTokens),
        content.slice(0, 500),
    ].join("|");
}

/** Grava cada chat() na cassete (para gravar baseline). */
export class RecordingLlmPort implements LlmPort {
    readonly cassette: LlmCassetteEntry[] = [];

    constructor(private readonly inner: LlmPort) {}

    async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const response = await this.inner.chat(req);
        this.cassette.push({
            requestFingerprint: fingerprintLlmRequest(req),
            response,
        });
        return response;
    }
}

/**
 * Reproduz cassete por índice de chamada (determinístico, sem custo).
 * Se esgotar: resposta vazia segura (pipeline cai em fallback).
 */
export class ReplayLlmPort implements LlmPort {
    private idx = 0;

    constructor(private readonly cassette: LlmCassetteEntry[]) {}

    async chat(_req: LlmChatRequest): Promise<LlmChatResponse> {
        const entry = this.cassette[this.idx++];
        if (!entry) {
            return {
                content: [{ type: "text", text: "" }],
                stopReason: "end_turn",
                provider: "replay",
                model: "cassette-exhausted",
                usage: { inputTokens: 0, outputTokens: 0 },
            };
        }
        return entry.response;
    }
}
