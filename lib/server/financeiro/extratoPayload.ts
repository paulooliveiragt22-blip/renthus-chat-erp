import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseRow } from "./dashboardPayload";
import { civilRangeToUtcBounds, loadCompanyTimezone } from "@/lib/server/financeiro/receivedIncome";

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

/**
 * Extrato de receita: somente `financial_entries` (income).
 * Despesas: `expenses` do período.
 */
export async function buildExtratoLines(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string },
    expenses: ExpenseRow[]
): Promise<ExtratoLine[]> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const bounds = civilRangeToUtcBounds(dateRange.from, dateRange.to, timeZone);
    const lines: ExtratoLine[] = [];

    const { data: feRows } = await admin
        .from("financial_entries")
        .select(
            "id, amount, payment_method, status, description, origin, order_id, sale_id, received_at, occurred_at, orders(customers(name), customer_id, status)"
        )
        .eq("company_id", companyId)
        .eq("type", "income")
        .gte("occurred_at", bounds.from.toISOString())
        .lt("occurred_at", bounds.toExclusive.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(800);

    // Filtra received pelo instante canônico (received_at ?? occurred_at) no intervalo civil
    const fromMs = bounds.from.getTime();
    const toMs = bounds.toExclusive.getTime();

    for (const fe of feRows ?? []) {
        const when = new Date(String(fe.received_at ?? fe.occurred_at)).getTime();
        if (!Number.isFinite(when) || when < fromMs || when >= toMs) continue;

        const ord = fe.orders as
            | { customers?: { name?: string }; customer_id?: string; status?: string }
            | null
            | undefined;
        const status = String(fe.status ?? "");
        lines.push({
            id: `fe-${String(fe.id)}`,
            date: String(fe.received_at ?? fe.occurred_at),
            type: "income",
            source: "financial_entry",
            description:
                String(fe.description ?? "").trim() ||
                (fe.order_id
                    ? `Pedido #${String(fe.order_id).slice(-6).toUpperCase()}`
                    : "Recebimento"),
            customer: ord?.customers?.name ?? "—",
            channel: String(fe.origin ?? "—"),
            payment_method: String(fe.payment_method ?? "—"),
            amount: Number(fe.amount ?? 0),
            status:
                status === "received" ? "recebido" : status === "pending" ? "pendente" : status,
            orderId: (fe.order_id as string) ?? null,
            saleId: (fe.sale_id as string) ?? null,
            customerId: ord?.customer_id ?? null,
            orderStatus: ord?.status ?? null,
        });
    }

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
