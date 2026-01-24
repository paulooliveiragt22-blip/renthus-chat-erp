// app/api/print/orders/[id]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey } from "@/lib/print/agents";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    try {
        // extract token (Agent Key)
        const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const agent = await verifyAgentByApiKey(auth);
        if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const admin = createAdminClient();

        // fetch order (use maybeSingle so we can return 404)
        const { data: order, error: orderErr } = await admin
            .from("orders")
            .select("*")
            .eq("id", params.id)
            .maybeSingle();

        if (orderErr) {
            return NextResponse.json({ error: orderErr.message }, { status: 500 });
        }
        if (!order) {
            return NextResponse.json({ error: "not_found" }, { status: 404 });
        }

        // ensure company match
        if (String(order.company_id) !== String(agent.company_id)) {
            return NextResponse.json({ error: "forbidden" }, { status: 403 });
        }

        // fetch order items (ordered by created_at)
        const { data: items, error: itemsErr } = await admin
            .from("order_items")
            .select("id, order_id, product_name, quantity, unit_price, line_total, product_variant_id, created_at")
            .eq("order_id", params.id)
            .order("created_at", { ascending: true });

        // if itemsErr, still return order but with empty items array (graceful)
        if (itemsErr) {
            return NextResponse.json({ order, items: [] });
        }

        return NextResponse.json({ order, items });
    } catch (e: any) {
        // unexpected error
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
