/**
 * Fila local de cupons (D-P5 / Local Print Bus).
 */

export type LocalPrintJobStatus = "queued" | "printing" | "printed" | "failed";

export type LocalPrintReceipt = {
    clientPrintId: string;
    companyId: string;
    /** Ainda sem order_id no servidor até o sync. */
    localSaleLabel?: string;
    total: number;
    change?: number;
    seller?: string | null;
    items: Array<{ name: string; qty: number; price: number }>;
    payments: Array<{ method: string; value: number }>;
    copyType?: string;
};

export type LocalPrintJob = LocalPrintReceipt & {
    status: LocalPrintJobStatus;
    createdAt: string;
    printedAt: string | null;
    lastError: string | null;
};

export type PrintIntent = {
    clientPrintId: string;
    alreadyPrinted: boolean;
    printedAt: string | null;
    copyType: string;
    receipt?: LocalPrintReceipt;
};

export function createPrintIntentId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `prt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
