/**
 * Wake HTTP do worker `GET /api/chatbot/outbound-worker`.
 *
 * Mesmo padrão do `queueWorkerWake`: o scheduler externo é rede de segurança,
 * o caminho feliz é o detector chamar o worker logo após enfileirar. Sem isso a
 * mensagem de recuperação só sai no próximo tick do cron.
 *
 * Não há risco de loop: o worker não acorda o detector.
 */

import { resolveQueueWorkerWakeOrigin } from "@/lib/chatbot/queueWorkerWake";

function wakeEnabled(): boolean {
    return process.env.OUTBOUND_WORKER_WAKE_ENABLED !== "0";
}

export function scheduleOutboundWorkerWake(reason = "wake"): void {
    if (!wakeEnabled()) return;

    const origin = resolveQueueWorkerWakeOrigin();
    const secret = process.env.CRON_SECRET?.trim();
    if (!origin || !secret) {
        if (process.env.NODE_ENV === "development") {
            console.warn(
                "[outbound-wake] skipped: define CRON_SECRET e NEXT_PUBLIC_APP_URL (ou CHATBOT_QUEUE_WAKE_URL / APP_INTERNAL_URL)"
            );
        }
        return;
    }

    void fetch(`${origin}/api/chatbot/outbound-worker`, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
    })
        .then((res) => {
            if (!res.ok) {
                console.warn("[outbound-wake] HTTP", res.status, res.statusText, { reason });
            }
        })
        .catch((err: unknown) => {
            console.warn(
                "[outbound-wake] fetch failed:",
                err instanceof Error ? err.message : err,
                { reason }
            );
        });
}
