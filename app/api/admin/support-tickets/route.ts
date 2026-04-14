import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export async function GET(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { searchParams } = new URL(req.url);
    const status = String(searchParams.get("status") ?? "all").trim();

    let q = admin
        .from("support_tickets")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(100);

    if (status !== "all") q = q.eq("status", status);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tickets: data ?? [] });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: TicketStatus };
    const id = String(body.id ?? "").trim();
    const status = String(body.status ?? "").trim() as TicketStatus;
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    if (!["open", "in_progress", "resolved", "closed"].includes(status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }

    const { data, error } = await admin
        .from("support_tickets")
        .update({ status })
        .eq("id", id)
        .eq("company_id", companyId)
        .select("*")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ticket: data });
}
