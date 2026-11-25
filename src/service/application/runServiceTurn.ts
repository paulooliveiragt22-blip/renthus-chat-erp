import { createServiceModel } from "@/src/service/adapters/ai/runServiceModel";
import { createServiceHandover } from "@/src/service/adapters/handover/serviceHandover";
import { createServiceReply } from "@/src/service/adapters/reply/serviceReply";
import { createServiceDataPort } from "@/src/service/adapters/supabase/serviceRpc";
import { createServiceTrace } from "@/src/service/adapters/trace/serviceTrace";
import { createServiceWallet } from "@/src/service/adapters/wallet/serviceWallet";
import { executeServiceTurn } from "@/src/service/application/executeServiceTurn";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";

export type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";

export async function runServiceTurn(input: ServiceTurnInput): Promise<void> {
    await executeServiceTurn(input, {
        data: createServiceDataPort(input.admin),
        wallet: createServiceWallet(input.admin),
        model: createServiceModel(),
        reply: createServiceReply(input),
        handover: createServiceHandover(input),
        trace: createServiceTrace(input.admin),
    });
}
