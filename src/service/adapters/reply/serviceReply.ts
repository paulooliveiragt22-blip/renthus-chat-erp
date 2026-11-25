import { botReply, botSendButtons, botSendCtaUrl } from "@/lib/chatbot/botSend";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";
import type { ServiceReplyPort } from "@/src/service/ports/serviceTurnPorts";

export function createServiceReply(input: ServiceTurnInput): ServiceReplyPort {
    return {
        async text(body) {
            if (!input.phoneE164.trim()) return;
            await botReply(input.admin, input.companyId, input.threadId, input.phoneE164, body);
        },
        async buttons(body, buttons) {
            if (!input.phoneE164.trim()) return;
            await botSendButtons(
                input.admin,
                input.companyId,
                input.threadId,
                input.phoneE164,
                body,
                buttons,
                input.waConfig
            );
        },
        async cta(body, label, url) {
            if (!input.phoneE164.trim()) return;
            await botSendCtaUrl(
                input.admin,
                input.companyId,
                input.threadId,
                input.phoneE164,
                body,
                label,
                url,
                input.waConfig
            );
        },
    };
}
