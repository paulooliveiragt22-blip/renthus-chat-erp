import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST() {
    try {
        // Apenas admin/owner (decisão comercial)
        const ctx = await requireCompanyAccess(["owner", "admin"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;

        // Busca subscription ativa
        const { data: sub, error: subErr } = await admin
            .from("subscriptions")
            .select("id, allow_overage, plan_id, status")
            .eq("company_id", companyId)
            .eq("status", "active")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
        if (!sub?.id) return NextResponse.json({ error: "No active subscription" }, { status: 400 });

        // Já está habilitado
        if (sub.allow_overage === true) {
            return NextResponse.json({ ok: true, allow_overage: true, subscription_id: sub.id });
        }

        // Habilita overage
        const { error: upErr } = await admin
            .from("subscriptions")
            .update({ allow_overage: true })
            .eq("id", sub.id);

        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

        return NextResponse.json({
            ok: true,
            allow_overage: true,
            subscription_id: sub.id,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}
