import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrintIntent } from "../domain/LocalPrintJob";

/**
 * Após criar o pedido no sync: se cupom já foi impresso offline, grava print_jobs done
 * (não pending) para o agent cloud não reimprimir.
 */
export async function recordOfflinePrintIfNeeded(args: {
    admin: SupabaseClient;
    companyId: string;
    orderId: string;
    printIntent?: PrintIntent | null;
}): Promise<{ recorded: boolean; jobId?: string; error?: string }> {
    const intent = args.printIntent;
    if (!intent?.alreadyPrinted || !intent.clientPrintId) {
        return { recorded: false };
    }

    const { data, error } = await args.admin.rpc("rpc_record_offline_print_done", {
        p_company_id: args.companyId,
        p_order_id: args.orderId,
        p_client_print_id: intent.clientPrintId,
        p_copy_type: intent.copyType ?? "cashier",
        p_payload: intent.receipt
            ? {
                  type: "receipt",
                  total: intent.receipt.total,
                  items: intent.receipt.items,
                  payments: intent.receipt.payments,
              }
            : {},
        p_printed_at: intent.printedAt ?? new Date().toISOString(),
    });

    if (error) {
        return { recorded: false, error: error.message };
    }

    return { recorded: true, jobId: data ? String(data) : undefined };
}
