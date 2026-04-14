import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseRow } from "./dashboardPayload";

export type ExtratoLine = {
    id: string;
    date: string;
    type: "income" | "expense";
    source: "order" | "financial_entry" | "expense";
    description: string;
    customer: string;
    channel: string;
    payment_method: string;
    amount: number;
    status: string;
    orderId?: string | null;
    saleId?: string | null;
    customerId?: string | null;
    orderStatus?: string | null;
};

export async function buildExtratoLines(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string },
    expenses: ExpenseRow[]
): Promise<ExtratoLine[]> {
    const fromIso = dateRange.from + "T00:00:00.000Z";
    const toIso = dateRange.to + "T23:59:59.999Z";
    const lines: ExtratoLine[] = [];

    const { data: spRows } = await admin
        .from("sale_payments")
        .select("id, created_at, amount, payment_method, status, sale_id, sales(origin, notes, customer_id, customers(name))")
        .eq("company_id", companyId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(500);

    (spRows ?? []).forEach((sp: Record<string, unknown>) => {
        const sale = sp.sales as Record<string, unknown> | null | undefined;
        const origin = (sale?.origin as string) ?? "pdv";
        const channel = origin === "chatbot" ? "whatsapp" : origin === "ui_order" ? "admin" : "pdv";
        const cust = sale?.customers as { name?: string } | undefined;
        lines.push({
            id: `sp-${String(sp.id)}`,
            date: String(sp.created_at),
            type: "income",
            source: "financial_entry",
            description: `Venda — ${(sale?.notes as string) ?? origin}`,
            customer: cust?.name ?? "—",
            channel,
            payment_method: String(sp.payment_method ?? "—"),
            amount: Number(sp.amount ?? 0),
            status:
                sp.status === "received" ? "recebido" : sp.status === "pending" ? "pendente" : String(sp.status ?? ""),
            orderId: null,
            saleId: (sp.sale_id as string) ?? null,
            customerId: (sale?.customer_id as string) ?? null,
            orderStatus: null,
        });
    });

    const { data: ordRows } = await admin
        .from("orders")
        .select("id, created_at, total_amount, payment_method, status, channel, source, customer_id, customers(name)")
        .eq("company_id", companyId)
        .in("status", ["finalized", "delivered", "confirmed", "preparing", "delivering"])
        .is("sale_id", null)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(300);

    (ordRows ?? []).forEach((o: Record<string, unknown>) => {
        const cust = o.customers as { name?: string } | undefined;
        lines.push({
            id: `ord-${String(o.id)}`,
            date: String(o.created_at),
            type: "income",
            source: "order",
            description: `Pedido #${String(o.id).slice(-6).toUpperCase()}`,
            customer: cust?.name ?? "—",
            channel: (o.source as string) ?? (o.channel as string) ?? "admin",
            payment_method: String(o.payment_method ?? "—"),
            amount: Number(o.total_amount ?? 0),
            status: String(o.status),
            orderId: o.id as string,
            saleId: null,
            customerId: (o.customer_id as string) ?? null,
            orderStatus: String(o.status),
        });
    });

    expenses.forEach((e) => {
        lines.push({
            id: `exp-${e.id}`,
            date: e.due_date + "T12:00:00",
            type: "expense",
            source: "expense",
            description: `${e.category}${e.description ? ` — ${e.description}` : ""}`,
            customer: "—",
            channel: "despesa",
            payment_method: "—",
            amount: Number(e.amount ?? 0),
            status: e.payment_status === "paid" ? "pago" : "pendente",
        });
    });

    lines.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return lines;
}
