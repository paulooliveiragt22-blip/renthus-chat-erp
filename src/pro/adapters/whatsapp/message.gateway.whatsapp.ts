import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, TenantRef } from "@/src/types/contracts";
import type { MessageGateway } from "../../ports/message.gateway";
import { botReply, botSendButtons } from "@/lib/chatbot/botSend";
import { sendFlowMessage, type WaConfig } from "@/lib/whatsapp/send";

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

    async send(tenant: TenantRef, message: OutboundMessage): Promise<void> {
        if (message.kind === "text") {
            const text = message.text ?? "";
            if (await this.isRecentDuplicateText(tenant, text)) return;
            await botReply(this.admin, tenant.companyId, tenant.threadId, tenant.phoneE164, text);
            return;
        }

        if (message.kind === "buttons") {
            const text = message.text ?? "Como posso ajudar?";
            if (await this.isRecentDuplicateText(tenant, text)) return;
            await botSendButtons(
                this.admin,
                tenant.companyId,
                tenant.threadId,
                tenant.phoneE164,
                text,
                message.buttons ?? [],
                this.waConfig
            );
            return;
        }

        if (message.kind === "flow" && message.flow) {
            if (await this.isRecentDuplicateText(tenant, message.flow.bodyText)) return;
            await sendFlowMessage(
                tenant.phoneE164,
                {
                    flowId: message.flow.flowId,
                    flowToken: message.flow.flowToken,
                    ctaLabel: message.flow.ctaLabel,
                    bodyText: message.flow.bodyText,
                },
                this.waConfig
            );
        }
    }
}

