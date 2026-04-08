import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

/** Dados do pedido para impressão (substitui leituras diretas ao Supabase no agent). */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const orderId: string = body?.order_id ?? "";
        if (!orderId) {
            return NextResponse.json({ error: "order_id obrigatório" }, { status: 400 });
        }

        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        const admin = createAdminClient();

        const { data: order, error: ordErr } = await admin
            .from("orders")
            .select("*")
            .eq("id", orderId)
            .eq("company_id", v.agent.company_id)
            .maybeSingle();

        if (ordErr || !order) {
            return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
        }

        const { data: items, error: itemsErr } = await admin
            .from("order_items")
            .select("product_name, quantity, unit_price, line_total, unit_type, produto_embalagem_id")
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        if (itemsErr) {
            console.error("[agent/print-data] items", itemsErr.message);
            return NextResponse.json({ error: itemsErr.message }, { status: 500 });
        }

        const rows = items ?? [];
        const embIds = [...new Set(rows.filter((i) => i.produto_embalagem_id).map((i) => i.produto_embalagem_id))];

        let enrichedItems = rows;
        if (embIds.length > 0) {
            const { data: embs } = await admin
                .from("view_pdv_produtos")
                .select("id, product_name, descricao, sigla_comercial, volume_formatado, fator_conversao")
                .in("id", embIds as string[]);

            if (embs?.length) {
                const embMap = new Map(embs.map((e) => [e.id, e]));
                enrichedItems = rows.map((item) => ({
                    ...item,
                    _emb: embMap.get(item.produto_embalagem_id as string) || null,
                }));
            }
        }

        let customer: { name: string; phone: string | null; address: string | null } | null = null;
        const customerId = (order as { customer_id?: string | null }).customer_id;
        if (customerId) {
            const { data: cust } = await admin
                .from("customers")
                .select("name, phone, address")
                .eq("id", customerId)
                .maybeSingle();
            if (cust) {
                customer = {
                    name: cust.name ?? "",
                    phone: cust.phone ?? null,
                    address: cust.address ?? null,
                };
            }
        }

        let payments: { payment_method: string; amount: number }[] = [];
        const saleId = (order as { sale_id?: string | null }).sale_id;
        if (saleId) {
            const { data: payRows } = await admin
                .from("sale_payments")
                .select("payment_method, amount")
                .eq("sale_id", saleId)
                .order("amount", { ascending: false });
            payments = (payRows ?? []) as { payment_method: string; amount: number }[];
        }

        return NextResponse.json({
            ok: true,
            order,
            items: enrichedItems,
            customer,
            payments,
        });
    } catch (e: any) {
        console.error("[agent/print-data]", e);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
