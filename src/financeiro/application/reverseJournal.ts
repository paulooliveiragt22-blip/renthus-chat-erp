import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import { accountBusinessLabel } from "@/src/financeiro/domain/accountLabels";
import type {
    ReverseJournalInput,
    ReverseJournalPartialInput,
} from "@/src/financeiro/ports/financeCommand.port";

export type JournalDetailLine = {
    code: string;
    name: string;
    label: string;
    direction: "debit" | "credit";
    amount: number;
    remaining: number;
};

export type JournalOrderItem = {
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
};

export type JournalOrderFee = {
    systemKey: string | null;
    label: string;
    amount: number;
};

export type JournalPriorReversal = {
    id: string;
    postedAt: string;
    amount: number;
    reason: string | null;
    description: string | null;
};

export type JournalOrderContext = {
    id: string;
    status: string;
    totalAmount: number;
    deliveryFee: number;
    paymentMethod: string | null;
    customerName: string;
    items: JournalOrderItem[];
    fees: JournalOrderFee[];
};

export type JournalDetail = {
    id: string;
    entrySeq: number | null;
    status: string;
    sourceType: string;
    origin: string | null;
    paymentMethod: string | null;
    description: string | null;
    reason: string | null;
    postedAt: string;
    orderId: string | null;
    saleId: string | null;
    billId: string | null;
    cashRegisterId: string | null;
    reversesId: string | null;
    lines: JournalDetailLine[];
    order: JournalOrderContext | null;
    priorReversals: JournalPriorReversal[];
};

const LIQUID_CODES = new Set(["1.1", "1.2", "2.1"]);

export function isReversibleJournalLine(line: JournalDetailLine): boolean {
    return line.remaining > 0 && !LIQUID_CODES.has(line.code);
}

export function journalLineKey(line: Pick<JournalDetailLine, "code" | "direction">): string {
    return `${line.code}:${line.direction}`;
}

async function loadOrderContext(
    admin: SupabaseClient,
    companyId: string,
    orderId: string
): Promise<JournalOrderContext | null> {
    const { data: ord, error: ordErr } = await admin
        .from("orders")
        .select(
            "id, status, total_amount, delivery_fee, payment_method, customers(name)"
        )
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (ordErr || !ord) return null;

    const cust = ord.customers as { name?: string } | null;

    const { data: items } = await admin
        .from("order_items")
        .select("id, product_name, quantity, qty, unit_price, line_total")
        .eq("order_id", orderId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

    const { data: fees } = await admin
        .from("order_fees")
        .select("system_key, label, amount")
        .eq("order_id", orderId)
        .eq("company_id", companyId);

    return {
        id: String(ord.id),
        status: String(ord.status ?? ""),
        totalAmount: Number(ord.total_amount ?? 0),
        deliveryFee: Number(ord.delivery_fee ?? 0),
        paymentMethod: ord.payment_method != null ? String(ord.payment_method) : null,
        customerName: cust?.name ?? "—",
        items: (items ?? []).map((it) => ({
            id: String(it.id),
            productName: String(it.product_name ?? ""),
            quantity: Number(it.qty ?? it.quantity ?? 0),
            unitPrice: Number(it.unit_price ?? 0),
            lineTotal: Number(it.line_total ?? 0),
        })),
        fees: (fees ?? []).map((f) => ({
            systemKey: f.system_key != null ? String(f.system_key) : null,
            label: String(f.label ?? f.system_key ?? "Taxa"),
            amount: Number(f.amount ?? 0),
        })),
    };
}

async function loadPriorReversals(
    admin: SupabaseClient,
    companyId: string,
    journalId: string
): Promise<JournalPriorReversal[]> {
    const { data: revJournals } = await admin
        .from("finance_journals")
        .select("id, posted_at, reason, description")
        .eq("company_id", companyId)
        .eq("reverses_id", journalId)
        .eq("status", "posted")
        .order("posted_at", { ascending: false });

    if (!revJournals?.length) return [];

    const ids = revJournals.map((r) => String(r.id));
    const { data: extratoRows } = await admin
        .from("v_fin_extrato")
        .select("id, cash_amount, debit_total")
        .eq("company_id", companyId)
        .in("id", ids);

    const amountById = new Map<string, number>();
    for (const r of extratoRows ?? []) {
        const cash = Number(r.cash_amount ?? 0);
        const debit = Number(r.debit_total ?? 0);
        amountById.set(String(r.id), Math.abs(cash !== 0 ? cash : debit));
    }

    return revJournals.map((r) => ({
        id: String(r.id),
        postedAt: String(r.posted_at),
        amount: amountById.get(String(r.id)) ?? 0,
        reason: r.reason != null ? String(r.reason) : null,
        description: r.description != null ? String(r.description) : null,
    }));
}

export async function queryJournalDetail(
    admin: SupabaseClient,
    companyId: string,
    journalId: string
): Promise<JournalDetail> {
    const { data, error } = await admin.rpc("rpc_fin_journal_detail", {
        p_company_id: companyId,
        p_journal_id: journalId,
    });
    if (error) throw new Error(error.message);

    const raw = (data ?? {}) as Record<string, unknown>;
    const linesRaw = Array.isArray(raw.lines) ? raw.lines : [];

    const orderId = raw.order_id != null ? String(raw.order_id) : null;
    const order = orderId ? await loadOrderContext(admin, companyId, orderId) : null;
    const priorReversals = await loadPriorReversals(admin, companyId, journalId);

    return {
        id: String(raw.id ?? journalId),
        entrySeq: raw.entry_seq != null ? Number(raw.entry_seq) : null,
        status: String(raw.status ?? ""),
        sourceType: String(raw.source_type ?? ""),
        origin: raw.origin != null ? String(raw.origin) : null,
        paymentMethod: raw.payment_method != null ? String(raw.payment_method) : null,
        description: raw.description != null ? String(raw.description) : null,
        reason: raw.reason != null ? String(raw.reason) : null,
        postedAt: String(raw.posted_at ?? ""),
        orderId,
        saleId: raw.sale_id != null ? String(raw.sale_id) : null,
        billId: raw.bill_id != null ? String(raw.bill_id) : null,
        cashRegisterId: raw.cash_register_id != null ? String(raw.cash_register_id) : null,
        reversesId: raw.reverses_id != null ? String(raw.reverses_id) : null,
        lines: linesRaw.map((l) => {
            const row = l as Record<string, unknown>;
            const code = String(row.code ?? "");
            const name = String(row.name ?? code);
            return {
                code,
                name,
                label: accountBusinessLabel(code, name),
                direction: row.direction === "credit" ? "credit" : "debit",
                amount: Number(row.amount ?? 0),
                remaining: Number(row.remaining ?? 0),
            };
        }),
        order,
        priorReversals,
    };
}

export function reverseJournal(admin: SupabaseClient, input: ReverseJournalInput) {
    return financeCommandSupabase.reverseJournal(admin, input);
}

export function reverseJournalPartial(admin: SupabaseClient, input: ReverseJournalPartialInput) {
    return financeCommandSupabase.reverseJournalPartial(admin, input);
}
