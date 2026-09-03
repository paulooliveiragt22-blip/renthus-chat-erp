import "server-only";
import type { AdminClient, ChatbotQueueJobRow } from "./types";
import { getPositiveIntEnv } from "./env";
import { tryCoalesceRedisLock } from "./coalesceRedis";

const INBOUND_COALESCE_WINDOW_SECONDS = getPositiveIntEnv("INBOUND_DEDUP_WINDOW_SECONDS", 20);

type CoalesceJob = Pick<
    ChatbotQueueJobRow,
    "id" | "thread_id" | "phone_e164" | "company_id" | "body_text" | "metadata"
>;

function normalizeInboundText(text: string): string {
    return text
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Nunca coalescer IDs que fecham/cancelam pedido ou confirmam endereço (ADR-0005 C1). */
function isCriticalOrderConfirmationText(normalizedText: string): boolean {
    if (!normalizedText) return false;
    const criticalIds = new Set([
        "pro_confirm_order",
        "btn_confirm_order",
        "btn_confirmar",
        "pro_cancel_order",
        "btn_cancel_order",
        "pro_confirm_saved_address",
        "pro_confirm_typed_address",
    ]);
    return criticalIds.has(normalizedText);
}

function shouldSkipCoalesceByPayload(params: {
    normalizedText: string;
    messageType?: string | null;
}): boolean {
    const { normalizedText, messageType } = params;
    if (!normalizedText) return true;
    if (isCriticalOrderConfirmationText(normalizedText)) return true;
    if (normalizedText.length <= 6) return true;
    if (messageType === "interactive") return true;
    return false;
}

/**
 * Chave de dedup pra mensagens inbound equivalentes chegando em rajada (retry do provider,
 * duplo tap do cliente). `null` quando o payload não é elegível pra coalescer (texto curto,
 * confirmação crítica de pedido, mensagem interativa) — nunca coalescer o que pode fechar pedido.
 */
function buildCoalesceKey(
    threadId: string | null | undefined,
    phoneE164: string | null | undefined,
    companyId: string | null | undefined,
    bodyText: string | null | undefined,
    messageType?: string | null
): string | null {
    const owner = phoneE164 || threadId || companyId || "global";
    if (!owner || !bodyText) return null;
    const normalized = normalizeInboundText(bodyText);
    if (shouldSkipCoalesceByPayload({ normalizedText: normalized, messageType })) return null;
    return `${owner}::${normalized}`;
}

/**
 * Deve coalescer este inbound? Redis SET NX primeiro; fallback PG se Upstash indisponível.
 * `seenInBatch` cobre duplicatas no mesmo batch Lambda/SQS.
 */
async function shouldCoalesceInbound(
    admin: AdminClient,
    job: CoalesceJob,
    coalesceKey: string,
    seenInBatch: Set<string>
): Promise<boolean> {
    if (seenInBatch.has(coalesceKey)) return true;

    const redis = await tryCoalesceRedisLock(coalesceKey);
    if (redis === "duplicate") return true;
    if (redis === "acquired") return false;

    return hasRecentEquivalentProcessed(admin, job, coalesceKey);
}

/** Já existe um job equivalente (mesma chave de coalesce) processado/processando na janela recente? */
async function hasRecentEquivalentProcessed(
    admin: AdminClient,
    job: CoalesceJob,
    coalesceKey: string
): Promise<boolean> {
    const threadId = job.thread_id;
    const phoneE164 = job.phone_e164;
    const companyId = job.company_id;
    if (!threadId && !phoneE164 && !companyId) return false;
    const cutoff = new Date(Date.now() - INBOUND_COALESCE_WINDOW_SECONDS * 1000).toISOString();
    const [byThread, byPhone, byCompany] = await Promise.all([
        threadId
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("thread_id", threadId)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
        phoneE164
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("phone_e164", phoneE164)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
        companyId
            ? admin
                .from("chatbot_queue")
                .select("id, thread_id, phone_e164, company_id, body_text, metadata")
                .eq("company_id", companyId)
                .in("status", ["done", "processing"])
                .gte("created_at", cutoff)
                .limit(30)
            : Promise.resolve({ data: [], error: null }),
    ]);

    const recent = [...(byThread.data ?? []), ...(byPhone.data ?? []), ...(byCompany.data ?? [])] as Array<
        Pick<ChatbotQueueJobRow, "id" | "thread_id" | "phone_e164" | "company_id" | "body_text" | "metadata">
    >;
    for (const row of recent) {
        if (row.id === job.id) continue;
        const key = buildCoalesceKey(
            row.thread_id,
            row.phone_e164,
            row.company_id,
            row.body_text,
            row.metadata?.message_type ?? null
        );
        if (key && key === coalesceKey) return true;
    }
    return false;
}

export {
    buildCoalesceKey,
    hasRecentEquivalentProcessed,
    shouldCoalesceInbound,
    normalizeInboundText,
    isCriticalOrderConfirmationText,
    shouldSkipCoalesceByPayload,
};
