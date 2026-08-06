/**
 * Preço LLM por modelo (puro — sem I/O).
 * USD por 1M tokens (input / output). Fallback = modelo mais caro listado
 * (errar cobrando a mais é recuperável; a menos some na margem).
 */

export type LlmTokenRates = { inputUsdPerM: number; outputUsdPerM: number };

/** Tabela canônica — alinhar a Anthropic / OpenAI pricing pages. */
const LLM_RATES: Record<string, LlmTokenRates> = {
    // Anthropic
    "claude-haiku-4-5-20251001": { inputUsdPerM: 1, outputUsdPerM: 5 },
    "claude-haiku-4-5": { inputUsdPerM: 1, outputUsdPerM: 5 },
    "claude-3-5-haiku-latest": { inputUsdPerM: 1, outputUsdPerM: 5 },
    "claude-sonnet-4-20250514": { inputUsdPerM: 3, outputUsdPerM: 15 },
    "claude-sonnet-4": { inputUsdPerM: 3, outputUsdPerM: 15 },
    // OpenAI
    "gpt-4o-mini": { inputUsdPerM: 0.15, outputUsdPerM: 0.6 },
    "gpt-4o": { inputUsdPerM: 2.5, outputUsdPerM: 10 },
    "gpt-4.1-mini": { inputUsdPerM: 0.4, outputUsdPerM: 1.6 },
    "gpt-4.1": { inputUsdPerM: 2, outputUsdPerM: 8 },
};

/** Conservador: Sonnet-class se modelo desconhecido. */
const FALLBACK_RATES: LlmTokenRates = { inputUsdPerM: 3, outputUsdPerM: 15 };

export function usdBrlRateFromEnv(envValue?: string | null): number {
    const n = Number(envValue ?? process.env.AI_USD_BRL_RATE ?? "5.5");
    return Number.isFinite(n) && n > 0 ? n : 5.5;
}

export function resolveLlmRates(model: string | null | undefined): LlmTokenRates & {
    matched: boolean;
} {
    const key = String(model ?? "")
        .trim()
        .toLowerCase();
    if (!key) return { ...FALLBACK_RATES, matched: false };

    const exact = LLM_RATES[key];
    if (exact) return { ...exact, matched: true };

    // prefix match (snapshots / aliases)
    for (const [k, rates] of Object.entries(LLM_RATES)) {
        if (key.startsWith(k) || k.startsWith(key)) {
            return { ...rates, matched: true };
        }
    }
    if (key.includes("haiku")) return { ...LLM_RATES["claude-haiku-4-5"]!, matched: true };
    if (key.includes("sonnet")) return { ...LLM_RATES["claude-sonnet-4"]!, matched: true };
    if (key.includes("gpt-4o-mini")) return { ...LLM_RATES["gpt-4o-mini"]!, matched: true };
    if (key.includes("gpt-4o")) return { ...LLM_RATES["gpt-4o"]!, matched: true };

    return { ...FALLBACK_RATES, matched: false };
}

function usdToBrlCents(usd: number, rate: number): number {
    if (!(usd > 0)) return 0;
    return Math.max(1, Math.ceil(usd * rate * 100));
}

/**
 * Custo LLM em centavos BRL a partir de tokens + modelo.
 * Sem modelo → fallback caro (Sonnet-class).
 */
export function estimateLlmCostBrlCents(
    model: string | null | undefined,
    inputTokens: number,
    outputTokens: number,
    usdBrlRate: number = usdBrlRateFromEnv()
): number {
    const rates = resolveLlmRates(model);
    const usd =
        (Math.max(0, inputTokens) / 1_000_000) * rates.inputUsdPerM +
        (Math.max(0, outputTokens) / 1_000_000) * rates.outputUsdPerM;
    return usdToBrlCents(usd, usdBrlRate);
}
