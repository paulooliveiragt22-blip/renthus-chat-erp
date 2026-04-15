import type { OutboundMessage, TenantRef } from "@/src/types/contracts";

export interface MessageGateway {
    send(tenant: TenantRef, message: OutboundMessage): Promise<void>;
}

