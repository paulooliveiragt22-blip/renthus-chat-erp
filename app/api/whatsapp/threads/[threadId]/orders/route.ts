import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type OrderItemRow = { product_name: string; quantity: number; unit_price: number; unit_type: string };
type CustomerOrder = { id: string; created_at: string; status: string; total_amount: number; items: OrderItemRow[] };

function buildTags(orders: CustomerOrder[]): string[] {
    const tags: string[] = [];
    if (orders.length >= 10) tags.push("Cliente VIP");
    else if (orders.length >= 5) tags.push("Cliente Frequente");
    const total = orders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    if (total >= 1000) tags.push("Alto Valor");
    const names: Record<string, number> = {};
    for (const o of orders) {
        for (const it of o.items) {
            const key = (it.product_name ?? "").toLowerCase();
            if (key) names[key] = (names[key] ?? 0) + (it.quantity ?? 1);
        }
    }
    const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [name] of top) {
        const label = name.charAt(0).toUpperCase() + name.slice(1, 20);
        if (!tags.some((t) => t === `Prefere ${label}`)) tags.push(`Prefere ${label}`);
    }
    return tags.slice(0, 5);
}

/**
 * GET /api/whatsapp/threads/:threadId/orders
 *
 * Perfil de compras do cliente da thread (stats + últimos pedidos, com itens) —
 * usado na sidebar de perfil do WhatsApp Inbox ("Últimos pedidos" com deep link
 * pro detalhe). Substitui a leitura direta de `orders`/`customers` que o
 * client fazia via Supabase browser client (violava a regra de SELECT só por
 * view/RPC aprovada) por uma rota server-side com o `company_id` da sessão.
 */
export async function GET(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) return NextResponse.json({ error: threadErr.message }, { status: 500 });
    if (!thread) return NextResponse.json({ error: "thread_not_found" }, { status: 404 });

    const phone = thread.phone_e164 as string | null;
    if (!phone) return NextResponse.json({ customer: null, orders: [] });

    const { data: cust, error: custErr } = await admin
        .from("customers")
        .select("id, name, phone")
        .eq("company_id", companyId)
        .eq("phone", phone)
        .maybeSingle();
    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });
    if (!cust?.id) return NextResponse.json({ customer: null, orders: [] });

    const url = new URL(req.url);
    const displayLimit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "8") || 8, 1), 30);

    const { data: ordersRaw, error: ordersErr } = await admin
        .from("orders")
        .select(`id, created_at, status, total_amount, order_items ( product_name, quantity, unit_price, unit_type )`)
        .eq("customer_id", cust.id)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(30);
    if (ordersErr) return NextResponse.json({ error: ordersErr.message }, { status: 500 });

    const orders: CustomerOrder[] = (ordersRaw ?? []).map((o: Record<string, unknown>) => ({
        id: String(o.id),
        created_at: String(o.created_at),
        status: (o.status as string) ?? "new",
        total_amount: Number(o.total_amount ?? 0),
        items: Array.isArray(o.order_items)
            ? (o.order_items as Record<string, unknown>[]).map((it) => ({
                  product_name: (it.product_name as string) ?? "Item",
                  quantity: Number(it.quantity ?? 1),
                  unit_price: Number(it.unit_price ?? 0),
                  unit_type: (it.unit_type as string) ?? "unit",
              }))
            : [],
    }));

    const customer = {
        id: cust.id as string,
        name: (cust.name as string | null) ?? null,
        phone: (cust.phone as string | null) ?? null,
        totalSpent: orders.reduce((s, o) => s + o.total_amount, 0),
        orderCount: orders.length,
        tags: buildTags(orders),
    };

    return NextResponse.json({ customer, orders: orders.slice(0, displayLimit) });
}
