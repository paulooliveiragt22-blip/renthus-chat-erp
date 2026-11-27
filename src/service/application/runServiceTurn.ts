import { createServiceModel } from "@/src/service/adapters/ai/runServiceModel";
import { loadWhatsappPriorTurns } from "@/src/service/adapters/whatsapp/priorTurns";
import { createServiceHandover } from "@/src/service/adapters/handover/serviceHandover";
import { createServiceReply } from "@/src/service/adapters/reply/serviceReply";
import { createGoogleCalendarPort } from "@/src/service/adapters/google/googleCalendarPort";
import { createServiceDataPort } from "@/src/service/adapters/supabase/serviceRpc";
import { createServiceTrace } from "@/src/service/adapters/trace/serviceTrace";
import { createServiceWallet } from "@/src/service/adapters/wallet/serviceWallet";
import { executeServiceTurn } from "@/src/service/application/executeServiceTurn";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";

export type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";

export async function runServiceTurn(input: ServiceTurnInput): Promise<void> {
    const priorTurns =
        input.priorTurns ??
        (input.messagingChannel === "site"
            ? []
            : await loadWhatsappPriorTurns(input.admin, input.threadId, input.messageId));
    await executeServiceTurn({ ...input, priorTurns }, {
        data: createServiceDataPort(input.admin),
        wallet: createServiceWallet(input.admin),
        model: createServiceModel(),
        reply: createServiceReply(input),
        handover: createServiceHandover(input),
        trace: createServiceTrace(input.admin),
        calendar: createGoogleCalendarPort(input.admin),
    });
}
