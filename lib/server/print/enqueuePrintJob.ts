import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    normalizePrintCopyTypes,
    type PrintCopyType,
} from "@/lib/print/copyTypes";

type EnqueueArgs = {
    admin: SupabaseClient;
    companyId: string;
    orderId: string;
    source?: string;
    change?: number | null;
    priority?: number;
    /** Se omitido: reprint → cashier; order → settings da loja (RPC). */
    copyTypes?: PrintCopyType[] | null;
};

export type EnqueuePrintResult =
    | {
          ok: true;
          jobs: Array<{ copy_type: string; job_id: string }>;
          skipped: string[];
          jobId: string | null;
      }
    | { ok: false; error: string };

/**
 * Enfileira impressão resolvendo a impressora padrão/ativa da empresa no servidor.
 * Retorna um job por via; `jobId` = primeiro job (compat callers antigos).
 */
export async function enqueuePrintJob(args: EnqueueArgs): Promise<EnqueuePrintResult> {
    const { admin, companyId, orderId } = args;
    const copies =
        args.copyTypes === undefined || args.copyTypes === null
            ? null
            : normalizePrintCopyTypes(args.copyTypes);

    const { data, error } = await admin.rpc("rpc_enqueue_print_job", {
        p_company_id: companyId,
        p_order_id: orderId,
        p_source: args.source ?? "reprint",
        p_change: args.change ?? 0,
        p_priority: args.priority ?? 5,
        p_copy_types: copies && copies.length > 0 ? copies : null,
    });

    if (error) {
        return { ok: false, error: error.message ?? "Erro ao enfileirar impressão" };
    }

    const raw = (data ?? {}) as {
        ok?: boolean;
        jobs?: Array<{ copy_type?: string; job_id?: string }>;
        skipped?: string[];
    };
    const jobs = Array.isArray(raw.jobs)
        ? raw.jobs
              .map((j) => ({
                  copy_type: String(j.copy_type ?? ""),
                  job_id: String(j.job_id ?? ""),
              }))
              .filter((j) => j.job_id)
        : [];
    const skipped = Array.isArray(raw.skipped) ? raw.skipped.map(String) : [];

    if (jobs.length === 0 && skipped.length === 0) {
        return { ok: false, error: "Nenhum job de impressão criado" };
    }

    return {
        ok: true,
        jobs,
        skipped,
        jobId: jobs[0]?.job_id ?? null,
    };
}
