/**
 * Limite simples de chamadas LLM em paralelo **por instância** do runtime, particionado por
 * provider (serverless: não partilha entre réplicas; ainda reduz picos locais e 429 em cascata).
 * Anthropic e OpenAI usam gates independentes (`createInFlightGate`) — saturar um não bloqueia
 * o outro (ver docs/PLANO_MULTI_PROVIDER_IA.md, Fase 7).
 */
export function createInFlightGate(envVarName: string, defaultCap: number) {
    function maxInFlight(): number {
        const raw = process.env[envVarName]?.trim();
        const n = raw ? Number.parseInt(raw, 10) : defaultCap;
        if (!Number.isFinite(n) || n < 1) return defaultCap;
        return Math.min(64, n);
    }

    const waiters: Array<() => void> = [];
    let active = 0;

    function releaseSlot(): void {
        active -= 1;
        const next = waiters.shift();
        if (next) next();
    }

    async function acquireSlot(): Promise<void> {
        const cap = maxInFlight();
        if (active < cap) {
            active += 1;
            return;
        }
        await new Promise<void>((resolve) => {
            waiters.push(() => {
                active += 1;
                resolve();
            });
        });
    }

    return async function runWithInFlightSlot<T>(fn: () => Promise<T>): Promise<T> {
        await acquireSlot();
        try {
            return await fn();
        } finally {
            releaseSlot();
        }
    };
}

/** Executa `fn` com teto de chamadas Anthropic concorrentes neste processo. */
export const runWithAnthropicInFlightSlot = createInFlightGate("ANTHROPIC_CHATBOT_MAX_IN_FLIGHT", 8);

/** Executa `fn` com teto de chamadas OpenAI concorrentes neste processo. */
export const runWithOpenAiInFlightSlot = createInFlightGate("OPENAI_CHATBOT_MAX_IN_FLIGHT", 8);

/** Executa `fn` com teto de chamadas Groq concorrentes neste processo.
 * Mesmo default de 8 que Anthropic/OpenAI — Groq é rápido (LPU), mas o tier grátis tem
 * rate limit por minuto (ver https://console.groq.com/docs/rate-limits). */
export const runWithGroqInFlightSlot = createInFlightGate("GROQ_CHATBOT_MAX_IN_FLIGHT", 8);
