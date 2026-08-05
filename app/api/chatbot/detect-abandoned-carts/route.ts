/**
 * app/api/chatbot/detect-abandoned-carts/route.ts
 *
 * Detecta rascunhos parados com itens e enfileira a mensagem de recuperação.
 *
 * A detecção roda em SQL (`detect_abandoned_carts`) porque o rascunho vive no
 * jsonb da sessão e a sessão expira em ~2h — o snapshot precisa ser tirado
 * antes disso, e o índice parcial único faz a deduplicação por thread.
 *
 * Gatilho: scheduler externo a cada ~5 min (o cron nativo diário é só backup).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { buildCartRecoveryMessage } from "@/lib/chatbot/outbound/cartRecoveryMessage";

export const runtime = "nodejs";
export const maxDuration = 60;

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

const IDLE_MINUTES = getPositiveIntEnv("CART_RECOVERY_IDLE_MINUTES", 25);
const DETECT_LIMIT = getPositiveIntEnv("CART_RECOVERY_DETECT_LIMIT", 50);
const CART_MAX_AGE_HOURS = getPositiveIntEnv("CART_RECOVERY_MAX_AGE_HOURS", 48);

type Admin = ReturnType<typeof createAdminClient>;

interface DetectedCart {
    id: string;
    company_id: string;
    thread_id: string;
    customer_id: string | null;
    phone_e164: string;
    draft: { items?: unknown; grandTotal?: unknown; deliveryFee?: unknown } | null;
    item_count: number;
    grand_total: number | null;
}

export async function GET(req: Request) {
    const authError = validateCronAuthorization(req.headers.get("authorization"));
    if (authError) return authError;

    const admin = createAdminClient();
    const t0 = Date.now();

    const { data, error } = await admin.rpc("detect_abandoned_carts", {
        p_idle_minutes: IDLE_MINUTES,
        p_limit: DETECT_LIMIT,
    });

    if (error) {
        console.error("[detect-abandoned-carts] rpc falhou:", error.message);
        return NextResponse.json(
            { ok: false, error: "detect_rpc_failed", ms: Date.now() - t0 },
            { status: 503 }
        );
    }

    const carts = (data ?? []) as DetectedCart[];
    const { enqueued, discarded } = await enqueueRecoveryJobs(admin, carts);
    const expired = await expireStaleCarts(admin);

    const result = { detected: carts.length, enqueued, discarded, expired };
    console.info("[metric] cart_recovery_detect", { ...result, ms: Date.now() - t0 });

    return NextResponse.json({ ok: true, ...result, ms: Date.now() - t0 });
}

async function enqueueRecoveryJobs(
    admin: Admin,
    carts: DetectedCart[]
): Promise<{ enqueued: number; discarded: number }> {
    if (carts.length === 0) return { enqueued: 0, discarded: 0 };

    const names = await loadCustomerNames(admin, carts);
    const jobs: Array<Record<string, unknown>> = [];
    const emptyCartIds: string[] = [];

    for (const cart of carts) {
        const payload = buildCartRecoveryMessage({
            draft: cart.draft,
            customerName: names.get(cart.thread_id) ?? null,
        });
        if (!payload) {
            emptyCartIds.push(cart.id);
            continue;
        }
        jobs.push({
            company_id: cart.company_id,
            thread_id: cart.thread_id,
            phone_e164: cart.phone_e164,
            purpose: "cart_recovery",
            payload,
            dedup_key: `cart_recovery:${cart.id}`,
            source_id: cart.id,
        });
    }

    if (emptyCartIds.length > 0) {
        await admin.from("abandoned_carts").update({ status: "discarded" }).in("id", emptyCartIds);
    }

    if (jobs.length === 0) {
        return { enqueued: 0, discarded: emptyCartIds.length };
    }

    const { error } = await admin
        .from("outbound_jobs")
        .upsert(jobs, { onConflict: "company_id,dedup_key", ignoreDuplicates: true });

    if (error) {
        console.error("[detect-abandoned-carts] enqueue falhou:", error.message);
        return { enqueued: 0, discarded: emptyCartIds.length };
    }

    return { enqueued: jobs.length, discarded: emptyCartIds.length };
}

async function expireStaleCarts(admin: Admin): Promise<number> {
    const { data, error } = await admin.rpc("expire_stale_abandoned_carts", {
        p_max_age_hours: CART_MAX_AGE_HOURS,
    });
    if (error) {
        console.warn("[detect-abandoned-carts] expire falhou:", error.message);
        return 0;
    }
    return Number(data ?? 0) || 0;
}

/** Nome para personalizar a mensagem: cliente cadastrado tem prioridade sobre o profile do WhatsApp. */
async function loadCustomerNames(
    admin: Admin,
    carts: DetectedCart[]
): Promise<Map<string, string>> {
    const byThread = new Map<string, string>();

    const { data: threads } = await admin
        .from("whatsapp_threads")
        .select("id, profile_name")
        .in("id", carts.map((c) => c.thread_id));
    for (const row of threads ?? []) {
        const name = String(row.profile_name ?? "").trim();
        if (name) byThread.set(String(row.id), name);
    }

    const customerIds = carts.map((c) => c.customer_id).filter((id): id is string => Boolean(id));
    if (customerIds.length === 0) return byThread;

    const { data: customers } = await admin
        .from("customers")
        .select("id, name")
        .in("id", customerIds);
    const nameById = new Map<string, string>();
    for (const row of customers ?? []) {
        const name = String(row.name ?? "").trim();
        if (name) nameById.set(String(row.id), name);
    }

    for (const cart of carts) {
        const name = cart.customer_id ? nameById.get(cart.customer_id) : undefined;
        if (name) byThread.set(cart.thread_id, name);
    }

    return byThread;
}
