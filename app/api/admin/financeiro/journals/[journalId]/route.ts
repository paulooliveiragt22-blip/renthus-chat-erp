import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { queryJournalDetail } from "@/src/financeiro/application/reverseJournal";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ journalId: string }> }
) {
    const ctx = await requireCompanyPlanFeature(
        "financeiro_full",
        ["owner", "admin", "member"],
        "financeiro.read"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { journalId: rawId } = await params;
    const journalId = String(rawId ?? "").trim();
    if (!journalId) return NextResponse.json({ error: "journal_id_required" }, { status: 400 });

    try {
        const detail = await queryJournalDetail(admin, companyId, journalId);
        return NextResponse.json({ journal: detail });
    } catch (err) {
        const msg = err instanceof Error ? err.message : "journal_load_failed";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
