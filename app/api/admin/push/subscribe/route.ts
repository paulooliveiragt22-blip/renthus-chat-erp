import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

type Body = {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    userAgent?: string | null;
};

/**
 * Upsert subscription Web Push do usuário logado (tenant).
 * POST { endpoint, keys: { p256dh, auth } }
 */
export async function POST(req: Request) {
    const ctx = await requireCapability("dashboard.view");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId, userId } = ctx;

    if (!userId) {
        return NextResponse.json({ error: "user_required" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const endpoint = String(body.endpoint ?? "").trim();
    const p256dh = String(body.keys?.p256dh ?? "").trim();
    const auth = String(body.keys?.auth ?? "").trim();
    if (!endpoint || !p256dh || !auth) {
        return NextResponse.json({ error: "subscription_invalid" }, { status: 400 });
    }

    const { error } = await admin.from("admin_push_subscriptions").upsert(
        {
            company_id: companyId,
            user_id: userId,
            endpoint,
            p256dh,
            auth,
            user_agent: body.userAgent ? String(body.userAgent).slice(0, 500) : null,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

/** Remove subscription pelo endpoint. */
export async function DELETE(req: Request) {
    const ctx = await requireCapability("dashboard.view");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
    const endpoint = String(body.endpoint ?? "").trim();
    if (!endpoint) return NextResponse.json({ error: "endpoint_required" }, { status: 400 });

    const { error } = await admin
        .from("admin_push_subscriptions")
        .delete()
        .eq("company_id", companyId)
        .eq("endpoint", endpoint);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
