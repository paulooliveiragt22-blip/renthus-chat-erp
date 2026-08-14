import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimezone, DEFAULT_STORE_TIMEZONE } from "@/lib/delivery/hours";
import { todayIsoInZone, zonedDayRange } from "@/src/financeiro/domain/dayBounds";
import { rpcCashRevenue } from "@/src/financeiro/adapters/supabase/financeQuery.supabase";
import type { CashRevenueSummary } from "@/src/financeiro/ports/financeQuery.port";

export type ReceivedIncomeSummary = CashRevenueSummary;

export async function loadCompanyTimezone(
    admin: SupabaseClient,
    companyId: string
): Promise<string> {
    const { data } = await admin
        .from("company_settings")
        .select("timezone")
        .eq("company_id", companyId)
        .maybeSingle();
    return normalizeTimezone(data?.timezone) || DEFAULT_STORE_TIMEZONE;
}

export async function fetchReceivedIncome(
    admin: SupabaseClient,
    companyId: string,
    range: { from: Date; toExclusive: Date },
    timeZone: string
): Promise<ReceivedIncomeSummary> {
    return rpcCashRevenue(admin, companyId, range, timeZone);
}

/** Intervalo inclusivo de datas civis YYYY-MM-DD no fuso da loja → UTC. */
export function civilRangeToUtcBounds(
    fromIsoDate: string,
    toIsoDate: string,
    timeZone: string
): { from: Date; toExclusive: Date } {
    const start = zonedDayRange(fromIsoDate, timeZone).start;
    const endExclusive = zonedDayRange(toIsoDate, timeZone).endExclusive;
    return { from: start, toExclusive: endExclusive };
}

export async function receivedIncomeToday(
    admin: SupabaseClient,
    companyId: string,
    now = new Date()
): Promise<{ total: number; count: number; timeZone: string; day: string }> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const day = todayIsoInZone(now, timeZone);
    const { start, endExclusive } = zonedDayRange(day, timeZone);
    const summary = await fetchReceivedIncome(
        admin,
        companyId,
        { from: start, toExclusive: endExclusive },
        timeZone
    );
    return { total: summary.total, count: summary.count, timeZone, day };
}
