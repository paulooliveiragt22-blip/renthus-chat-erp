import type { ProSessionState } from "@/src/types/contracts";

export interface SessionRepository {
    load(companyId: string, threadId: string): Promise<ProSessionState | null>;
    save(companyId: string, threadId: string, state: ProSessionState): Promise<void>;
}

