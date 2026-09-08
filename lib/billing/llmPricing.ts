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
    "gpt-5-mini": { inputUsdPerM: 0.25, outputUsdPerM: 2 },
    "gpt-5-mini-2025-08-07": { inputUsdPerM: 0.25, outputUsdPerM: 2 },
    // Groq Cloud — pricing idêntico ao gpt-4o-mini (mesma faixa de preço). Alinhar
    // tabelas em https://console.groq.com/docs/pricing. Família "gpt-oss" é open-source
    // OpenAI (120B/20B), rate limit por minuto (não por dia). Fallback: openai/gpt-oss-20b.
    "openai/gpt-oss-120b": { inputUsdPerM: 0.15, outputUsdPerM: 0.6 },
    "openai/gpt-oss-20b": { inputUsdPerM: 0.1, outputUsdPerM: 0.5 },
    "qwen/qwen3-32b": { inputUsdPerM: 0.29, outputUsdPerM: 0.59 },
    "groq/compound": { inputUsdPerM: 0, outputUsdPerM: 0 }, // placeholder — pricing variável
    // Ollama (local) — custo zero em USD (a máquina paga em energia, mas isso é do developer,
    // não do cliente). Llama 3.1 8B, Qwen2.5-Coder 7B, etc. caem aqui via heurística abaixo.
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
    if (key.includes("gpt-5-mini")) return { ...LLM_RATES["gpt-5-mini"]!, matched: true };
    if (key.includes("gpt-4o-mini")) return { ...LLM_RATES["gpt-4o-mini"]!, matched: true };
    if (key.includes("gpt-4o")) return { ...LLM_RATES["gpt-4o"]!, matched: true };
    // Ollama local — qualquer modelo servido por Ollama (llama3.1, qwen2.5-coder, mistral, …)
    // tem custo $0. Match por prefixo "ollama" também ajuda se a métrica vier como "ollama/llama3.1:8b".
    if (key.startsWith("ollama") || key.includes("llama") || key.includes("qwen") || key.includes("mistral")) {
        return { inputUsdPerM: 0, outputUsdPerM: 0, matched: true };
    }

    return { ...FALLBACK_RATES, matched: false };
}

function usdToBrlCents(usd: number, rate: number): number {
    if (!(usd > 0)) return 0;
    return Math.max(1, Math.ceil(usd * rate * 100));
}

/** Multiplicadores Anthropic prompt cache (5m TTL) sobre o preço de input base. */
export const ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const ANTHROPIC_CACHE_READ_MULTIPLIER = 0.1;

export type LlmCacheUsageParts = {
    /** Tokens de input fora do cache (usage.input_tokens / noCache). */
    noCacheInputTokens?: number;
    cacheReadTokens?: number;
    /** cache_creation_input_tokens (write). */
    cacheWriteTokens?: number;
};

/**
 * Custo LLM em centavos BRL a partir de tokens + modelo.
 * Sem modelo → fallback caro (Sonnet-class).
 *
 * Com `cacheParts` (Anthropic): cobra noCache×1 + write×1.25 + read×0.1 + output.
 * `inputTokens` sem breakdown = input cheio (legado / providers sem cache).
 *
 * Aritmética em décimos de µUSD para evitar float (ex.: 0.1×5.5×100 → 56 por ceil).
 */
export function estimateLlmCostBrlCents(
    model: string | null | undefined,
    inputTokens: number,
    outputTokens: number,
    usdBrlRate: number = usdBrlRateFromEnv(),
    cacheParts?: LlmCacheUsageParts | null
): number {
    const rates = resolveLlmRates(model);
    const read = Math.max(0, Number(cacheParts?.cacheReadTokens ?? 0));
    const write = Math.max(0, Number(cacheParts?.cacheWriteTokens ?? 0));
    const hasCacheBreakdown = read > 0 || write > 0 || cacheParts?.noCacheInputTokens != null;

    let noCache: number;
    if (hasCacheBreakdown) {
        noCache =
            cacheParts?.noCacheInputTokens != null
                ? Math.max(0, Number(cacheParts.noCacheInputTokens))
                : Math.max(0, Math.max(0, inputTokens) - read - write);
    } else {
        noCache = Math.max(0, inputTokens);
    }

    /** USD = tokens/1e6 * usdPerM * mult → BRL cents = ceil(USD * rate * 100) */
    const usd =
        (noCache / 1_000_000) * rates.inputUsdPerM +
        (write / 1_000_000) * rates.inputUsdPerM * ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER +
        (read / 1_000_000) * rates.inputUsdPerM * ANTHROPIC_CACHE_READ_MULTIPLIER +
        (Math.max(0, outputTokens) / 1_000_000) * rates.outputUsdPerM;

    if (!(usd > 0)) return 0;
    // Evita 0.55*100 = 55.00000000000001 → ceil 56: arredonda para 1e-9 antes do ceil.
    const brlCents = usd * usdBrlRate * 100;
    const cleaned = Math.round(brlCents * 1e9) / 1e9;
    return Math.max(1, Math.ceil(cleaned - 1e-9));
}
