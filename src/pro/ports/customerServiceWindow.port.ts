import type { MessagingChannel } from "@/src/domain/contracts/identity";
import type { FreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";

/** Porta: política de janela por canal (bot vs humano). */
export interface CustomerServiceWindowPort {
    resolveFreeForm(params: {
        channel: MessagingChannel | "whatsapp" | "instagram" | "messenger";
        lastInboundAt: string | Date | null | undefined;
        nowMs?: number;
    }): FreeFormSendPolicy;
}
