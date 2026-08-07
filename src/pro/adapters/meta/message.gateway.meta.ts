import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import type { OutboundMessage, TenantRef } from "@/src/types/contracts";
import type { MessageGateway } from "../../ports/message.gateway";
import {
    loadActiveMetaChannelByCompany,
    resolvePageAccessToken,
} from "@/lib/meta/messagingChannels";
import { sendMetaPageQuickReplies, sendMetaPageText } from "@/lib/meta/sendMetaMessage";
import { resolveFreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";

/**
 * MessageGateway para Instagram / Messenger (Send API da Page).
 * Flows WhatsApp não existem nestes canais → degradam para texto.
 * B4: fora da janela 24h o bot silencia (sem HSM / sem Message Tag).
 */
export class MetaMessageGateway implements MessageGateway {
    constructor(
        private readonly admin: SupabaseClient,
        private readonly channel: Extract<MessagingChannel, "instagram" | "messenger">
    ) {}

    private async assertWithinServiceWindow(tenant: TenantRef): Promise<boolean> {
        if (!tenant.threadId) return false;
        const { data } = await this.admin
            .from("whatsapp_threads")
            .select("last_inbound_at")
            .eq("id", tenant.threadId)
            .maybeSingle();
        const policy = resolveFreeFormSendPolicy({
            channel: this.channel,
            lastInboundAt: (data?.last_inbound_at as string | null) ?? null,
        });
        if (!policy.allowAutomated) {
            console.info("[pro/meta] skip send outside window", {
                channel: this.channel,
                threadId: tenant.threadId,
                reason: policy.reason,
            });
            return false;
        }
        return true;
    }

    private recipientId(tenant: TenantRef): string {
        return (tenant.channelUserId || tenant.phoneE164 || "").trim();
    }

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

    private async persistOutbound(params: {
        tenant: TenantRef;
        body: string;
        providerMessageId?: string;
    }): Promise<void> {
        const recipient = this.recipientId(params.tenant);
        await this.admin.from("whatsapp_messages").insert({
            thread_id: params.tenant.threadId,
            direction: "outbound",
            sender_type: "bot",
            channel: this.channel,
            provider: "meta",
            body: params.body,
            provider_message_id: params.providerMessageId ?? null,
            to_addr: recipient || null,
            status: "sent",
        });
    }

    async send(tenant: TenantRef, message: OutboundMessage): Promise<void> {
        const recipient = this.recipientId(tenant);
        if (!recipient) {
            console.error("[pro/meta] missing channelUserId/phone for send", {
                companyId: tenant.companyId,
                threadId: tenant.threadId,
                channel: this.channel,
            });
            return;
        }

        if (!(await this.assertWithinServiceWindow(tenant))) {
            return;
        }

        const row = await loadActiveMetaChannelByCompany(this.admin, tenant.companyId);
        if (!row) {
            console.error("[pro/meta] no active meta_messaging_channels", tenant.companyId);
            return;
        }
        const accessToken = resolvePageAccessToken(row);
        if (!accessToken) {
            console.error("[pro/meta] missing page access token", tenant.companyId);
            return;
        }

        if (message.kind === "text" || message.kind === "flow" || message.kind === "cta_url") {
            const text =
                message.kind === "flow"
                    ? (message.flow?.bodyText ?? message.text ?? "")
                    : message.kind === "cta_url"
                      ? `${message.ctaUrl?.bodyText ?? ""}\n\n${message.ctaUrl?.url ?? ""}`.trim()
                      : (message.text ?? "");
            if (!text.trim()) return;
            if (await this.isRecentDuplicateText(tenant, text)) return;
            const result = await sendMetaPageText({
                pageId: row.page_id,
                accessToken,
                recipientId: recipient,
                text,
            });
            if (!result.ok) {
                console.error("[pro/meta] send text failed:", result.error);
                return;
            }
            await this.persistOutbound({
                tenant,
                body: text,
                providerMessageId: result.messageId,
            });
            return;
        }

        if (message.kind === "buttons") {
            const text = message.text ?? "Como posso ajudar?";
            const buttons = message.buttons ?? [];
            if (!buttons.length) return;
            const result = await sendMetaPageQuickReplies({
                pageId: row.page_id,
                accessToken,
                recipientId: recipient,
                text,
                buttons,
            });
            if (!result.ok) {
                console.error("[pro/meta] send buttons failed:", result.error);
                return;
            }
            await this.persistOutbound({ tenant, body: text });
        }
    }
}
