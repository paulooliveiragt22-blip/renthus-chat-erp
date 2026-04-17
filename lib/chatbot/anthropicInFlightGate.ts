/**
 * Limite simples de chamadas Anthropic em paralelo **por instância** do runtime
 * (serverless: não partilha entre réplicas; ainda reduz picos locais e 429 em cascata).
 */
function maxInFlight(): number {
    const raw = process.env.ANTHROPIC_CHATBOT_MAX_IN_FLIGHT?.trim();
    const n = raw ? Number.parseInt(raw, 10) : 8;
    if (!Number.isFinite(n) || n < 1) return 8;
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

/** Executa `fn` com teto de `messages.create` concorrentes neste processo. */
export async function runWithAnthropicInFlightSlot<T>(fn: () => Promise<T>): Promise<T> {
    await acquireSlot();
    try {
        return await fn();
    } finally {
        releaseSlot();
    }
}
