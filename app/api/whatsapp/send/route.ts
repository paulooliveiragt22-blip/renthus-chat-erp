import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { checkLimit, requireFeature } from "@/lib/billing/entitlements";

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

// imports mantidos...
export async function POST(req: Request) {
    try {
        const payload = (await req.json()) as Body;
        const toPhone = normalizeE164(payload.to_phone_e164);
        const text = (payload.text ?? "").trim();
        if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

        const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const { admin, companyId } = ctx;

        try {
            await requireFeature(admin, companyId, "whatsapp_messages");
        } catch (e: any) {
            return NextResponse.json({ error: e?.message ?? "Feature not enabled" }, { status: 403 });
        }

        // 1) Atomic check & reserve (RPC)
        const { data: rpcData, error: rpcErr } = await admin
            .rpc('check_and_increment_usage', { p_company: companyId, p_feature: 'whatsapp_messages', p_amount: 1 });

        if (rpcErr) {
            console.error("RPC error", rpcErr);
            return NextResponse.json({ error: "rpc_error" }, { status: 500 });
        }
        const usage = rpcData as any;
        if (!usage?.allowed) {
            return NextResponse.json({ error: "message_limit_reached", usage }, { status: 402 });
        }

        // 2) Channel & thread
        const { data: channel, error: chErr } = await admin
            .from("whatsapp_channels")
            .select("id, provider, from_identifier, provider_metadata")
            .eq("company_id", companyId)
            .eq("status", "active")
            .maybeSingle();
        if (chErr || !channel) {
            // release reservation
            await admin.rpc('decrement_monthly_usage', { p_company: companyId, p_feature: 'whatsapp_messages', p_amount: 1 });
            return NextResponse.json({ error: "No active whatsapp channel for this company" }, { status: 400 });
        }
        const threadId = await getOrCreateThread({ admin, companyId, channelId: channel.id, phoneE164: toPhone });

        // 3) Insert a pending whatsapp_messages row with provider = null (so trigger won't increment)
        const { data: created, error: insErr } = await admin
            .from("whatsapp_messages")
            .insert({
                thread_id: threadId,
                direction: "out",
                channel: "whatsapp",
                provider: null,                // IMPORTANT: leave null to avoid trigger counting
                provider_message_id: null,
                from_addr: null,
                to_addr: toPhone,
                body: text,
                num_media: 0,
                status: "pending",
                raw_payload: null
            })
            .select("id")
            .single();

        if (insErr || !created?.id) {
            // rollback reservation
            await admin.rpc('decrement_monthly_usage', { p_company: companyId, p_feature: 'whatsapp_messages', p_amount: 1 });
            return NextResponse.json({ error: "failed_to_create_message_record" }, { status: 500 });
        }

        const messageId = created.id;

        // 4) Send via provider
        let providerMessageId: string | null = null;
        let fromAddr = "";
        let toAddr = "";
        let provider: "twilio" | "360dialog" = channel.provider;

        try {
            if (channel.provider === "twilio") {
                const accountSid = process.env.TWILIO_ACCOUNT_SID!;
                const authToken = process.env.TWILIO_AUTH_TOKEN!;
                const from = process.env.TWILIO_WHATSAPP_FROM!;
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
                // 360dialog send (same logic as before)...
                const token = process.env.DIALOG_TOKEN!;
                const phoneNumberId = process.env.DIALOG_PHONE_NUMBER_ID!;
                const baseUrl = process.env.DIALOG_BASE_URL || "https://graph.facebook.com/v20.0";
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
                if (!res.ok) throw new Error("360dialog failed: " + JSON.stringify(json));
                providerMessageId = json?.messages?.[0]?.id ?? null;
                fromAddr = "360dialog";
                toAddr = toPhone;
                provider = "360dialog";
            }

            // 5) Update message record with provider metadata (no trigger increment because update)
            await admin.from("whatsapp_messages").update({
                provider,
                provider_message_id: providerMessageId,
                from_addr: fromAddr,
                to_addr: toAddr,
                status: "sent",
                raw_payload: { provider, provider_message_id: providerMessageId, sent_at: new Date().toISOString() }
            }).eq("id", messageId);

            // 6) Update thread preview
            await admin.from("whatsapp_threads").update({
                last_message_at: new Date().toISOString(),
                last_message_preview: text.slice(0, 120)
            }).eq("id", threadId);

            return NextResponse.json({ ok: true, provider, provider_message_id: providerMessageId, usage });

        } catch (sendErr: any) {
            // On send error: mark message failed and decrement usage reservation
            await admin.from("whatsapp_messages").update({
                status: "failed",
                error: String(sendErr?.message ?? sendErr),
                raw_payload: { error: String(sendErr?.message ?? sendErr) }
            }).eq("id", messageId);

            // release reserved usage
            await admin.rpc('decrement_monthly_usage', { p_company: companyId, p_feature: 'whatsapp_messages', p_amount: 1 });

            return NextResponse.json({ error: "send_failed", details: String(sendErr?.message ?? sendErr) }, { status: 502 });
        }

    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
    }
}

