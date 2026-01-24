// app/api/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey } from "@/lib/print/agents";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        const orderId = String(params.id || "").trim();
        if (!orderId) return NextResponse.json({ error: "order_id required" }, { status: 400 });

        // 1) If Authorization header present try agent auth first
        const authHeader = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (authHeader) {
            const agent = await verifyAgentByApiKey(authHeader);
            if (agent) {
                // agent is valid — use admin client to fetch order + items
                const admin = createAdminClient();

                const { data: order, error: orderErr } = await admin
                    .from("orders")
                    .select("*")
                    .eq("id", orderId)
                    .maybeSingle();

                if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
                if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

                // ensure same company
                if (String(order.company_id) !== String(agent.company_id)) {
                    return NextResponse.json({ error: "forbidden" }, { status: 403 });
                }

                const { data: items, error: itemsErr } = await admin
                    .from("order_items")
                    .select("id, order_id, product_name, quantity, unit_price, line_total, product_variant_id, created_at")
                    .eq("order_id", orderId)
                    .order("created_at", { ascending: true });

                // return order and items (if itemsErr we'll return empty items to be graceful)
                return NextResponse.json({ order, items: itemsErr ? [] : items });
            }
            // if Authorization exists but not a valid agent, fallthrough to normal auth (or reply 401)
            // we'll let normal session flow handle it below (or we could return 401)
        }

        // 2) Normal UI/backend request: require company access (cookie/session)
        const access = await requireCompanyAccess();
        if (!access || !access.ok) {
            const status = access?.status || 403;
            const msg = access?.error || "forbidden";
            return NextResponse.json({ error: msg }, { status });
        }
        const admin = access.admin; // createAdminClient already available if requireCompanyAccess returned ok

        // Make sure the order belongs to the selected company
        const { data: order, error: orderErr } = await admin
            .from("orders")
            .select("*")
            .eq("id", orderId)
            .eq("company_id", access.companyId)
            .maybeSingle();

        if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
        if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

        const { data: items, error: itemsErr } = await admin
            .from("order_items")
            .select("id, order_id, product_name, quantity, unit_price, line_total, product_variant_id, created_at")
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        return NextResponse.json({ order, items: itemsErr ? [] : items });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
