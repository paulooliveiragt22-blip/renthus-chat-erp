/**
 * Fetch Meta Graph com throttle por phone_number_id + retry em 429 (Retry-After).
 */

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function minGapMs(): number {
    const raw = Number(process.env.WHATSAPP_MIN_GAP_MS ?? "100");
    if (!Number.isFinite(raw) || raw < 0) return 100;
    return Math.min(2_000, Math.floor(raw));
}

function maxRetries(): number {
    const raw = Number(process.env.WHATSAPP_429_MAX_RETRIES ?? "3");
    if (!Number.isFinite(raw) || raw < 0) return 3;
    return Math.min(5, Math.floor(raw));
}

/** Último envio por phoneNumberId (throttle local por instância). */
const lastSendAt = new Map<string, number>();
const phoneChains = new Map<string, Promise<void>>();

/** Só para testes unitários. */
export function resetMetaGraphThrottleForTests(): void {
    lastSendAt.clear();
    phoneChains.clear();
}

async function throttlePhone(phoneNumberId: string): Promise<void> {
    const gap = minGapMs();
    if (gap <= 0) return;

    const prev = phoneChains.get(phoneNumberId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    });
    phoneChains.set(
        phoneNumberId,
        prev.then(() => gate).catch(() => gate)
    );

    await prev.catch(() => undefined);
    const last = lastSendAt.get(phoneNumberId) ?? 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastSendAt.set(phoneNumberId, Date.now());
    release();
}

function retryWaitMs(res: Response, attempt: number): number {
    const ra = res.headers.get("retry-after");
    if (ra) {
        const sec = Number(ra);
        if (Number.isFinite(sec) && sec >= 0) return Math.min(60_000, sec * 1000);
    }
    return Math.min(16_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
}

export type MetaGraphPostResult = {
    ok: boolean;
    status: number;
    json: Record<string, unknown>;
};

/** POST JSON ao Graph API com throttle + retry 429. */
export async function metaGraphPostJson(
    phoneNumberId: string,
    url: string,
    init: {
        accessToken: string;
        body: unknown;
    }
): Promise<MetaGraphPostResult> {
    await throttlePhone(phoneNumberId);

    const retries = maxRetries();
    let lastStatus = 0;
    let lastJson: Record<string, unknown> = {};

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${init.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(init.body),
        });
        lastStatus = res.status;
        lastJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        if (res.status !== 429 || attempt >= retries) {
            return { ok: res.ok, status: res.status, json: lastJson };
        }

        const wait = retryWaitMs(res, attempt);
        console.warn("[meta-graph] 429 backoff", {
            phoneNumberId,
            attempt,
            waitMs: wait,
        });
        await sleep(wait);
        await throttlePhone(phoneNumberId);
    }

    return { ok: false, status: lastStatus, json: lastJson };
}
