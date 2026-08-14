import type { ChatbotQueueJobRow } from "./types";

/**
 * Agrupa jobs já intercalados por empresa em buckets por `thread_id`, preservando a
 * ordem relativa dentro de cada conversa. Jobs sem `thread_id` nunca compartilham bucket
 * (cada um vira conversa isolada) — evita juntar mensagens de origens distintas.
 */
export function groupQueueJobsByThread<T extends Pick<ChatbotQueueJobRow, "thread_id">>(
    jobs: T[]
): T[][] {
    const order: string[] = [];
    const buckets = new Map<string, T[]>();
    for (const job of jobs) {
        const key = job.thread_id || `__no_thread_${buckets.size}`;
        if (!buckets.has(key)) {
            buckets.set(key, []);
            order.push(key);
        }
        buckets.get(key)!.push(job);
    }
    return order.map((key) => buckets.get(key)!);
}
