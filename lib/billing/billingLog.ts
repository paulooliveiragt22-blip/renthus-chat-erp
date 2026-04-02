/**
 * Logs de cobrança em uma linha (fácil de filtrar em APM / Vercel).
 */

import "server-only";

export function billingLog(scope: string, message: string, extra?: Record<string, unknown>) {
    const payload = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
    console.log(`[billing:${scope}] ${message}${payload}`);
}
