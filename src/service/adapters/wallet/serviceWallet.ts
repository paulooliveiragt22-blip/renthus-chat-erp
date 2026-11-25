import type { SupabaseClient } from "@supabase/supabase-js";
import { beginAiTurn, debitFromAnthropicUsage, releaseAiTurn } from "@/lib/billing/aiWallet";
import type { ServiceWalletPort } from "@/src/service/ports/serviceTurnPorts";

export function createServiceWallet(admin: SupabaseClient): ServiceWalletPort {
    return {
        async begin(companyId, idempotencyKey) {
            const begun = await beginAiTurn(admin, companyId, idempotencyKey);
            return { allowed: begun.allowed };
        },
        async settle(companyId, turnKey, model, inputTokens, outputTokens) {
            await debitFromAnthropicUsage(
                admin,
                companyId,
                { input_tokens: inputTokens, output_tokens: outputTokens },
                {
                    turn_key: turnKey,
                    step_key: `${turnKey}:service`,
                    model,
                }
            );
        },
        async release(companyId, turnKey) {
            await releaseAiTurn(admin, companyId, turnKey);
        },
    };
}
