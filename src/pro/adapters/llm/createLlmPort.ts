import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmPort } from "@/src/pro/ports/llm.port";
import { LlmProviderError } from "@/src/pro/ports/llm.port";
import { AnthropicLlmAdapter } from "./anthropic.llm";

/**
 * Factory por env.
 * - `LLM_PROVIDER=anthropic` (default) → Claude
 * - futuros: `openai` → GPT (adapter a implementar)
 */
export function createLlmPort(admin?: SupabaseClient | null): LlmPort {
    const provider = (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase();

    if (provider === "anthropic" || provider === "") {
        return new AnthropicLlmAdapter(admin);
    }

    if (provider === "openai") {
        throw new LlmProviderError(
            "LLM_PROVIDER=openai ainda não tem adapter. Use anthropic ou implemente OpenAiLlmAdapter."
        );
    }

    throw new LlmProviderError(`LLM_PROVIDER desconhecido: ${provider}`);
}

export function getConfiguredLlmProvider(): string {
    return (process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase() || "anthropic";
}
