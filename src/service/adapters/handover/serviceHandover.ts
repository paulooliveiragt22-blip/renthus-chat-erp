import { applyHandover } from "@/lib/chatbot/handover";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";
import type { ServiceHandoverPort } from "@/src/service/ports/serviceTurnPorts";

export function createServiceHandover(input: ServiceTurnInput): ServiceHandoverPort {
    return {
        async handoff(reason) {
            await applyHandover({
                admin: input.admin,
                companyId: input.companyId,
                threadId: input.threadId,
                phoneE164: input.phoneE164,
                customerName: input.profileName ?? null,
                channel: input.messagingChannel ?? "whatsapp",
                reason,
            });
        },
    };
}
