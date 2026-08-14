import type { SupabaseClient } from "@supabase/supabase-js";

export type CashRevenueSummary = {
    total: number;
    count: number;
    byDay: Array<{ day: string; amount: number; entries_count: number }>;
    byPaymentMethod: Array<{ method: string; amount: number; entries_count: number }>;
    byOrigin: Array<{ origin: string; amount: number; entries_count: number }>;
};

export type FinanceDashboardRpc = CashRevenueSummary & {
    cogs: number;
    opexPaid: number;
    arOpen: number;
};

export type FinanceQueryPort = {
    cashRevenue(
        admin: SupabaseClient,
        companyId: string,
        range: { from: Date; toExclusive: Date },
        timeZone: string
    ): Promise<CashRevenueSummary>;
    dashboard(
        admin: SupabaseClient,
        companyId: string,
        range: { from: Date; toExclusive: Date },
        timeZone: string
    ): Promise<FinanceDashboardRpc>;
};
