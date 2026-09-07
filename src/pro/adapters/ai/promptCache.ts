/**
 * Anthropic prompt caching — helpers puros (ADR-0003 §9.3).
 *
 * Conflito: system único com worklist/draft muda a cada turno → miss.
 * Ponta de maior valor (Haiku 4.5 ≥4096 tokens no prefixo):
 * 1) `system` = só regras estáveis
 * 2) `cacheControl` na última tool (`respond_to_customer`) — Anthropic
 *    cacheia tudo até o breakpoint (system + tools)
 * 3) phase/draft/worklist/hints no **user** message (fora do prefixo)
 */
import type { LlmProviderName } from "@/src/pro/adapters/ai/modelProvider";
import type { EnvLike } from "@/lib/env/EnvLike";

export const ANTHROPIC_PROMPT_CACHE_CONTROL = {
    type: "ephemeral" as const,
    ttl: "5m" as const,
};

export function isLlmPromptCacheEnabled(
    provider: LlmProviderName,
    env: EnvLike = process.env
): boolean {
    const raw = env.LLM_CACHE_CONTROL_ENABLED?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
    if (provider !== "anthropic") return false;
    // default on for Anthropic; explicit 1/true also on
    if (raw === undefined || raw === "") return true;
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function anthropicCacheProviderOptions(): {
    anthropic: { cacheControl: typeof ANTHROPIC_PROMPT_CACHE_CONTROL };
} {
    return { anthropic: { cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL } };
}
