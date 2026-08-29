/**
 * Guarda de API key por provider — único sobrevivente de `llm.port.ts`/adapters (deletados na
 * Fase 8, ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md); ainda usado por `ai.service.ts` e
 * `intentClassifier.service.ts` antes de chamar `resolveLanguageModel()`.
 */
export function hasLlmApiKey(provider?: string): boolean {
    const p = (provider ?? process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase() || "anthropic";
    if (p === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
    // Ollama não exige API key — assume "tem key" se o provider é ollama.
    if (p === "ollama") return true;
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
