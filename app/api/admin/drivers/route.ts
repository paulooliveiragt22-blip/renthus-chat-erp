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

    const { data: driverId, error } = await admin.rpc("rpc_upsert_driver", {
        p_company_id: companyId,
        p_payload: {
            name,
            phone: body.phone?.trim() ?? "",
            vehicle: body.vehicle?.trim() ?? "",
            plate: body.plate?.trim() ?? "",
            notes: body.notes?.trim() ?? "",
            is_active: body.is_active !== false,
        },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data, error: selErr } = await admin
        .from("drivers")
        .select("*")
        .eq("id", driverId as string)
        .eq("company_id", companyId)
        .single();
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    return NextResponse.json({ driver: data });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as DriverBody;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const payload: Record<string, unknown> = { id };
    if (body.name != null) payload.name = String(body.name).trim();
    if (body.phone !== undefined) payload.phone = body.phone?.trim() ?? "";
    if (body.vehicle !== undefined) payload.vehicle = body.vehicle?.trim() ?? "";
    if (body.plate !== undefined) payload.plate = body.plate?.trim() ?? "";
    if (body.notes !== undefined) payload.notes = body.notes?.trim() ?? "";
    if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);

    const { error } = await admin.rpc("rpc_upsert_driver", {
        p_company_id: companyId,
        p_payload: payload,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data, error: selErr } = await admin
        .from("drivers")
        .select("*")
        .eq("id", id)
        .eq("company_id", companyId)
        .single();
    if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
    return NextResponse.json({ driver: data });
}

export async function DELETE(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as DriverBody;
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const { error } = await admin.rpc("rpc_delete_driver", {
        p_company_id: companyId,
        p_driver_id: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
