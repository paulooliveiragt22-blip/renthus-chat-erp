/**
 * POST /api/support/create-ticket
 *
 * Cria ticket de suporte (handover humano).
 * A1: company_id só do workspace autenticado — nunca do body (OWASP multi-tenant).
 * Handover do bot Pro usa applyHandover direto no worker (não esta rota).
 */

import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { resolveChannelAccessToken } from "@/lib/whatsapp/channelCredentials";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const access = await requireCompanyAccess({
    allowedRoles: ["owner", "admin", "member"],
    mutating: true,
  });
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: access.code },
      { status: access.status }
    );
  }
  const { admin, companyId } = access;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const customer_phone = body.customer_phone;
  const customer_name = body.customer_name;
  const message = body.message;
  const priority = body.priority;
  const thread_id = body.thread_id;
  const customer_id = body.customer_id;
  const channel = body.channel;

  const phone = typeof customer_phone === "string" ? customer_phone.trim() || null : null;
  const threadId = typeof thread_id === "string" ? thread_id.trim() || null : null;

  if (!phone && !threadId) {
    return NextResponse.json(
      { error: "customer_phone or thread_id required" },
      { status: 400 }
    );
  }

  const { data: channelRow } = await admin
    .from("whatsapp_channels")
    .select("from_identifier, provider_metadata, encrypted_access_token, waba_id")
    .eq("company_id", companyId)
    .eq("provider", "meta")
    .eq("status", "active")
    .maybeSingle();

  const waConfig: WaConfig = {
    phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    accessToken: channelRow
      ? resolveChannelAccessToken(channelRow)
      : (process.env.WHATSAPP_TOKEN ?? ""),
  };

  if (threadId) {
    const { data: existingThread } = await admin
      .from("support_tickets")
      .select("id")
      .eq("company_id", companyId)
      .eq("thread_id", threadId)
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

  if (phone) {
    const { data: existing } = await admin
      .from("support_tickets")
      .select("id")
      .eq("company_id", companyId)
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

  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      company_id: companyId,
      customer_phone: phone,
      customer_id: typeof customer_id === "string" ? customer_id : null,
      thread_id: threadId,
      channel: typeof channel === "string" ? channel : phone ? "whatsapp" : null,
      customer_name: typeof customer_name === "string" ? customer_name : null,
      message:
        typeof message === "string"
          ? message
          : "Cliente solicitou atendimento humano via WhatsApp",
      priority: typeof priority === "string" ? priority : "normal",
      status: "open",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
