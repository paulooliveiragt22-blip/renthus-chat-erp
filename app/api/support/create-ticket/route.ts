/**
 * POST /api/support/create-ticket
 *
 * Cria ticket de suporte (handover humano) quando cliente clica em "Atendente".
 * Chamado pelo handler de botões do WhatsApp (server-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { company_id, customer_phone, customer_name, message, priority } = body;

  if (!company_id || !customer_phone) {
    return NextResponse.json(
      { error: "company_id and customer_phone required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Verifica se já existe ticket aberto para este cliente (evita duplicata)
  const { data: existing } = await admin
    .from("support_tickets")
    .select("id")
    .eq("company_id", company_id)
    .eq("customer_phone", customer_phone)
    .in("status", ["open", "in_progress"])
    .maybeSingle();

  if (existing?.id) {
    // Ticket já existe — apenas confirma pro cliente
    await sendWhatsAppMessage(
      customer_phone,
      `📞 Você já possui um atendimento em aberto.\n\nAguarde, em breve entraremos em contato! ⏳`
    );
    return NextResponse.json({ success: true, ticket_id: existing.id, existing: true });
  }

  // Cria novo ticket
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      company_id,
      customer_phone,
      customer_name: customer_name ?? null,
      message:       message ?? "Cliente solicitou atendimento humano via WhatsApp",
      priority:      priority ?? "normal",
      status:        "open",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notifica o cliente
  await sendWhatsAppMessage(
    customer_phone,
    `📞 *Transferindo para atendente...*\n\n` +
    `Ticket #${ticket.id.slice(0, 8).toUpperCase()}\n\n` +
    `Aguarde alguns instantes. Em breve alguém irá te atender! ⏳`
  );

  return NextResponse.json({ success: true, ticket_id: ticket.id });
}
