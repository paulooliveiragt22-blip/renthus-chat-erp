/**
 * Retry + circuit breaker para 429 de LLM (pico fim de semana), com estado **isolado por
 * provider** — abrir o circuito da Anthropic não pode afetar chamadas OpenAI, e vice-versa
 * (ver docs/PLANO_MULTI_PROVIDER_IA.md, Fase 7; substitui `anthropicResilience.ts`, que tinha um
 * único estado global e ficou como código morto após a migração pro Vercel AI SDK).
 *
 * Usa o gate in-flight por instância e por provider (`anthropicInFlightGate.ts`).
 * Com Upstash: teto opcional global (`LLM_GLOBAL_MAX_IN_FLIGHT`) e por empresa
 * (`COMPANY_LLM_MAX_IN_FLIGHT`) via `llmDistributedCap.ts`.
 */

import { runWithAnthropicInFlightSlot, runWithOpenAiInFlightSlot } from "@/lib/chatbot/anthropicInFlightGate";
import { runWithDistributedLlmCap } from "@/lib/chatbot/llmDistributedCap";
import type { LlmProviderName } from "@/src/pro/adapters/ai/modelProvider";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isLlmRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as { status?: number; message?: unknown; error?: { type?: string } };
    if (e.status === 429) return true;
    const m = String(e.message ?? "").toLowerCase();
    if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return true;
    if (String(e.error?.type ?? "").toLowerCase().includes("rate_limit")) return true;
    return false;
}

function retryAfterMs(error: unknown, attempt: number): number {
    const e = error as { headers?: { get?: (k: string) => string | null }; retryAfter?: number };
    const header = typeof e.headers?.get === "function" ? e.headers.get("retry-after") : null;
    if (header) {
        const sec = Number(header);
        if (Number.isFinite(sec) && sec > 0) return Math.min(30_000, sec * 1000);
    }
    if (typeof e.retryAfter === "number" && e.retryAfter > 0) {
        return Math.min(30_000, e.retryAfter * 1000);
    }
    const base = Math.min(8_000, 400 * 2 ** attempt);
    return base + Math.floor(Math.random() * 250);
}

type CircuitState = { openUntilMs: number; consecutive429: number };

const circuits: Record<LlmProviderName, CircuitState> = {
    anthropic: { openUntilMs: 0, consecutive429: 0 },
    openai: { openUntilMs: 0, consecutive429: 0 },
};

const CIRCUIT_OPEN_ENV: Record<LlmProviderName, string> = {
    anthropic: "ANTHROPIC_CIRCUIT_OPEN_MS",
    openai: "OPENAI_CIRCUIT_OPEN_MS",
};

const IN_FLIGHT_GATE: Record<LlmProviderName, <T>(fn: () => Promise<T>) => Promise<T>> = {
    anthropic: runWithAnthropicInFlightSlot,
    openai: runWithOpenAiInFlightSlot,
};

export function getCircuitOpenRemainingMs(provider: LlmProviderName): number {
    return Math.max(0, circuits[provider].openUntilMs - Date.now());
}

/** Só para testes unitários. */
export function resetCircuitForTests(provider?: LlmProviderName): void {
    const targets: LlmProviderName[] = provider ? [provider] : ["anthropic", "openai"];
    for (const p of targets) {
        circuits[p] = { openUntilMs: 0, consecutive429: 0 };
        wasOpen[p] = false;
    }
}

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.floor(n);
}

export type CircuitStateChangeEvent =
    | { provider: LlmProviderName; state: "open"; openMs: number }
    | { provider: LlmProviderName; state: "close" };

/** Estado anterior por provider — usado só pra detectar a transição aberto→fechado (Fase 9). */
const wasOpen: Record<LlmProviderName, boolean> = { anthropic: false, openai: false };

function tripCircuit(provider: LlmProviderName, onCircuitStateChange?: (e: CircuitStateChangeEvent) => void): void {
    const openMs = getPositiveIntEnv(CIRCUIT_OPEN_ENV[provider], 30_000);
    circuits[provider].openUntilMs = Date.now() + openMs;
    wasOpen[provider] = true;
    console.warn(`[llm:${provider}] circuit open`, { openMs, consecutive429: circuits[provider].consecutive429 });
    onCircuitStateChange?.({ provider, state: "open", openMs });
}

function noteRecoveryIfNeeded(provider: LlmProviderName, onCircuitStateChange?: (e: CircuitStateChangeEvent) => void): void {
    if (!wasOpen[provider]) return;
    wasOpen[provider] = false;
    console.warn(`[llm:${provider}] circuit close`);
    onCircuitStateChange?.({ provider, state: "close" });
}

/**
 * Executa chamada LLM com:
 * - gate in-flight do provider certo
 * - até N retries em 429 com backoff
 * - circuit breaker (isolado por provider) após 3× 429 seguidos
 *
 * `onCircuitStateChange` é opcional (ver docs/PLANO_MULTI_PROVIDER_IA.md, Fase 9): emite tag de
 * observabilidade sem acoplar `lib/chatbot` a `src/pro/ports` — quem chama decide o que fazer com
 * o evento (ex.: `deps.factory.ts` conecta ao `MetricsPort` já disponível ali).
 */
export async function runLlmWithResilience<T>(
    provider: LlmProviderName,
    fn: () => Promise<T>,
    opts?: {
        maxRetries?: number;
        onCircuitStateChange?: (e: CircuitStateChangeEvent) => void;
        /** Quando setado, aplica teto Redis por company (noisy neighbor). */
        companyId?: string | null;
    }
): Promise<T> {
    const circuit = circuits[provider];
    const runWithGate = IN_FLIGHT_GATE[provider];
    const onCircuitStateChange = opts?.onCircuitStateChange;

    const remaining = getCircuitOpenRemainingMs(provider);
    if (remaining > 0) {
        const err = new Error(`${provider}_circuit_open`);
        (err as { status?: number }).status = 429;
        throw err;
    }

    const maxRetries = Math.min(5, Math.max(0, opts?.maxRetries ?? 3));
    let lastError: unknown;

    const runOnce = () =>
        runWithDistributedLlmCap({
            provider,
            companyId: opts?.companyId,
            fn: () => runWithGate(fn),
        });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const openMs = getCircuitOpenRemainingMs(provider);
        if (openMs > 0 && attempt > 0) {
            const err = new Error(`${provider}_circuit_open`);
            (err as { status?: number }).status = 429;
            throw err;
        }
        try {
            const result = await runOnce();
            circuit.consecutive429 = 0;
            noteRecoveryIfNeeded(provider, onCircuitStateChange);
            return result;
        } catch (error) {
            lastError = error;
            if (!isLlmRateLimitError(error) || attempt >= maxRetries) {
                if (isLlmRateLimitError(error)) {
                    circuit.consecutive429 += 1;
                    if (circuit.consecutive429 >= 3) tripCircuit(provider, onCircuitStateChange);
                }
                throw error;
            }
            circuit.consecutive429 += 1;
            if (circuit.consecutive429 >= 3) tripCircuit(provider, onCircuitStateChange);
            const wait = retryAfterMs(error, attempt);
            console.warn(`[llm:${provider}] 429 backoff`, { attempt, waitMs: wait });
            await sleep(wait);
        }
    }

    throw lastError;
}
