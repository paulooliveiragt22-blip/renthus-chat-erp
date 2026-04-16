import type { ProSessionState, TenantRef } from "@/src/types/contracts";
import type { SessionRepository } from "../../ports/session.repository";
import { ProPipelineSessionLoadError } from "../errors";

export function createInitialProState(): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
    };
}

export async function loadState(params: {
    sessionRepo: SessionRepository;
    tenant: TenantRef;
}): Promise<ProSessionState> {
    const { sessionRepo, tenant } = params;
    try {
        const loaded = await sessionRepo.load(tenant.companyId, tenant.threadId);
        return loaded ?? createInitialProState();
    } catch (cause) {
        throw new ProPipelineSessionLoadError(
            { companyId: tenant.companyId, threadId: tenant.threadId },
            { cause }
        );
    }
}

