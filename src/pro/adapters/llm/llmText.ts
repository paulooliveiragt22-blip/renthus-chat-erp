/**
 * Guarda de API key por provider — único sobrevivente de `llm.port.ts`/adapters (deletados na
 * Fase 8, ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md); ainda usado por `ai.service.ts` e
 * `intentClassifier.service.ts` antes de chamar `resolveLanguageModel()`.
 *
 * Deve espelhar `resolveLanguageModel` em `modelProvider.ts`: openai→OPENAI, groq→GROQ,
 * ollama→sempre ok, anthropic (default)→ANTHROPIC. Provider desconhecido = sem key.
 */
export function hasLlmApiKey(provider?: string): boolean {
    const p = (provider ?? process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase() || "anthropic";
    if (p === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
    if (p === "groq") return Boolean(process.env.GROQ_API_KEY?.trim());
    // Ollama local — não exige API key real.
    if (p === "ollama") return true;
    if (p === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    return false;
}
