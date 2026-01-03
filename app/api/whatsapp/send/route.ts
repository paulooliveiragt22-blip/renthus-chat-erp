import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type Body = {
    to_phone_e164: string; // ex: +5565999999999
    text: string;
};

function normalizeE164(phone: string) {
    const p = String(phone ?? "").trim();
    if (!p.startsWith("+")) {
        throw new Error("to_phone_e164 must be in E.164 format, ex: +55...");
    }
    return p;
}

async function getOrCreateThread(params: {
    admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
    companyId: string;
    channelId: string;
    phoneE164: string;
}) {
    const { admin, companyId, channelId, phoneE164 } = params;

    // Procura thread do telefone DENTRO da company
    const { data: existing, error: exErr } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();

    if (exErr) throw new Error(exErr.message);

    if (existing?.id) {
        // Atualiza canal e last_message_at (se migrou, a thread acompanha o canal atual)
        await admin
            .from("whatsapp_threads")
            .update({
                channel_id: channelId,
                last_message_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

        return existing.id;
    }

    // Cria nova
    const { data: created, error: insErr } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
            channel_id: channelId,
            phone_e164: phoneE164,
            last_message_at: new Date().toISOString(),
            last_message_preview: null,
        })
        .select("id")
        .single();

    if (insErr || !created?.id) throw new Error(insErr?.message || "Failed to create thread");
    return created.id;
}

export async function POST(req: Request) {
    try {
        const payload = (await req.json()) as Body;

        const toPhone = normalizeE164(payload.to_phone_e164);
        const text = (payload.text ?? "").trim();
        if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

        // Workspace + auth + membership (cookie)
        const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;

        // Canal ativo da company
        const { data: channel, error: chErr } = await admin
            .from("whatsapp_channels")
            .select("id, provider, from_identifier, provider_metadata")
            .eq("company_id", companyId)
            .eq("status", "active")
            .maybeSingle();

        if (chErr || !channel) {
            return NextResponse.json({ error: "No active whatsapp channel for this company" }, { status: 400 });
        }

        // Thread (company + phone)
        const threadId = await getOrCreateThread({
            admin,
            companyId,
            channelId: channel.id,
            phoneE164: toPhone,
        });

        // Envio por provedor
        let providerMessageId: string | null = null;
        let fromAddr = "";
        let toAddr = "";
        let provider: "twilio" | "360dialog" = channel.provider;

        if (channel.provider === "twilio") {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const from = process.env.TWILIO_WHATSAPP_FROM; // whatsapp:+...
            if (!accountSid || !authToken || !from) {
                return NextResponse.json({ error: "Missing Twilio env vars" }, { status: 500 });
            }

            const client = twilio(accountSid, authToken);
            const msg = await client.messages.create({
                from,
                to: `whatsapp:${toPhone}`,
                body: text,
            });

            providerMessageId = msg.sid;
            fromAddr = from;
            toAddr = `whatsapp:${toPhone}`;
            provider = "twilio";
        } else {
            const token = process.env.DIALOG_TOKEN;
            const phoneNumberId = process.env.DIALOG_PHONE_NUMBER_ID;
            const baseUrl = process.env.DIALOG_BASE_URL || "https://graph.facebook.com/v20.0";
            if (!token || !phoneNumberId) {
                return NextResponse.json({ error: "Missing 360dialog env vars" }, { status: 500 });
            }

            const url = `${baseUrl}/${phoneNumberId}/messages`;
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "text",
                    text: { body: text },
                }),
            });

            const json = await res.json().catch(() => ({}));

            if (!res.ok) {
                // grava falha
                await admin.from("whatsapp_messages").insert({
                    thread_id: threadId,
                    direction: "out",
                    channel: "whatsapp",
                    provider: "360dialog",
                    provider_message_id: null,
                    from_addr: "360dialog",
                    to_addr: toPhone,
                    body: text,
                    num_media: 0,
                    status: "failed",
                    error: JSON.stringify(json),
                    raw_payload: json,
                });

                return NextResponse.json({ error: "360dialog send failed", details: json }, { status: 502 });
            }

            providerMessageId = json?.messages?.[0]?.id ?? null;
            fromAddr = "360dialog";
            toAddr = toPhone;
            provider = "360dialog";
        }

        // Grava outbound
        await admin.from("whatsapp_messages").insert({
            thread_id: threadId,
            direction: "out",
            channel: "whatsapp",
            provider,
            provider_message_id: providerMessageId,
            from_addr: fromAddr,
            to_addr: toAddr,
            body: text,
            num_media: 0,
            status: "sent",
            raw_payload: { provider, provider_message_id: providerMessageId },
        });

        // ✅ Atualiza preview + last_message_at da thread (BUGFIX: era thread.id)
        await admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: text.slice(0, 120),
            })
            .eq("id", threadId);

        return NextResponse.json({ ok: true, provider, provider_message_id: providerMessageId });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}
