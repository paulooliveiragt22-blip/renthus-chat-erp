/**
 * GET /api/orders/by-phone?phone=+5566999991234&company_id=xxx&limit=5
 *
 * Retorna últimos pedidos de um cliente pelo telefone.
 * Chamado pelo Flow Status (server-side, sem auth de usuário).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const phone     = searchParams.get("phone");
  const companyId = searchParams.get("company_id");
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "5"), 10);

  if (!phone || !companyId) {
    return NextResponse.json({ error: "phone and company_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Normaliza o telefone (com ou sem +)
  const phoneNorm = phone.startsWith("+") ? phone : `+${phone}`;

  // Busca via customer_id → customers.phone
  const { data: orders, error } = await admin
    .from("orders")
    .select(`
      id,
      created_at,
      status,
      confirmation_status,
      total_amount,
      delivery_fee,
      delivery_address,
      payment_method,
      change_for,
      source,
      customers!inner ( name, phone ),
      order_items ( product_name, quantity, unit_price, line_total )
    `)
    .eq("company_id", companyId)
    .eq("customers.phone", phoneNorm)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const formatted = (orders ?? []).map((o: any) => ({
    id:               o.id.slice(0, 8).toUpperCase(),
    full_id:          o.id,
    date:             new Date(o.created_at).toLocaleDateString("pt-BR"),
    time:             new Date(o.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit", minute: "2-digit"
                      }),
    status_emoji:     getStatusEmoji(o.status, o.confirmation_status),
    status_text:      getStatusText(o.status, o.confirmation_status),
    total:            parseFloat(o.total_amount ?? 0),
    delivery_address: o.delivery_address ?? "",
    payment_method:   formatPayment(o.payment_method),
    change_for:       o.change_for ? parseFloat(o.change_for) : null,
    items:            (o.order_items ?? []).map((i: any) => ({
                        name:       i.product_name,
                        quantity:   i.quantity,
                        unit_price: parseFloat(i.unit_price ?? 0),
                        subtotal:   parseFloat(i.line_total ?? 0),
                      })),
  }));

  return NextResponse.json({ orders: formatted, total: formatted.length });
}

function getStatusEmoji(status: string, confirmationStatus: string): string {
  if (confirmationStatus === "pending_confirmation") return "⏳";
  if (confirmationStatus === "rejected")             return "❌";
  if (status === "new")                              return "✅";
  if (status === "delivered")                        return "🚚";
  if (status === "finalized")                        return "✅";
  if (status === "canceled")                         return "❌";
  return "📦";
}

function getStatusText(status: string, confirmationStatus: string): string {
  if (confirmationStatus === "pending_confirmation") return "Aguardando confirmação";
  if (confirmationStatus === "rejected")             return "Pedido rejeitado";
  if (status === "new")                              return "Confirmado";
  if (status === "delivered")                        return "Entregue";
  if (status === "finalized")                        return "Finalizado";
  if (status === "canceled")                         return "Cancelado";
  return "Processando";
}

function formatPayment(method: string): string {
  const labels: Record<string, string> = {
    pix:  "PIX",
    card: "Cartão",
    cash: "Dinheiro",
  };
  return labels[method] ?? method ?? "";
}
