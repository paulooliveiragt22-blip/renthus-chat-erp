/**
 * FAQ de status de pedidos recentes — resposta determinística (sem LLM).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    publicMenuOrderCode,
    publicMenuOrderStatusLabel,
} from "@/lib/public-menu/checkout/orderStatusLabel";

const STATUS_RE =
    /\b(?:status|cad[eê]|onde\s+est[aá]|acompanhar|previs[aã]o|meu\s+pedido|meus\s+pedidos)\b/iu;

export function looksLikeOrderStatusQuestion(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 100) return false;
    if (/^(?:btn_status)$/iu.test(t)) return true;
    return STATUS_RE.test(t);
}

type OrderRow = {
    id: string;
    status: string;
    confirmation_status: string | null;
    created_at: string;
};

/**
 * Lista até 3 pedidos recentes do cliente. Null se não houver customerId ou pedidos.
 */
export async function tryBuildOrderStatusReply(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null | undefined;
}): Promise<string | null> {
    const customerId = String(params.customerId ?? "").trim();
    if (!customerId) return null;

    const { data, error } = await params.admin
        .from("orders")
        .select("id, status, confirmation_status, created_at")
        .eq("company_id", params.companyId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(3);

    if (error || !data?.length) return null;

    const lines = (data as OrderRow[]).map((o) => {
        const label = publicMenuOrderStatusLabel(o.status, o.confirmation_status);
        const code = publicMenuOrderCode(o.id);
        return `• ${code}: *${label}*`;
    });

    return `Seus pedidos recentes:\n${lines.join("\n")}\n\nQuer ajuda com algum deles?`;
}
