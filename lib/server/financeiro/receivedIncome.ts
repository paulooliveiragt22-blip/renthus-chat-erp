import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimezone, DEFAULT_STORE_TIMEZONE } from "@/lib/delivery/hours";
import { todayIsoInZone, zonedDayRange } from "@/lib/server/financeiro/dayBounds";

export type ReceivedIncomeSummary = {
    total: number;
    count: number;
    byDay: Array<{ day: string; amount: number; entries_count: number }>;
    byPaymentMethod: Array<{ method: string; amount: number; entries_count: number }>;
    byOrigin: Array<{ origin: string; amount: number; entries_count: number }>;
};

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
    const { data, error } = await admin.rpc("rpc_company_received_income", {
        p_company_id: companyId,
        p_from: range.from.toISOString(),
        p_to: range.toExclusive.toISOString(),
        p_timezone: timeZone,
    });

    if (error) throw new Error(error.message);

    const raw = (data ?? {}) as Record<string, unknown>;
    const byDayRaw = Array.isArray(raw.by_day) ? raw.by_day : [];
    const byPayRaw = Array.isArray(raw.by_payment_method) ? raw.by_payment_method : [];
    const byOriRaw = Array.isArray(raw.by_origin) ? raw.by_origin : [];

    return {
        total: Number(raw.total ?? 0),
        count: Number(raw.count ?? 0),
        byDay: byDayRaw.map((r: Record<string, unknown>) => ({
            day: String(r.day ?? "").slice(0, 10),
            amount: Number(r.amount ?? 0),
            entries_count: Number(r.entries_count ?? 0),
        })),
        byPaymentMethod: byPayRaw.map((r: Record<string, unknown>) => ({
            method: String(r.method ?? "outros"),
            amount: Number(r.amount ?? 0),
            entries_count: Number(r.entries_count ?? 0),
        })),
        byOrigin: byOriRaw.map((r: Record<string, unknown>) => ({
            origin: String(r.origin ?? "balcao"),
            amount: Number(r.amount ?? 0),
            entries_count: Number(r.entries_count ?? 0),
        })),
    };
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
    const summary = await fetchReceivedIncome(admin, companyId, { from: start, toExclusive: endExclusive }, timeZone);
    return { total: summary.total, count: summary.count, timeZone, day };
}
