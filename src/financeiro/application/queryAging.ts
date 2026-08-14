import type { SupabaseClient } from "@supabase/supabase-js";
import { asMoney } from "@/src/financeiro/domain/money";

export type AgingBucket = {
    customerId: string | null;
    customerName: string;
    totalTitles: number;
    totalOpen: number;
    current: number;
    overdue0To30: number;
    overdue31To60: number;
    overdue61To90: number;
    overdue90Plus: number;
};

export type AgingSummary = {
    totalOpen: number;
    current: number;
    overdue0To30: number;
    overdue31To60: number;
    overdue61To90: number;
    overdue90Plus: number;
    byCustomer: AgingBucket[];
};

type AgingRow = {
    customer_id?: string | null;
    customer_name?: string | null;
    total_titles?: number | null;
    total_open?: number | null;
    current_amount?: number | null;
    overdue_0_30?: number | null;
    overdue_31_60?: number | null;
    overdue_61_90?: number | null;
    overdue_90plus?: number | null;
};

export async function queryAging(
    admin: SupabaseClient,
    companyId: string
): Promise<AgingSummary> {
    const { data, error } = await admin
        .from("v_aging_receivables")
        .select(
            "customer_id, customer_name, total_titles, total_open, current_amount, overdue_0_30, overdue_31_60, overdue_61_90, overdue_90plus"
        )
        .eq("company_id", companyId);

    if (error) throw new Error(error.message);

    const byCustomer: AgingBucket[] = ((data ?? []) as AgingRow[]).map((r) => ({
        customerId: r.customer_id ?? null,
        customerName: String(r.customer_name ?? "—"),
        totalTitles: Number(r.total_titles ?? 0),
        totalOpen: asMoney(r.total_open),
        current: asMoney(r.current_amount),
        overdue0To30: asMoney(r.overdue_0_30),
        overdue31To60: asMoney(r.overdue_31_60),
        overdue61To90: asMoney(r.overdue_61_90),
        overdue90Plus: asMoney(r.overdue_90plus),
    }));

    return {
        totalOpen: byCustomer.reduce((s, r) => s + r.totalOpen, 0),
        current: byCustomer.reduce((s, r) => s + r.current, 0),
        overdue0To30: byCustomer.reduce((s, r) => s + r.overdue0To30, 0),
        overdue31To60: byCustomer.reduce((s, r) => s + r.overdue31To60, 0),
        overdue61To90: byCustomer.reduce((s, r) => s + r.overdue61To90, 0),
        overdue90Plus: byCustomer.reduce((s, r) => s + r.overdue90Plus, 0),
        byCustomer,
    };
}
