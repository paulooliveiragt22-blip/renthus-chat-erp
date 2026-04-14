import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type EnqueueArgs = {
    admin: SupabaseClient;
    companyId: string;
    orderId: string;
    source?: string;
    change?: number | null;
    priority?: number;
};

/**
 * Enfileira impressão resolvendo a impressora padrão/ativa da empresa no servidor.
 */
export async function enqueuePrintJob(args: EnqueueArgs): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
    const { admin, companyId, orderId } = args;

    const { data: jobId, error } = await admin.rpc("rpc_enqueue_print_job", {
        p_company_id: companyId,
        p_order_id: orderId,
        p_source: args.source ?? "reprint",
        p_change: args.change ?? 0,
        p_priority: args.priority ?? 5,
    });

    if (error || !jobId) {
        return { ok: false, error: error?.message ?? "Erro ao enfileirar impressão" };
    }
    return { ok: true, jobId: String(jobId) };
}
