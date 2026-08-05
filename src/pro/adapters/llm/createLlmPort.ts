import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmPort } from "@/src/pro/ports/llm.port";
import { LlmProviderError } from "@/src/pro/ports/llm.port";
import { AnthropicLlmAdapter } from "./anthropic.llm";
import { OpenAiLlmAdapter } from "./openai.llm";

/**
 * Factory por env.
 * - `LLM_PROVIDER=anthropic` (default) → Claude
 * - `LLM_PROVIDER=openai` → GPT (default model gpt-4o-mini via `LLM_MODEL`)
 */
export function createLlmPort(admin?: SupabaseClient | null): LlmPort {
    const provider = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();

    if (provider === "anthropic" || provider === "") {
        return new AnthropicLlmAdapter(admin);
    }

    if (provider === "openai") {
        return new OpenAiLlmAdapter(admin);
    }

    throw new LlmProviderError(`LLM_PROVIDER desconhecido: ${provider}`);
}

export function getConfiguredLlmProvider(): string {
    return (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase() || "anthropic";
}
