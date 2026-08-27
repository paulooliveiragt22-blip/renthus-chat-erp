import { recordPlatformAudit, type RecordAuditInput } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformAuditRepository } from "@/src/platform/domain/ports/PlatformAuditRepository";

export class RecordPlatformAuditUseCase {
    constructor(private readonly repo: PlatformAuditRepository) {}

    execute(input: RecordAuditInput): Promise<string | null> {
        return this.repo.record(input);
    }
}

export const defaultAuditRepo: PlatformAuditRepository = {
    record: recordPlatformAudit,
    async list() {
        return { rows: [], total: 0 };
    },
};

export const recordPlatformAuditUseCase = new RecordPlatformAuditUseCase(defaultAuditRepo);
