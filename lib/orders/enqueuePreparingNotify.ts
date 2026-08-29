import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Enfileira aviso transacional "em preparo" (best-effort).
 * Falha de Meta/fila não deve desfazer o status.
 */
export async function enqueuePreparingNotify(params: {
    admin: SupabaseClient;
    companyId: string;
    orderId: string;
    orderCode: string;
    customerId: string | null;
    fulfillmentType?: string | null;
}): Promise<{ enqueued: boolean; reason?: string; job?: { id: string; company_id: string; thread_id: string } }> {
    const { admin, companyId, orderId, orderCode, customerId, fulfillmentType } = params;
    if (!customerId) return { enqueued: false, reason: "no_customer" };

    const { data: customer } = await admin
        .from("customers")
        .select("phone")
        .eq("id", customerId)
        .eq("company_id", companyId)
        .maybeSingle();

    const phoneRaw = String(customer?.phone ?? "").trim();
    const digits = phoneRaw.replaceAll(/\D/g, "");
    const phoneE164 = phoneRaw.startsWith("+")
        ? phoneRaw
        : digits
          ? digits.startsWith("55")
              ? `+${digits}`
              : `+55${digits}`
          : "";
    if (!phoneE164.startsWith("+") || phoneE164.length < 12) {
        return { enqueued: false, reason: "no_phone" };
    }

    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, channel")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!thread?.id) {
        return { enqueued: false, reason: "no_thread" };
    }

    const channel = String(thread.channel ?? "whatsapp");
    // IG/Messenger só se a thread já existir nesse canal (gate de feature fica no inbound).
    if (channel !== "whatsapp" && channel !== "instagram" && channel !== "messenger") {
        return { enqueued: false, reason: "unsupported_channel" };
    }

    const readyLine =
        String(fulfillmentType ?? "").toLowerCase() === "pickup"
            ? "Avisamos assim que estiver pronto para retirada."
            : "Avisamos assim que sair para entrega.";

    const text =
        `🍳 Seu pedido ${orderCode} está em preparo!\n` + readyLine;

    const { data: upserted, error } = await admin.from("outbound_jobs").upsert(
        {
            company_id: companyId,
            thread_id: thread.id,
            phone_e164: String(thread.phone_e164 ?? phoneE164),
            purpose: "transactional",
            payload: { kind: "text", text },
            dedup_key: `order_preparing:${orderId}`,
            source_id: orderId,
            scheduled_at: new Date().toISOString(),
        },
        { onConflict: "company_id,dedup_key", ignoreDuplicates: true }
    ).select("id, company_id, thread_id").maybeSingle();

    if (error) {
        console.warn("[orders] enqueue preparing notify:", error.message);
        return { enqueued: false, reason: "enqueue_failed" };
    }
    // ignoreDuplicates: se já existia, select pode ser null — lookup por dedup
    if (upserted?.id) {
        return {
            enqueued: true,
            job: {
                id: String(upserted.id),
                company_id: String(upserted.company_id),
                thread_id: String(upserted.thread_id),
            },
        };
    }
    const { data: existing } = await admin
        .from("outbound_jobs")
        .select("id, company_id, thread_id")
        .eq("company_id", companyId)
        .eq("dedup_key", `order_preparing:${orderId}`)
        .maybeSingle();
    if (existing?.id) {
        return {
            enqueued: true,
            job: {
                id: String(existing.id),
                company_id: String(existing.company_id),
                thread_id: String(existing.thread_id),
            },
        };
    }
    return { enqueued: true };
}
