import type { LocalPrintJob, LocalPrintReceipt } from "../domain/LocalPrintJob";

export type LocalPrintQueue = {
    enqueue(receipt: LocalPrintReceipt): Promise<LocalPrintJob>;
    markPrinted(clientPrintId: string, printedAt?: string): Promise<void>;
    markFailed(clientPrintId: string, error: string): Promise<void>;
    get(clientPrintId: string): Promise<LocalPrintJob | null>;
    listQueued(companyId: string): Promise<LocalPrintJob[]>;
};

export function createMemoryLocalPrintQueue(): LocalPrintQueue {
    const byId = new Map<string, LocalPrintJob>();
    return {
        async enqueue(receipt) {
            const job: LocalPrintJob = {
                ...receipt,
                status: "queued",
                createdAt: new Date().toISOString(),
                printedAt: null,
                lastError: null,
            };
            byId.set(job.clientPrintId, job);
            return { ...job };
        },
        async markPrinted(clientPrintId, printedAt) {
            const row = byId.get(clientPrintId);
            if (!row) throw new Error(`local_print_missing:${clientPrintId}`);
            byId.set(clientPrintId, {
                ...row,
                status: "printed",
                printedAt: printedAt ?? new Date().toISOString(),
                lastError: null,
            });
        },
        async markFailed(clientPrintId, error) {
            const row = byId.get(clientPrintId);
            if (!row) throw new Error(`local_print_missing:${clientPrintId}`);
            byId.set(clientPrintId, { ...row, status: "failed", lastError: error });
        },
        async get(clientPrintId) {
            const row = byId.get(clientPrintId);
            return row ? { ...row } : null;
        },
        async listQueued(companyId) {
            return [...byId.values()]
                .filter((j) => j.companyId === companyId && j.status === "queued")
                .map((j) => ({ ...j }));
        },
    };
}
