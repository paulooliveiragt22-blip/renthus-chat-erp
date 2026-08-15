import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import {
    ACCEPTED_CUSTOMER_PAYMENTS_SETTINGS_KEY,
    assertAtLeastOneCustomerPayment,
    acceptedCustomerPaymentsFromCompanySettings,
    normalizeAcceptedCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

export const runtime = "nodejs";

/** GET /api/admin/accepted-payments — policy canônica cardápio/chatbot. */
export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { data, error } = await ctx.admin
        .from("companies")
        .select("settings")
        .eq("id", ctx.companyId)
        .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const accepted = acceptedCustomerPaymentsFromCompanySettings(data?.settings);
    return NextResponse.json({ accepted });
}

/** PATCH /api/admin/accepted-payments — body = mapa { pix, cash, debit, card }. */
export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const accepted = normalizeAcceptedCustomerPayments(body.accepted ?? body);
    const min = assertAtLeastOneCustomerPayment(accepted);
    if (!min.ok) {
        return NextResponse.json(
            { error: "Selecione pelo menos uma forma de pagamento." },
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

    delete prev.enabled_payments;
    prev[ACCEPTED_CUSTOMER_PAYMENTS_SETTINGS_KEY] = accepted;

    const { error: writeErr } = await ctx.admin
        .from("companies")
        .update({ settings: prev, updated_at: new Date().toISOString() })
        .eq("id", ctx.companyId);
    if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, accepted });
}
