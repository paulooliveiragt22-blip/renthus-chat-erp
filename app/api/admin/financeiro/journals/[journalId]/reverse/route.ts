import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import {
    enforceFinanceWriteRateLimit,
    financeRpcFailure,
} from "@/src/financeiro/application/http";
import { reverseJournal, reverseJournalPartial } from "@/src/financeiro/application/reverseJournal";
import type { ReverseJournalLineInput } from "@/src/financeiro/ports/financeCommand.port";

export const runtime = "nodejs";

type ReverseBody = {
    reason?: string;
    mode?: "full" | "partial";
    lines?: ReverseJournalLineInput[];
    idempotency_key?: string;
};

export async function POST(
    req: Request,
    { params }: { params: Promise<{ journalId: string }> }
) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin"],
        "financeiro.write"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const limited = enforceFinanceWriteRateLimit(companyId, "reverse_journal");
    if (limited) return limited;

    const { journalId: rawId } = await params;
    const journalId = String(rawId ?? "").trim();
    if (!journalId) return NextResponse.json({ error: "journal_id_required" }, { status: 400 });

    const body = (await req.json().catch(() => ({}))) as ReverseBody;
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "reason_required" }, { status: 400 });

    const mode = body.mode === "partial" ? "partial" : "full";
    const idempotencyKey = body.idempotency_key?.trim() || null;

    try {
        if (mode === "partial") {
            const lines = Array.isArray(body.lines) ? body.lines : [];
            if (lines.length === 0) {
                return NextResponse.json({ error: "journal_lines_required" }, { status: 400 });
            }
            const normalized = lines.map((l) => ({
                code: String(l.code ?? "").trim(),
                dir: l.dir === "credit" ? "credit" as const : "debit" as const,
                amt: Number(l.amt),
            }));
            await reverseJournalPartial(admin, {
                companyId,
                journalId,
                reason,
                lines: normalized,
                idempotencyKey:
                    idempotencyKey ??
                    `reversal:partial:${journalId}:${normalized.map((x) => `${x.code}:${x.amt}`).join(",")}`,
            });
        } else {
            await reverseJournal(admin, {
                companyId,
                journalId,
                reason,
                idempotencyKey: idempotencyKey ?? `reversal:${journalId}`,
            });
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "reverse_failed";
        return financeRpcFailure(msg);
    }

    return NextResponse.json({ ok: true, journal_id: journalId, mode });
}
