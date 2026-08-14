import type { SupabaseClient } from "@supabase/supabase-js";
import { asMoney } from "@/src/financeiro/domain/money";
import type {
    CashRevenueSummary,
    FinanceDashboardRpc,
    FinanceQueryPort,
} from "@/src/financeiro/ports/financeQuery.port";

function parseCash(raw: Record<string, unknown> | null): CashRevenueSummary {
    const src = raw ?? {};
    const byDayRaw = Array.isArray(src.by_day) ? src.by_day : [];
    const byPayRaw = Array.isArray(src.by_payment_method) ? src.by_payment_method : [];
    const byOriRaw = Array.isArray(src.by_origin) ? src.by_origin : [];
    return {
        total: asMoney(src.total),
        count: Number(src.count ?? 0),
        byDay: byDayRaw.map((r: Record<string, unknown>) => ({
            day: String(r.day ?? "").slice(0, 10),
            amount: asMoney(r.amount),
            entries_count: Number(r.entries_count ?? 0),
        })),
        byPaymentMethod: byPayRaw.map((r: Record<string, unknown>) => ({
            method: String(r.method ?? "outros"),
            amount: asMoney(r.amount),
            entries_count: Number(r.entries_count ?? 0),
        })),
        byOrigin: byOriRaw.map((r: Record<string, unknown>) => ({
            origin: String(r.origin ?? "pdv"),
            amount: asMoney(r.amount),
            entries_count: Number(r.entries_count ?? 0),
        })),
    };
}

export const financeQuerySupabase: FinanceQueryPort = {
    async cashRevenue(admin, companyId, range, timeZone) {
        const { data, error } = await admin.rpc("rpc_fin_cash_revenue", {
            p_company_id: companyId,
            p_from: range.from.toISOString(),
            p_to: range.toExclusive.toISOString(),
            p_timezone: timeZone,
        });
        if (error) throw new Error(error.message);
        return parseCash((data ?? {}) as Record<string, unknown>);
    },

    async dashboard(admin, companyId, range, timeZone) {
        const { data, error } = await admin.rpc("rpc_fin_dashboard", {
            p_company_id: companyId,
            p_from: range.from.toISOString(),
            p_to: range.toExclusive.toISOString(),
            p_timezone: timeZone,
        });
        if (error) throw new Error(error.message);
        const raw = (data ?? {}) as Record<string, unknown>;
        return {
            ...parseCash(raw),
            cogs: asMoney(raw.cogs),
            opexPaid: asMoney(raw.opex_paid),
            arOpen: asMoney(raw.ar_open),
        };
    },
};

export async function rpcCashRevenue(
    admin: SupabaseClient,
    companyId: string,
    range: { from: Date; toExclusive: Date },
    timeZone: string
): Promise<CashRevenueSummary> {
    return financeQuerySupabase.cashRevenue(admin, companyId, range, timeZone);
}
