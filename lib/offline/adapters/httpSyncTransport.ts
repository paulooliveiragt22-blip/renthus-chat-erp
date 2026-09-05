import type { SyncBatchRequest, SyncBatchResponse, SyncTransport } from "../ports/SyncTransport";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Transporte HTTP do outbox (Perf-3: batch).
 * P0: a rota responde 501 — não aplica mutação de negócio.
 */
export function createHttpSyncTransport(
    options: { endpoint?: string; timeoutMs?: number } = {}
): SyncTransport {
    const endpoint = options.endpoint ?? "/api/offline/sync";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return {
        async sendBatch(request: SyncBatchRequest, externalSignal?: AbortSignal): Promise<SyncBatchResponse> {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const onAbort = () => controller.abort();
            externalSignal?.addEventListener("abort", onAbort);

            try {
                const res = await fetch(endpoint, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        companyId: request.companyId,
                        commands: request.commands.map((c) => ({
                            id: c.id,
                            type: c.type,
                            clientMutationId: c.clientMutationId,
                            payload: c.payload,
                            createdAt: c.createdAt,
                        })),
                    }),
                    signal: controller.signal,
                });

                const json = (await res.json().catch(() => ({}))) as Partial<SyncBatchResponse> & {
                    error?: string;
                };

                if (res.status === 501) {
                    return {
                        notImplemented: true,
                        results: request.commands.map((c) => ({
                            clientMutationId: c.clientMutationId,
                            outcome: "failed" as const,
                            error: json.error ?? "offline_sync_not_implemented",
                        })),
                    };
                }

                if (!res.ok) {
                    const msg = json.error ?? `http_${res.status}`;
                    return {
                        results: request.commands.map((c) => ({
                            clientMutationId: c.clientMutationId,
                            outcome: "failed" as const,
                            error: msg,
                        })),
                    };
                }

                return {
                    results: json.results ?? [],
                    notImplemented: json.notImplemented,
                };
            } finally {
                clearTimeout(timer);
                externalSignal?.removeEventListener("abort", onAbort);
            }
        },
    };
}

/** Transport mock para testes / dry flush. */
export function createMockSyncTransport(
    handler: (req: SyncBatchRequest) => Promise<SyncBatchResponse> | SyncBatchResponse
): SyncTransport {
    return {
        sendBatch: async (request) => handler(request),
    };
}
