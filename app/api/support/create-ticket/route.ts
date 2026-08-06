/**
 * POST /api/support/create-ticket
 *
 * Cria ticket de suporte (handover humano) quando cliente clica em "Atendente".
 * Chamado pelo handler de botões do WhatsApp (server-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    company_id,
    customer_phone,
    customer_name,
    message,
    priority,
    thread_id,
    customer_id,
    channel,
  } = body;

  if (!company_id || (!customer_phone && !thread_id)) {
    return NextResponse.json(
      { error: "company_id and (customer_phone or thread_id) required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const phone = typeof customer_phone === "string" ? customer_phone.trim() || null : null;

  // Carrega credenciais do canal da empresa (só se for notificar via WA)
  const { data: channelRow } = await admin
    .from("whatsapp_channels")
    .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
    .eq("company_id", company_id)
    .eq("provider", "meta")
    .eq("status", "active")
    .maybeSingle();

  const waConfig: WaConfig = {
    phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    accessToken:   channelRow ? resolveChannelAccessToken(channelRow) : (process.env.WHATSAPP_TOKEN ?? ""),
  };

  if (thread_id) {
    const { data: existingThread } = await admin
      .from("support_tickets")
      .select("id")
      .eq("company_id", company_id)
      .eq("thread_id", thread_id)
      .in("status", ["open", "in_progress"])
      .maybeSingle();
    if (existingThread?.id) {
      if (phone) {
        await sendWhatsAppMessage(
          phone,
          `📞 Você já possui um atendimento em aberto.\n\nAguarde, em breve entraremos em contato! ⏳`,
          waConfig
        );
      }
      return NextResponse.json({ success: true, ticket_id: existingThread.id, existing: true });
    }
  }

  // Verifica se já existe ticket aberto para este cliente (evita duplicata)
  if (phone) {
    const { data: existing } = await admin
      .from("support_tickets")
      .select("id")
      .eq("company_id", company_id)
      .eq("customer_phone", phone)
      .in("status", ["open", "in_progress"])
      .maybeSingle();

    if (existing?.id) {
      await sendWhatsAppMessage(
        phone,
        `📞 Você já possui um atendimento em aberto.\n\nAguarde, em breve entraremos em contato! ⏳`,
        waConfig
      );
      return NextResponse.json({ success: true, ticket_id: existing.id, existing: true });
    }
  }

  // Cria novo ticket
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      company_id,
      customer_phone: phone,
      customer_id: customer_id ?? null,
      thread_id: thread_id ?? null,
      channel: channel ?? (phone ? "whatsapp" : null),
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

  // Notifica o cliente (só WhatsApp com phone)
  if (phone) {
    await sendWhatsAppMessage(
      phone,
      `📞 *Transferindo para atendente...*\n\n` +
      `Ticket #${ticket.id.slice(0, 8).toUpperCase()}\n\n` +
      `Aguarde alguns instantes. Em breve alguém irá te atender! ⏳`,
      waConfig
    );
  }

  return NextResponse.json({ success: true, ticket_id: ticket.id });
}
