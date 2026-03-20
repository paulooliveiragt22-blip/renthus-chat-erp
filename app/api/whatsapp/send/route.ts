import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { checkLimit, requireFeature } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

type Body =
    | {
          to_phone_e164: string; // ex: +5565999999999
          text: string;
          kind?: "text";
      }
    | {
          to_phone_e164: string;
          kind: "image" | "video" | "audio" | "document";
          media_url: string;
          caption?: string;
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
        const kind = (payload as any).kind ?? "text";

        if (kind === "text") {
            const text = ((payload as any).text ?? "").trim();
            if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
        } else {
            const mediaUrl = (payload as any).media_url;
            if (!mediaUrl) return NextResponse.json({ error: "media_url is required for media messages" }, { status: 400 });
        }

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
        const fromPlaceholder = String(channel.from_identifier ?? "");

        const { data: created, error: insErr } = await admin
            .from("whatsapp_messages")
            .insert({
                thread_id: threadId,
                direction: "outbound",
                channel: "whatsapp",
                provider: null, // IMPORTANT: leave null to avoid trigger counting
                provider_message_id: null,
                from_addr: fromPlaceholder || "whatsapp",
                to_addr: toPhone,
                body: kind === "text" ? (payload as any).text ?? "" : (payload as any).caption ?? null,
                num_media: kind === "text" ? 0 : 1,
                status: "pending",
                raw_payload: null,
            })
            .select("id")
            .single();

        if (insErr || !created?.id) {
            // rollback reservation
            await admin.rpc('decrement_monthly_usage', { p_company: companyId, p_feature: 'whatsapp_messages', p_amount: 1 });
            console.error("[whatsapp/send] failed_to_create_message_record:", {
                code: insErr?.code,
                message: insErr?.message,
                details: insErr?.details,
                hint: insErr?.hint,
            });
            return NextResponse.json(
                {
                    error: "failed_to_create_message_record",
                    code: insErr?.code,
                    message: insErr?.message,
                    details: insErr?.details,
                    hint: insErr?.hint,
                },
                { status: 500 }
            );
        }

        const messageId = created.id;

        // 4) Send via Meta WhatsApp Cloud API (único provider)
        let providerMessageId: string | null = null;
        let fromAddr = "";
        let toAddr = "";
        const provider: "meta" = "meta";

        try {
            const pm = (channel as any).provider_metadata ?? {};
            const token = pm.access_token ?? process.env.WHATSAPP_TOKEN!;
            const phoneNumberId = pm.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID!;
            const baseUrl = pm.base_url ?? process.env.WHATSAPP_BASE_URL ?? "https://graph.facebook.com/v20.0";

            const url = `${baseUrl}/${phoneNumberId}/messages`;
            let bodyPayload: any;

            if (kind === "text") {
                const text = ((payload as any).text ?? "").trim();
                bodyPayload = {
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "text",
                    text: { body: text },
                };
            } else if (kind === "image") {
                bodyPayload = {
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "image",
                    image: {
                        link: (payload as any).media_url,
                        caption: (payload as any).caption ?? undefined,
                    },
                };
            } else if (kind === "video") {
                bodyPayload = {
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "video",
                    video: {
                        link: (payload as any).media_url,
                        caption: (payload as any).caption ?? undefined,
                    },
                };
            } else if (kind === "audio") {
                bodyPayload = {
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "audio",
                    audio: {
                        link: (payload as any).media_url,
                    },
                };
            } else {
                // document
                bodyPayload = {
                    messaging_product: "whatsapp",
                    to: toPhone.replace("+", ""),
                    type: "document",
                    document: {
                        link: (payload as any).media_url,
                        caption: (payload as any).caption ?? undefined,
                    },
                };
            }

            const res = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(bodyPayload),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error("meta_send_failed: " + JSON.stringify(json));

            providerMessageId = json?.messages?.[0]?.id ?? null;
            fromAddr = String(channel.from_identifier ?? `whatsapp:${phoneNumberId}`);
            toAddr = toPhone;

            // 5) Update message record with provider metadata (no trigger increment because update)
            await admin
                .from("whatsapp_messages")
                .update({
                    provider,
                    provider_message_id: providerMessageId,
                    from_addr: fromAddr,
                    to_addr: toAddr,
                    status: "sent",
                    raw_payload: { provider, provider_message_id: providerMessageId, sent_at: new Date().toISOString() },
                })
                .eq("id", messageId);

            // 6) Update thread preview (texto ou caption para mídia)
            const previewText =
                kind === "text"
                    ? ((payload as any).text ?? "").trim().slice(0, 120)
                    : (((payload as any).caption ?? "").trim().slice(0, 120)) ||
                      (kind === "image" ? "[imagem]" : kind === "video" ? "[vídeo]" : kind === "audio" ? "[áudio]" : "[documento]");
            await admin
                .from("whatsapp_threads")
                .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: previewText || null,
                })
                .eq("id", threadId);

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

