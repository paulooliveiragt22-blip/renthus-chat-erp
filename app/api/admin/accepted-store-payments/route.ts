import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    ACCEPTED_STORE_PAYMENTS_KEY,
    ACCEPTED_STORE_PRAZO_KEY,
    assertAtLeastOneStorePayment,
    normalizeStoreImmediate,
    normalizeStorePrazo,
    storePaymentsFromCompanySettings,
} from "@/src/financeiro/domain/storePaymentPolicy";

export const runtime = "nodejs";

/** GET /api/admin/accepted-store-payments — policy PDV / Pedidos / Mesa. */
export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { data, error } = await ctx.admin
        .from("companies")
        .select("settings")
        .eq("id", ctx.companyId)
        .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const policy = storePaymentsFromCompanySettings(data?.settings);
    return NextResponse.json({
        immediate: policy.immediate,
        prazo: policy.prazo,
    });
}

/** PATCH — body: { immediate?, prazo? } ou chaves flat no root. */
export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const immediate = normalizeStoreImmediate(body.immediate ?? body.accepted_store_payments);
    const prazo = normalizeStorePrazo(body.prazo ?? body.accepted_store_prazo);
    const min = assertAtLeastOneStorePayment(immediate, prazo);
    if (!min.ok) {
        return NextResponse.json(
            { error: "Selecione pelo menos uma forma de pagamento na loja." },
            { status: 400 }
        );
    }

    const { data: current, error: readErr } = await ctx.admin
        .from("companies")
        .select("settings")
        .eq("id", ctx.companyId)
        .maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

    const prev =
        typeof current?.settings === "object" &&
        current.settings != null &&
        !Array.isArray(current.settings)
            ? { ...(current.settings as Record<string, unknown>) }
            : {};

    prev[ACCEPTED_STORE_PAYMENTS_KEY] = immediate;
    prev[ACCEPTED_STORE_PRAZO_KEY] = prazo;

    const { error: writeErr } = await ctx.admin
        .from("companies")
        .update({ settings: prev, updated_at: new Date().toISOString() })
        .eq("id", ctx.companyId);
    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, immediate, prazo });
}
