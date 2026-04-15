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

    async send(tenant: TenantRef, message: OutboundMessage): Promise<void> {
        if (message.kind === "text") {
            await botReply(this.admin, tenant.companyId, tenant.threadId, tenant.phoneE164, message.text ?? "");
            return;
        }

        if (message.kind === "buttons") {
            await botSendButtons(
                this.admin,
                tenant.companyId,
                tenant.threadId,
                tenant.phoneE164,
                message.text ?? "Como posso ajudar?",
                message.buttons ?? [],
                this.waConfig
            );
            return;
        }

        if (message.kind === "flow" && message.flow) {
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

