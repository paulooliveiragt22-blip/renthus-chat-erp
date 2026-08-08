/**
 * Recorder/replay de `LanguageModel` (Vercel AI SDK) — Fase 7 da migração
 * (ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Substitui `src/pro/adapters/llm/recording.llm.ts`
 * (`RecordingLlmPort`/`ReplayLlmPort`, que decoravam `LlmPort.chat()` — API descontinuada nas
 * Fases 3-6).
 *
 * Mecanismo oficial do SDK para isto é `wrapLanguageModel` + `LanguageModelMiddleware.wrapGenerate`
 * (intercepta `doGenerate()` no nível do provider, sem tocar `generateText`/tools/loop): grava cada
 * chamada real numa cassete em memória; no replay, `createReplayModel` devolve um `LanguageModel`
 * (via `MockLanguageModelV3` de `ai/test`, o mock oficial do SDK) que reproduz a cassete por ordem
 * de chamada — determinístico, sem custo, sem rede.
 */

import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type {
    LanguageModelV3,
    LanguageModelV3CallOptions,
    LanguageModelV3GenerateResult,
    LanguageModelV3Message,
} from "@ai-sdk/provider";

export type LlmCassetteEntry = {
    requestFingerprint: string;
    result: LanguageModelV3GenerateResult;
};

function textFromUserContent(content: LanguageModelV3Message["content"]): string {
    if (!Array.isArray(content)) return "";
    return content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join(" ");
}

/** Fingerprint estável o bastante para ordenar/casar turns (não é crypto). */
export function fingerprintGenerateCall(params: LanguageModelV3CallOptions): string {
    const prompt = params.prompt ?? [];
    const lastUser = [...prompt].reverse().find((m) => m.role === "user");
    const content = lastUser ? textFromUserContent(lastUser.content) : "";
    return [String(params.maxOutputTokens ?? ""), content.slice(0, 500)].join("|");
}

/**
 * Middleware que grava cada `doGenerate()` real na cassete (para gravar baseline).
 * `cassette` é o array vivo — o caller lê `cassette` após o(s) `generateText` de gravação.
 */
export function createRecordingMiddleware(cassette: LlmCassetteEntry[]): LanguageModelMiddleware {
    return {
        specificationVersion: "v3",
        wrapGenerate: async ({ doGenerate, params }) => {
            const result = await doGenerate();
            cassette.push({ requestFingerprint: fingerprintGenerateCall(params), result });
            return result;
        },
    };
}

/** Envolve um `LanguageModel` real com gravação; devolve o model decorado + a cassete viva. */
export function createRecordingModel(model: LanguageModelV3): {
    model: LanguageModelV3;
    cassette: LlmCassetteEntry[];
} {
    const cassette: LlmCassetteEntry[] = [];
    const wrapped = wrapLanguageModel({ model, middleware: createRecordingMiddleware(cassette) });
    return { model: wrapped, cassette };
}

/** Resultado devolvido quando a cassete se esgota (fallback seguro, sem custo). */
function exhaustedResult(): LanguageModelV3GenerateResult {
    return {
        content: [{ type: "text", text: "" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
        response: { id: "cassette-exhausted", modelId: "cassette-exhausted" },
    };
}

/**
 * Reproduz cassete por índice de chamada (determinístico, sem custo, sem API key).
 * Se esgotar: resposta vazia segura (o loop de `ai.service.ts` cai no tratamento de
 * `respond_to_customer` ausente, igual ao `ReplayLlmPort` antigo).
 */
export function createReplayModel(cassette: readonly LlmCassetteEntry[]): LanguageModelV3 {
    let idx = 0;
    return new MockLanguageModelV3({
        doGenerate: async () => {
            const entry = cassette[idx++];
            return entry ? entry.result : exhaustedResult();
        },
    });
}
