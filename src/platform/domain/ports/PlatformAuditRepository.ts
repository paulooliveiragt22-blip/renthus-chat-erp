import type { PlatformAuditEntry } from "../entities/PlatformAuditEntry";
import type { RecordAuditInput } from "@/lib/platform/audit/recordPlatformAudit";

export interface PlatformAuditRepository {
    record(input: RecordAuditInput): Promise<string | null>;
    list(filters: {
        limit: number;
        offset: number;
        companyId?: string;
        action?: string;
    }): Promise<{ rows: PlatformAuditEntry[]; total: number }>;
}
