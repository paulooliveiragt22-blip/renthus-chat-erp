import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type {
    ReverseJournalInput,
    ReverseJournalPartialInput,
} from "@/src/financeiro/ports/financeCommand.port";

export type JournalDetailLine = {
    code: string;
    name: string;
    direction: "debit" | "credit";
    amount: number;
    remaining: number;
};

export type JournalDetail = {
    id: string;
    status: string;
    sourceType: string;
    origin: string | null;
    paymentMethod: string | null;
    description: string | null;
    postedAt: string;
    orderId: string | null;
    saleId: string | null;
    billId: string | null;
    cashRegisterId: string | null;
    reversesId: string | null;
    lines: JournalDetailLine[];
};

const LIQUID_CODES = new Set(["1.1", "1.2", "2.1"]);

export function isReversibleJournalLine(line: JournalDetailLine): boolean {
    return line.remaining > 0 && !LIQUID_CODES.has(line.code);
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

    return {
        id: String(raw.id ?? journalId),
        status: String(raw.status ?? ""),
        sourceType: String(raw.source_type ?? ""),
        origin: raw.origin != null ? String(raw.origin) : null,
        paymentMethod: raw.payment_method != null ? String(raw.payment_method) : null,
        description: raw.description != null ? String(raw.description) : null,
        postedAt: String(raw.posted_at ?? ""),
        orderId: raw.order_id != null ? String(raw.order_id) : null,
        saleId: raw.sale_id != null ? String(raw.sale_id) : null,
        billId: raw.bill_id != null ? String(raw.bill_id) : null,
        cashRegisterId: raw.cash_register_id != null ? String(raw.cash_register_id) : null,
        reversesId: raw.reverses_id != null ? String(raw.reverses_id) : null,
        lines: linesRaw.map((l) => {
            const row = l as Record<string, unknown>;
            return {
                code: String(row.code ?? ""),
                name: String(row.name ?? row.code ?? ""),
                direction: row.direction === "credit" ? "credit" : "debit",
                amount: Number(row.amount ?? 0),
                remaining: Number(row.remaining ?? 0),
            };
        }),
    };
}

export function reverseJournal(admin: SupabaseClient, input: ReverseJournalInput) {
    return financeCommandSupabase.reverseJournal(admin, input);
}

export function reverseJournalPartial(admin: SupabaseClient, input: ReverseJournalPartialInput) {
    return financeCommandSupabase.reverseJournalPartial(admin, input);
}
