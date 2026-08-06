/**
 * Preço e duração STT (puro — sem I/O).
 * Fonte: OpenAI API Pricing — estimated cost / minute
 * https://developers.openai.com/api/docs/pricing
 */

/** USD por minuto de áudio. Desconhecido → 0.006. */
const STT_USD_PER_MINUTE: Record<string, number> = {
    "whisper-1": 0.006,
    "gpt-4o-transcribe": 0.006,
    "gpt-4o-mini-transcribe": 0.003,
    "gpt-transcribe": 0.0045,
    "gpt-4o-transcribe-diarize": 0.006,
};

const STT_USD_PER_MINUTE_FALLBACK = 0.006;

/**
 * Heurística voz WhatsApp (OGG/Opus ~16 kbps): bytes → segundos
 * quando a API não devolve `duration`.
 */
export const STT_OPUS_BYTES_PER_SEC = 2000;

export function usdBrlRateFromEnv(envValue?: string | null): number {
    const n = Number(envValue ?? process.env.AI_USD_BRL_RATE ?? "5.5");
    return Number.isFinite(n) && n > 0 ? n : 5.5;
}

export function normalizeSttDurationSec(durationSec: number): number {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 1;
    return Math.max(1, Math.ceil(durationSec));
}

export function estimateSttDurationFromBytes(byteLength: number): number {
    const bytes = Math.max(0, Math.floor(byteLength));
    if (bytes <= 0) return 1;
    return normalizeSttDurationSec(bytes / STT_OPUS_BYTES_PER_SEC);
}

export function sttUsdPerMinute(model: string): number {
    const key = model.trim().toLowerCase();
    return STT_USD_PER_MINUTE[key] ?? STT_USD_PER_MINUTE_FALLBACK;
}

function usdToBrlCents(usd: number, rate: number): number {
    if (!(usd > 0)) return 0;
    return Math.max(1, Math.ceil(usd * rate * 100));
}

/**
 * Custo STT em centavos BRL.
 * (sec/60) × USD/min × câmbio → ceil centavos (mín. 1).
 */
export function estimateSttCostBrlCents(
    model: string,
    durationSec: number,
    usdBrlRate: number = usdBrlRateFromEnv()
): number {
    const sec = normalizeSttDurationSec(durationSec);
    const usd = (sec / 60) * sttUsdPerMinute(model);
    return usdToBrlCents(usd, usdBrlRate);
}

/** Exemplos de ordem de grandeza (BRL, câmbio 5.5) — docs/UX. */
export function sttCostExamplesBrl(model: string, usdBrlRate = 5.5): {
    perSecondCents: number;
    per20sCents: number;
    perMinuteCents: number;
} {
    return {
        perSecondCents: estimateSttCostBrlCents(model, 1, usdBrlRate),
        per20sCents: estimateSttCostBrlCents(model, 20, usdBrlRate),
        perMinuteCents: estimateSttCostBrlCents(model, 60, usdBrlRate),
    };
}
