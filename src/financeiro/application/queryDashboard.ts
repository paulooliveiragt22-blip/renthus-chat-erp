import type { SupabaseClient } from "@supabase/supabase-js";
import {
    civilRangeToUtcBounds,
    loadCompanyTimezone,
} from "@/src/financeiro/application/cashRevenue";
import { financeQuerySupabase } from "@/src/financeiro/adapters/supabase/financeQuery.supabase";
import { asMoney } from "@/src/financeiro/domain/money";
import { FINANCE_ORIGINS, normalizeFinanceOrigin } from "@/src/financeiro/domain/origin";

export type DaySummary = {
    isoDate: string;
    label: string;
    revenue: number;
    cost: number;
    orders: number;
    expensesDay: number;
};

export type PaySummary = { method: string; label: string; color: string; total: number; count: number };

export type ExpenseRow = {
    id: string;
    category: string;
    description: string;
    amount: number;
    due_date: string;
    payment_status: string;
};

export type StatsPayload = {
    revenue: number;
    cost: number;
    expensesPaid: number;
    profit: number;
    realProfit: number;
    orders: number;
    ticket: number;
    byDay: DaySummary[];
    byPay: PaySummary[];
    byOrigin: Record<string, number>;
    totalAReceber: number;
};

const PAY_META: Record<string, { label: string; color: string }> = {
    pix: { label: "PIX", color: "#22c55e" },
    card: { label: "Cartão", color: "#6d28d9" },
    cash: { label: "Dinheiro", color: "#f97316" },
    debit: { label: "Débito", color: "#3b82f6" },
    credit_installment: { label: "Crédito Parc.", color: "#a855f7" },
    boleto: { label: "Boleto", color: "#0ea5e9" },
    promissoria: { label: "Promissória", color: "#f59e0b" },
    cheque: { label: "Cheque", color: "#64748b" },
    credit: { label: "A Prazo", color: "#ef4444" },
};

function pad(n: number) {
    return String(n).padStart(2, "0");
}
function shortDay(iso: string) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function eachCivilDay(from: string, to: string): string[] {
    const out: string[] = [];
    const cur = new Date(from + "T12:00:00Z");
    const end = new Date(to + "T12:00:00Z");
    while (cur <= end) {
        out.push(
            `${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}-${pad(cur.getUTCDate())}`
        );
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

export async function buildFinanceDashboard(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string; days: number }
): Promise<{ stats: StatsPayload; expenses: ExpenseRow[] }> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const bounds = civilRangeToUtcBounds(dateRange.from, dateRange.to, timeZone);
    const dash = await financeQuerySupabase.dashboard(
        admin,
        companyId,
        { from: bounds.from, toExclusive: bounds.toExclusive },
        timeZone
    );

    const { data: payables } = await admin
        .from("bills")
        .select("id, description, notes, original_amount, due_date, status")
        .eq("company_id", companyId)
        .eq("type", "payable")
        .gte("due_date", dateRange.from)
        .lte("due_date", dateRange.to)
        .order("due_date", { ascending: false });

    const safeExp: ExpenseRow[] = (payables ?? []).map(
        (b: {
            id: string;
            description?: string | null;
            notes?: string | null;
            original_amount?: number;
            due_date: string;
            status: string;
        }) => ({
            id: String(b.id),
            category: String(b.description ?? "outros"),
            description: String(b.notes ?? ""),
            amount: asMoney(b.original_amount),
            due_date: String(b.due_date).slice(0, 10),
            payment_status: b.status === "paid" ? "paid" : "pending",
        })
    );

    const dayMap: Record<string, DaySummary> = {};
    for (const iso of eachCivilDay(dateRange.from, dateRange.to)) {
        dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
    }
    for (const d of dash.byDay) {
        if (!dayMap[d.day]) {
            dayMap[d.day] = {
                isoDate: d.day,
                label: shortDay(d.day),
                revenue: 0,
                cost: 0,
                orders: 0,
                expensesDay: 0,
            };
        }
        dayMap[d.day].revenue += d.amount;
        dayMap[d.day].orders += d.entries_count;
    }

    const revenue = dash.total;
    const costTotal = dash.cogs;
    if (revenue > 0 && costTotal > 0) {
        for (const d of Object.values(dayMap)) {
            if (d.revenue <= 0) continue;
            d.cost = (d.revenue / revenue) * costTotal;
        }
    }
    safeExp.forEach((e) => {
        if (e.payment_status !== "paid") return;
        const iso = e.due_date;
        if (!dayMap[iso]) {
            dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
        }
        dayMap[iso].expensesDay += Number(e.amount);
    });
    const byDay = Object.values(dayMap).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    const byPay: PaySummary[] = dash.byPaymentMethod
        .map((p) => {
            const meta = PAY_META[p.method] ?? { label: p.method, color: "#a1a1aa" };
            return { method: p.method, ...meta, total: p.amount, count: p.entries_count };
        })
        .sort((a, b) => b.total - a.total);

    const originMap: Record<string, number> = Object.fromEntries(FINANCE_ORIGINS.map((k) => [k, 0]));
    for (const o of dash.byOrigin) {
        const key = normalizeFinanceOrigin(o.origin);
        originMap[key] = (originMap[key] ?? 0) + o.amount;
    }

    const expensesPaid = dash.opexPaid;
    const orders = dash.count;

    const stats: StatsPayload = {
        revenue,
        cost: costTotal,
        expensesPaid,
        profit: revenue - costTotal,
        realProfit: revenue - costTotal - expensesPaid,
        orders,
        ticket: orders > 0 ? revenue / orders : 0,
        byDay,
        byPay,
        byOrigin: originMap,
        totalAReceber: dash.arOpen,
    };

    return { stats, expenses: safeExp };
}
