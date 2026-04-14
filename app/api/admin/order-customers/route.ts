import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("customers")
        .select("id,name,phone")
        .eq("company_id", companyId)
        .order("name", { ascending: true, nullsFirst: false })
        .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ customers: data ?? [] });
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        id?: string | null;
        name?: string;
        phone?: string;
        address?: string;
    };

    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const address = String(body.address ?? "").trim();

    if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
    if (!phone || phone.length < 8) return NextResponse.json({ error: "phone_required" }, { status: 400 });

    if (id) {
        const { data, error } = await admin
            .from("customers")
            .update({ name, phone, address: address || null })
            .eq("id", id)
            .eq("company_id", companyId)
            .select("id")
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ customer_id: data.id as string });
    }

    const { data: found, error: findErr } = await admin
        .from("customers")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (found?.id) {
        const { error: upErr } = await admin
            .from("customers")
            .update({ name, address: address || null })
            .eq("id", found.id);
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
        return NextResponse.json({ customer_id: found.id as string });
    }

    const { data: created, error: insErr } = await admin
        .from("customers")
        .insert({ name, phone, address: address || null, company_id: companyId })
        .select("id")
        .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ customer_id: created.id as string });
}
