/**
 * Seleção de `LanguageModel` (Vercel AI SDK) por env — substitui o papel de
 * `createLlmPort`/`LlmPort` nesta migração (ver `docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md`).
 *
 * - `LLM_PROVIDER=anthropic` (default) → Claude via `@ai-sdk/anthropic`
 * - `LLM_PROVIDER=openai` → GPT via `@ai-sdk/openai`
 * - `LLM_MODEL` (opcional) sobrepõe o modelo default do provider escolhido.
 *
 * Mesmos nomes de env var que `createLlmPort.ts` já usava — não introduzir nomes novos.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProviderName = "anthropic" | "openai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** GPT-5 mini (não gpt-4o-mini) — decisão em docs/PLANO_MULTI_PROVIDER_IA.md: tool-calling mais
 * confiável a um custo ainda bem abaixo do Haiku. Não reabrir sem benchmark novo. */
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export class LlmProviderConfigError extends Error {
    readonly code = "AI_PROVIDER_ERROR";
    constructor(message: string) {
        super(message);
        this.name = "LlmProviderConfigError";
    }
}

export function getConfiguredLlmProviderName(): LlmProviderName {
    const raw = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();
    if (raw === "" || raw === "anthropic") return "anthropic";
    if (raw === "openai") return "openai";
    throw new LlmProviderConfigError(`LLM_PROVIDER desconhecido: ${raw}`);
}

export type ResolveLanguageModelOpts = {
    /** Provider explícito (por empresa) — se ausente, cai em `getConfiguredLlmProviderName()` (env global). */
    provider?: LlmProviderName;
    /** Sobrepõe `LLM_MODEL`/default do provider resolvido. */
    model?: string;
};

/**
 * Resolve o `LanguageModel` a usar nesta chamada.
 *
 * Retrocompatível: aceita string (comportamento antigo — só sobrepõe o modelo, provider vem do
 * env) ou um objeto `{ provider?, model? }` (multi-provider por empresa — ver
 * docs/PLANO_MULTI_PROVIDER_IA.md, Fase 2). Sem argumento, comportamento idêntico ao anterior.
 */
export function resolveLanguageModel(modelOverrideOrOpts?: string | ResolveLanguageModelOpts): LanguageModel {
    const opts: ResolveLanguageModelOpts =
        typeof modelOverrideOrOpts === "string" ? { model: modelOverrideOrOpts } : modelOverrideOrOpts ?? {};
    const provider = opts.provider ?? getConfiguredLlmProviderName();

    if (provider === "anthropic") {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new LlmProviderConfigError("ANTHROPIC_API_KEY missing");
        const model = opts.model?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
        return createAnthropic({ apiKey })(model);
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new LlmProviderConfigError("OPENAI_API_KEY missing");
    const model = opts.model?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    return createOpenAI({ apiKey })(model);
}
