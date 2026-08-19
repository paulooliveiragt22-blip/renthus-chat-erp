import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseRow } from "@/src/financeiro/application/queryDashboard";
import { civilRangeToUtcBounds, loadCompanyTimezone } from "@/src/financeiro/application/cashRevenue";
import { asMoney } from "@/src/financeiro/domain/money";
import { ORIGIN_LABELS, normalizeFinanceOrigin } from "@/src/financeiro/domain/origin";

export type ExtratoLine = {
    id: string;
    date: string;
    type: "income" | "expense";
    source: "order" | "financial_entry" | "expense" | "journal";
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
    journalId?: string | null;
    journalSourceType?: string | null;
    journalStatus?: string | null;
};

type ExtratoViewRow = {
    id: string;
    posted_at: string;
    source_type: string;
    origin: string | null;
    payment_method: string | null;
    description: string | null;
    status: string;
    sale_id: string | null;
    order_id: string | null;
    cash_amount: number | null;
    debit_total: number | null;
    line_type: string;
};

/**
 * Extrato: journals posted no intervalo civil da loja (`v_fin_extrato`).
 * Cursor: `posted_at` do último item da página (próxima página = posted_at < cursor).
 */
export async function buildExtratoLines(
    admin: SupabaseClient,
    companyId: string,
    dateRange: { from: string; to: string },
    _expenses?: ExpenseRow[],
    opts?: { limit?: number; cursor?: string | null }
): Promise<{ lines: ExtratoLine[]; nextCursor: string | null }> {
    const timeZone = await loadCompanyTimezone(admin, companyId);
    const bounds = civilRangeToUtcBounds(dateRange.from, dateRange.to, timeZone);
    const lines: ExtratoLine[] = [];
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);

    let q = admin
        .from("v_fin_extrato")
        .select(
            "id, posted_at, source_type, origin, payment_method, description, status, sale_id, order_id, cash_amount, debit_total, line_type"
        )
        .eq("company_id", companyId)
        .gte("posted_at", bounds.from.toISOString())
        .lt("posted_at", bounds.toExclusive.toISOString())
        .order("posted_at", { ascending: false })
        .limit(limit + 1);

    if (opts?.cursor) {
        q = q.lt("posted_at", opts.cursor);
    }

    const { data: rows, error } = await q;

    if (error) throw new Error(error.message);

    const fetched = (rows ?? []) as ExtratoViewRow[];
    const hasMore = fetched.length > limit;
    const pageRows = hasMore ? fetched.slice(0, limit) : fetched;

    const orderIds = [
        ...new Set(
            pageRows
                .map((r) => r.order_id)
                .filter((id): id is string => Boolean(id))
        ),
    ];
    const journalIds = pageRows.map((r) => r.id);
    const traceMeta: Record<
        string,
        { orderSourceSnapshot: string | null; orderChannelSnapshot: string | null }
    > = {};
    if (journalIds.length > 0) {
        const { data: traces } = await admin
            .from("v_fin_journal_trace")
            .select("id, order_source_snapshot, order_channel_snapshot")
            .eq("company_id", companyId)
            .in("id", journalIds);
        for (const t of traces ?? []) {
            traceMeta[String(t.id)] = {
                orderSourceSnapshot: (t.order_source_snapshot as string | null) ?? null,
                orderChannelSnapshot: (t.order_channel_snapshot as string | null) ?? null,
            };
        }
    }
    const orderMeta: Record<string, { customer: string; customerId: string | null; status: string | null }> =
        {};
    if (orderIds.length > 0) {
        const { data: ords } = await admin
            .from("orders")
            .select("id, status, customer_id, customers(name)")
            .eq("company_id", companyId)
            .in("id", orderIds);
        for (const o of ords ?? []) {
            const cust = o.customers as { name?: string } | null;
            orderMeta[String(o.id)] = {
                customer: cust?.name ?? "—",
                customerId: (o.customer_id as string | null) ?? null,
                status: (o.status as string | null) ?? null,
            };
        }
    }

    for (const row of pageRows) {
        const meta = row.order_id ? orderMeta[row.order_id] : undefined;
        const trace = traceMeta[row.id];
        const originKey = normalizeFinanceOrigin(
            trace?.orderSourceSnapshot ?? row.origin ?? "manual"
        );
        const channelLabel = ORIGIN_LABELS[originKey];
        const channelDetail = trace?.orderChannelSnapshot
            ? `${channelLabel} · ${trace.orderChannelSnapshot}`
            : channelLabel;
        const isExpense = row.line_type === "expense";
        const cash = asMoney(row.cash_amount);
        const amount = isExpense ? asMoney(row.debit_total) : cash !== 0 ? cash : asMoney(row.debit_total);
        lines.push({
            id: `j-${row.id}`,
            date: String(row.posted_at),
            type: isExpense ? "expense" : "income",
            source: "journal",
            description:
                String(row.description ?? "").trim() ||
                (row.order_id
                    ? `Pedido #${String(row.order_id).slice(-6).toUpperCase()}`
                    : row.source_type),
            customer: meta?.customer ?? "—",
            channel: channelDetail,
            payment_method: String(row.payment_method ?? "—"),
            amount,
            status: row.status === "posted" ? (isExpense ? "pago" : "recebido") : row.status,
            orderId: row.order_id,
            saleId: row.sale_id,
            customerId: meta?.customerId ?? null,
            orderStatus: meta?.status ?? null,
            journalId: row.id,
            journalSourceType: row.source_type,
            journalStatus: row.status,
        });
    }

    lines.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const last = pageRows[pageRows.length - 1];
    return {
        lines,
        nextCursor: hasMore && last ? String(last.posted_at) : null,
    };
}
