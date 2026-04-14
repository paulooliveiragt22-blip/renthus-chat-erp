import type { SupabaseClient } from "@supabase/supabase-js";

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
function isoDate(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shortDay(iso: string) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export async function buildFinanceDashboard(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string; days: number }
): Promise<{ stats: StatsPayload; expenses: ExpenseRow[] }> {
    const fromIso = dateRange.from + "T00:00:00.000Z";
    const toIso = dateRange.to + "T23:59:59.999Z";

    const { data: salesRaw } = await admin
        .from("sales")
        .select("id, created_at, total, subtotal, origin, status")
        .eq("company_id", companyId)
        .neq("status", "canceled")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true });

    const { data: ordersRaw } = await admin
        .from("orders")
        .select("id, created_at, total_amount, delivery_fee, payment_method, status, source, channel")
        .eq("company_id", companyId)
        .in("status", ["finalized", "delivered"])
        .is("sale_id", null)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true });

    const safeSales = (salesRaw ?? []) as Record<string, unknown>[];
    const safeOrders = (ordersRaw ?? []) as Record<string, unknown>[];

    const saleIds = safeSales.map((s) => s.id as string);
    let salePayments: { sale_id?: string; payment_method?: string; amount?: number }[] = [];
    if (saleIds.length > 0) {
        const { data: spRows } = await admin
            .from("sale_payments")
            .select("sale_id, payment_method, amount")
            .in("sale_id", saleIds)
            .not("payment_method", "in", '("credit_installment","boleto","cheque","promissoria")');
        salePayments = (spRows ?? []) as typeof salePayments;
    }

    const costBySale: Record<string, number> = {};
    if (saleIds.length > 0) {
        const { data: siRows } = await admin.from("sale_items").select("sale_id, qty, unit_cost").in("sale_id", saleIds);
        (siRows ?? []).forEach((si: { sale_id: string; qty: number; unit_cost: number | null }) => {
            costBySale[si.sale_id] = (costBySale[si.sale_id] ?? 0) + Number(si.qty) * Number(si.unit_cost ?? 0);
        });
    }

    const costByOrder: Record<string, number> = {};
    const orderIds = safeOrders.map((o) => o.id as string);
    if (orderIds.length > 0) {
        const { data: items } = await admin
            .from("order_items")
            .select("order_id, quantity, qty, produto_embalagem_id")
            .in("order_id", orderIds);
        const embIds = [...new Set((items ?? []).map((it: { produto_embalagem_id?: string }) => it.produto_embalagem_id).filter(Boolean))] as string[];
        const embCostMap: Record<string, { baseCost: number; fator: number }> = {};
        if (embIds.length > 0) {
            const { data: embRows } = await admin
                .from("view_pdv_produtos")
                .select("id, fator_conversao, product_preco_custo")
                .eq("company_id", companyId)
                .in("id", embIds);
            (embRows ?? []).forEach((e: { id: string; product_preco_custo?: number; fator_conversao?: number }) => {
                embCostMap[e.id] = { baseCost: Number(e.product_preco_custo ?? 0), fator: Number(e.fator_conversao ?? 1) };
            });
        }
        (items ?? []).forEach((it: { order_id: string; quantity?: number; qty?: number; produto_embalagem_id?: string }) => {
            const q = Number(it.quantity ?? it.qty ?? 1);
            const em = it.produto_embalagem_id ? embCostMap[it.produto_embalagem_id] : undefined;
            costByOrder[it.order_id] = (costByOrder[it.order_id] ?? 0) + (em ? em.baseCost * em.fator * q : 0);
        });
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
    const totalAReceber = (billsOpen ?? []).reduce((s: number, b: { saldo_devedor?: number }) => s + Number(b.saldo_devedor ?? 0), 0);

    const dayMap: Record<string, DaySummary> = {};
    for (let i = 0; i < dateRange.days; i++) {
        const d = new Date(Date.now() - (dateRange.days - 1 - i) * 86400000);
        const iso = isoDate(d);
        dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
    }
    safeSales.forEach((s) => {
        const iso = String(s.created_at).slice(0, 10);
        if (!dayMap[iso]) dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
        dayMap[iso].revenue += Number(s.total ?? 0);
        dayMap[iso].cost += costBySale[s.id as string] ?? 0;
        dayMap[iso].orders += 1;
    });
    safeOrders.forEach((o) => {
        const iso = String(o.created_at).slice(0, 10);
        if (!dayMap[iso]) dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
        dayMap[iso].revenue += Number(o.total_amount ?? 0);
        dayMap[iso].cost += costByOrder[o.id as string] ?? 0;
        dayMap[iso].orders += 1;
    });
    safeExp.forEach((e) => {
        if (e.payment_status !== "paid") return;
        const iso = e.due_date;
        if (!dayMap[iso]) dayMap[iso] = { isoDate: iso, label: shortDay(iso), revenue: 0, cost: 0, orders: 0, expensesDay: 0 };
        dayMap[iso].expensesDay += Number(e.amount);
    });
    const byDay = Object.values(dayMap).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    const payMap: Record<string, { total: number; count: number }> = {};
    salePayments.forEach((sp) => {
        const m = sp.payment_method ?? "outros";
        if (!payMap[m]) payMap[m] = { total: 0, count: 0 };
        payMap[m].total += Number(sp.amount ?? 0);
        payMap[m].count += 1;
    });
    safeOrders.forEach((o) => {
        const m = (o.payment_method ?? "outros") as string;
        if (!payMap[m]) payMap[m] = { total: 0, count: 0 };
        payMap[m].total += Number(o.total_amount ?? 0);
        payMap[m].count += 1;
    });
    const byPay: PaySummary[] = Object.entries(payMap).map(([method, v]) => {
        const meta = PAY_META[method] ?? { label: method, color: "#a1a1aa" };
        return { method, ...meta, ...v };
    }).sort((a, b) => b.total - a.total);

    const normOrigin = (raw: string | null | undefined): string => {
        if (!raw) return "pdv";
        if (raw === "chatbot" || raw.startsWith("flow_")) return "chatbot";
        if (raw === "ui" || raw === "ui_order") return "ui_order";
        return "pdv";
    };
    const originMap: Record<string, number> = { pdv: 0, chatbot: 0, ui_order: 0 };
    safeSales.forEach((s) => {
        const key = normOrigin(s.origin as string);
        originMap[key] = (originMap[key] ?? 0) + Number(s.total ?? 0);
    });
    safeOrders.forEach((o) => {
        const src = (o.source ?? o.channel ?? null) as string | null;
        const key =
            !src || src === "balcao" || src === "pdv_direct"
                ? "pdv"
                : src === "whatsapp" || src === "chatbot" || src.startsWith("flow_")
                  ? "chatbot"
                  : "ui_order";
        originMap[key] = (originMap[key] ?? 0) + Number(o.total_amount ?? 0);
    });

    const revenue = byDay.reduce((s, d) => s + d.revenue, 0);
    const cost = byDay.reduce((s, d) => s + d.cost, 0);
    const expensesPaid = safeExp.filter((e) => e.payment_status === "paid").reduce((s, e) => s + Number(e.amount), 0);
    const orders = byDay.reduce((s, d) => s + d.orders, 0);

    const stats: StatsPayload = {
        revenue,
        cost,
        expensesPaid,
        profit: revenue - cost,
        realProfit: revenue - cost - expensesPaid,
        orders,
        ticket: orders > 0 ? revenue / orders : 0,
        byDay,
        byPay,
        byOrigin: originMap,
        totalAReceber,
    };

    return { stats, expenses: safeExp };
}
