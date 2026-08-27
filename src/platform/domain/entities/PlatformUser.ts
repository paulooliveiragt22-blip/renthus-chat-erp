import type { PlatformRole } from "@/lib/platform/platformRoles";

export type PlatformUserEntity = {
    id: string;
    authUserId: string;
    email: string;
    displayName: string;
    role: PlatformRole;
    isActive: boolean;
    mfaRequired: boolean;
    lastLoginAt: string | null;
    createdAt: string;
};

export type PlatformAuditEntry = {
    id: string;
    occurredAt: string;
    actorEmail: string | null;
    actorRole: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    companyId: string | null;
    outcome: string;
};
