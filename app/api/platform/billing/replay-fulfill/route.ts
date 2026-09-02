/**
 * POST /api/platform/billing/replay-fulfill
 * ADR-0004 B2 — replay manual de order pago (rede de segurança, não caminho feliz).
 * Body: { order_id: string }
 */

import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPagarmeOrder } from "@/lib/billing/pagarme";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";

export const runtime = "nodejs";

export async function POST(req: Request) {
    return withPlatformAccess("platform.billing.write", async () => {
        const body = (await req.json().catch(() => ({}))) as { order_id?: string };
        const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
        if (!orderId || !/^or_[A-Za-z0-9]+$/.test(orderId)) {
            return NextResponse.json({ error: "order_id inválido" }, { status: 400 });
        }

        const admin = createAdminClient();
        try {
            const order = await getPagarmeOrder(orderId);
            const result = await fulfillPayment(admin, {
                id: order.id,
                metadata: (order.metadata ?? {}) as Record<string, string>,
                customer: order.customer,
            });
            return NextResponse.json({ ok: true, result, order_status: order.status });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return NextResponse.json({ error: msg }, { status: 400 });
        }
    });
}
