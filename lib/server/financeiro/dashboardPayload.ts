import type { SupabaseClient } from "@supabase/supabase-js";
import {
    civilRangeToUtcBounds,
    fetchReceivedIncome,
    loadCompanyTimezone,
} from "@/lib/server/financeiro/receivedIncome";

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

function normOrigin(raw: string | null | undefined): string {
    if (!raw) return "pdv";
    if (raw === "chatbot" || raw.startsWith("flow_")) return "chatbot";
    if (raw === "ui" || raw === "ui_order" || raw === "admin") return "ui_order";
    if (raw === "balcao" || raw === "pdv" || raw === "pdv_direct") return "pdv";
    return "pdv";
}

export async function buildFinanceDashboard(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string; days: number }
): Promise<{ stats: StatsPayload; expenses: ExpenseRow[] }> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const bounds = civilRangeToUtcBounds(dateRange.from, dateRange.to, timeZone);
    const income = await fetchReceivedIncome(
        admin,
        companyId,
        { from: bounds.from, toExclusive: bounds.toExclusive },
        timeZone
    );

    // Custo: entradas recebidas → order_id / sale_id
    const { data: feRows } = await admin
        .from("financial_entries")
        .select("id, order_id, sale_id, amount, received_at, occurred_at")
        .eq("company_id", companyId)
        .eq("type", "income")
        .eq("status", "received")
        .gte("received_at", bounds.from.toISOString())
        .lt("received_at", bounds.toExclusive.toISOString());

    // Fallback: algumas linhas antigas só têm occurred_at
    const { data: feOcc } = await admin
        .from("financial_entries")
        .select("id, order_id, sale_id, amount, received_at, occurred_at")
        .eq("company_id", companyId)
        .eq("type", "income")
        .eq("status", "received")
        .is("received_at", null)
        .gte("occurred_at", bounds.from.toISOString())
        .lt("occurred_at", bounds.toExclusive.toISOString());

    const feMap = new Map<string, { order_id: string | null; sale_id: string | null }>();
    for (const row of [...(feRows ?? []), ...(feOcc ?? [])]) {
        feMap.set(String(row.id), {
            order_id: (row.order_id as string) ?? null,
            sale_id: (row.sale_id as string) ?? null,
        });
    }

    const saleIds = [...new Set([...feMap.values()].map((v) => v.sale_id).filter(Boolean))] as string[];
    const orderIds = [...new Set([...feMap.values()].map((v) => v.order_id).filter(Boolean))] as string[];

    const costBySale: Record<string, number> = {};
    if (saleIds.length > 0) {
        const { data: siRows } = await admin.from("sale_items").select("sale_id, qty, unit_cost").in("sale_id", saleIds);
        (siRows ?? []).forEach((si: { sale_id: string; qty: number; unit_cost: number | null }) => {
            costBySale[si.sale_id] = (costBySale[si.sale_id] ?? 0) + Number(si.qty) * Number(si.unit_cost ?? 0);
        });
    }

    const costByOrder: Record<string, number> = {};
    if (orderIds.length > 0) {
        const { data: items } = await admin
            .from("order_items")
            .select("order_id, quantity, qty, produto_embalagem_id")
            .in("order_id", orderIds);
        const embIds = [
            ...new Set(
                (items ?? [])
                    .map((it: { produto_embalagem_id?: string }) => it.produto_embalagem_id)
                    .filter(Boolean)
            ),
        ] as string[];
        const embCostMap: Record<string, { baseCost: number; fator: number }> = {};
        if (embIds.length > 0) {
            const { data: embRows } = await admin
                .from("view_pdv_produtos")
                .select("id, fator_conversao, product_preco_custo")
                .eq("company_id", companyId)
                .in("id", embIds);
            (embRows ?? []).forEach((e: { id: string; product_preco_custo?: number; fator_conversao?: number }) => {
                embCostMap[e.id] = {
                    baseCost: Number(e.product_preco_custo ?? 0),
                    fator: Number(e.fator_conversao ?? 1),
                };
            });
        }
        (items ?? []).forEach(
            (it: { order_id: string; quantity?: number; qty?: number; produto_embalagem_id?: string }) => {
                const q = Number(it.quantity ?? it.qty ?? 1);
                const em = it.produto_embalagem_id ? embCostMap[it.produto_embalagem_id] : undefined;
                costByOrder[it.order_id] =
                    (costByOrder[it.order_id] ?? 0) + (em ? em.baseCost * em.fator * q : 0);
            }
        );
    }

    let costTotal = 0;
    for (const v of feMap.values()) {
        if (v.sale_id) costTotal += costBySale[v.sale_id] ?? 0;
        else if (v.order_id) costTotal += costByOrder[v.order_id] ?? 0;
    }

    const { data: expData } = await admin
        .from("expenses")
        .select("id, category, description, amount, due_date, payment_status")
        .eq("company_id", companyId)
        .gte("due_date", dateRange.from)
        .lte("due_date", dateRange.to)
        .order("due_date", { ascending: false });
    const safeExp = (expData ?? []) as ExpenseRow[];

    const { data: billsOpen } = await admin
        .from("bills")
        .select("saldo_devedor, status")
        .eq("company_id", companyId)
        .eq("type", "receivable")
        .in("status", ["open", "partial", "overdue"]);
    const totalAReceber = (billsOpen ?? []).reduce(
        (s: number, b: { saldo_devedor?: number }) => s + Number(b.saldo_devedor ?? 0),
        0
    );

    const dayMap: Record<string, DaySummary> = {};
    for (const iso of eachCivilDay(dateRange.from, dateRange.to)) {
        dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
    }
    for (const d of income.byDay) {
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
    // Distribui custo proporcional por dia via entries_count — aproximação; detalhe por FE seria pesado.
    // Melhor: custo total no período (já calculado); custo diário fica 0 aqui se não quisermos alocar.
    // Aloca custo nos dias na proporção da receita do dia.
    const revenue = income.total;
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

    const byPay: PaySummary[] = income.byPaymentMethod
        .map((p) => {
            const meta = PAY_META[p.method] ?? { label: p.method, color: "#a1a1aa" };
            return { method: p.method, ...meta, total: p.amount, count: p.entries_count };
        })
        .sort((a, b) => b.total - a.total);

    const originMap: Record<string, number> = { pdv: 0, chatbot: 0, ui_order: 0 };
    for (const o of income.byOrigin) {
        const key = normOrigin(o.origin);
        originMap[key] = (originMap[key] ?? 0) + o.amount;
    }

    const expensesPaid = safeExp
        .filter((e) => e.payment_status === "paid")
        .reduce((s, e) => s + Number(e.amount), 0);
    const orders = income.count;

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
        totalAReceber,
    };

    return { stats, expenses: safeExp };
}
