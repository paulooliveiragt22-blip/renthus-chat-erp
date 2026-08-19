import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, TenantRef } from "@/src/types/contracts";
import type { MessageGateway } from "../../ports/message.gateway";
import { botReply, botSendButtons, botSendCtaUrl } from "@/lib/chatbot/botSend";
import type { WaConfig } from "@/lib/whatsapp/send";

export class WhatsAppMessageGateway implements MessageGateway {
    constructor(
        private readonly admin: SupabaseClient,
        private readonly waConfig?: WaConfig
    ) {}

    private async isRecentDuplicateText(tenant: TenantRef, text: string): Promise<boolean> {
        const body = text.trim();
        if (!tenant.threadId || !body) return false;
        const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data } = await this.admin
            .from("whatsapp_messages")
            .select("id")
            .eq("thread_id", tenant.threadId)
            .eq("direction", "outbound")
            .eq("sender_type", "bot")
            .eq("body", body)
            .gte("created_at", since)
            .limit(1);
        return Boolean(data?.length);
    }

    /**
     * `botSendButtons`/`botSendCtaUrl` (lib/whatsapp/send.ts) só chamam a
     * Graph API da Meta — diferente de `botReply` (texto simples), que já persiste via
     * `sendWhatsAppMessage` (lib/whatsapp/sendMessage.ts). Sem isto, mensagens interativas
     * eram entregues de verdade ao cliente mas nunca apareciam em `whatsapp_messages`
     * (invisíveis no Inbox admin e em qualquer consulta de auditoria/replay).
     */
    private async persistOutbound(params: {
        tenant: TenantRef;
        body: string;
        providerMessageId?: string;
        rawPayload?: Record<string, unknown>;
    }): Promise<void> {
        const { tenant, body, providerMessageId, rawPayload } = params;
        if (!tenant.threadId) return;
        /** `from_addr`/`to_addr` são NOT NULL — sem placeholder o insert falha em silêncio (sem lançar). */
        const fromAddr = this.waConfig?.phoneNumberId
            ? `whatsapp:${this.waConfig.phoneNumberId}`
            : "whatsapp";
        const { error: insertErr } = await this.admin.from("whatsapp_messages").insert({
            thread_id: tenant.threadId,
            direction: "outbound",
            channel: "whatsapp",
            provider: "meta",
            provider_message_id: providerMessageId ?? null,
            from_addr: fromAddr,
            to_addr: tenant.phoneE164 || fromAddr,
            body,
            num_media: 0,
            status: "sent",
            sender_type: "bot",
            raw_payload: rawPayload ?? null,
        });
        if (insertErr) {
            console.error("[pro/whatsapp] persistOutbound insert failed:", insertErr.message);
            return;
        }
        await this.admin
            .from("whatsapp_threads")
            .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: body.slice(0, 120),
            })
            .eq("id", tenant.threadId);
    }

    async send(tenant: TenantRef, message: OutboundMessage): Promise<void> {
        if (message.kind === "text") {
            const text = message.text ?? "";
            if (!text.trim()) return;
            if (await this.isRecentDuplicateText(tenant, text)) return;
            await botReply(this.admin, tenant.companyId, tenant.threadId, tenant.phoneE164, text);
            return;
        }

        if (message.kind === "buttons") {
            const text = message.text ?? "Como posso ajudar?";
            const buttons = message.buttons ?? [];
            /**
             * Não deduplicar só pelo body: clarificações repetem "Qual opcao..."
             * com botões diferentes (Heineken → salgadinho → trezentinha).
             */
            if (!buttons.length) return;
            const result = await botSendButtons(
                this.admin,
                tenant.companyId,
                tenant.threadId,
                tenant.phoneE164,
                text,
                buttons,
                this.waConfig
            );
            if (result?.ok === false) {
                /** Fallback: lista numerada em texto (cliente responde 1/2/3). Evita "problema técnico". */
                console.error("[pro/whatsapp] buttons failed, fallback text:", result.error);
                await botReply(
                    this.admin,
                    tenant.companyId,
                    tenant.threadId,
                    tenant.phoneE164,
                    text
                );
                return;
            }
            await this.persistOutbound({
                tenant,
                body: text,
                providerMessageId: result?.messageId,
                rawPayload: { kind: "buttons", buttons },
            });
            return;
        }

        if (message.kind === "cta_url" && message.ctaUrl) {
            const { bodyText, displayText, url } = message.ctaUrl;
            if (!url.trim()) return;
            if (await this.isRecentDuplicateText(tenant, bodyText)) return;
            const result = await botSendCtaUrl(
                this.admin,
                tenant.companyId,
                tenant.threadId,
                tenant.phoneE164,
                bodyText,
                displayText,
                url,
                this.waConfig
            );
            if (result?.ok === false) {
                console.error("[pro/whatsapp] cta_url failed, fallback text:", result.error);
                await botReply(
                    this.admin,
                    tenant.companyId,
                    tenant.threadId,
                    tenant.phoneE164,
                    `${bodyText}\n\n${url}`
                );
                return;
            }
            await this.persistOutbound({
                tenant,
                body: bodyText,
                providerMessageId: result?.messageId,
                rawPayload: { kind: "cta_url", displayText, url },
            });
            return;
        }
    }
}

