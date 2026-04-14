import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type DriverBody = {
    id?: string;
    name?: string;
    phone?: string | null;
    vehicle?: string | null;
    plate?: string | null;
    notes?: string | null;
    is_active?: boolean;
};

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;
    const { data, error } = await admin
        .from("drivers")
        .select("*")
        .eq("company_id", companyId)
        .order("name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ drivers: data ?? [] });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as DriverBody;
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

    const { data, error } = await admin
        .from("drivers")
        .insert({
            company_id: companyId,
            name,
            phone: body.phone?.trim() || null,
            vehicle: body.vehicle?.trim() || null,
            plate: body.plate?.trim() || null,
            notes: body.notes?.trim() || null,
            is_active: body.is_active !== false,
        })
        .select("*")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ driver: data });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as DriverBody;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.name != null) patch.name = String(body.name).trim();
    if (body.phone !== undefined) patch.phone = body.phone?.trim() || null;
    if (body.vehicle !== undefined) patch.vehicle = body.vehicle?.trim() || null;
    if (body.plate !== undefined) patch.plate = body.plate?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    const { data, error } = await admin
        .from("drivers")
        .update(patch)
        .eq("id", id)
        .eq("company_id", companyId)
        .select("*")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ driver: data });
}

export async function DELETE(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as DriverBody;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin
        .from("drivers")
        .delete()
        .eq("id", id)
        .eq("company_id", companyId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
