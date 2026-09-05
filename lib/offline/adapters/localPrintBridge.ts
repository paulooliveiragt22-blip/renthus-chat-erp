/**
 * Bridge localhost → Print Agent (D-P5).
 * Contrato: POST http://127.0.0.1:17890/local-print
 * Body: LocalPrintReceipt JSON. 200 = impresso.
 * Electron: window.electronAPI.printOrder (legado PDV).
 */

import type { LocalPrintReceipt, PrintIntent } from "../domain/LocalPrintJob";
import { createPrintIntentId } from "../domain/LocalPrintJob";

export const LOCAL_PRINT_BRIDGE_DEFAULT_URL = "http://127.0.0.1:17890/local-print";

type ElectronPrintApi = {
    printOrder?: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
};

function getElectronPrint(): ElectronPrintApi | null {
    if (typeof window === "undefined") return null;
    const api = (window as unknown as { electronAPI?: ElectronPrintApi }).electronAPI;
    return api ?? null;
}

export async function tryLocalPrint(
    receipt: LocalPrintReceipt,
    options?: { bridgeUrl?: string; timeoutMs?: number }
): Promise<PrintIntent> {
    const clientPrintId = receipt.clientPrintId || createPrintIntentId();
    const payload: LocalPrintReceipt = { ...receipt, clientPrintId };
    const timeoutMs = options?.timeoutMs ?? 8_000;

    const electron = getElectronPrint();
    if (electron?.printOrder) {
        try {
            await Promise.resolve(
                electron.printOrder({
                    orderId: clientPrintId,
                    total: payload.total,
                    change: payload.change ?? 0,
                    seller: payload.seller ?? null,
                    items: payload.items,
                    payments: payload.payments,
                    clientPrintId,
                    offline: true,
                })
            );
            return {
                clientPrintId,
                alreadyPrinted: true,
                printedAt: new Date().toISOString(),
                copyType: payload.copyType ?? "cashier",
                receipt: payload,
            };
        } catch (e) {
            console.warn("[localPrint] electron failed, trying bridge", e);
        }
    }

    const bridgeUrl = options?.bridgeUrl ?? LOCAL_PRINT_BRIDGE_DEFAULT_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(bridgeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        if (res.ok) {
            return {
                clientPrintId,
                alreadyPrinted: true,
                printedAt: new Date().toISOString(),
                copyType: payload.copyType ?? "cashier",
                receipt: payload,
            };
        }
        return {
            clientPrintId,
            alreadyPrinted: false,
            printedAt: null,
            copyType: payload.copyType ?? "cashier",
            receipt: payload,
        };
    } catch {
        return {
            clientPrintId,
            alreadyPrinted: false,
            printedAt: null,
            copyType: payload.copyType ?? "cashier",
            receipt: payload,
        };
    } finally {
        clearTimeout(timer);
    }
}
