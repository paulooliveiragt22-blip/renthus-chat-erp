/**
 * Contrato do Print Agent — Local Print Bridge (ADR-0008 D-P5 / P1.8)
 *
 * O PWA tenta, nesta ordem:
 * 1. `window.electronAPI.printOrder` (desktop legado)
 * 2. POST `http://127.0.0.1:17890/local-print` (bridge no agent)
 *
 * Request JSON (LocalPrintReceipt):
 * {
 *   clientPrintId: string (UUID),
 *   companyId: string,
 *   total: number,
 *   change?: number,
 *   seller?: string,
 *   items: [{ name, qty, price }],
 *   payments: [{ method, value }],
 *   copyType?: "cashier" | ...
 * }
 *
 * Response: 200 OK = impresso. Qualquer falha/timeout → PWA segue com
 * printIntent.alreadyPrinted=false e o sync pode enfileirar pending normal.
 *
 * No sync: se alreadyPrinted=true, ERP chama rpc_record_offline_print_done
 * → print_jobs status=done + unique (company_id, client_print_id).
 * O poll cloud do agent NÃO deve pegar esses jobs.
 */

export const LOCAL_PRINT_BRIDGE_PORT = 17890;
export const LOCAL_PRINT_BRIDGE_PATH = "/local-print";
